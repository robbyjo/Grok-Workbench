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
    try {
      if(args.Length==4 && args[0]=="--stop-owned"){
        int pid=int.Parse(args[1]);long ticks=long.Parse(args[2]);string name=args[3];
        if(name!="WINWORD" && name!="EXCEL")throw new Exception("Unsupported owned application.");
        try{var p=Process.GetProcessById(pid);if(p.ProcessName==name && p.StartTime.ToUniversalTime().Ticks==ticks && p.MainWindowHandle==IntPtr.Zero)p.Kill();}catch(ArgumentException){}
        return;
      }
      var input=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[0]));
      string op=S(input,"operation"),path=S(input,"path");
      object result;
      if(op=="word") result=Word(input,path);
      else if(op=="excel")result=Excel(input,path);
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
      stage="create Word document";doc=app.Documents.Add();
      appPid=AppPid((object)app);own=appPid>0&&!before.Contains(appPid);
      if(own)Owned(appPid,"WINWORD");
      stage="write Word content";string text=S(input,"title")+"\r\r"+S(input,"text").Replace("\n","\r");doc.Content.Text=text;
      stage="format Word heading";if(S(input,"title").Length>0)doc.Paragraphs[1].Range.Font.Size=20;
      object[] rows=A(input,"table");
      stage="create Word table";if(rows.Length>0){var first=Array(rows[0]);dynamic range=doc.Range(doc.Content.End-1,doc.Content.End-1);dynamic table=doc.Tables.Add(range,rows.Length,first.Length);for(int r=0;r<rows.Length;r++){var row=Array(rows[r]);for(int c=0;c<row.Length;c++)table.Cell(r+1,c+1).Range.Text=Convert.ToString(row[c]);}table.Rows[1].Range.Bold=1;}
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
      book=app.Workbooks.Add();dynamic sheet=book.Worksheets[1];sheet.Name="Workbench";
      appPid=AppPid((object)app);own=appPid>0&&!before.Contains(appPid);
      if(own)Owned(appPid,"EXCEL");
      object[] headers=A(input,"headers"),rows=A(input,"rows");
      for(int c=0;c<headers.Length;c++){sheet.Cells[1,c+1].NumberFormat="@";sheet.Cells[1,c+1].Value2=Convert.ToString(headers[c]);}
      for(int r=0;r<rows.Length;r++){var row=Array(rows[r]);for(int c=0;c<row.Length;c++) {object value=row[c]; if(value is string)sheet.Cells[r+2,c+1].NumberFormat="@";sheet.Cells[r+2,c+1].Value2=value;}}
      foreach(object item in A(input,"formulas")){var formula=(Dictionary<string,object>)item;sheet.Range[S(formula,"cell")].Formula=S(formula,"formula");}
      sheet.Rows[1].Font.Bold=true;sheet.UsedRange.Columns.AutoFit();
      if(input.ContainsKey("chart") && Convert.ToBoolean(input["chart"]) && rows.Length>0 && headers.Length>1){dynamic obj=sheet.ChartObjects().Add(30,Math.Max(180,(rows.Length+3)*16),520,320);dynamic chart=obj.Chart;chart.ChartType=51;chart.SetSourceData(sheet.Range[sheet.Cells[1,1],sheet.Cells[rows.Length+1,headers.Length]]);chart.HasTitle=true;chart.ChartTitle.Text=S(input,"title");}
      app.CalculateFull();
      var values=new List<object>();foreach(object item in A(input,"formulas")){var formula=(Dictionary<string,object>)item;string cell=S(formula,"cell");values.Add(new{cell=cell,formula=Convert.ToString(sheet.Range[cell].Formula),value=(object)sheet.Range[cell].Value2});}
      book.SaveAs(path,51);
      return new{path=path,rows=rows.Length,columns=headers.Length,formulaResults=values,ownedInstance=own,processId=appPid};
    } finally {if(book!=null){try{book.Close(false);}catch{}Release((object)book);}try{app.EnableEvents=events;app.DisplayAlerts=alerts;app.AutomationSecurity=security;if(own && app.Workbooks.Count==0)app.Quit();}catch{}finally{Release((object)app);}}
  }
}
