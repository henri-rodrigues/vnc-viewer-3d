import RFB from '/novnc/rfb.js';

const $ = (id) => document.getElementById(id);
const STORE = 'vnc-viewer.saved';
const STORE_SPEED = 'vnc-viewer.speed';

// Qualidade JPEG (0-9) e compressão (0-9) pedidas ao servidor de acesso remoto.
const SPEEDS = {
  rapida: { quality: 2, compression: 7 },
  equilibrada: { quality: 5, compression: 4 },
  qualidade: { quality: 8, compression: 2 },
};

// O servidor às vezes envia um cursor totalmente transparente (o mouse "some").
// Nesse caso o noVNC mostra RFB.cursors.dot; trocamos o ponto por uma seta normal.
const ARROW = [
  'X...........',
  'XX..........',
  'XOX.........',
  'XOOX........',
  'XOOOX.......',
  'XOOOOX......',
  'XOOOOOX.....',
  'XOOOOOOX....',
  'XOOOOOOOX...',
  'XOOOOOOOOX..',
  'XOOOOOOOOOX.',
  'XOOOOOOXXXXX',
  'XOOOXOOX....',
  'XOOXXOOX....',
  'XOX..XOOX...',
  'XX...XOOX...',
  'X.....XOOX..',
  '......XOOX..',
  '.......XX...',
];
RFB.cursors.dot = {
  rgbaPixels: new Uint8Array(ARROW.flatMap((row) => [...row].flatMap((c) =>
    c === 'X' ? [0, 0, 0, 255] : c === 'O' ? [255, 255, 255, 255] : [0, 0, 0, 0]))),
  w: 12, h: 19, hotx: 0, hoty: 0,
};

let rfb = null;

// ---------- computadores salvos (conexoes.csv; senha nunca é salva) ----------
let editing = null; // {host, port} do item sendo editado

async function api(method, body) {
  const res = await fetch('/api/conexoes', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.existing = data.existing;
    throw err;
  }
  return res.json();
}

function setEditing(c) {
  editing = c ? { host: c.host, port: c.port } : null;
  $('formTitle').textContent = c ? `Editando: ${c.name}` : 'Nova conexão';
  $('cancelEdit').hidden = !c;
  $('save').textContent = c ? 'Salvar alterações' : 'Salvar';
}

// Preenche o formulário. Só entra em modo de edição se pedido (botão ✎):
// clicar no nome ou em ▶ é para conectar, e salvar depois disso cria um
// computador novo em vez de substituir este.
function fill(c, { edit = false } = {}) {
  $('name').value = c.name || '';
  $('group').value = c.group || '';
  $('host').value = c.host;
  $('port').value = c.port;
  setEditing(edit ? c : null);
  renderList(lastList);
  (edit ? $('name') : $('password')).focus();
}

function clearForm() {
  $('form').reset();
  $('port').value = 5900;
  setEditing(null);
  renderList(lastList);
}

function button(cls, title, text, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.title = title;
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

function item(c) {
  const li = document.createElement('li');
  const go = button('go', 'Preencher o formulário para conectar', c.name || c.host, () => fill(c));
  if (editing && editing.host === c.host && editing.port === c.port) go.classList.add('editing');
  const sub = document.createElement('small');
  sub.textContent = `${c.host}:${c.port}`;
  go.append(sub);
  const run = button('run', 'Conectar', '▶', () => {
    fill(c);
    connect(c.host, c.port, $('password').value);
  });
  const edit = button('run', 'Editar', '✎', () => fill(c, { edit: true }));
  const del = button('del', 'Excluir', '✕', async () => {
    if (!confirm(`Excluir "${c.name}" (${c.host}:${c.port})?`)) return;
    try {
      const list = await api('DELETE', { host: c.host, port: c.port });
      if (editing && editing.host === c.host && editing.port === c.port) clearForm();
      renderList(list);
    } catch (e) { alert(`Não foi possível excluir: ${e.message}`); }
  });
  li.append(go, run, edit, del);
  return li;
}

function empty(text) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

let lastList = [];
function renderList(list) {
  lastList = list;
  const box = $('company');
  box.replaceChildren();
  $('groups').replaceChildren(...[...new Set(list.map((c) => c.group))].map((g) => new Option(g)));
  if (!list.length) return box.append(empty('Nenhum computador salvo. Preencha o formulário e clique em Salvar.'));
  const groups = Map.groupBy(list, (c) => c.group);
  for (const [group, items] of groups) {
    if (groups.size > 1) {
      const h = document.createElement('h3');
      h.textContent = group;
      box.append(h);
    }
    const ul = document.createElement('ul');
    ul.className = 'list';
    items.forEach((c) => ul.append(item(c)));
    box.append(ul);
  }
}

async function loadList() {
  try { renderList(await api('GET')); } catch { renderList([]); }
}

// Versões anteriores salvavam no navegador: move para o CSV uma única vez.
async function migrateLocal() {
  let old = [];
  try { old = JSON.parse(localStorage.getItem(STORE)) || []; } catch {}
  for (const c of old) {
    try { await api('POST', { item: { ...c, group: 'Geral' } }); } catch {}
  }
  try { localStorage.removeItem(STORE); } catch {}
}

$('save').onclick = async () => {
  if (!$('host').reportValidity() || !$('port').reportValidity()) return;
  const item = {
    name: $('name').value.trim(),
    host: $('host').value.trim(),
    port: Number($('port').value),
    group: $('group').value.trim(),
  };
  const save = (replace) => api('POST', { item, original: editing, replace });
  try {
    let list;
    try {
      list = await save(false);
    } catch (e) {
      // Já existe outro computador com o mesmo IP e porta: só substitui se o usuário confirmar.
      if (e.status !== 409) throw e;
      const ex = e.existing || {};
      if (!confirm(`Já existe "${ex.name}" salvo com ${item.host}:${item.port}.\n\nSubstituir pelos dados novos?`)) return;
      list = await save(true);
    }
    setEditing(null);
    renderList(list);
  } catch (e) { alert(`Não foi possível salvar: ${e.message}`); }
};
$('cancelEdit').onclick = clearForm;
$('reload').onclick = loadList;

// ---------- conexão ----------
function setStatus(text, state = '') {
  $('status').textContent = text;
  $('status').className = state;
}

function disconnect() {
  if (rfb) rfb.disconnect();
}

// Janela de senha na própria página (prompt() é bloqueado em alguns navegadores).
function askPassword(target) {
  const dlg = $('pwDialog');
  $('pwTarget').textContent = target;
  $('pwInput').value = '';
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? $('pwInput').value : null);
  });
}

function connect(host, port, password) {
  disconnect();
  $('toolbar').hidden = false;
  setStatus(`Conectando a ${host}:${port}…`);

  const url = `ws://${location.host}/websockify?host=${encodeURIComponent(host)}&port=${port}`;
  // Cada conexão usa sua própria instância: eventos de uma conexão antiga
  // (que ainda está fechando) não podem mexer na nova.
  const r = new RFB($('screen'), url, { credentials: password ? { password } : undefined });
  rfb = r;
  r.scaleViewport = $('scale').checked;
  r.clipViewport = !$('scale').checked;
  r.viewOnly = $('viewonly').checked;
  r.focusOnClick = true;
  r.showDotCursor = true;
  applySpeed();

  r.addEventListener('connect', () => {
    if (rfb !== r) return;
    setStatus(`Conectado: ${$('name').value.trim() || host}`, 'on');
    r.focus();
  });
  r.addEventListener('disconnect', (e) => {
    if (rfb !== r) return;
    if (e.detail.clean) setStatus('Desconectado');
    else setStatus('Conexão perdida ou recusada', 'err');
    rfb = null;
  });
  r.addEventListener('credentialsrequired', async () => {
    const pw = await askPassword(`${host}:${port}`);
    if (rfb !== r) return;
    if (pw === null) return r.disconnect();
    r.sendCredentials({ password: pw });
  });
  r.addEventListener('securityfailure', (e) => {
    if (rfb !== r) return;
    setStatus(`Falha de autenticação: ${e.detail.reason || 'senha incorreta'}`, 'err');
  });
  // Remoto -> local
  // Só se o usuário permitir: senão o PC remoto poderia colocar qualquer texto
  // (ex.: um comando malicioso) na área de transferência deste PC.
  r.addEventListener('clipboard', (e) => {
    if (!$('recvclip').checked) return;
    navigator.clipboard?.writeText(e.detail.text).catch(() => {});
  });
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  connect($('host').value.trim(), Number($('port').value), $('password').value);
});

// ---------- barra de ferramentas ----------
$('disconnect').onclick = disconnect;
$('scale').onchange = (e) => {
  if (!rfb) return;
  rfb.scaleViewport = e.target.checked;
  rfb.clipViewport = !e.target.checked;
};
$('viewonly').onchange = (e) => { if (rfb) rfb.viewOnly = e.target.checked; };

function applySpeed() {
  const s = SPEEDS[$('speed').value] || SPEEDS.equilibrada;
  if (!rfb) return;
  rfb.qualityLevel = s.quality;
  rfb.compressionLevel = s.compression;
}
try { $('speed').value = localStorage.getItem(STORE_SPEED) || 'equilibrada'; } catch {}
$('speed').onchange = (e) => {
  try { localStorage.setItem(STORE_SPEED, e.target.value); } catch {}
  applySpeed();
};
$('cad').onclick = () => rfb?.sendCtrlAltDel();
$('clip').onclick = async () => {
  if (!rfb) return;
  try { rfb.clipboardPasteFrom(await navigator.clipboard.readText()); } catch {
    setStatus('Sem permissão para ler a área de transferência', 'err');
  }
};
$('fullscreen').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('screen').requestFullscreen();
};

// ---------- este computador (acesso remoto local) ----------
let host = null;

async function hostApi(action, body) {
  const res = await fetch(`/api/host${action ? `/${action}` : ''}`, {
    method: action ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: action ? JSON.stringify(body || {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function renderHost(s, msg = '') {
  host = s;
  const state = $('hostState');
  if (s.busy) {
    state.textContent = `Aguarde: ${s.busy}…`;
    state.className = 'state';
  } else if (!s.installed) {
    state.textContent = 'Acesso remoto não instalado';
    state.className = 'state';
  } else if (s.running) {
    state.textContent = 'Ligado: outras pessoas podem acessar';
    state.className = 'state on';
  } else {
    state.textContent = 'Desligado: ninguém consegue acessar';
    state.className = 'state off';
  }
  $('hostInstall').hidden = s.installed || !!s.busy;
  $('hostControls').hidden = !s.installed || !!s.busy;
  $('hostToggle').textContent = s.running ? 'Desligar acesso' : 'Ligar acesso';
  $('hostToggle').className = s.running ? 'grow' : 'primary grow';
  $('hostInfo').hidden = !s.running;
  $('hostIps').replaceChildren(...s.ips.map(({ ip, adapter, network, category }) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'Copiar';
    b.textContent = ip;
    const small = document.createElement('small');
    small.textContent = `porta ${s.port}`;
    const net = document.createElement('small');
    net.className = 'net';
    const where = network || adapter;
    net.textContent = category === 'Public' ? `${where}: rede Pública (bloqueada)` : where;
    if (category === 'Public') b.classList.add('public');
    b.append(small, net);
    b.onclick = () => navigator.clipboard?.writeText(ip).then(() => hostMsg(`${ip} copiado.`));
    li.append(b);
    return li;
  }));
  // Acesso ligado, mas a rede está como Pública: o firewall bloqueia os colegas.
  const blocked = s.ips.filter((i) => i.category === 'Public');
  const reachable = s.ips.some((i) => i.category === 'Private' || i.category === 'DomainAuthenticated');
  if (s.running && !s.busy && blocked.length && !reachable) {
    state.textContent = 'Ligado, mas bloqueado: rede Pública';
    state.className = 'state off';
  }
  $('hostWarn').hidden = !(s.installed && !s.busy && blocked.length);
  $('hostWarnNet').textContent = blocked.map((i) => `"${i.network || i.adapter}"`).join(' e ');
  hostMsg(msg);
}

function hostMsg(text) { $('hostMsg').textContent = text; }

async function refreshHost() {
  try { renderHost(await hostApi()); } catch { hostMsg('Não foi possível verificar este computador.'); }
}

async function hostAction(action, body, waiting) {
  hostMsg(waiting);
  $('hostState').textContent = 'Aguarde…';
  $('hostInstall').hidden = $('hostControls').hidden = true;
  try {
    const s = await hostApi(action, body);
    renderHost(s.installed === undefined ? await hostApi() : s);
  } catch (e) {
    await refreshHost();
    hostMsg(e.message);
  }
}

$('hostInstall').addEventListener('submit', (e) => {
  e.preventDefault();
  const password = $('hostPassword').value;
  const adminPassword = $('hostAdminPassword').value;
  if (password === adminPassword) {
    hostMsg('A senha de administração precisa ser diferente da senha de acesso.');
    return;
  }
  $('hostPassword').value = $('hostAdminPassword').value = '';
  hostAction('install', { password, adminPassword },
    'Ativando o acesso remoto… Confirme a janela de permissão do Windows. Pode levar alguns minutos.');
});
$('hostToggle').onclick = () => {
  const on = !host?.running;
  hostAction(on ? 'start' : 'stop', null, 'Confirme a janela de permissão do Windows…');
};
$('hostConfig').onclick = () => hostAction('config', null, 'Abrindo configurações avançadas…');
$('hostRefresh').onclick = refreshHost;
$('hostNetwork').onclick = () => hostApi('network').catch(() => {});

migrateLocal().then(loadList);
refreshHost();
setInterval(() => { if (!document.hidden) refreshHost(); }, 15000);
