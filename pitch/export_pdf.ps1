$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = New-Object -ComObject PowerPoint.Application
try { $p = $app.Presentations.Open((Join-Path $here "Studify_AI_Pitch.pptx"), -1, 0, 0); $p.SaveAs((Join-Path $here "Studify_AI_Pitch.pdf"), 32); $p.Close() } finally { $app.Quit() }
