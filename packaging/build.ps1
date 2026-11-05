# Builds the Windows installer:  dist\Shortsmith-Setup-<version>.exe  +  dist\SHA256SUMS.txt
#
#   powershell -ExecutionPolicy Bypass -File packaging\build.ps1 -Version 1.2.3
#
# Needs: Python 3.11+ (with backend requirements + pyinstaller installed in $Python), Node.js, Inno Setup 6.
param(
  [string]$Version = "",
  [string]$Python = "",
  [string]$Iscc = ""
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root
$build = Join-Path $root "build"
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $build, $dist | Out-Null

if (-not $Python) { $Python = if (Test-Path "$root\.venv\Scripts\python.exe") { "$root\.venv\Scripts\python.exe" } else { "python" } }
if (-not $Version) { $Version = (& $Python -c "import sys; sys.path.insert(0, 'backend'); from app.version import __version__; print(__version__)").Trim() }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3 (got '$Version')" }
Write-Host "== Building Shortsmith $Version"

# ---- version stamp (app + exe metadata)
$verFile = "backend\app\version.py"
(Get-Content $verFile -Raw) -replace '__version__ = "[^"]*"', "__version__ = `"$Version`"" | Set-Content $verFile -Encoding utf8 -NoNewline
$v = $Version.Split('.')
@"
VSVersionInfo(
  ffi=FixedFileInfo(filevers=($($v[0]), $($v[1]), $($v[2]), 0), prodvers=($($v[0]), $($v[1]), $($v[2]), 0)),
  kids=[StringFileInfo([StringTable('040904B0', [
    StringStruct('CompanyName', 'MalaMonster'), StringStruct('FileDescription', 'Shortsmith'),
    StringStruct('FileVersion', '$Version'), StringStruct('ProductName', 'Shortsmith'),
    StringStruct('ProductVersion', '$Version'), StringStruct('OriginalFilename', 'Shortsmith.exe')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])]
)
"@ | Set-Content "$build\version_info.txt" -Encoding utf8

# ---- frontend
Push-Location frontend
if (Test-Path package-lock.json) { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
if ($LASTEXITCODE) { throw "npm install failed" }
npm run build
if ($LASTEXITCODE) { throw "frontend build failed" }
Pop-Location

# ---- FFmpeg (static GPL build from BtbN, verified against the release's checksums)
$ffDir = "$build\ffmpeg"
if (-not (Test-Path "$ffDir\ffmpeg.exe")) {
  $name = "ffmpeg-n9.0-latest-win64-gpl-9.0.zip"
  $base = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
  Write-Host "== Downloading $name"
  $zip = "$build\$name"
  Invoke-WebRequest "$base/$name" -OutFile $zip -UseBasicParsing
  $sums = (Invoke-WebRequest "$base/checksums.sha256" -UseBasicParsing).Content
  if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
  $line = ($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($name) } | Select-Object -First 1
  if (-not $line) { throw "No checksum published for $name" }
  $expected = ($line.Trim() -split '\s+')[0].ToLower()
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw "FFmpeg download checksum mismatch" }
  $tmp = "$build\ffmpeg-extract"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive $zip -DestinationPath $tmp
  New-Item -ItemType Directory -Force $ffDir | Out-Null
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Copy-Item "$($src.FullName)\bin\ffmpeg.exe", "$($src.FullName)\bin\ffprobe.exe" $ffDir
  Copy-Item "$($src.FullName)\LICENSE.txt" "$ffDir\LICENSE.txt"
  Remove-Item -Recurse -Force $tmp, $zip
}

# ---- Python app → Shortsmith.exe
Write-Host "== PyInstaller"
& $Python -m PyInstaller packaging\shortsmith.spec --noconfirm --clean --distpath "$build\pyi" --workpath "$build\pyi-work"
if ($LASTEXITCODE) { throw "PyInstaller failed" }

# ---- installer
if (-not $Iscc) {
  $Iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $Iscc) { $Iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source }
  if (-not $Iscc) { throw "Inno Setup 6 not found (winget install JRSoftware.InnoSetup)" }
}
Write-Host "== Inno Setup"
& $Iscc /Q "/DAppVersion=$Version" packaging\installer.iss
if ($LASTEXITCODE) { throw "Inno Setup failed" }

$setup = "$dist\Shortsmith-Setup-$Version.exe"
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
"$hash  Shortsmith-Setup-$Version.exe" | Set-Content "$dist\SHA256SUMS.txt" -Encoding ascii
Write-Host ("== Done: {0} ({1:N0} MB)" -f $setup, ((Get-Item $setup).Length / 1MB))
