// Gera dist/VNC Viewer 3D.exe: um único executável com o Node.js e todo o
// programa dentro (Node "Single Executable Application"). Não usa nenhuma
// ferramenta externa: só o Node.js instalado e a API do Windows.
// Uso: node tools/build-exe.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
// Sem espaços: é o nome que vai para o Release do GitHub. Ao instalar, o .exe
// se copia como "VNC Viewer 3D.exe" (ver exe-install.js).
const EXE = path.join(DIST, 'VNC-Viewer-3D.exe');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// ---------- 1. junta os módulos JS num arquivo só ----------
// No executável, require() só carrega módulos nativos do Node; os nossos vão
// embutidos aqui, cada um com seu próprio require() para caminhos relativos.
const modules = [
  'main.js', 'server.js', 'host.js', 'resources.js', 'exe-install.js',
  'vendor/ws/index.js', ...walk(path.join(ROOT, 'vendor/ws/lib')).map(rel),
];

function bundle() {
  const parts = modules.map((m) => {
    const code = fs.readFileSync(path.join(ROOT, m), 'utf8');
    return `${JSON.stringify(m)}: function (module, exports, require, __filename, __dirname) {\n${code}\n},`;
  });
  return `'use strict';
const __path = require('path');
const __nativeRequire = require;
const __defs = {
${parts.join('\n')}
};
const __cache = {};
function __resolve(from, req) {
  const base = __path.posix.normalize(__path.posix.join(__path.posix.dirname(from), req));
  return [base, base + '.js', base + '/index.js'].find((p) => p in __defs);
}
function __load(id) {
  if (__cache[id]) return __cache[id].exports;
  const module = { exports: {} };
  __cache[id] = module;
  const req = (r) => {
    if (r.startsWith('.')) {
      const found = __resolve(id, r);
      if (!found) throw new Error('Módulo não encontrado: ' + r + ' (em ' + id + ')');
      return __load(found);
    }
    return __nativeRequire(r);
  };
  __defs[id].call(module.exports, module, module.exports, req, id, __path.posix.dirname(id));
  return module.exports;
}
__load('main.js');
`;
}

// ---------- 2. arquivos embutidos (páginas, noVNC, instalador do TightVNC) ----------
function assets() {
  const files = [
    ...walk(path.join(ROOT, 'public')),
    ...walk(path.join(ROOT, 'vendor/novnc/core')),
    ...walk(path.join(ROOT, 'vendor/novnc/vendor')),
    ...walk(path.join(ROOT, 'vendor/tightvnc')),
    ...walk(path.join(ROOT, 'installer')),
    path.join(ROOT, 'package.json'), // versão mostrada no assistente
  ];
  // Nenhuma lista de computadores vai no .exe: cada pessoa cadastra os seus.
  return Object.fromEntries(files.map((f) => [rel(f), f]));
}

// ---------- 3. ajustes no executável ----------
// Remove a assinatura digital do node.exe (fica inválida ao alterar o arquivo).
function stripSignature(buf) {
  const pe = buf.readUInt32LE(0x3c);
  const opt = pe + 24;
  const dirs = opt + (buf.readUInt16LE(opt) === 0x20b ? 112 : 96);
  const certOff = buf.readUInt32LE(dirs + 4 * 8);
  const certSize = buf.readUInt32LE(dirs + 4 * 8 + 4);
  if (!certOff) return buf;
  buf.writeUInt32LE(0, dirs + 4 * 8);
  buf.writeUInt32LE(0, dirs + 4 * 8 + 4);
  return certOff + certSize >= buf.length - 8 ? buf.subarray(0, certOff) : buf;
}

// Programa de janela (sem console preto) em vez de programa de console.
function setGuiSubsystem(buf) {
  const pe = buf.readUInt32LE(0x3c);
  buf.writeUInt16LE(2, pe + 24 + 68);
}

// Liga o "fusível" que faz o Node rodar o programa embutido.
function flipFuse(buf) {
  const fuse = Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0');
  const i = buf.indexOf(fuse);
  if (i < 0) throw new Error('Fusível do Node SEA não encontrado neste node.exe');
  buf[i + fuse.length - 1] = '1'.charCodeAt(0);
}

// ---------- execução ----------
// Não gera o .exe se algum arquivo de terceiros foi alterado.
const problems = require('./verificar-vendor').verify();
if (problems.length) {
  console.error(`Build cancelado: arquivos de terceiros não conferem com vendor/SBOM.json\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const bundleFile = path.join(DIST, 'bundle.js');
fs.writeFileSync(bundleFile, bundle());

const blobFile = path.join(DIST, 'sea-prep.blob');
const configFile = path.join(DIST, 'sea-config.json');
fs.writeFileSync(configFile, JSON.stringify({
  main: bundleFile,
  output: blobFile,
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  useSnapshot: false,
  assets: assets(),
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', configFile], { stdio: 'inherit' });

const exe = stripSignature(fs.readFileSync(process.execPath));
fs.writeFileSync(EXE, exe);
execFileSync('powershell', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'pe-resources.ps1'),
  '-Exe', EXE, '-BlobName', 'NODE_SEA_BLOB', '-BlobFile', blobFile,
  '-IconFile', path.join(ROOT, 'public', 'icon.ico'),
], { stdio: 'inherit' });

const out = fs.readFileSync(EXE);
flipFuse(out);
setGuiSubsystem(out);
fs.writeFileSync(EXE, out);

for (const f of [bundleFile, blobFile, configFile]) fs.rmSync(f);
console.log(`Pronto: ${EXE} (${(out.length / 1024 / 1024).toFixed(1)} MB)`);
