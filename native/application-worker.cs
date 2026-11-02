// Typed Office/JMP automation. All commands are authored here; input is data, not script.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
class ApplicationWorker {
  static JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=4000000};
  static string stage="initialize";
  static void Release(object value){try{if(value!=null && Marshal.IsComObject(value))Marshal.FinalReleaseComObject(value);}catch{}}
  static void Owned(int pid,string name){var process=Process.GetProcessById(pid);Console.WriteLine(json.Serialize(new{ownedProcess=new{pid=pid,name=name,started=process.StartTime.ToUniversalTime().Ticks.ToString()}}));Console.Out.Flush();}
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  static string S(Dictionary<string,object> a,string k){object v;return a.TryGetValue(k,out v)?Convert.ToString(v):"";}
  static object[] Array(object value){var list=value as System.Collections.IEnumerable;var result=new List<object>();if(list!=null && !(value is string))foreach(object item in list)result.Add(item);return result.ToArray();}
  static object[] A(Dictionary<string,object> a,string k){object v;return a.TryGetValue(k,out v)?Array(v):new object[0];}
  static int AppPid(dynamic app){try {uint pid;long hwnd;try{hwnd=(long)app.Hwnd;}catch{hwnd=(long)app.ActiveWindow.Hwnd;}GetWindowThreadProcessId(new IntPtr(hwnd),out pid);return (int)pid;}catch{return 0;}}
  [STAThread] static void Main(string[] args){
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    try {
      if(args.Length==4 && args[0]=="--stop-owned"){
        int pid=int.Parse(args[1]);long ticks=long.Parse(args[2]);string name=args[3];
        if(name!="WINWORD" && name!="EXCEL" && name!="POWERPNT")throw new Exception("Unsupported owned application.");
        try{var p=Process.GetProcessById(pid);if(p.ProcessName==name && p.StartTime.ToUniversalTime().Ticks==ticks && p.MainWindowHandle==IntPtr.Zero)p.Kill();}catch(ArgumentException){}
        return;
      }
      var input=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[0]));
      string op=S(input,"operation"),path=S(input,"path");
      object result;
      if(op=="word") result=Word(input,path);
      else if(op=="excel")result=Excel(input,path);
      else if(op=="powerpoint")result=PowerPoint(input,path);
      else if(op=="audacity")result=Audacity(input,path);
      else if(op=="jmp"){
        dynamic app=Activator.CreateInstance(Type.GetTypeFromProgID("JMP.Application",true));
        // Never quit JMP or close unrelated documents: COM may attach to an existing instance.
        try {app.RunJSLFile(S(input,"script"));result=new{launched=true};}
        finally {Release((object)app);}
      } else throw new Exception("Unknown application operation.");
      Console.WriteLine(json.Serialize(new{result=result}));
    }catch(Exception e){Console.WriteLine(json.Serialize(new{error=stage+": "+e.GetType().FullName+" "+e.HResult.ToString("X8")+": "+e.Message}));Environment.ExitCode=1;}
  }
  static object Word(Dictionary<string,object> input,string path){
    var before=new HashSet<int>();foreach(var p in Process.GetProcessesByName("WINWORD"))before.Add(p.Id);
    dynamic app=Activator.CreateInstance(Type.GetTypeFromProgID("Word.Application",true));dynamic doc=null;
    bool own=false;int appPid=0;int security=3;
    try {
      security=(int)app.AutomationSecurity;app.AutomationSecurity=3;
      stage="create/open Word copy";doc=input.ContainsKey("source")?app.Documents.Open(S(input,"source"),ConfirmConversions:false,ReadOnly:false,AddToRecentFiles:false):app.Documents.Add();
      appPid=AppPid((object)app);own=appPid>0&&!before.Contains(appPid);
      if(own)Owned(appPid,"WINWORD");
      stage="write Word content";if(!input.ContainsKey("source")){string text=S(input,"title")+"\r\r"+S(input,"text").Replace("\n","\r");doc.Content.Text=text;}
      else {
        doc.TrackRevisions=input.ContainsKey("tracked")&&Convert.ToBoolean(input["tracked"]);
        foreach(object item in A(input,"replacements")){var change=(Dictionary<string,object>)item;dynamic range=doc.Content.Duplicate;bool found=range.Find.Execute(FindText:S(change,"find"),MatchCase:true,MatchWildcards:false,Wrap:0,ReplaceWith:S(change,"replace"),Replace:2);if(!found)throw new Exception("Replacement text was not found: "+S(change,"find"));}
        foreach(object item in A(input,"comments")){var comment=(Dictionary<string,object>)item;dynamic range=doc.Content.Duplicate;if(!range.Find.Execute(FindText:S(comment,"find"),MatchCase:true,MatchWildcards:false,Wrap:0))throw new Exception("Comment anchor was not found.");doc.Comments.Add(range,S(comment,"text"));}
        if(S(input,"append").Length>0)doc.Range(doc.Content.End-1,doc.Content.End-1).InsertAfter("\r"+S(input,"append").Replace("\n","\r"));
      }
      stage="format Word heading";if(S(input,"title").Length>0)doc.Paragraphs[1].Range.Font.Size=20;
      object[] rows=A(input,"table");
      stage="create Word table";if(rows.Length>0){var first=Array(rows[0]);dynamic range=doc.Range(doc.Content.End-1,doc.Content.End-1);dynamic table=doc.Tables.Add(range,rows.Length,first.Length);for(int r=0;r<rows.Length;r++){var row=Array(rows[r]);for(int c=0;c<row.Length;c++)table.Cell(r+1,c+1).Range.Text=Convert.ToString(row[c]);}table.Rows[1].Range.Bold=1;}
      foreach(object item in A(input,"images")){dynamic range=doc.Range(doc.Content.End-1,doc.Content.End-1);range.InsertAfter("\r");range=doc.Range(doc.Content.End-1,doc.Content.End-1);dynamic picture=doc.InlineShapes.AddPicture(Convert.ToString(item),false,true,range);if(picture.Width>450)picture.Width=450;}
      stage="inspect Word content";string actual=Convert.ToString(doc.Content.Text);int words=(int)doc.Words.Count;
      stage="save Word document";doc.SaveAs2(path,16);
      return new{path=path,words=words,text=actual.Substring(0,Math.Min(4000,actual.Length)),ownedInstance=own,processId=appPid};
    } finally {if(doc!=null){try{doc.Close(false);}catch{}Release((object)doc);}try{app.AutomationSecurity=security;if(own && app.Documents.Count==0)app.Quit(false);}catch{}Release((object)app);}
  }
  static object Excel(Dictionary<string,object> input,string path){
    var before=new HashSet<int>();foreach(var p in Process.GetProcessesByName("EXCEL"))before.Add(p.Id);
    dynamic app=Activator.CreateInstance(Type.GetTypeFromProgID("Excel.Application",true));dynamic book=null;
    bool own=false;int appPid=0;int security=3;bool events=true,alerts=true;
    try {
      events=(bool)app.EnableEvents;alerts=(bool)app.DisplayAlerts;security=(int)app.AutomationSecurity;app.EnableEvents=false;app.DisplayAlerts=false;app.AutomationSecurity=3;
      book=input.ContainsKey("source")?app.Workbooks.Open(S(input,"source"),UpdateLinks:0,ReadOnly:false,IgnoreReadOnlyRecommended:true,AddToMru:false):app.Workbooks.Add();dynamic sheet=S(input,"sheet").Length>0?book.Worksheets[S(input,"sheet")]:book.Worksheets[1];if(!input.ContainsKey("source"))sheet.Name="Workbench";
      appPid=AppPid((object)app);own=appPid>0&&!before.Contains(appPid);
      if(own)Owned(appPid,"EXCEL");
      object[] headers=A(input,"headers"),rows=A(input,"rows");
      for(int c=0;c<headers.Length;c++){sheet.Cells[1,c+1].NumberFormat="@";sheet.Cells[1,c+1].Value2=Convert.ToString(headers[c]);}
      for(int r=0;r<rows.Length;r++){var row=Array(rows[r]);for(int c=0;c<row.Length;c++) {object value=row[c]; if(value is string)sheet.Cells[r+2,c+1].NumberFormat="@";sheet.Cells[r+2,c+1].Value2=value;}}
      foreach(object item in A(input,"cells")){var cell=(Dictionary<string,object>)item;object value=cell["value"];sheet.Range[S(cell,"cell")].NumberFormat=value is string?"@":"General";sheet.Range[S(cell,"cell")].Value2=value;}
      foreach(object item in A(input,"formulas")){var formula=(Dictionary<string,object>)item;sheet.Range[S(formula,"cell")].Formula=S(formula,"formula");}
      sheet.Rows[1].Font.Bold=true;sheet.UsedRange.Columns.AutoFit();
      if(input.ContainsKey("chart") && Convert.ToBoolean(input["chart"]) && ((rows.Length>0 && headers.Length>1)||(input.ContainsKey("source")&&sheet.UsedRange.Columns.Count>1))){dynamic obj=sheet.ChartObjects().Add(30,Math.Max(180,((int)sheet.UsedRange.Rows.Count+3)*16),520,320);dynamic chart=obj.Chart;chart.ChartType=51;chart.SetSourceData(input.ContainsKey("source")?sheet.UsedRange:sheet.Range[sheet.Cells[1,1],sheet.Cells[rows.Length+1,headers.Length]]);chart.HasTitle=true;chart.ChartTitle.Text=S(input,"title");}
      app.CalculateFull();
      var values=new List<object>();foreach(object item in A(input,"formulas")){var formula=(Dictionary<string,object>)item;string cell=S(formula,"cell");values.Add(new{cell=cell,formula=Convert.ToString(sheet.Range[cell].Formula),value=(object)sheet.Range[cell].Value2});}
      book.SaveAs(path,51);
      return new{path=path,rows=rows.Length,columns=headers.Length,formulaResults=values,ownedInstance=own,processId=appPid};
    } finally {if(book!=null){try{book.Close(false);}catch{}Release((object)book);}try{app.EnableEvents=events;app.DisplayAlerts=alerts;app.AutomationSecurity=security;if(own && app.Workbooks.Count==0)app.Quit();}catch{}finally{Release((object)app);}}
  }
  static object PowerPoint(Dictionary<string,object> input,string path){
    var before=new HashSet<int>();foreach(var p in Process.GetProcessesByName("POWERPNT"))before.Add(p.Id);
    dynamic app=Activator.CreateInstance(Type.GetTypeFromProgID("PowerPoint.Application",true));dynamic presentation=null;bool own=false;int appPid=0;int security=3;
    try{security=(int)app.AutomationSecurity;app.AutomationSecurity=3;
      presentation=input.ContainsKey("source")?app.Presentations.Open(S(input,"source"),0,0,0):app.Presentations.Add(0);
      appPid=AppPid((object)app);own=appPid>0&&!before.Contains(appPid);if(own)Owned(appPid,"POWERPNT");
      foreach(object item in A(input,"slides")){var data=(Dictionary<string,object>)item;dynamic slide=presentation.Slides.Add(presentation.Slides.Count+1,12);dynamic title=slide.Shapes.AddTextbox(1,40,30,640,60);title.TextFrame.TextRange.Text=S(data,"title");title.TextFrame.TextRange.Font.Size=28;dynamic body=slide.Shapes.AddTextbox(1,40,110,640,360);body.TextFrame.TextRange.Text=S(data,"text");body.TextFrame.TextRange.Font.Size=20;}
      presentation.SaveAs(path,24);string pdf="";if(input.ContainsKey("pdf")&&Convert.ToBoolean(input["pdf"])){stage="export PowerPoint PDF";pdf=Path.Combine(Path.GetDirectoryName(path),"presentation.pdf");presentation.SaveCopyAs(pdf,32,0);}
      return new{path=path,slides=(int)presentation.Slides.Count,pdf=pdf,ownedInstance=own,processId=appPid};
    }finally{if(presentation!=null){try{presentation.Close();}catch{}Release((object)presentation);}try{app.AutomationSecurity=security;if(own&&app.Presentations.Count==0)app.Quit();}catch{}Release((object)app);}
  }
  static object Audacity(Dictionary<string,object> input,string path){
    string source=S(input,"source");double peak=Convert.ToDouble(input["peak"]);
    if(source.Contains("\"")||path.Contains("\"")||source.Contains("\n")||path.Contains("\n")||peak< -24||peak>0)throw new Exception("Invalid Audacity data.");
    using(var to=new System.IO.Pipes.NamedPipeClientStream(".","ToSrvPipe",System.IO.Pipes.PipeDirection.Out,System.IO.Pipes.PipeOptions.Asynchronous))
    using(var from=new System.IO.Pipes.NamedPipeClientStream(".","FromSrvPipe",System.IO.Pipes.PipeDirection.In,System.IO.Pipes.PipeOptions.Asynchronous)){
      stage="connect to dedicated Audacity project";to.Connect(3000);from.Connect(3000);
      using(var writer=new StreamWriter(to,new System.Text.UTF8Encoding(false)))
      using(var reader=new StreamReader(from,System.Text.Encoding.UTF8)){
        Func<string,string> command=delegate(string text){stage="Audacity "+text.Split(':')[0];writer.Write(text+"\r\n\0");writer.Flush();var response=new System.Text.StringBuilder();
          var buffer=new char[2048];while(true){var readTask=reader.ReadAsync(buffer,0,buffer.Length);if(!readTask.Wait(15000))throw new TimeoutException("Command outcome is unknown; inspect the project before retrying. Received "+response.Length+" characters.");int count=readTask.Result;if(count==0)throw new Exception("Audacity pipe closed.");response.Append(buffer,0,count);string current=response.ToString();if(current.Contains("BatchCommand finished: OK")||current.Contains("BatchCommand finished: Failed"))break;if(response.Length>1000000)throw new Exception("Audacity response exceeds limits.");}
          string value=response.ToString();if(!value.Contains("BatchCommand finished: OK"))throw new Exception("Audacity rejected the authored command: "+value.Substring(Math.Max(0,value.Length-500)));return value;
        };
        string tracks=command("GetInfo: Type=Tracks");if(input.ContainsKey("inspect_only"))return new{tracks=tracks};int begin=tracks.IndexOf('['),end=tracks.LastIndexOf(']');if(begin<0||end<begin||json.Deserialize<object[]>(tracks.Substring(begin,end-begin+1)).Length!=0)throw new Exception("Open a dedicated empty Audacity project first; existing tracks are preserved.");
        command("Import2: Filename=\""+source.Replace('\\','/')+"\"");command("SelectAll:");command("Normalize: PeakLevel="+peak.ToString(System.Globalization.CultureInfo.InvariantCulture)+" ApplyGain=1 RemoveDcOffset=1 StereoIndependent=0");command("Export2: Filename=\""+path.Replace('\\','/')+"\"");
        return new{backend="Audacity mod-script-pipe",path=path,notice="Dedicated project remains open for review."};
      }
    }
  }
}
