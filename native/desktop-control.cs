// Windows-only, unelevated, selected-window automation. No commands or scripts are evaluated.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Automation;

class DesktopControl {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr arg);
  delegate bool EnumProc(IntPtr h, IntPtr arg);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint first,uint second,bool attach);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder info,uint length,out uint needed);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SetProp(IntPtr h, string name, IntPtr value);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr h, string name);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] input, int size);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int l,t,r,b; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x,y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx,dy; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT key; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  static JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength=16000000 };
  static IntPtr target;
  static string identity, frame;
  static DateTime captured;
  static int width,height,imageWidth,imageHeight,steps;
  static int excluded;
  const string grantProperty="GrokWorkbench.DesktopControl.Grant";
  static IntPtr grantStamp=new IntPtr(DateTime.UtcNow.Ticks ^ ((long)Process.GetCurrentProcess().Id << 32));
  static Dictionary<string, AutomationElement> refs = new Dictionary<string, AutomationElement>();
  static string S(Dictionary<string,object> a,string k) { object v; return a.TryGetValue(k,out v) ? Convert.ToString(v) : ""; }
  static int N(Dictionary<string,object> a,string k,int fallback) { object v; return a.TryGetValue(k,out v) ? Convert.ToInt32(v) : fallback; }
  static object[] Array(object value){var list=value as System.Collections.IEnumerable;var result=new List<object>();if(list!=null && !(value is string))foreach(object item in list)result.Add(item);return result.ToArray();}
  static string Id(IntPtr h) { uint pid; GetWindowThreadProcessId(h,out pid); using(var p=Process.GetProcessById((int)pid)) return h.ToInt64()+":"+pid+":"+p.StartTime.ToUniversalTime().Ticks; }
  static string Title(IntPtr h) { var b=new StringBuilder(513); GetWindowText(h,b,b.Capacity); return b.ToString(); }
  static string ObjectName(IntPtr handle){var b=new StringBuilder(256);uint needed;return handle!=IntPtr.Zero&&GetUserObjectInformation(handle,2,b,512,out needed)?b.ToString():"unavailable";}
  static object InputStatus(){var input=OpenInputDesktop(0,false,1);int error=input==IntPtr.Zero?Marshal.GetLastWin32Error():0;string name=ObjectName(input);if(input!=IntPtr.Zero)CloseDesktop(input);return new{foregroundAvailable=GetForegroundWindow()!=IntPtr.Zero,windowStation=ObjectName(GetProcessWindowStation()),threadDesktop=ObjectName(GetThreadDesktop(GetCurrentThreadId())),inputDesktop=name,inputError=error};}
  static void Check() { if(target==IntPtr.Zero || !IsWindow(target) || !IsWindowVisible(target) || Id(target)!=identity || GetProp(target,grantProperty)!=grantStamp) throw new Exception("Selected window closed or changed. Select it again in Workbench."); }
  static void Foreground() {
    Check();SetForegroundWindow(target);System.Threading.Thread.Sleep(100);if(GetForegroundWindow()==target)return;
    IntPtr foreground=GetForegroundWindow();if(foreground==IntPtr.Zero)throw new Exception("Windows has no foreground input target. Unlock the desktop and bring the selected window forward.");
    uint pid,current=GetCurrentThreadId(),focusThread=GetWindowThreadProcessId(foreground,out pid),targetThread=GetWindowThreadProcessId(target,out pid);bool focusAttached=false,targetAttached=false;
    try{if(focusThread!=current)focusAttached=AttachThreadInput(current,focusThread,true);if(targetThread!=current&&targetThread!=focusThread)targetAttached=AttachThreadInput(current,targetThread,true);BringWindowToTop(target);SetForegroundWindow(target);System.Threading.Thread.Sleep(100);}
    finally{if(targetAttached)AttachThreadInput(current,targetThread,false);if(focusAttached)AttachThreadInput(current,focusThread,false);}
    if(GetForegroundWindow()!=target)throw new Exception("Selected window cannot receive input. Bring it to the foreground and retry.");
  }
  static void Fresh(Dictionary<string,object> a) {
    Check(); RECT r; GetClientRect(target,out r);
    if(frame==null || S(a,"frame")!=frame || (DateTime.UtcNow-captured).TotalSeconds>30 || r.r!=width || r.b!=height) throw new Exception("Stale view. Take another screenshot before acting.");
    if(++steps>200) throw new Exception("Window action limit reached. Re-enable desktop control in Workbench.");
    Foreground(); frame=null;
  }
  static void Send(INPUT[] inputs) { if(GetForegroundWindow()!=target || SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)))!=inputs.Length) throw new Exception("Windows blocked input (elevated/protected applications are unsupported)."); }
  static INPUT K(ushort key,ushort scan,uint flags) { return new INPUT { type=1,u=new UNION { key=new KEYBDINPUT { vk=key,scan=scan,flags=flags } } }; }
  static void Mouse(uint flags,uint data) { Send(new[]{new INPUT {type=0,u=new UNION {mouse=new MOUSEINPUT {flags=flags,data=data}}}}); }
  static void Move(Dictionary<string,object> a,string xKey,string yKey) {
    int x=N(a,xKey,-1),y=N(a,yKey,-1);
    if(x<0 || y<0 || x>=imageWidth || y>=imageHeight) throw new Exception("Coordinates must be inside the last screenshot.");
    POINT p=new POINT {x=(int)((long)x*width/imageWidth),y=(int)((long)y*height/imageHeight)};
    ClientToScreen(target,ref p);
    if(GetAncestor(WindowFromPoint(p),2)!=target) throw new Exception("Another window covers the input point. Uncover the selected window and retry.");
    SetCursorPos(p.x,p.y);
  }
  static void Tree(AutomationElement e,List<object> rows,int depth) {
    if(e==null || rows.Count>=180 || depth>8) return;
    try {
      var c=e.Current;
      string key="c"+rows.Count;
      if(!c.IsOffscreen) {
        refs[key]=e;
        string value=""; object pattern;
        if(!c.IsPassword && e.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)) {value=((ValuePattern)pattern).Current.Value ?? "";value=value.Substring(0,Math.Min(500,value.Length));}
        var rect=c.BoundingRectangle;
        bool boundsAvailable=!rect.IsEmpty && Math.Abs(rect.X)<10000000 && Math.Abs(rect.Y)<10000000 && rect.Width>0 && rect.Width<1000000 && rect.Height>0 && rect.Height<1000000;
        POINT point=new POINT();if(boundsAvailable){point.x=(int)rect.X;point.y=(int)rect.Y;ScreenToClient(target,ref point);}
        rows.Add(new {reference=key,name=c.IsPassword ? "[password]" : c.Name.Substring(0,Math.Min(300,c.Name.Length)),type=c.ControlType.ProgrammaticName,enabled=c.IsEnabled,password=c.IsPassword,value=value,boundsAvailable=boundsAvailable,x=(int)((long)point.x*imageWidth/width),y=(int)((long)point.y*imageHeight/height),width=boundsAvailable?(int)(rect.Width*imageWidth/width):0,height=boundsAvailable?(int)(rect.Height*imageHeight/height):0});
      }
      var child=TreeWalker.ControlViewWalker.GetFirstChild(e);
      while(child!=null && rows.Count<180) { Tree(child,rows,depth+1); child=TreeWalker.ControlViewWalker.GetNextSibling(child); }
    } catch(ElementNotAvailableException) {} catch(InvalidOperationException) {}
  }
  static object Handle(Dictionary<string,object> a) {
    string op=S(a,"op");
    if(op=="input_status") return InputStatus();
    if(op=="list") {
      var rows=new List<object>();
      EnumWindows(delegate(IntPtr h,IntPtr ignored) {
        try { uint pid; GetWindowThreadProcessId(h,out pid); string title=Title(h); RECT r;
          if(pid!=excluded && pid!=Process.GetCurrentProcess().Id && IsWindowVisible(h) && title.Length>0 && GetClientRect(h,out r) && r.r>10 && r.b>10 && rows.Count<200)
            rows.Add(new {id=Id(h),title=title,process=Process.GetProcessById((int)pid).ProcessName});
        } catch {} return true;
      },IntPtr.Zero); return rows;
    }
    if(op=="select") {
      string id=S(a,"target"); var pieces=id.Split(':'); long h;
      if(pieces.Length!=3 || !long.TryParse(pieces[0],out h)) throw new Exception("Invalid window.");
      var candidate=new IntPtr(h); uint pid; GetWindowThreadProcessId(candidate,out pid);
      if(pid==excluded || pid==Process.GetCurrentProcess().Id || Id(candidate)!=id) throw new Exception("Window is unavailable.");
      if(!SetProp(candidate,grantProperty,grantStamp)) throw new Exception("Windows denied access to this window. Elevated/protected applications are unsupported.");
      target=candidate; identity=id; frame=null; steps=0; Check(); return new {title=Title(target)};
    }
    if(op=="view") {
      Check(); RECT r; GetClientRect(target,out r); width=r.r; height=r.b;
      if(width<1 || height<1 || width>8192 || height>8192 || (long)width*height>25000000) throw new Exception("Window size unsupported. Restore the window first.");
      double scale=Math.Min(1,1280.0/Math.Max(width,height)); imageWidth=Math.Max(1,(int)(width*scale)); imageHeight=Math.Max(1,(int)(height*scale));
      string png;
      using(var bitmap=new Bitmap(width,height)) {
        using(var g=Graphics.FromImage(bitmap)) { IntPtr dc=g.GetHdc(); try { if(!PrintWindow(target,dc,3)) throw new Exception("Application does not support window capture."); } finally {g.ReleaseHdc(dc);} }
        using(var small=new Bitmap(bitmap,imageWidth,imageHeight)) using(var stream=new MemoryStream()) {small.Save(stream,ImageFormat.Png);png=Convert.ToBase64String(stream.ToArray());}
      }
      refs.Clear(); var nodes=new List<object>(); try {Tree(AutomationElement.FromHandle(target),nodes,0);} catch {}
      frame=Guid.NewGuid().ToString("N"); captured=DateTime.UtcNow;
      return new {frame=frame,width=imageWidth,height=imageHeight,title=Title(target),controls=nodes,png=png,input=InputStatus()};
    }
    if(op!="act") throw new Exception("Unknown operation.");
    string action=S(a,"action");
    if(action=="type" && S(a,"text").Length>4000) throw new Exception("Text limit is 4000 characters.");
    Fresh(a);
    if(action=="click" || action=="double_click") {Move(a,"x","y"); bool right=S(a,"button")=="right";var pair=new[]{new INPUT {type=0,u=new UNION {mouse=new MOUSEINPUT {flags=right ? 8u:2u}}},new INPUT {type=0,u=new UNION {mouse=new MOUSEINPUT {flags=right ? 16u:4u}}}};Send(pair);if(action=="double_click"){System.Threading.Thread.Sleep(80);Send(pair);}}
    else if(action=="drag") {
      if(a.ContainsKey("source_reference") || a.ContainsKey("target_reference")){
        if(a.ContainsKey("points"))throw new Exception("Choose drag points or two control references, not both.");
        var referencePoints=new List<object>();foreach(string key in new[]{"source_reference","target_reference"}){AutomationElement element;if(!refs.TryGetValue(S(a,key),out element)||element.Current.IsPassword)throw new Exception("Drag control is unavailable or protected.");var rect=element.Current.BoundingRectangle;if(rect.IsEmpty||Double.IsInfinity(rect.X)||Double.IsInfinity(rect.Y))throw new Exception("Drag control has no visible bounds.");POINT p=new POINT{x=(int)(rect.X+rect.Width/2),y=(int)(rect.Y+rect.Height/2)};ScreenToClient(target,ref p);referencePoints.Add(new Dictionary<string,object>{{"x",(int)((long)p.x*imageWidth/width)},{"y",(int)((long)p.y*imageHeight/height)}});}a["points"]=referencePoints.ToArray();
      }
      var points=a.ContainsKey("points") ? Array(a["points"]) : null;int duration=N(a,"duration_ms",600);
      if(points==null || points.Length<2 || points.Length>128 || duration<100 || duration>5000) throw new Exception("Drag requires 2..128 points and a duration of 100..5000 ms.");
      var path=new List<Dictionary<string,object>>();foreach(object item in points) {var p=item as Dictionary<string,object>;if(p==null)throw new Exception("Invalid drag point.");int x=N(p,"x",-1),y=N(p,"y",-1);if(x<0||y<0||x>=imageWidth||y>=imageHeight)throw new Exception("Drag points must stay inside the screenshot.");path.Add(p);}
      if(path.Count==2){var start=path[0];var end=path[1];int x0=N(start,"x",0),y0=N(start,"y",0),dx=N(end,"x",0)-x0,dy=N(end,"y",0)-y0;int count=Math.Max(4,Math.Min(64,(int)Math.Ceiling(Math.Sqrt((double)dx*dx+(double)dy*dy)/8)));path=new List<Dictionary<string,object>>();for(int i=0;i<=count;i++)path.Add(new Dictionary<string,object>{{"x",x0+dx*i/count},{"y",y0+dy*i/count}});}
      Move(path[0],"x","y");Mouse(2,0);
      try {for(int i=1;i<path.Count;i++){System.Threading.Thread.Sleep(duration/(path.Count-1));Check();Move(path[i],"x","y");if(GetForegroundWindow()!=target)throw new Exception("Window lost input focus; drag stopped.");}}
      finally {SendInput(1,new[]{new INPUT{type=0,u=new UNION{mouse=new MOUSEINPUT{flags=4}}}},Marshal.SizeOf(typeof(INPUT)));}
    }
    else if(action=="type") {
      try {if(AutomationElement.FocusedElement.Current.IsPassword) throw new Exception("Typing into password fields is not supported by this bridge.");} catch(ElementNotAvailableException) {}
      foreach(char ch in S(a,"text")) Send(new[]{K(0,ch,4),K(0,ch,6)});
    }
    else if(action=="key") {
      string key=S(a,"key").ToUpperInvariant();
      var keys=new Dictionary<string,ushort>{{"ENTER",13},{"TAB",9},{"ESCAPE",27},{"BACKSPACE",8},{"DELETE",46},{"UP",38},{"DOWN",40},{"LEFT",37},{"RIGHT",39},{"HOME",36},{"END",35},{"PAGEUP",33},{"PAGEDOWN",34},{"SPACE",32},{"ADD",107},{"SUBTRACT",109},{"DECIMAL",110}};
      var parts=key.Split('+');var modifiers=new List<ushort>();for(int i=0;i<parts.Length-1;i++){ushort m=parts[i]=="CTRL"?(ushort)17:parts[i]=="SHIFT"?(ushort)16:parts[i]=="ALT"?(ushort)18:(ushort)0;if(m==0||modifiers.Contains(m))throw new Exception("Only Ctrl, Shift and Alt modifiers are supported.");modifiers.Add(m);}key=parts[parts.Length-1];
      if((modifiers.Contains(18)&&(key=="TAB"||key=="ESCAPE")) || (modifiers.Contains(17)&&(key=="ESCAPE" || (modifiers.Contains(18)&&key=="DELETE"))))throw new Exception("System/window-switching shortcuts are excluded.");
      if(modifiers.Contains(17) && (key=="C"||key=="V"||key=="X"))throw new Exception("Clipboard shortcuts are excluded; use literal text or set_value.");
      ushort vk;if(!keys.TryGetValue(key,out vk)){int number;if(key.StartsWith("F")&&int.TryParse(key.Substring(1),out number)&&number>=1&&number<=12)vk=(ushort)(111+number);else if(key.Length==1 && "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".IndexOf(key)>=0)vk=key[0];else throw new Exception("Unsupported key.");}
      var inputs=new List<INPUT>();foreach(ushort m in modifiers)inputs.Add(K(m,0,0));inputs.Add(K(vk,0,0));inputs.Add(K(vk,0,2));modifiers.Reverse();foreach(ushort m in modifiers)inputs.Add(K(m,0,2));Send(inputs.ToArray());
    }
    else if(action=="scroll") {Move(a,"x","y"); int ticks=N(a,"ticks",0); if(ticks==0 || Math.Abs((long)ticks)>10) throw new Exception("Scroll ticks must be -10..10, nonzero."); Mouse(0x800,unchecked((uint)(ticks*120)));}
    else if(action=="invoke" || action=="set_value") {
      AutomationElement e; if(!refs.TryGetValue(S(a,"reference"),out e) || e.Current.IsPassword || e.Current.ProcessId!=AutomationElement.FromHandle(target).Current.ProcessId) throw new Exception("Control unavailable or protected.");
      if(action=="invoke") ((InvokePattern)e.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
      else {string value=S(a,"text");if(value.Length>4000) throw new Exception("Text too long.");((ValuePattern)e.GetCurrentPattern(ValuePattern.Pattern)).SetValue(value);}
    }
    else throw new Exception("Unsupported action.");
    refs.Clear(); return new {ok=true,remaining=200-steps,instruction="Take a fresh screenshot to verify the result before another action."};
  }
  static void Main(string[] args) {
    SetProcessDPIAware(); if(args.Length>0) int.TryParse(args[0],out excluded);
    string line; while((line=Console.ReadLine())!=null) {
      object reply;
      try {if(line.Length>65536) throw new Exception("Request too large."); reply=new {result=Handle(json.Deserialize<Dictionary<string,object>>(line))};}
      catch(Exception e) {reply=new {error=e.Message};}
      Console.WriteLine(json.Serialize(reply)); Console.Out.Flush();
    }
  }
}
