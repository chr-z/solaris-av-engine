$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'vite|preview|axe-scan|console-probe' }
$now = Get-Date
if (-not $procs) { Write-Output 'VITE_ORPHANS: NONE' } else {
  foreach ($p in $procs) {
    $ageMin = [int](($now - $p.CreationDate).TotalMinutes)
    Write-Output ("CANDIDATE pid={0} ageMin={1} cmd={2}" -f $p.ProcessId, $ageMin, ($p.CommandLine.Substring(0, [Math]::Min(140, $p.CommandLine.Length))))
  }
}
$chrome = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'lh-t20-profile|puppeteer|cdp' -and $_.CommandLine -match 'user-data-dir' }
if (-not $chrome) { Write-Output 'CHROME_PROBE_ORPHANS: NONE' } else {
  foreach ($c in $chrome) { Write-Output ("CHROME pid={0} ageMin={1}" -f $c.ProcessId, [int](($now - $c.CreationDate).TotalMinutes)) }
}
