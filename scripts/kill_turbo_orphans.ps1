# Kill ONLY solaris-web-turbo's orphaned vite preview process groups
# (validated protocol: never touch other projects' servers).
$targets = @(28732,13272,33420,15648,34672, 10164,24628,31216,8796,27164, 39912,35688,27412,11864,40632)
foreach ($pid2 in $targets) {
  $p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
  if ($p) {
    try { Stop-Process -Id $pid2 -Force -ErrorAction Stop; Write-Output ("KILLED " + $pid2) }
    catch { Write-Output ("FAIL " + $pid2 + " : " + $_.Exception.Message) }
  } else { Write-Output ("GONE " + $pid2) }
}
