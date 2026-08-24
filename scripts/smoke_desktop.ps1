# Smoke test do binario Solaris desktop: inicia, espera, confirma vivo, mata.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/smoke_desktop.ps1 -Exe <caminho>
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [int]$WaitSeconds = 5
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $Exe)) {
    Write-Output "SMOKE_FAIL: binario nao encontrado em $Exe"
    exit 1
}

$p = Start-Process -FilePath $Exe -PassThru
Start-Sleep -Seconds $WaitSeconds

$alive = $false
try { $alive = -not $p.HasExited } catch { $alive = $false }

if ($alive) {
    $mem = 0
    try {
        $proc = Get-Process -Id $p.Id -ErrorAction Stop
        $mem = [math]::Round($proc.WorkingSet64 / 1MB, 1)
    } catch {}
    Write-Output "SMOKE_OK: pid=$($p.Id) vivo apos ${WaitSeconds}s mem=${mem}MB exe=$Exe"
    try { $p.Kill() ; $p.WaitForExit(5000) | Out-Null } catch {}
    Write-Output "SMOKE_KILLED: processo encerrado"
    exit 0
} else {
    $code = -1
    try { $code = $p.ExitCode } catch {}
    Write-Output "SMOKE_FAIL: processo morreu antes de ${WaitSeconds}s exitcode=$code exe=$Exe"
    exit 1
}
