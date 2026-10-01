# Export every slide of Studify_AI_Pitch.pptx to PNG via PowerPoint (for visual QA).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pptx = Join-Path $here "Studify_AI_Pitch.pptx"
$out = Join-Path $here "preview"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null
$app = New-Object -ComObject PowerPoint.Application
try {
  $pres = $app.Presentations.Open($pptx, $true, $false, $false)
  $pres.Export($out, "PNG", 1600, 900)
  $pres.Close()
} finally {
  $app.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null
}
Get-ChildItem $out | Select-Object -ExpandProperty Name
