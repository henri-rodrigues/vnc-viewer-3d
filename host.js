// "Este computador": instala e controla o TightVNC Server local para que outras
// pessoas possam acessar este PC. Ações administrativas pedem confirmação do
// Windows (UAC).
const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');
const resources = require('./resources');

const SERVICE = 'tvnserver';
const VNC_PORT = 5900;
// Instalador oficial incluído no projeto (ver vendor/tightvnc/LEIA-ME.txt).
const MSI_REL = 'vendor/tightvnc/tightvnc-2.8.89-gpl-setup-64bit.msi';
let MSI = null; // caminho em disco, resolvido na hora de instalar
const MSI_SHA256 = 'dff8d7e40a81e0b86ba1d9d5cc0d4f22d08354c50c9cbdc0825bbb6ccfb1073c';
const MSI_SIGNER = 'GlavSoft';
let busy = null; // nome da operação em andamento

function run(file, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

// PowerShell lendo o script pela entrada padrão: o conteúdo (que pode ter
// senha) não aparece na linha de comando do processo.
function runStdin(script, timeout) {
  return new Promise((resolve) => {
    const p = execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'],
      { windowsHide: true, timeout }, (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}${stderr}` });
      });
    p.stdin.end(`${script}\r\n`);
  });
}

// Executa um script PowerShell como administrador e espera terminar.
// O script vai direto na memória (-EncodedCommand), sem arquivo em %TEMP%
// que outro programa da mesma conta pudesse trocar antes da elevação.
async function runElevated(script, timeout) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  // Uma linha só: com "-Command -", blocos de várias linhas não são executados.
  const launcher = "$ErrorActionPreference = 'Stop'; try { "
    + `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'; `
    + 'exit $p.ExitCode } catch { Write-Output "UAC_CANCELADO"; exit 1223 }';
  const r = await runStdin(launcher, timeout);
  if (r.out.includes('UAC_CANCELADO')) r.code = 1223;
  return r;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 1000 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

// IPs das placas com gateway (rede real; ignora adaptadores virtuais como
// VirtualBox e Hyper-V), com o nome e o tipo da rede no Windows:
// Public, Private ou DomainAuthenticated. Em rede Pública o firewall bloqueia
// o acesso (de propósito), então o painel avisa.
let ipCache = { at: 0, ips: [] };
async function lanIps() {
  if (Date.now() - ipCache.at < 10000) return ipCache.ips;
  const r = await run('powershell', ['-NoProfile', '-Command',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; '
    + '$list = @(Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | ForEach-Object { '
    + '$p = Get-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue | Select-Object -First 1; '
    + '[pscustomobject]@{ ip = @($_.IPv4Address)[0].IPAddress; adapter = $_.InterfaceAlias; '
    + 'network = [string]$p.Name; category = [string]$p.NetworkCategory } }); '
    + 'ConvertTo-Json -Compress -InputObject $list']);
  let ips = [];
  try { ips = JSON.parse(r.out.trim() || '[]').filter((i) => /^\d+\.\d+\.\d+\.\d+$/.test(i.ip)); } catch {}
  if (!ips.length) {
    ips = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
      .map((i) => ({ ip: i.address, adapter: '', network: '', category: '' }));
  }
  ipCache = { at: Date.now(), ips };
  return ips;
}

// Abre a tela do Windows onde se troca o perfil da rede (Pública/Privada).
async function openNetworkSettings() {
  await run('powershell', ['-NoProfile', '-Command', "Start-Process 'ms-settings:network-status'"]);
}

function serverExe() {
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter(Boolean)
    .map((p) => path.join(p, 'TightVNC', 'tvnserver.exe'))
    .find((p) => fs.existsSync(p));
}

async function status() {
  const q = await run('sc.exe', ['query', SERVICE]);
  const installed = q.code !== 1060 && /STATE|ESTADO/i.test(q.out);
  // O número do estado não depende do idioma do Windows (4 = RUNNING).
  const state = Number((q.out.match(/:\s*(\d)\s+\w+/) || [])[1]);
  return {
    installed,
    running: installed && state === 4,
    listening: await portOpen(VNC_PORT),
    port: VNC_PORT,
    hostname: os.hostname(),
    ips: await lanIps(),
    busy,
  };
}

async function verifyMsi() {
  MSI = resources.file(MSI_REL);
  if (!MSI || !fs.existsSync(MSI)) throw new Error('Instalador do acesso remoto não encontrado no programa.');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(MSI)).digest('hex');
  if (hash !== MSI_SHA256) throw new Error('O instalador do acesso remoto foi alterado (SHA256 diferente). Instalação recusada.');
  const r = await run('powershell', ['-NoProfile', '-Command',
    `$s = Get-AuthenticodeSignature '${MSI.replace(/'/g, "''")}';"$($s.Status)|$($s.SignerCertificate.Subject)"`]);
  const [st, subject = ''] = r.out.trim().split('|');
  if (st !== 'Valid' || !subject.includes(MSI_SIGNER)) {
    throw new Error('A assinatura digital do instalador do acesso remoto não é válida. Instalação recusada.');
  }
}

const UAC_MSG ='O Windows não autorizou (a janela de permissão foi cancelada).';

async function exclusive(name, fn) {
  if (busy) throw new Error(`Aguarde: ${busy} em andamento.`);
  busy = name;
  try { return await fn(); } finally { busy = null; }
}

// Senha VNC: o protocolo usa no máximo 8 caracteres.
const PASSWORD_RE = /^[A-Za-z0-9!@#$%&*._+=-]{6,8}$/;
const PASSWORD_RULE = 'de 6 a 8 caracteres (letras, números ou ! @ # $ % & * . _ + = -)';

function install(password, adminPassword) {
  if (!PASSWORD_RE.test(password || '')) throw new Error(`A senha de acesso precisa ter ${PASSWORD_RULE}.`);
  if (!PASSWORD_RE.test(adminPassword || '')) throw new Error(`A senha de administração precisa ter ${PASSWORD_RULE}.`);
  if (password === adminPassword) throw new Error('A senha de administração precisa ser diferente da senha de acesso.');
  return exclusive('instalação', async () => {
    const msi = [
      '/quiet', '/norestart', 'ADDLOCAL=Server',
      'SERVER_REGISTER_AS_SERVICE=1', 'SERVER_ADD_FIREWALL_EXCEPTION=1', 'SERVER_ALLOW_SAS=1',
      'SET_USEVNCAUTHENTICATION=1', 'VALUE_OF_USEVNCAUTHENTICATION=1',
      'SET_PASSWORD=1', `VALUE_OF_PASSWORD=${password}`,
      // Protege as configurações do TightVNC com outra senha.
      'SET_USECONTROLAUTHENTICATION=1', 'VALUE_OF_USECONTROLAUTHENTICATION=1',
      'SET_CONTROLPASSWORD=1', `VALUE_OF_CONTROLPASSWORD=${adminPassword}`,
      // Reduz a superfície de ataque: sem servidor HTTP (Java viewer, porta 5800),
      // sem transferência de arquivos e sem parâmetros via URL.
      'SET_ACCEPTHTTPCONNECTIONS=1', 'VALUE_OF_ACCEPTHTTPCONNECTIONS=0',
      'SET_ENABLEFILETRANSFERS=1', 'VALUE_OF_ENABLEFILETRANSFERS=0',
      'SET_ENABLEURLPARAMS=1', 'VALUE_OF_ENABLEURLPARAMS=0',
      'SET_ALLOWLOOPBACK=1', 'VALUE_OF_ALLOWLOOPBACK=0',
      // Desempenho: tira o papel de parede durante o acesso.
      'SET_REMOVEWALLPAPER=1', 'VALUE_OF_REMOVEWALLPAPER=1',
    ].join(' ');
    await verifyMsi();
    const r = await runElevated([
      "$ErrorActionPreference = 'Stop'",
      // Copia o MSI para C:\\Windows\\Temp (só administradores alteram o arquivo)
      // e confere essa cópia: depois da conferência, ninguém consegue trocá-lo.
      `$bytes = [IO.File]::ReadAllBytes('${MSI.replace(/'/g, "''")}')`,
      "$f = Join-Path $env:SystemRoot ('Temp\\vnc3d-' + [guid]::NewGuid() + '.msi')",
      '[IO.File]::WriteAllBytes($f, $bytes)',
      'try {',
      `  if ((Get-FileHash $f -Algorithm SHA256).Hash -ne '${MSI_SHA256}') { exit 2 }`,
      `  $sig = Get-AuthenticodeSignature $f`,
      `  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notlike '*${MSI_SIGNER}*') { exit 3 }`,
      `  $p = Start-Process msiexec.exe -Wait -PassThru -ArgumentList ('/i "' + $f + '" ${msi}')`,
      '  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { exit $p.ExitCode }',
      // Firewall: só redes de Domínio/Privadas e só a sub-rede local (nunca Wi-Fi público).
      '  $rules = @(Get-NetFirewallRule | Where-Object DisplayName -like "*TightVNC*")',
      '  $rules += @(Get-NetFirewallApplicationFilter | Where-Object Program -like "*\\TightVNC\\*" | Get-NetFirewallRule)',
      '  if (-not $rules) { exit 4 }',
      '  try { $rules | Sort-Object Name -Unique | Set-NetFirewallRule -Profile Domain,Private -RemoteAddress LocalSubnet } catch { exit 4 }',
      '  exit 0',
      '} finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }',
    ].join('\r\n'), 5 * 60 * 1000);
    if (r.code === 1223) throw new Error(UAC_MSG);
    if (r.code === 2 || r.code === 3) throw new Error('O instalador do acesso remoto foi alterado. Instalação recusada.');
    const s = await status();
    if (!s.installed) throw new Error(`A ativação do acesso remoto falhou (código ${r.code}).`);
    if (r.code === 4) {
      // Não deixa o serviço ligado com o firewall aberto para qualquer rede.
      if (s.running) await setRunning(false, true);
      throw new Error('O acesso remoto foi instalado, mas não foi possível restringir o firewall à rede local. '
        + 'O acesso ficou desligado; peça ao TI para conferir a regra da porta 5900 no Firewall do Windows.');
    }
    if (!s.running) await setRunning(true, true);
    return status();
  });
}

async function setRunning(on, inner = false) {
  const go = async () => {
    const r = await runElevated(`sc.exe ${on ? 'start' : 'stop'} ${SERVICE}\r\nexit 0`, 60000);
    if (r.code === 1223) throw new Error(UAC_MSG);
    return status();
  };
  return inner ? go() : exclusive(on ? 'ligar' : 'desligar', go);
}

async function openConfig() {
  const exe = serverExe();
  if (!exe) throw new Error('O acesso remoto não está instalado neste PC.');
  const r = await run('powershell', ['-NoProfile', '-Command',
    `try { Start-Process '${exe.replace(/'/g, "''")}' -ArgumentList '-configservice' -Verb RunAs } catch { exit 1223 }`]);
  if (r.code === 1223) throw new Error(UAC_MSG);
}

module.exports = { status, install, setRunning, openConfig, openNetworkSettings, verifyMsi };
