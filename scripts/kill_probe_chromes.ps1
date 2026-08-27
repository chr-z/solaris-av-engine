# Mata apenas chromes headless de probe (user-data-dir temporario do harness).
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -match 'solaris-mvp-shot|solaris-probe' } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Output ("killed " + $_.ProcessId)
  }
Write-Output "done"
