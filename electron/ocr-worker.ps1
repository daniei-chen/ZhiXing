param([Parameter(Mandatory=$true)][string]$Image)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
 $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
 $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-WinRt($operation,[Type]$result) {
 $task=$asTask.MakeGenericMethod($result).Invoke($null,@($operation))
 $task.GetAwaiter().GetResult()
}
$stream=$null
$bitmap=$null
try {
 $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
 if(-not $engine) { @{error='no-language'} | ConvertTo-Json -Compress; exit 0 }
 $file=Wait-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Image)) ([Windows.Storage.StorageFile])
 $stream=Wait-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
 $decoder=Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 $max=[Windows.Media.Ocr.OcrEngine]::MaxImageDimension
 if($decoder.PixelWidth -gt $max -or $decoder.PixelHeight -gt $max -or ([long]$decoder.PixelWidth*$decoder.PixelHeight) -gt 20000000){
  @{error='dimensions'; max=$max} | ConvertTo-Json -Compress
  exit 0
 }
 $bitmap=Wait-WinRt ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
 $ocr=Wait-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
 $lines=@($ocr.Lines | ForEach-Object {
   $line=$_
   $words=@($line.Words | ForEach-Object {
     $word=$_
     $rect=$word.BoundingRect
     [ordered]@{text=[string]$word.Text; x=[double]$rect.X; y=[double]$rect.Y; width=[double]$rect.Width; height=[double]$rect.Height}
   })
   [ordered]@{text=[string]$line.Text; words=$words}
 })
 $text=($lines | ForEach-Object {$_.text}) -join [Environment]::NewLine
 @{language=$engine.RecognizerLanguage.LanguageTag; width=[int]$decoder.PixelWidth; height=[int]$decoder.PixelHeight; text=$text; lines=$lines} | ConvertTo-Json -Compress -Depth 8
} catch {
 @{error='failed'} | ConvertTo-Json -Compress
} finally {
 if($bitmap){$bitmap.Dispose()}
 if($stream){$stream.Dispose()}
}
