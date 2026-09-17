# Launch the Forebay dashboard in dev mode. Handles first-run setup:
# installs dependencies and re-extracts the Electron binary if its download
# was left unpacked (a known Windows install quirk).
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies (first run)..." -ForegroundColor Cyan
  npm install
}

$electron = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) {
  Write-Host "Extracting the Electron binary..." -ForegroundColor Cyan
  try { node "node_modules\electron\install.js" } catch {}
  if (-not (Test-Path $electron)) {
    $zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-*-win32-x64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($zip) {
      $dist = Join-Path $PSScriptRoot "node_modules\electron\dist"
      Remove-Item -Recurse -Force $dist -ErrorAction SilentlyContinue
      Expand-Archive -Path $zip.FullName -DestinationPath $dist -Force
      "electron.exe" | Out-File (Join-Path $PSScriptRoot "node_modules\electron\path.txt") -Encoding ascii -NoNewline
    } else {
      Write-Host "Could not find the Electron cache zip. Run 'npm install' manually." -ForegroundColor Yellow
    }
  }
}

Write-Host "Starting Forebay..." -ForegroundColor Green
npm run dev
