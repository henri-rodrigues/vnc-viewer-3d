# Instala o VNC Viewer 3D: dependências + atalhos na Área de Trabalho e no Menu Iniciar.
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
Set-Location $dir

Write-Host '== VNC Viewer 3D Ar Condicionado ==' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js não encontrado. Instalando via winget...' -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Instale o Node.js LTS em https://nodejs.org e rode este instalador de novo.'
    }
}

# Todas as bibliotecas já estão na pasta vendor/: nada é baixado da internet.
if (-not (Test-Path "$dir\public\icon.ico")) { node "$dir\tools\make-icon.js" }

$shell = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($folder in $targets) {
    $lnk = $shell.CreateShortcut((Join-Path $folder 'VNC Viewer 3D.lnk'))
    $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
    $lnk.Arguments = "`"$dir\Iniciar VNC Viewer.vbs`""
    $lnk.WorkingDirectory = $dir
    $lnk.IconLocation = "$dir\public\icon.ico,0"
    $lnk.Description = 'Acesso remoto - 3D Ar Condicionado'
    $lnk.Save()
    Write-Host "Atalho criado em $folder"
}

Write-Host 'Pronto! Clique em "VNC Viewer 3D" na Área de Trabalho.' -ForegroundColor Green
