# Kill ONLY this project's orphaned `vite preview` processes (auto-discovered).
# Scope: solaris-web-turbo worktree ALWAYS eligible; solaris-av-engine (main
# dir, shared with desktop lane) only when older than -MaxAgeHours.
# NEVER touches solaris-redesign (other worker's lane) — hard skip.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File kill_turbo_orphans.ps1 [-MaxAgeHours 3]
param([int]$MaxAgeHours = 3)
$now = Get-Date
$cut = $now.AddHours(-$MaxAgeHours)
$procs = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match 'vite' -and $_.CommandLine -match 'preview' -and (
    $_.CommandLine -match 'solaris-web-turbo' -or $_.CommandLine -match 'solaris-av-engine')
}
$killed = 0
foreach ($p in $procs) {
  if ($p.CommandLine -match 'solaris-redesign') { Write-Output ("SKIP redesign-lane " + $p.ProcessId); continue }
  $ageH = [math]::Round(($now - $p.CreationDate).TotalHours, 1)
  $port = if ($p.CommandLine -match '--port (\d+)') { $Matches[1] } else { '?' }
  if ($p.CreationDate -gt $cut) { Write-Output ("SKIP fresh pid=" + $p.ProcessId + " port=" + $port + " age_h=" + $ageH); continue }
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    $killed++
    Write-Output ("KILLED pid=" + $p.ProcessId + " port=" + $port + " age_h=" + $ageH)
  } catch { Write-Output ("FAIL pid=" + $p.ProcessId + " : " + $_.Exception.Message) }
}
if ($killed -eq 0 -and -not $procs) { Write-Output 'NONE' }
