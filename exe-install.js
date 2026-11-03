// Só no .exe. Decide o que fazer ao abrir:
//  - é a cópia instalada            -> abre o programa;
//  - "--desinstalar"                -> assistente de desinstalação;
//  - é um .exe baixado (novo/outro) -> assistente de instalação/atualização.
// O assistente (installer/assistente.ps1) usa as telas do próprio Windows.
// Se ele não puder abrir (ex.: política do PowerShell), cai na instalação
// silenciosa antiga, na pasta padrão.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');
const resources = require('./resources');

const NAME = 'VNC Viewer 3D';
const DEFAULT_DIR = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Local'), 'Programs', NAME);
const REG_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VNCViewer3D';

const ps = (script) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const samePath = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function version() {
  try { return JSON.parse(resources.read('package.json')).version || ''; } catch { return ''; }
}

function message(text) {
  try {
    ps(`Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${q(text)}, ${q(NAME)}) | Out-Null`);
  } catch {}
}

// Onde está instalado (registro do Windows). Instalações antigas (até 1.3.0)
// não registravam: estão na pasta padrão.
function installedInfo() {
  try {
    const out = ps('[Console]::OutputEncoding = [Text.Encoding]::UTF8; '
      + `$r = Get-ItemProperty -Path ${q(REG_KEY)} -ErrorAction SilentlyContinue; `
      + 'if ($r) { ConvertTo-Json -Compress @{ dir = [string]$r.InstallLocation; version = [string]$r.DisplayVersion } }')
      .toString().trim();
    if (out) {
      const info = JSON.parse(out);
      if (info.dir) return info;
    }
  } catch {}
  if (fs.existsSync(path.join(DEFAULT_DIR, `${NAME}.exe`))) return { dir: DEFAULT_DIR, version: '' };
  return null;
}

// Extrai o assistente e as imagens para uma pasta temporária.
function extractWizard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vnc3d-instalador-'));
  // BOM: o PowerShell 5.1 só lê acentos de .ps1 em UTF-8 com BOM.
  const script = resources.read('installer/assistente.ps1').toString('utf8').replace(/^﻿/, '');
  fs.writeFileSync(path.join(dir, 'assistente.ps1'), `﻿${script}`, 'utf8');
  fs.writeFileSync(path.join(dir, 'icon.ico'), resources.read('public/icon.ico'));
  fs.writeFileSync(path.join(dir, 'logo.png'), resources.read('public/logo.png'));
  return dir;
}

function wizardArgs(dir, params) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden',
    '-File', path.join(dir, 'assistente.ps1'), '-Assets', dir];
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') args.push(`-${k}`, String(v));
  return args;
}

// ---------- instalação silenciosa (plano B) ----------
function quitRunning() {
  const port = Number(process.env.PORT) || 6080;
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/api/quit', method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${port}` }, timeout: 2000,
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.end('{}');
  });
}

async function silentInstall() {
  const exe = path.join(DEFAULT_DIR, `${NAME}.exe`);
  const icon = path.join(DEFAULT_DIR, 'icon.ico');
  fs.mkdirSync(DEFAULT_DIR, { recursive: true });
  for (let i = 0; ; i++) {
    try { fs.copyFileSync(process.execPath, exe); break; } catch (e) {
      if ((e.code !== 'EBUSY' && e.code !== 'EPERM') || i >= 10) throw e;
      if (i === 0) await quitRunning();
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  fs.writeFileSync(icon, resources.read('public/icon.ico'));
  const folders = ps("[Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('Programs')")
    .toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const lines = ['$sh = New-Object -ComObject WScript.Shell'];
  for (const f of folders) {
    lines.push(`$l = $sh.CreateShortcut(${q(path.join(f, `${NAME}.lnk`))})`, `$l.TargetPath = ${q(exe)}`,
      `$l.WorkingDirectory = ${q(DEFAULT_DIR)}`, `$l.IconLocation = ${q(`${icon},0`)}`,
      "$l.Description = 'Acesso remoto - 3D Ar Condicionado'", '$l.Save()');
  }
  ps(lines.join('; '));
  spawn(exe, [], { detached: true, stdio: 'ignore', cwd: DEFAULT_DIR }).unref();
}

// ---------- decisão ----------
// Retorna true se este processo deve continuar e iniciar o servidor.
async function ensureInstalled() {
  const here = path.dirname(process.execPath);
  const info = installedInfo();

  if (process.argv.includes('--desinstalar')) {
    const dir = extractWizard();
    // O assistente precisa continuar rodando depois que este .exe fechar (para
    // poder apagá-lo). Filhos normais do Node são encerrados junto com ele, e
    // "detached" abre o PowerShell sem console (ele fecha na hora). Por isso o
    // PowerShell é aberto pelo wscript, que roda solto e esconde a janela.
    const args = wizardArgs(dir, {
      Mode: 'uninstall', CurrentDir: info?.dir || here, Version: version(), WaitPid: process.pid,
    });
    const cmdline = ['powershell', ...args].map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ');
    const vbs = path.join(dir, 'abrir.vbs');
    // UTF-16 com BOM: o wscript lê assim caminhos com acento.
    fs.writeFileSync(vbs, `﻿CreateObject("WScript.Shell").Run "${cmdline.replace(/"/g, '""')}", 0, False\r\n`, 'utf16le');
    spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore' }).unref();
    await new Promise((r) => setTimeout(r, 1500));
    return false;
  }

  if (info && samePath(here, info.dir)) return true;

  const dir = extractWizard();
  const code = await new Promise((resolve) => {
    const p = spawn('powershell', wizardArgs(dir, {
      Mode: 'install', Source: process.execPath, Version: version(),
      CurrentDir: info?.dir, CurrentVersion: info?.version,
    }), { stdio: 'ignore', windowsHide: true });
    p.on('exit', resolve);
    p.on('error', () => resolve(-1));
  });
  const result = (() => { try { return fs.readFileSync(path.join(dir, 'resultado.txt'), 'utf8').trim(); } catch { return ''; } })();
  fs.rm(dir, { recursive: true, force: true }, () => {});

  // Assistente não abriu (nem chegou a gravar o resultado): instala do jeito simples.
  if (!result && code !== 0) {
    try {
      await silentInstall();
    } catch (e) {
      message(`Não foi possível instalar: ${e.message}`);
    }
  }
  return false;
}

module.exports = { ensureInstalled };
