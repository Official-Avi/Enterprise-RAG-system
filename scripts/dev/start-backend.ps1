# Starts the RackFlow backend on Windows without Docker: PostgreSQL + Qdrant (if not already
# running), then restarts the API on 127.0.0.1:8000 and one worker. Run it after a reboot.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\dev\start-backend.ps1
#
# The API and worker run detached in hidden windows and outlive this script. Output is appended to
# .data\api.log and .data\worker.log. Settings come from <repo>\.env, which rackflow.core.config
# reads by absolute path, so nothing is copied into the environment here.
# Exit code: 0 when live, ready and a fresh worker heartbeat were all observed, otherwise 1.

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$backend = Join-Path $repo "backend"
$data = Join-Path $repo ".data"
$python = Join-Path $backend ".venv\Scripts\python.exe"
$apiBase = "http://127.0.0.1:8000/api/v1"
$apiArgs = "-m uvicorn rackflow.api.app:create_app --factory --host 127.0.0.1 --port 8000"
$workerArgs = "-m rackflow.worker.main"

if (-not (Test-Path $python)) {
    throw "Backend virtualenv not found at $python. Run 'uv sync' in backend first (see README)."
}

function Get-BackendProcess {
    # Includes the cmd.exe log wrapper, the venv python launcher and the real interpreter.
    Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -and $_.ProcessId -ne $PID -and
            ($_.Name -in "cmd.exe", "python.exe") -and
            ($_.CommandLine -match "uvicorn rackflow\.api\.app:create_app|-m rackflow\.worker\.main") }
}

function Start-Detached([string]$Arguments, [string]$LogName) {
    # cmd.exe does the redirection so stdout and stderr share one log: the app logs to stdout,
    # uvicorn to stderr, and Start-Process cannot send both to the same file.
    $log = Join-Path $data $LogName
    $line = "/d /c `"`"$python`" $Arguments >> `"$log`" 2>&1`""
    Start-Process -FilePath "$env:ComSpec" -ArgumentList $line -WorkingDirectory $backend -WindowStyle Hidden
}

# 1. PostgreSQL and Qdrant (each is left alone if already running).
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-services.ps1")
if ($LASTEXITCODE -ne 0) { throw "start-services.ps1 failed with exit code $LASTEXITCODE" }

# 2. Stop any previous API and worker. A job held by a killed worker is retried after its lease.
$old = @(Get-BackendProcess)
if ($old.Count -gt 0) {
    Write-Host "Stopping $($old.Count) previous API/worker process(es)"
    $old | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 500
    }
}
$holder = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($holder) {
    throw "Port 8000 is held by another program (PID $($holder[0].OwningProcess)). Not touching it."
}

# 3. Start detached.
$startedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss+00:00")
Start-Detached $apiArgs "api.log"
Start-Detached $workerArgs "worker.log"
Write-Host "API and worker starting (logs: .data\api.log, .data\worker.log)"

# 4. Verify. The first readiness check loads the embedding model, so it can take a while.
function Get-Status([string]$Url) {
    try { return (Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 15).StatusCode }
    catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

$live = 0; $ready = 0
for ($i = 0; $i -lt 60; $i++) {
    $live = Get-Status "$apiBase/health/live"
    if ($live -eq 200) { $ready = Get-Status "$apiBase/health/ready" }
    if ($live -eq 200 -and $ready -eq 200) { break }
    Start-Sleep -Seconds 2
}
Write-Host "health/live:  $live"
Write-Host "health/ready: $ready"

# Only a worker started by this run counts: a killed worker's recent heartbeat must not pass.
$heartbeatCheck = @"
from datetime import UTC, datetime, timedelta
from sqlalchemy import func, select
from rackflow.db.models import WorkerHeartbeat
from rackflow.db.session import session_scope
since = datetime.fromisoformat('$startedAt')
with session_scope() as db:
    latest = db.scalar(select(func.max(WorkerHeartbeat.last_heartbeat_at))
                       .where(WorkerHeartbeat.started_at >= since))
fresh = latest is not None and datetime.now(UTC) - latest < timedelta(seconds=30)
print(f'latest heartbeat from new worker: {latest}')
raise SystemExit(0 if fresh else 1)
"@
Push-Location $backend
$heartbeat = 1
for ($i = 0; $i -lt 15; $i++) {
    $heartbeatCheck | & $python - | Write-Host
    $heartbeat = $LASTEXITCODE
    if ($heartbeat -eq 0) { break }
    Start-Sleep -Seconds 2
}
Pop-Location

if ($live -eq 200 -and $ready -eq 200 -and $heartbeat -eq 0) {
    Write-Host "Backend is up: http://127.0.0.1:8000"
    exit 0
}
Write-Host "Backend did NOT come up cleanly. See .data\api.log and .data\worker.log."
exit 1
