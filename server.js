// Servidor local do VNC Viewer 3D. Sem dependências externas: só Node.js e
// o que está na pasta vendor/ (noVNC e ws).
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { exec } = require('child_process');
const { WebSocketServer } = require('./vendor/ws');
const hostVnc = require('./host');
const resources = require('./resources');

const PORT = Number(process.env.PORT) || 6080;
// Proxy TCP aberto: escutar somente em loopback.
const HOST = process.env.BIND || '127.0.0.1';
const URL_LOCAL = `http://localhost:${PORT}`;
const CSV_FILE = path.join(resources.DATA_DIR, 'conexoes.csv');
// O .exe sempre abre o navegador.
const OPEN = process.argv.includes('--open') || resources.IS_EXE;

function openBrowser() {
  exec(`start "" "${URL_LOCAL}"`, { windowsHide: true });
}

// Lê conexoes.csv (nome;host;porta;grupo). Aceita ';' ou ',' como separador.
function readCsv() {
  let text;
  try { text = fs.readFileSync(CSV_FILE, 'utf8').replace(/^﻿/, ''); } catch { return []; }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const header = lines.shift().split(sep).map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  return lines.map((line) => {
    const v = line.split(sep).map((s) => unescapeCell(s.trim()));
    return {
      name: v[col('nome')] || v[col('host')],
      host: v[col('host')],
      port: Number(v[col('porta')]) || 5900,
      group: (col('grupo') >= 0 && v[col('grupo')]) || 'Geral',
    };
  }).filter((c) => c.host);
}

const clean = (s) => String(s ?? '').replace(/[;\r\n\t]/g, ' ').trim();

// Injeção de fórmula: no Excel, uma célula que começa com = + - @ vira fórmula
// (ex.: =HYPERLINK(...)). Um apóstrofo na frente faz o Excel tratar como texto.
const escapeCell = (s) => (/^[=+\-@]/.test(s) ? `'${s}` : s);
const unescapeCell = (s) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);

function writeCsv(list) {
  const lines = ['nome;host;porta;grupo',
    ...list.map((c) => [c.name, c.host, c.port, c.group].map((v) => escapeCell(clean(v))).join(';'))];
  // BOM para o Excel abrir os acentos corretamente.
  fs.writeFileSync(CSV_FILE, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

const sameKey = (a, b) => a && b && a.host === b.host && Number(a.port) === Number(b.port);

// Só aceita pedidos endereçados a este servidor pelo nome local. Bloqueia DNS
// rebinding: um site atacante.com que passe a resolver para 127.0.0.1 chega
// aqui com "Host: atacante.com".
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const hostAllowed = (host) => LOCAL_HOSTS.has(String(host).toLowerCase());

// Origin de uma página deste próprio servidor. Sem Origin só é aceito onde o
// navegador pode omiti-lo (GET da mesma origem); veja os usos abaixo.
function originAllowed(origin, { required = false } = {}) {
  if (!origin) return !required;
  try {
    return LOCAL_HOSTS.has(new URL(origin).host);
  } catch {
    return false;
  }
}

// Portas que o proxy aceita: VNC (5900-5999).
const VNC_PORTS = { min: 5900, max: 5999 };

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:", // cursor remoto do noVNC usa data:
    "font-src 'self'",
    `connect-src 'self' ws://localhost:${PORT} ws://127.0.0.1:${PORT}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'", // clickjacking
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), payment=()',
};

// ---------- API ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const api = {
  'GET /api/conexoes': () => readCsv(),

  // Cria ou edita. Corpo: { item: {name, host, port, group}, original?: {host, port}, replace?: bool }
  // Sem "original" é sempre um computador novo. Se o IP:porta já pertence a
  // OUTRO computador salvo, responde 409 e só substitui com replace: true.
  'POST /api/conexoes': ({ item, original, replace } = {}) => {
    const host = clean(item?.host);
    const port = Number(item?.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new HttpError(400, 'Host ou porta inválidos');
    }
    const entry = { name: clean(item.name) || host, host, port, group: clean(item.group) || 'Geral' };
    const list = readCsv();
    if (original && !list.some((c) => sameKey(c, original))) {
      throw new HttpError(404, 'O computador que estava sendo editado não existe mais. Recarregue a lista.');
    }
    const clash = list.find((c) => sameKey(c, entry) && !sameKey(c, original));
    if (clash && replace !== true) {
      const err = new HttpError(409, `Já existe "${clash.name}" com ${host}:${port}.`);
      err.existing = clash;
      throw err;
    }
    let pos = list.findIndex((c) => sameKey(c, original || entry));
    const rest = list.filter((c) => !sameKey(c, original) && !sameKey(c, entry));
    if (pos < 0 || pos > rest.length) pos = rest.length;
    rest.splice(pos, 0, entry);
    writeCsv(rest);
    return rest;
  },

  'DELETE /api/conexoes': (body) => {
    const list = readCsv().filter((c) => !sameKey(c, body));
    writeCsv(list);
    return list;
  },

  // "Este computador": TightVNC Server local.
  'GET /api/host': () => hostVnc.status(),
  'POST /api/host/install': (body) => hostVnc.install(body?.password, body?.adminPassword),
  'POST /api/host/start': () => hostVnc.setRunning(true),
  'POST /api/host/stop': () => hostVnc.setRunning(false),
  'POST /api/host/config': () => hostVnc.openConfig(),
  'POST /api/host/network': () => hostVnc.openNetworkSettings(),

  // Usado pelo .exe novo para fechar a versão antiga antes de substituí-la.
  'POST /api/quit': () => { setTimeout(() => process.exit(0), 200); },
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new HttpError(413, 'Corpo muito grande')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve(undefined);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, pathname) {
  const key = `${req.method} ${pathname}`;
  const fn = Object.hasOwn(api, key) ? api[key] : null;
  if (!fn) return sendJson(res, 404, { error: 'Não encontrado' });
  // Leitura: GET da mesma origem pode vir sem Origin; de outra origem, recusa.
  // Alteração: o navegador sempre manda Origin, então ele é obrigatório.
  const write = req.method !== 'GET';
  if (!originAllowed(req.headers.origin, { required: write })) {
    return sendJson(res, 403, { error: 'Origem não permitida' });
  }
  if (write) {
    if (!String(req.headers['content-type']).startsWith('application/json')) {
      return sendJson(res, 415, { error: 'Use application/json' });
    }
  }
  try {
    const body = req.method === 'GET' ? undefined : await readJson(req);
    sendJson(res, 200, (await fn(body)) || { ok: true });
  } catch (e) {
    sendJson(res, e.status || 400, { error: e.message, ...(e.existing ? { existing: e.existing } : {}) });
  }
}

// ---------- arquivos estáticos ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
// URL -> pasta do projeto. O rfb.js do noVNC importa "../vendor/pako/...", por isso /vendor.
const STATIC = [
  ['/novnc/', 'vendor/novnc/core/'],
  ['/vendor/', 'vendor/novnc/vendor/'],
  ['/', 'public/'],
];

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Método não permitido' });
  const [prefix, root] = STATIC.find(([p]) => pathname.startsWith(p));
  let rel;
  try { rel = decodeURIComponent(pathname.slice(prefix.length)); } catch { rel = ''; }
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  // Impede sair da pasta (../ ou \).
  if (rel.split(/[\\/]/).some((p) => p === '..') || rel.includes('\\') || rel.includes(':')) {
    res.writeHead(403).end();
    return;
  }
  const data = resources.read(root + rel);
  if (!data) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

const server = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (!hostAllowed(req.headers.host)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Host não permitido');
    return;
  }
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/api/')) handleApi(req, res, pathname);
  else serveStatic(req, res, pathname);
});

// ---------- proxy WebSocket -> TCP (VNC) ----------
// maxPayload: mensagens do navegador (teclado/mouse) são pequenas.
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

function reject(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  // Só a página deste servidor (Origin obrigatório) e pelo nome local (Host).
  if (url.pathname !== '/websockify' || !hostAllowed(req.headers.host)
      || !originAllowed(req.headers.origin, { required: true })) {
    return reject(socket, 403, 'Forbidden');
  }
  const host = url.searchParams.get('host');
  const port = Number(url.searchParams.get('port'));
  // Só portas VNC: o proxy não pode virar ponte para outros serviços (SMB, RDP…).
  if (!host || !/^[\w.-]{1,253}$/.test(host) || !Number.isInteger(port)
      || port < VNC_PORTS.min || port > VNC_PORTS.max) {
    return reject(socket, 400, 'Bad Request');
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const tcp = net.connect({ host, port });
    tcp.setNoDelay(true);

    tcp.on('connect', () => console.log(`[+] ${host}:${port}`));
    tcp.on('data', (buf) => ws.readyState === ws.OPEN && ws.send(buf));
    tcp.on('close', () => ws.close());
    tcp.on('error', (err) => {
      console.log(`[!] ${host}:${port} ${err.code || err.message}`);
      ws.close(1011, String(err.code || 'tcp error'));
    });

    ws.on('message', (data) => tcp.writable && tcp.write(data));
    ws.on('close', () => tcp.destroy());
    ws.on('error', () => tcp.destroy());
  });
});

server.on('error', (err) => {
  // Já está rodando (atalho clicado de novo): só abre o navegador.
  if (err.code === 'EADDRINUSE') {
    if (OPEN) openBrowser();
    else console.log(`Já existe um servidor em ${URL_LOCAL}`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`VNC Viewer 3D em ${URL_LOCAL}`);
  if (OPEN) openBrowser();
});
