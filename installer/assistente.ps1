# Assistente de instalação / atualização / desinstalação do VNC Viewer 3D.
# Telas do Windows (Windows Forms, já incluso no Windows): nada externo.
# É aberto pelo próprio .exe (ver exe-install.js), que extrai este arquivo e as
# imagens para uma pasta temporária e passa os caminhos como parâmetros.
param(
    [ValidateSet('install', 'uninstall')] [string] $Mode = 'install',
    [string] $Source,          # .exe baixado (instalação)
    [string] $Version = '',
    [Parameter(Mandatory)] [string] $Assets,  # pasta com icon.ico e logo.png
    [string] $CurrentDir = '', # pasta da versão já instalada, se houver
    [string] $CurrentVersion = '',
    [int] $WaitPid = 0         # processo que precisa fechar antes (desinstalação)
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace VncViewer3D -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][VncViewer3D.Dpi]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()

$AppName = 'VNC Viewer 3D'
$ExeName = "$AppName.exe"
$RegKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\VNCViewer3D'
$DefaultDir = Join-Path $env:LOCALAPPDATA "Programs\$AppName"
$Result = Join-Path $Assets 'resultado.txt'

$Azul = [Drawing.Color]::FromArgb(0, 131, 202)
$AzulEscuro = [Drawing.Color]::FromArgb(14, 43, 92)
$Texto = [Drawing.Color]::FromArgb(43, 53, 71)
$Muted = [Drawing.Color]::FromArgb(105, 114, 125)
$Fundo = [Drawing.Color]::FromArgb(244, 244, 244)

# Tamanhos em pixels escalados para o DPI da tela (fontes em pontos já escalam sozinhas).
$g = [Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $Scale = $g.DpiX / 96; $g.Dispose()
function S([double] $n) { [int][Math]::Round($n * $Scale) }

function Set-Result([string] $v) { Set-Content -LiteralPath $Result -Value $v -Encoding ASCII }

# ---------- estado ----------
$reg = Get-ItemProperty -Path $RegKey -ErrorAction SilentlyContinue
$State = @{
    Dir = $DefaultDir
    Desktop = $true
    StartMenu = $true
    Launch = $true
    RemoveServer = $true
    KeepList = $false
    Updating = [bool]$CurrentDir
}
if ($CurrentDir) { $State.Dir = $CurrentDir }
if ($reg) {
    if ($null -ne $reg.AtalhoAreaDeTrabalho) { $State.Desktop = [bool]$reg.AtalhoAreaDeTrabalho }
    if ($null -ne $reg.AtalhoMenuIniciar) { $State.StartMenu = [bool]$reg.AtalhoMenuIniciar }
}
$ServerInstalled = [bool](Get-Service tvnserver -ErrorAction SilentlyContinue)

# ---------- janela ----------
$form = New-Object Windows.Forms.Form
$form.Text = $(if ($Mode -eq 'uninstall') { "Desinstalar - $AppName" } else { "Instalação - $AppName" })
$form.ClientSize = New-Object Drawing.Size((S 600), (S 430))
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [Drawing.Color]::White
$form.Font = New-Object Drawing.Font('Segoe UI', 9)
$iconFile = Join-Path $Assets 'icon.ico'
if (Test-Path $iconFile) { $form.Icon = New-Object Drawing.Icon $iconFile }

$header = New-Object Windows.Forms.Panel
$header.SetBounds(0, 0, (S 600), (S 72)); $header.BackColor = [Drawing.Color]::White
$title = New-Object Windows.Forms.Label
$title.SetBounds((S 24), (S 14), (S 430), (S 26)); $title.Font = New-Object Drawing.Font('Segoe UI Semibold', 12)
$title.ForeColor = $AzulEscuro
$subtitle = New-Object Windows.Forms.Label
$subtitle.SetBounds((S 26), (S 42), (S 430), (S 22)); $subtitle.ForeColor = $Muted
$logo = New-Object Windows.Forms.PictureBox
$logo.SetBounds((S 470), (S 6), (S 110), (S 60)); $logo.SizeMode = 'Zoom'
$logoFile = Join-Path $Assets 'logo.png'
if (Test-Path $logoFile) { $logo.Image = [Drawing.Image]::FromFile($logoFile) }
$header.Controls.AddRange(@($title, $subtitle, $logo))

$line = New-Object Windows.Forms.Panel
$line.SetBounds(0, (S 72), (S 600), (S 3)); $line.BackColor = $Azul

$content = New-Object Windows.Forms.Panel
$content.SetBounds(0, (S 75), (S 600), (S 295)); $content.BackColor = [Drawing.Color]::White

$footer = New-Object Windows.Forms.Panel
$footer.SetBounds(0, (S 370), (S 600), (S 60)); $footer.BackColor = $Fundo

function New-Button([string] $text, [int] $x, [bool] $primary = $false) {
    $b = New-Object Windows.Forms.Button
    $b.Text = $text
    $b.SetBounds($x, (S 15), (S 92), (S 30))
    $b.FlatStyle = 'Flat'
    if ($primary) {
        $b.BackColor = $Azul; $b.ForeColor = [Drawing.Color]::White; $b.FlatAppearance.BorderColor = $Azul
    } else {
        $b.BackColor = [Drawing.Color]::White; $b.ForeColor = $Texto
        $b.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(200, 205, 212)
    }
    $b
}
$btnBack = New-Button '< Voltar' (S 290)
$btnNext = New-Button 'Avançar >' (S 390) $true
$btnCancel = New-Button 'Cancelar' (S 492)
$footer.Controls.AddRange(@($btnBack, $btnNext, $btnCancel))
$form.Controls.AddRange(@($header, $line, $content, $footer))
$form.AcceptButton = $btnNext

# ---------- helpers de conteúdo ----------
function Clear-Page([string] $t, [string] $sub) {
    $content.Controls.Clear(); $title.Text = $t; $subtitle.Text = $sub
}
function Add-Text([string] $text, [int] $y, [int] $h = 40, [switch] $Bold, [switch] $Small) {
    $l = New-Object Windows.Forms.Label
    $l.Text = $text
    $l.SetBounds((S 28), (S $y), (S 544), (S $h))
    $l.ForeColor = $(if ($Small) { $Muted } else { $Texto })
    if ($Bold) { $l.Font = New-Object Drawing.Font('Segoe UI Semibold', 9.5) }
    $content.Controls.Add($l); $l
}
function Add-Check([string] $text, [int] $y, [bool] $checked) {
    $c = New-Object Windows.Forms.CheckBox
    $c.Text = $text; $c.Checked = $checked
    $c.SetBounds((S 28), (S $y), (S 544), (S 24)); $c.ForeColor = $Texto
    $content.Controls.Add($c); $c
}

# ---------- ações ----------
function Stop-RunningApp {
    # Pede para o programa aberto fechar (mesma API usada pelo .exe novo).
    try {
        Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:6080/api/quit' -Method Post `
            -ContentType 'application/json' -Body '{}' -Headers @{ Origin = 'http://localhost:6080' } -TimeoutSec 3 | Out-Null
        Start-Sleep -Milliseconds 800
    } catch {}
}

function Invoke-Retry([scriptblock] $action, [string] $failMessage) {
    for ($i = 0; $i -lt 20; $i++) {
        try { & $action; return } catch { Start-Sleep -Milliseconds 500 }
    }
    throw $failMessage
}

function Set-Shortcut([string] $path, [string] $target, [string] $dir) {
    $sh = New-Object -ComObject WScript.Shell
    $l = $sh.CreateShortcut($path)
    $l.TargetPath = $target
    $l.WorkingDirectory = $dir
    $l.IconLocation = "$(Join-Path $dir 'icon.ico'),0"
    $l.Description = 'Acesso remoto - 3D Ar Condicionado'
    $l.Save()
}

function Get-ShortcutPaths {
    @{
        Desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
        StartMenu = Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"
    }
}

# Apaga o atalho só se ele apontar para este programa (não mexe em atalhos de outra instalação).
function Remove-OurShortcut([string] $lnk, [string] $exe) {
    if (-not (Test-Path -LiteralPath $lnk)) { return }
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk).TargetPath
    if ($target -and ([IO.Path]::GetFullPath($target) -ieq [IO.Path]::GetFullPath($exe))) {
        Remove-Item -LiteralPath $lnk -Force
    }
}

function Invoke-Install([scriptblock] $report) {
    $dir = $State.Dir
    $exe = Join-Path $dir $ExeName
    & $report 'Fechando o programa, se estiver aberto...' 10
    Stop-RunningApp

    & $report 'Preparando a pasta...' 25
    try {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $probe = Join-Path $dir ('.teste-' + [guid]::NewGuid())
        [IO.File]::WriteAllText($probe, 'x'); Remove-Item -LiteralPath $probe -Force
    } catch {
        throw "Sem permissão para gravar em:`n$dir`n`nEscolha uma pasta dentro da sua conta (por exemplo, a pasta sugerida)."
    }

    & $report 'Copiando o programa...' 45
    Invoke-Retry { Copy-Item -LiteralPath $Source -Destination $exe -Force } `
        "Não foi possível substituir o programa em:`n$exe`n`nFeche o VNC Viewer 3D e tente de novo."
    Copy-Item -LiteralPath (Join-Path $Assets 'icon.ico') -Destination (Join-Path $dir 'icon.ico') -Force
    # A lista de computadores (conexoes.csv) é de cada pessoa: o instalador nunca cria nem altera.

    & $report 'Criando atalhos...' 70
    $lnk = Get-ShortcutPaths
    if ($State.Desktop) { Set-Shortcut $lnk.Desktop $exe $dir } else { Remove-OurShortcut $lnk.Desktop $exe }
    if ($State.StartMenu) { Set-Shortcut $lnk.StartMenu $exe $dir } else { Remove-OurShortcut $lnk.StartMenu $exe }

    & $report 'Registrando no Windows...' 85
    New-Item -Path $RegKey -Force | Out-Null
    $strings = @{
        DisplayName = $AppName
        DisplayVersion = $Version
        Publisher = '3D Ar Condicionado'
        DisplayIcon = (Join-Path $dir 'icon.ico')
        InstallLocation = $dir
        UninstallString = ('"' + $exe + '" --desinstalar')
        URLInfoAbout = 'https://3darcondicionado.com.br/'
    }
    foreach ($k in $strings.Keys) { New-ItemProperty -Path $RegKey -Name $k -Value $strings[$k] -PropertyType String -Force | Out-Null }
    $dwords = @{
        NoModify = 1; NoRepair = 1
        EstimatedSize = [int]((Get-Item -LiteralPath $exe).Length / 1KB)
        AtalhoAreaDeTrabalho = [int]$State.Desktop
        AtalhoMenuIniciar = [int]$State.StartMenu
    }
    foreach ($k in $dwords.Keys) { New-ItemProperty -Path $RegKey -Name $k -Value $dwords[$k] -PropertyType DWord -Force | Out-Null }
    & $report 'Concluído.' 100
}

function Invoke-Uninstall([scriptblock] $report) {
    $notes = @()
    & $report 'Fechando o programa...' 10
    if ($WaitPid) { try { Wait-Process -Id $WaitPid -Timeout 15 } catch {} }
    Stop-RunningApp

    if ($State.RemoveServer -and $ServerInstalled) {
        & $report 'Removendo o acesso remoto deste PC (confirme a permissão do Windows)...' 25
        $keys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
        $codes = @(Get-ChildItem -Path $keys -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue } |
            Where-Object { $_.DisplayName -like 'TightVNC*' -and $_.PSChildName -match '^\{[0-9A-Fa-f-]+\}$' } |
            ForEach-Object { $_.PSChildName })
        foreach ($code in $codes) {
            try {
                $p = Start-Process msiexec.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList "/x $code /quiet /norestart"
                if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { $notes += "O acesso remoto deste PC não foi removido (código $($p.ExitCode))." }
            } catch {
                $notes += 'O acesso remoto deste PC não foi removido: a permissão do Windows foi cancelada.'
            }
        }
    }

    & $report 'Removendo atalhos...' 55
    $dir = $State.Dir
    $lnk = Get-ShortcutPaths
    foreach ($p in @($lnk.Desktop, $lnk.StartMenu)) { Remove-OurShortcut $p (Join-Path $dir $ExeName) }

    & $report 'Removendo arquivos...' 75
    # Apaga só os arquivos do programa, nunca a pasta inteira às cegas.
    $files = @($ExeName, 'icon.ico')
    if (-not $State.KeepList) { $files += 'conexoes.csv' }
    foreach ($f in $files) {
        $path = Join-Path $dir $f
        if (Test-Path -LiteralPath $path) {
            Invoke-Retry { Remove-Item -LiteralPath $path -Force } "Não foi possível apagar:`n$path"
        }
    }
    if ((Test-Path -LiteralPath $dir) -and -not (Get-ChildItem -LiteralPath $dir -Force)) { Remove-Item -LiteralPath $dir -Force }

    & $report 'Removendo o registro do Windows...' 90
    Remove-Item -Path $RegKey -Recurse -Force -ErrorAction SilentlyContinue
    & $report 'Concluído.' 100
    $notes
}

# ---------- páginas ----------
$Pages = if ($Mode -eq 'uninstall') { @('confirm', 'progress', 'done') } else { @('welcome', 'folder', 'options', 'ready', 'progress', 'done') }
$script:Index = 0
$script:Controls = @{}
$script:Notes = @()
$script:Finished = $false

function Show-Page {
    $page = $Pages[$script:Index]
    $btnBack.Visible = $script:Index -gt 0 -and $page -notin @('progress', 'done')
    $btnNext.Enabled = $true; $btnCancel.Enabled = $true; $btnCancel.Visible = $true
    $btnNext.Text = 'Avançar >'
    switch ($page) {
        'welcome' {
            if ($State.Updating) {
                $from = $(if ($CurrentVersion) { "versão $CurrentVersion" } else { 'versão anterior' })
                Clear-Page "Atualizar o $AppName" "Da $from para a versão $Version"
                Add-Text "O $AppName já está instalado neste computador, em:" 20 22 | Out-Null
                Add-Text $State.Dir 44 22 -Bold | Out-Null
                Add-Text 'O assistente vai substituir o programa pela versão nova. Seus computadores salvos são mantidos.' 80 40 | Out-Null
                Add-Text 'Se o programa estiver aberto, ele será fechado e aberto de novo no final.' 124 40 -Small | Out-Null
            } else {
                Clear-Page "Bem-vindo à instalação do $AppName" "Versão $Version"
                Add-Text 'Este assistente vai instalar o acesso remoto da 3D Ar Condicionado neste computador.' 20 40 | Out-Null
                Add-Text 'Não é preciso ser administrador, nem instalar nada antes.' 64 22 | Out-Null
                Add-Text 'Clique em Avançar para continuar ou em Cancelar para sair.' 104 22 -Small | Out-Null
            }
        }
        'folder' {
            Clear-Page 'Pasta de instalação' 'Onde o programa deve ser instalado?'
            Add-Text 'O programa será instalado nesta pasta. Para escolher outra, clique em Procurar.' 20 22 | Out-Null
            $box = New-Object Windows.Forms.TextBox
            $box.SetBounds((S 28), (S 52), (S 440), (S 24)); $box.Text = $State.Dir
            $browse = New-Object Windows.Forms.Button
            $browse.Text = 'Procurar...'; $browse.SetBounds((S 476), (S 50), (S 96), (S 28)); $browse.FlatStyle = 'System'
            $browse.Add_Click({
                $dlg = New-Object Windows.Forms.FolderBrowserDialog
                $dlg.Description = 'Escolha a pasta onde instalar o VNC Viewer 3D'
                $dlg.SelectedPath = Split-Path $script:Controls.Folder.Text -Parent
                if ($dlg.ShowDialog($form) -eq 'OK') {
                    $chosen = $dlg.SelectedPath
                    if ((Split-Path $chosen -Leaf) -ne $AppName) { $chosen = Join-Path $chosen $AppName }
                    $script:Controls.Folder.Text = $chosen
                }
            })
            $content.Controls.AddRange(@($box, $browse))
            $script:Controls.Folder = $box
            if ($State.Updating) {
                $box.Enabled = $false; $browse.Enabled = $false
                Add-Text 'Na atualização a pasta não muda. Para instalar em outro lugar, desinstale primeiro.' 90 40 -Small | Out-Null
            } else {
                Add-Text 'Dica: use uma pasta dentro da sua conta. Pastas como "Arquivos de Programas" exigem administrador.' 90 40 -Small | Out-Null
            }
        }
        'options' {
            Clear-Page 'Atalhos e opções' 'Escolha o que criar'
            $script:Controls.Desktop = Add-Check 'Criar atalho na Área de Trabalho' 24 $State.Desktop
            $script:Controls.StartMenu = Add-Check 'Criar atalho no Menu Iniciar' 54 $State.StartMenu
            $script:Controls.Launch = Add-Check "Abrir o $AppName ao concluir" 84 $State.Launch
        }
        'ready' {
            Clear-Page 'Pronto para instalar' 'Confira as escolhas e clique em Instalar'
            $yes = { param($v) if ($v) { 'sim' } else { 'não' } }
            Add-Text 'Pasta:' 20 20 -Small | Out-Null
            Add-Text $State.Dir 40 22 -Bold | Out-Null
            Add-Text ("Atalho na Área de Trabalho: " + (& $yes $State.Desktop)) 74 22 | Out-Null
            Add-Text ("Atalho no Menu Iniciar: " + (& $yes $State.StartMenu)) 98 22 | Out-Null
            Add-Text ("Abrir ao concluir: " + (& $yes $State.Launch)) 122 22 | Out-Null
            $btnNext.Text = $(if ($State.Updating) { 'Atualizar' } else { 'Instalar' })
        }
        'confirm' {
            Clear-Page "Desinstalar o $AppName" "Versão instalada em $($State.Dir)"
            Add-Text "O $AppName e seus atalhos serão removidos deste computador." 20 22 | Out-Null
            $script:Controls.RemoveServer = Add-Check 'Remover também o acesso remoto a este PC (recomendado)' 56 ($State.RemoveServer -and $ServerInstalled)
            $script:Controls.RemoveServer.Enabled = $ServerInstalled
            if (-not $ServerInstalled) { $script:Controls.RemoveServer.Text = 'O acesso remoto a este PC não está ativado' }
            $script:Controls.KeepList = Add-Check 'Manter a lista de computadores salvos (para reinstalar depois)' 86 $State.KeepList
            Add-Text 'Se o acesso remoto for removido, o Windows vai pedir permissão de administrador.' 124 40 -Small | Out-Null
            $btnNext.Text = 'Desinstalar'
        }
        'progress' {
            $verb = $(if ($Mode -eq 'uninstall') { 'Desinstalando' } elseif ($State.Updating) { 'Atualizando' } else { 'Instalando' })
            Clear-Page "$verb..." 'Aguarde'
            $label = Add-Text '' 30 22
            $bar = New-Object Windows.Forms.ProgressBar
            $bar.SetBounds((S 28), (S 60), (S 544), (S 22)); $bar.Style = 'Continuous'
            $content.Controls.Add($bar)
            $btnNext.Enabled = $false; $btnCancel.Enabled = $false
            $form.Refresh()
            $report = { param($text, $pct) $label.Text = $text; $bar.Value = [Math]::Min(100, $pct); [Windows.Forms.Application]::DoEvents() }
            try {
                if ($Mode -eq 'uninstall') { $script:Notes = @(Invoke-Uninstall $report) } else { Invoke-Install $report }
                $script:Finished = $true
                Set-Result 'ok'
                $script:Index++; Show-Page
            } catch {
                Set-Result 'erro'
                Clear-Page 'Não foi possível concluir' 'Nada foi perdido. Corrija o problema e tente de novo.'
                Add-Text $_.Exception.Message 20 160 | Out-Null
                $btnBack.Visible = $false; $btnCancel.Visible = $false
                $btnNext.Enabled = $true; $btnNext.Text = 'Fechar'
                $script:Index = $Pages.Count  # "Fechar" sai
            }
        }
        'done' {
            $btnCancel.Visible = $false
            $btnNext.Text = 'Concluir'
            if ($Mode -eq 'uninstall') {
                Clear-Page 'Desinstalação concluída' "O $AppName foi removido deste computador."
                Add-Text 'Pronto. Você pode fechar este assistente.' 20 22 | Out-Null
                $y = 56; foreach ($n in $script:Notes) { Add-Text $n $y 40 | Out-Null; $y += 44 }
            } else {
                Clear-Page $(if ($State.Updating) { 'Atualização concluída' } else { 'Instalação concluída' }) "Versão $Version"
                Add-Text "O $AppName está pronto para usar." 20 22 | Out-Null
                if ($State.Desktop) { Add-Text 'Use o atalho "VNC Viewer 3D" na Área de Trabalho para abrir.' 50 22 | Out-Null }
                elseif ($State.StartMenu) { Add-Text 'Abra pelo Menu Iniciar: "VNC Viewer 3D".' 50 22 | Out-Null }
                Add-Text 'Para desinstalar: Configurações > Aplicativos > Aplicativos instalados > VNC Viewer 3D.' 90 40 -Small | Out-Null
            }
        }
    }
}

# Guarda as escolhas da página atual; retorna $false para não avançar.
function Save-Page {
    switch ($Pages[$script:Index]) {
        'folder' {
            $dir = $script:Controls.Folder.Text.Trim()
            if (-not $dir -or -not [IO.Path]::IsPathRooted($dir)) {
                [void][Windows.Forms.MessageBox]::Show($form, 'Escolha uma pasta válida.', $AppName, 'OK', 'Warning'); return $false
            }
            $State.Dir = $dir
        }
        'options' {
            $State.Desktop = $script:Controls.Desktop.Checked
            $State.StartMenu = $script:Controls.StartMenu.Checked
            $State.Launch = $script:Controls.Launch.Checked
        }
        'confirm' {
            $State.RemoveServer = $script:Controls.RemoveServer.Checked
            $State.KeepList = $script:Controls.KeepList.Checked
        }
    }
    $true
}

$btnNext.Add_Click({
    if ($script:Index -ge $Pages.Count) { $form.Close(); return }  # tela de erro
    $page = $Pages[$script:Index]
    if ($page -eq 'done') {
        if ($Mode -eq 'install' -and $State.Launch) {
            Start-Process -FilePath (Join-Path $State.Dir $ExeName) -WorkingDirectory $State.Dir
        }
        $form.Close(); return
    }
    if (-not (Save-Page)) { return }
    $script:Index++
    Show-Page
})
$btnBack.Add_Click({ if ($script:Index -gt 0) { [void](Save-Page); $script:Index--; Show-Page } })
$btnCancel.Add_Click({ $form.Close() })
$form.Add_FormClosing({
    param($sender, $e)
    if ($script:Finished -or $script:Index -ge $Pages.Count) { return }
    if ($Pages[$script:Index] -eq 'progress') { $e.Cancel = $true; return }
    $msg = $(if ($Mode -eq 'uninstall') { 'Cancelar a desinstalação?' } else { 'Cancelar a instalação?' })
    if ([Windows.Forms.MessageBox]::Show($form, $msg, $AppName, 'YesNo', 'Question') -ne 'Yes') { $e.Cancel = $true }
    else { Set-Result 'cancelado' }
})

Show-Page
[void]$form.ShowDialog()
