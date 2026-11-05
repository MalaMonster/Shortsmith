# Creates "Shortsmith" shortcuts that start the app with no console window.
param(
  [Parameter(Mandatory = $true)][string]$Pythonw,
  [switch]$NoDesktop,
  [switch]$NoStartMenu
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$shell = New-Object -ComObject WScript.Shell
$targets = @(Join-Path $root "Shortsmith.lnk")
if (-not $NoDesktop)   { $targets += Join-Path ([Environment]::GetFolderPath("Desktop")) "Shortsmith.lnk" }
if (-not $NoStartMenu) { $targets += Join-Path ([Environment]::GetFolderPath("Programs")) "Shortsmith.lnk" }
foreach ($t in $targets) {
  $s = $shell.CreateShortcut($t)
  $s.TargetPath = $Pythonw
  $s.Arguments = "`"$root\backend\run.py`""
  $s.WorkingDirectory = $root
  $s.IconLocation = "$root\assets\shortsmith.ico,0"
  $s.Description = "Shortsmith - turn gaming clips into YouTube Shorts"
  $s.Save()
  Write-Host "  Shortcut: $t"
}
