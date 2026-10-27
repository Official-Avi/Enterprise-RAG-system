# Starts local PostgreSQL and Qdrant for development on Windows without Docker.
# Both listen on 127.0.0.1 only. Data lives under <repo>/.data (git-ignored).
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\dev\start-services.ps1
# Env overrides: RACKFLOW_PG_BIN (folder with pg_ctl.exe), RACKFLOW_QDRANT_EXE (path to qdrant.exe)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\..\.."
$data = Join-Path $repo ".data"
$pgBin = if ($env:RACKFLOW_PG_BIN) { $env:RACKFLOW_PG_BIN } else { "$env:USERPROFILE\tools\pgsql\bin" }
$qdrantExe = if ($env:RACKFLOW_QDRANT_EXE) { $env:RACKFLOW_QDRANT_EXE } else { "$env:USERPROFILE\tools\qdrant\qdrant.exe" }

if (-not (Test-Path "$data\pg\PG_VERSION")) {
    throw "PostgreSQL data dir not initialised at $data\pg. See README 'Local setup without Docker'."
}

# PostgreSQL
& "$pgBin\pg_ctl.exe" -D "$data\pg" status *> $null
if ($LASTEXITCODE -ne 0) {
    & "$pgBin\pg_ctl.exe" -D "$data\pg" -l "$data\postgres.log" -o "-c listen_addresses=127.0.0.1 -p 5432" -w start
    Write-Host "PostgreSQL started on 127.0.0.1:5432"
} else {
    Write-Host "PostgreSQL already running"
}

# Qdrant
$listening = Get-NetTCPConnection -LocalPort 6333 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    $env:QDRANT__SERVICE__HOST = "127.0.0.1"
    $env:QDRANT__STORAGE__STORAGE_PATH = "$data\qdrant"
    $env:QDRANT__TELEMETRY_DISABLED = "true"
    Start-Process -FilePath $qdrantExe -WorkingDirectory $data -WindowStyle Hidden `
        -RedirectStandardOutput "$data\qdrant.log" -RedirectStandardError "$data\qdrant.err.log"
    for ($i = 0; $i -lt 30; $i++) {
        try { Invoke-RestMethod "http://127.0.0.1:6333/readyz" -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
    }
    Write-Host "Qdrant started on 127.0.0.1:6333"
} else {
    Write-Host "Qdrant already running"
}
