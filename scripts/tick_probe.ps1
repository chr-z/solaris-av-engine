$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'solaris-features' } | ForEach-Object {
  $cmd = $_.CommandLine
  if ($cmd.Length -gt 200) { $cmd = $cmd.Substring(0,200) }
  Write-Output ("PID=" + $_.ProcessId + " BORN=" + $_.CreationDate + " CMD=" + $cmd)
}
Write-Output "---node/vite listeners---"
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -gt 4000 -and $_.LocalPort -lt 6000 } | ForEach-Object {
  $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $_.OwningProcess)
  if ($p) {
    $c = $p.CommandLine
    if ($c.Length -gt 140) { $c = $c.Substring(0,140) }
    Write-Output ("PORT=" + $_.LocalPort + " PID=" + $_.OwningProcess + " BORN=" + $p.CreationDate + " CMD=" + $c)
  }
}
