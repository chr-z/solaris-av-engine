param([int]$Port = 0)
# Cleanup de órfãos do harness t19: mata o processo escutando na porta e
# qualquer chrome com profile temp solaris-shot-t19.
if ($Port -gt 0) {
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($c) {
    $c | ForEach-Object { taskkill /pid $_.OwningProcess /T /F 2>$null }
    Write-Output "porta ${Port}: processo(s) morto(s)"
  } else {
    Write-Output "porta ${Port}: livre"
  }
}
$procs = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'solaris-shot-t19' }
if ($procs) {
  $procs | ForEach-Object { taskkill /pid $_.ProcessId /T /F 2>$null }
  Write-Output "chrome profiles t19: morto(s)"
} else {
  Write-Output "nenhum chrome t19 vivo"
}
