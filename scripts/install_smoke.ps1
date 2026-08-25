# Smoke ponta a ponta do instalador NSIS do Solaris desktop:
# instala silencioso em dir de teste -> confere arquivos -> roda o app instalado ->
# desinstala silenciosamente e verifica limpeza.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/install_smoke.ps1 -Installer <caminho>
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [string]$InstallDir = "$env:LOCALAPPDATA\Temp\solaris_inst_test",
    [int]$WaitSeconds = 5
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Installer)) {
    Write-Output "INSTALLSMOKE_FAIL: instalador nao encontrado em $Installer"
    exit 1
}

# 1) instalacao silenciosa (NSIS: /S silencioso, /D=<dir> destino SEM aspas)
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
$p = Start-Process -FilePath $Installer -ArgumentList "/S", "/D=$InstallDir" -PassThru -Wait
Write-Output ("INSTALLER_EXIT=" + $p.ExitCode)

Start-Sleep -Seconds 1
if (-not (Test-Path $InstallDir)) {
    Write-Output "INSTALLSMOKE_FAIL: diretorio de instalacao nao foi criado ($InstallDir)"
    exit 1
}
$files = Get-ChildItem $InstallDir -Recurse -File
$total = ($files | Measure-Object Length -Sum).Sum
Write-Output ("INSTALL_OK: files=" + $files.Count + " bytes=" + $total)

# 2) localiza o exe principal (o maior .exe do dir = o app; uninstall.exe e pequeno)
$mainExe = Get-ChildItem $InstallDir -Filter *.exe |
    Sort-Object Length -Descending | Select-Object -First 1
if (-not $mainExe) {
    Write-Output "INSTALLSMOKE_FAIL: nenhum .exe instalado"
    exit 1
}
Write-Output ("INSTALLED_EXE=" + $mainExe.FullName + " size=" + $mainExe.Length)

# 3) smoke do app instalado: inicia, espera, confirma vivo, mata
$app = Start-Process -FilePath $mainExe.FullName -PassThru
Start-Sleep -Seconds $WaitSeconds
$alive = $false
try { $alive = -not $app.HasExited } catch { $alive = $false }
if (-not $alive) {
    Write-Output "INSTALLSMOKE_FAIL: app instalado morreu antes de ${WaitSeconds}s"
    exit 1
}
$mem = 0
try { $mem = [math]::Round((Get-Process -Id $app.Id).WorkingSet64 / 1MB, 1) } catch {}
Write-Output ("APP_SMOKE_OK: pid=" + $app.Id + " vivo apos ${WaitSeconds}s mem=${mem}MB")
try { $app.Kill(); $app.WaitForExit(5000) | Out-Null } catch {}

# 4) desinstalacao silenciosa (_?= mantem o processo sincrono e no proprio caminho)
$uninst = Join-Path $InstallDir "uninstall.exe"
if (Test-Path $uninst) {
    $u = Start-Process -FilePath $uninst -ArgumentList "/S", "_?=$InstallDir" -PassThru -Wait
    Write-Output ("UNINSTALLER_EXIT=" + $u.ExitCode)
    Start-Sleep -Seconds 3
} else {
    Write-Output "AVISO: uninstall.exe nao encontrado em $InstallDir"
}

if (Test-Path $InstallDir) {
    $left = (Get-ChildItem $InstallDir -Recurse -File | Measure-Object).Count
    Write-Output "INSTALLSMOKE_WARN: diretorio ainda existe com $left arquivo(s)"
    # _?= impede o auto-delete do proprio uninstaller — limpeza manual esperada
    Remove-Item -Recurse -Force $InstallDir
    Write-Output "LIMPEZA_MANUAL_OK"
} else {
    Write-Output "UNINSTALL_CLEAN: diretorio removido pelo desinstalador"
}

Write-Output "INSTALLSMOKE_PASS"
exit 0
