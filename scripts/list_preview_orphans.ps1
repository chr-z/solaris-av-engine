# List vite preview orphans (pid + cmdline head) — solaris-web-turbo
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vite' -and $_.CommandLine -match 'preview' }
foreach ($p in $procs) {
  $cmd = $p.CommandLine
  if ($cmd.Length -gt 200) { $cmd = $cmd.Substring(0, 200) }
  Write-Output ("PID=" + $p.ProcessId + " | " + ($p.CreationDate) + " | " + ($cmd -replace '\s+', ' '))
}
if (-not $procs) { Write-Output 'NONE' }
