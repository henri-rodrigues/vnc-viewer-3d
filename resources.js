// Acesso aos arquivos do programa. Rodando como .exe (Node SEA) os arquivos
// vêm embutidos no próprio executável; rodando com `node server.js`, do disco.
const fs = require('fs');
const os = require('os');
const path = require('path');

let sea = null;
try {
  const s = require('node:sea');
  if (s.isSea()) sea = s;
} catch {}

const IS_EXE = !!sea;
// Onde ficam os dados graváveis (conexoes.csv).
const DATA_DIR = IS_EXE ? path.dirname(process.execPath) : __dirname;

// Conteúdo de um arquivo do projeto (caminho relativo, com "/"), ou null.
function read(rel) {
  if (IS_EXE) {
    try { return Buffer.from(sea.getAsset(rel)); } catch { return null; }
  }
  const file = path.join(__dirname, rel);
  if (path.relative(__dirname, file).startsWith('..')) return null;
  try { return fs.statSync(file).isFile() ? fs.readFileSync(file) : null; } catch { return null; }
}

// Caminho em disco de um arquivo do projeto. No .exe, extrai para uma pasta temporária.
function file(rel) {
  if (!IS_EXE) return path.join(__dirname, rel);
  const data = read(rel);
  if (!data) return null;
  const out = path.join(os.tmpdir(), 'vnc-viewer-3d', rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, data);
  return out;
}

module.exports = { IS_EXE, DATA_DIR, read, file };
