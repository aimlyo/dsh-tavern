using System;
using System.IO;
using System.Diagnostics;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Drawing;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Text;
using System.Xml.Linq;
using Microsoft.Win32;
using System.Runtime.InteropServices;

class Launcher : Form {
 // Bump the suffix whenever patch-runtime.cjs changes; never patch a running installation.
 const string Version="5e2e365397638d61-setup2";
 Label label=new Label(); ProgressBar bar=new ProgressBar();
 string root, runtime, data; string[] args;
 string installedLauncher; bool showCompletion, installationSelected;
 const string LauncherName="DSH Tavern.exe";
 const string SettingsName="launcher-settings.xml";
 static string TestRoot { get { return Environment.GetEnvironmentVariable("DSH_LAUNCHER_TEST_ROOT"); } }
 [STAThread] static void Main(string[] args) {
  Application.EnableVisualStyles(); Application.Run(new Launcher(args));
 }
 Launcher(string[] a) {
  args=a; Text="DSH Tavern"; ClientSize=new Size(460,115); StartPosition=FormStartPosition.CenterScreen;
  FormBorderStyle=FormBorderStyle.FixedDialog; MaximizeBox=false; ControlBox=false;
  label.SetBounds(20,18,420,45); label.Text="正在检查运行文件…"; Controls.Add(label);
  bar.SetBounds(20,75,420,18); bar.Style=ProgressBarStyle.Marquee; Controls.Add(bar);
  Shown+=async delegate { while(true) {try {
   if(!installationSelected){if(!SelectInstallation()){Close();return;}installationSelected=true;}
   await Task.Run((Action)Run);
   try{File.Delete(Path.Combine(root,"launcher-error.txt"));}catch{}
   if(showCompletion&&TestRoot==null)MessageBox.Show("安装完成，酒馆已启动。\n\n以后请从桌面或开始菜单打开「DSH Tavern」。\n\n程序位置："+root+"\n数据位置："+data+"\n\n下载的安装包可以删除。请勿直接运行 runtime 文件夹中的 DSH Desktop.exe。", "DSH Tavern",MessageBoxButtons.OK,MessageBoxIcon.Information);
   Close(); return; } catch(Exception e) {
   try {Directory.CreateDirectory(root);File.WriteAllText(Path.Combine(root,"launcher-error.txt"),e.ToString());}catch{}
   if(TestRoot!=null){Environment.ExitCode=1;Close();return;}
   if(MessageBox.Show("启动失败："+e.Message+"\n\n文件位置："+root,"DSH Tavern",MessageBoxButtons.RetryCancel,MessageBoxIcon.Warning)==DialogResult.Retry)continue;
   Environment.ExitCode=1; Close(); return;
  }}};
 }
 static bool SamePath(string a,string b) { return string.Equals(Path.GetFullPath(a).TrimEnd('\\','/'),Path.GetFullPath(b).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase); }
 static bool HasInstallation(string path) {
  return Directory.Exists(path)&&(File.Exists(Path.Combine(path,SettingsName))||Directory.Exists(Path.Combine(path,"data","harness"))||Directory.Exists(Path.Combine(path,"harness"))||Directory.GetDirectories(path,"runtime-*").Length>0);
 }
 static string ReadRegisteredRoot() {
  using(var key=Registry.CurrentUser.OpenSubKey(@"Software\DSH-Tavern"))return key==null?null:key.GetValue("InstallRoot") as string;
 }
 bool SelectInstallation() {
  string beside=Path.GetDirectoryName(Application.ExecutablePath);
  string selected=null; bool freshInstallation=false;
  if(File.Exists(Path.Combine(beside,SettingsName)))selected=beside;
  else if(TestRoot!=null)selected=Path.GetFullPath(TestRoot);
  else {
   string registered=ReadRegisteredRoot();
   if(!string.IsNullOrEmpty(registered)) {
    if(HasInstallation(registered))selected=registered;
    else using(var recovery=new MissingInstallationDialog(registered,HasInstallation)) {
     if(recovery.ShowDialog(this)!=DialogResult.OK)return false;
     selected=recovery.ExistingRoot;
     freshInstallation=selected==null;
    }
   }
   else foreach(string old in new[]{@"D:\Workspace\.DSH-Tavern",Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"DSH-Tavern-Portable"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"DSH-Tavern")}) {
    if(HasInstallation(old)){selected=old;break;}
   }
  }
  bool existing=selected!=null&&HasInstallation(selected);
  bool ownEntry=selected!=null&&SamePath(Application.ExecutablePath,Path.Combine(selected,LauncherName));
  if(TestRoot==null&&!ownEntry) {
   using(var setup=new SetupDialog(selected??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"DSH-Tavern"),existing)) {
    if(setup.ShowDialog(this)!=DialogResult.OK)return false;
    selected=setup.InstallRoot;
   }
   showCompletion=true;
  }
  root=Path.GetFullPath(selected);runtime=Path.Combine(root,"runtime-"+Version);
  installedLauncher=Path.Combine(root,LauncherName);
  string settings=Path.Combine(root,SettingsName);
  if(File.Exists(settings)) {
   var doc=XDocument.Load(settings);
   data=(string)doc.Root.Element("DataDirectory");
   if(string.IsNullOrWhiteSpace(data)||!Path.IsPathRooted(data))throw new Exception("启动配置中的数据目录无效："+settings);
   if(!Directory.Exists(data))throw new Exception("原数据目录不存在："+data+"。请恢复原目录后重试。");
  } else {
   data=Path.Combine(root,"data");
   var legacy=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"DSH-Tavern");
   if(!freshInstallation&&TestRoot==null&&!Directory.Exists(data)&&Directory.Exists(Path.Combine(legacy,"harness")))data=legacy;
  }
  return true;
 }
 void SaveEntry() {
  // Install the outer launcher before network access, so failed first installs are retryable.
  if(!SamePath(Application.ExecutablePath,installedLauncher)) {
   string next=installedLauncher+".new";
   File.Copy(Application.ExecutablePath,next,true);
   if(File.Exists(installedLauncher))File.Replace(next,installedLauncher,null);
   else File.Move(next,installedLauncher);
  }
  Directory.CreateDirectory(data);
  string settings=Path.Combine(root,SettingsName);
  if(!File.Exists(settings))new XDocument(new XElement("Installation",new XAttribute("version",1),new XElement("DataDirectory",data))).Save(settings);
  if(TestRoot==null)using(var key=Registry.CurrentUser.CreateSubKey(@"Software\DSH-Tavern"))key.SetValue("InstallRoot",root);
  CreateShortcut(TestRoot==null?Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory):Path.Combine(TestRoot,"Desktop"));
  CreateShortcut(TestRoot==null?Environment.GetFolderPath(Environment.SpecialFolder.Programs):Path.Combine(TestRoot,"StartMenu"));
  File.WriteAllText(Path.Combine(root,"如何启动.txt"),"以后请从桌面或开始菜单打开 DSH Tavern，也可双击本目录的 DSH Tavern.exe。\r\n程序位置："+root+"\r\n数据位置："+data+"\r\n请保留数据目录；不要单独运行 runtime 文件夹中的 DSH Desktop.exe。\r\n",Encoding.UTF8);
 }
 void CreateShortcut(string folder) {
  if(string.IsNullOrWhiteSpace(folder))throw new Exception("无法找到系统快捷方式目录；可从 "+installedLauncher+" 启动。");
  Directory.CreateDirectory(folder);
  object shell=null,link=null;
  try {
   shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell",true));
   link=shell.GetType().InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{Path.Combine(folder,"DSH Tavern.lnk")});
   foreach(var pair in new[]{new[]{"TargetPath",installedLauncher},new[]{"WorkingDirectory",root},new[]{"Description","打开 DSH Tavern 酒馆"},new[]{"IconLocation",Path.Combine(runtime,"DSH Desktop.exe")+",0"}})
    link.GetType().InvokeMember(pair[0],BindingFlags.SetProperty,null,link,new object[]{pair[1]});
   link.GetType().InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);
  } finally {if(link!=null)Marshal.FinalReleaseComObject(link);if(shell!=null)Marshal.FinalReleaseComObject(shell);}
 }
 void Status(string text,int percent=-1) { BeginInvoke((Action)(()=>{label.Text=text;bar.Style=percent<0?ProgressBarStyle.Marquee:ProgressBarStyle.Continuous;if(percent>=0)bar.Value=Math.Min(100,percent);})); }
 void Resource(string name,string path) {using(var s=Assembly.GetExecutingAssembly().GetManifestResourceStream(name))using(var f=File.Create(path))s.CopyTo(f);}
 static string Quote(string s) {return "\""+Regex.Replace(s,@"(\\*)""", "$1$1\\\"").TrimEnd('\\')+new string('\\',(s.Length-s.TrimEnd('\\').Length)*2)+"\"";}
 void Run() {
  Directory.CreateDirectory(root);
  File.SetAttributes(root,File.GetAttributes(root)&~FileAttributes.Hidden);
  using(var mutex=new Mutex(false,"Local\\DSHTavernPrepare-Online")) {
   Status("正在等待运行文件准备完成…"); bool locked=false;
   try {try {locked=mutex.WaitOne();}catch(AbandonedMutexException){locked=true;}
    SaveEntry();
    if(!File.Exists(Path.Combine(runtime,"ready"))) {
     Status("首次准备运行环境，后续启动无需重复解压…");
     var stage=Path.Combine(root,"preparing-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
     try {
     var archive=Path.Combine(stage,"payload.7z");var seven=Path.Combine(stage,"7za.exe");var app=Path.Combine(stage,"app");
     Resource("payload",archive);Resource("seven",seven);
     using(var sha=SHA256.Create())using(var f=File.OpenRead(archive)) {
      var h=BitConverter.ToString(sha.ComputeHash(f)).Replace("-","").ToLowerInvariant();
      if(h!="5e2e365397638d61f202753b5dbcee1d9dbd377a5a9d17c160535891f187decd")throw new Exception("运行包校验失败");
     }
     var pi=new ProcessStartInfo(seven,"x "+Quote(archive)+" -o"+Quote(app)+" -y -bsp1 -bso0");
     pi.UseShellExecute=false;pi.CreateNoWindow=true;pi.RedirectStandardOutput=true;
     pi.EnvironmentVariables["TEMP"]=stage;pi.EnvironmentVariables["TMP"]=stage;
     using(var p=Process.Start(pi)) {char[] buf=new char[256];int n;while((n=p.StandardOutput.Read(buf,0,buf.Length))>0){var m=Regex.Match(new string(buf,0,n),@"(\d{1,3})%");if(m.Success)Status("首次准备运行环境："+m.Value,int.Parse(m.Groups[1].Value));}p.WaitForExit();if(p.ExitCode!=0)throw new Exception("解压失败，代码 "+p.ExitCode);}
     if(!File.Exists(Path.Combine(app,"DSH Desktop.exe")))throw new Exception("运行环境不完整");
     var patch=Path.Combine(stage,"patch-runtime.cjs");Resource("runtimePatch",patch);
     var packageHelper=Path.Combine(stage,"desktop-package-manager.mjs");Resource("packageHelper",packageHelper);
     var patchStart=new ProcessStartInfo(Path.Combine(app,"DSH Desktop.exe"),Quote(patch)+" "+Quote(app)+" "+Quote(packageHelper));
     patchStart.UseShellExecute=false;patchStart.CreateNoWindow=true;patchStart.RedirectStandardError=true;
     patchStart.EnvironmentVariables["ELECTRON_RUN_AS_NODE"]="1";
     patchStart.EnvironmentVariables["TEMP"]=stage;patchStart.EnvironmentVariables["TMP"]=stage;
     using(var p=Process.Start(patchStart)){string error=p.StandardError.ReadToEnd();p.WaitForExit();if(p.ExitCode!=0)throw new Exception("无法准备中文路径支持："+error);}
     Directory.Move(app,runtime);File.WriteAllText(Path.Combine(runtime,"ready"),Version);
     } finally {if(Directory.Exists(stage))Directory.Delete(stage,true);}
    }
    if(Array.IndexOf(args,"--prepare-only")<0)EnsureTavern();
   }finally{if(locked)mutex.ReleaseMutex();}
  }
  if(Array.IndexOf(args,"--prepare-only")>=0)return;
  Status("正在打开 DSH Tavern…"); var start=new ProcessStartInfo(Path.Combine(runtime,"DSH Desktop.exe"));
  start.UseShellExecute=false;start.WorkingDirectory=runtime;
  start.EnvironmentVariables["DSH_TAVERN_TEST_DATA"]=data;
  start.EnvironmentVariables["PORTABLE_EXECUTABLE_FILE"]=installedLauncher;
  start.EnvironmentVariables["PORTABLE_EXECUTABLE_DIR"]=root;
  var temp=Path.Combine(root,"temp");Directory.CreateDirectory(temp);start.EnvironmentVariables["TEMP"]=temp;start.EnvironmentVariables["TMP"]=temp;
  start.Arguments=string.Join(" ",Array.ConvertAll(args,Quote));
  start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
  using(var p=Process.Start(start)){if(Array.IndexOf(args,"--tavern-smoke")>=0){p.WaitForExit();if(p.ExitCode!=0)throw new Exception("启动检查失败");}}
 }
 void EnsureTavern() {
  var source=Path.Combine(data,@"harness\apps\dsh-tavern");
  if(File.Exists(Path.Combine(source,"package.json"))&&!File.Exists(Path.Combine(source,".portable-install-pending.json")))return;
  Status("首次启动需要联网，正在安装最新版酒馆…");
  var pi=new ProcessStartInfo(Path.Combine(runtime,"DSH Desktop.exe"),"--expose-internals "+Quote(Path.Combine(runtime,@"resources\online-install.mjs"))+" "+Quote(data));
  pi.UseShellExecute=false;pi.CreateNoWindow=true;pi.RedirectStandardOutput=true;pi.RedirectStandardError=true;
  pi.StandardOutputEncoding=Encoding.UTF8;pi.StandardErrorEncoding=Encoding.UTF8;
  pi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"]="1";pi.EnvironmentVariables["NODE_USE_ENV_PROXY"]="1";
  var temp=Path.Combine(root,"temp");Directory.CreateDirectory(temp);pi.EnvironmentVariables["TEMP"]=temp;pi.EnvironmentVariables["TMP"]=temp;
  var errors=new StringBuilder();
  using(var p=new Process()) {
   p.StartInfo=pi;
   p.OutputDataReceived+=(sender,e)=>{if(e.Data!=null&&e.Data.StartsWith("DSH_STATUS "))Status(e.Data.Substring(11));};
   p.ErrorDataReceived+=(sender,e)=>{if(e.Data!=null&&errors.Length<4000)errors.AppendLine(e.Data);};
   p.Start();p.BeginOutputReadLine();p.BeginErrorReadLine();p.WaitForExit();
   if(p.ExitCode!=0)throw new Exception(errors.Length>0?errors.ToString():"首次安装未完成，请检查网络后重试。");
  }
 }
}
