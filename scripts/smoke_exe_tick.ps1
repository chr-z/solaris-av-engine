$exe = 'D:\cargo-target\release\solaris-av-engine.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 5
$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) {
  Write-Output ('SMOKE_OK pid=' + $p.Id + ' mem=' + [math]::Round($alive.WorkingSet64/1MB) + 'MB')
  Stop-Process -Id $p.Id -Force
  Start-Sleep -Seconds 2
  if (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) { Write-Output 'SMOKE_KILL_FAILED' } else { Write-Output 'SMOKE_KILLED' }
} else {
  Write-Output ('SMOKE_DEAD_EARLY pid=' + $p.Id + ' exitcode=' + $p.ExitCode)
}
