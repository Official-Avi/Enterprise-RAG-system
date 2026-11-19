# Starts the RackFlow web app on http://127.0.0.1:3000, detached from this terminal, logging to .data\web.log.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev\start-web.ps1            # prod (default): build once, then serve
#   powershell -ExecutionPolicy Bypass -File scripts\dev\start-web.ps1 -Mode dev  # dev: live reload while editing code
#
# prod serves pre-built pages: about 150-250 MB and no compile workers, so it can't hit Next's
# "Jest worker encountered 2 child process exceptions" error when memory runs short. Use dev only while
# changing code. Any web server already on port 3000 started from this repo is stopped first.
param(
    [ValidateSet("prod", "dev")] [string]$Mode = "prod",
    [int]$Port = 3000,
    [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$web = Join-Path $repo "apps\web"
$log = Join-Path $repo ".data\web.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

# Stop a previous web server from this repo (dev or prod), never anything else.
$old = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine -like "*$web*" -or
    ($_.CommandLine -and $_.CommandLine -match "next (dev|start)" -and $_.CommandLine -match "-p $Port")
}
foreach ($p in $old) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($old) { Write-Host "Stopped $(@($old).Count) old web process(es)."; Start-Sleep 2 }

$env:NEXT_TELEMETRY_DISABLED = "1"
if ($Mode -eq "prod" -and -not $SkipBuild) {
    Write-Host "Building (about a minute)..."
    Push-Location $web
    try {
        # Build into .next-prod so it never collides with a dev server's .next folder.
        $env:NEXT_DIST_DIR = ".next-prod"
        & npx next build *> (Join-Path $repo ".data\web-build.log")
        if ($LASTEXITCODE -ne 0) { throw "next build failed; see .data\web-build.log" }
    } finally { Pop-Location }
}

$nextCmd = if ($Mode -eq "prod") { "set NEXT_DIST_DIR=.next-prod&& npx next start -H 127.0.0.1 -p $Port" } else { "npx next dev -H 127.0.0.1 -p $Port" }
$line = "/d /c `"set NEXT_TELEMETRY_DISABLED=1&& $nextCmd >> `"$log`" 2>&1`""
Start-Process -FilePath $env:ComSpec -ArgumentList $line -WorkingDirectory $web -WindowStyle Hidden

for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep 2
    try {
        if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 "http://127.0.0.1:$Port/login").StatusCode -eq 200) {
            Write-Host "Web app ($Mode) is up: http://127.0.0.1:$Port  (log: .data\web.log)"
            exit 0
        }
    } catch {}
}
throw "Web app did not answer on port $Port; see .data\web.log"
