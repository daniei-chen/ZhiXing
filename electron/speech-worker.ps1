param([ValidateSet('zh-CN','en-US')][string]$Language='zh-CN',[switch]$List,[string]$WaveFile='')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
if($List){
 $items=@([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { @{id=$_.Id;language=$_.Culture.Name;name=$_.Name} })
 ConvertTo-Json -InputObject $items -Compress
 exit 0
}
$source=@'
using System;
using System.Speech.Recognition;
using System.Text;
using System.Threading;
public static class ZhixingLocalSpeech {
 static readonly object Gate=new object();
 static long lastLevel=0;
 static void Emit(string type,string text) {
  lock(Gate) { Console.WriteLine(type+":"+Convert.ToBase64String(Encoding.UTF8.GetBytes(text??""))); Console.Out.Flush(); }
 }
 public static void Run(string language,string wav) {
  using(var recognizer=new SpeechRecognitionEngine(new System.Globalization.CultureInfo(language)))
  using(var ended=new ManualResetEvent(false)) {
   recognizer.LoadGrammar(new DictationGrammar());
   recognizer.SpeechHypothesized+=(s,e)=>Emit("partial",e.Result.Text);
   recognizer.SpeechRecognized+=(s,e)=> { if(e.Result.Confidence>=0.25) Emit("text",e.Result.Text); };
   recognizer.AudioLevelUpdated+=(s,e)=> { var now=DateTime.UtcNow.Ticks; if(now-lastLevel>1000000){lastLevel=now;Emit("level",e.AudioLevel.ToString());} };
   recognizer.RecognizeCompleted+=(s,e)=> { if(e.Error!=null) Emit("error",e.Error.Message); ended.Set(); };
   if(String.IsNullOrEmpty(wav)) recognizer.SetInputToDefaultAudioDevice(); else recognizer.SetInputToWaveFile(wav);
   recognizer.RecognizeAsync(RecognizeMode.Multiple);
   Emit("ready",language);
   if(String.IsNullOrEmpty(wav)) {
    string command=Console.ReadLine();
    if(command=="finish") recognizer.RecognizeAsyncStop(); else recognizer.RecognizeAsyncCancel();
   }
   if(!ended.WaitOne(String.IsNullOrEmpty(wav)?5000:20000)) recognizer.RecognizeAsyncCancel();
   Emit("done","");
  }
 }
}
'@
try {
 Add-Type -TypeDefinition $source -ReferencedAssemblies ([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location)
 [ZhixingLocalSpeech]::Run($Language,$WaveFile)
} catch {
 $message=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.GetBaseException().Message))
 [Console]::WriteLine('error:'+$message)
 exit 1
}
