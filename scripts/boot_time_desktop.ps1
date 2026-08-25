# Mede tempo ate janela aparecer (boot) do exe desktop Solaris.
param([string]$Exe = "D:/cargo-target/release/solaris-av-engine.exe", [int]$TimeoutMs = 15000)
$p = Start-Process -FilePath $Exe -PassThru
$sw = [Diagnostics.Stopwatch]::StartNew()
$ok = $false
while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    Start-Sleep -Milliseconds 100
    try { $p.Refresh(); if ($p.MainWindowHandle -ne 0) { $ok = $true; break } } catch {}
}
$sw.Stop()
if ($ok) { Write-Output ("BOOT_WINDOW_OK ms=" + $sw.ElapsedMilliseconds) } else { Write-Output "BOOT_WINDOW_TIMEOUT" }
try {
    $p.Refresh()
    $mem = [math]::Round($p.WorkingSet64 / 1MB, 1)
    Write-Output ("WS_MB=" + $mem)
} catch {}
try { $p.Kill(); $p.WaitForExit(5000) | Out-Null } catch {}
