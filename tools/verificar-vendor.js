// SBOM (lista de componentes de terceiros) e verificação de integridade.
//   node tools/verificar-vendor.js           confere todos os arquivos contra vendor/SBOM.json
//   node tools/verificar-vendor.js --gerar   recria o SBOM (só depois de atualizar um componente
//                                            de propósito e conferir a origem dele)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SBOM = path.join(ROOT, 'vendor', 'SBOM.json');

const COMPONENTS = [
  { name: 'TightVNC Server', version: '2.8.89', license: 'GPL-2.0', dir: 'vendor/tightvnc',
    source: 'https://www.tightvnc.com/download/2.8.89/tightvnc-2.8.89-gpl-setup-64bit.msi' },
  { name: 'noVNC', version: '1.7.0', license: 'MPL-2.0', dir: 'vendor/novnc',
    source: 'https://registry.npmjs.org/@novnc/novnc/-/novnc-1.7.0.tgz' },
  { name: 'ws', version: '8.22.1', license: 'MIT', dir: 'vendor/ws',
    source: 'https://registry.npmjs.org/ws/-/ws-8.22.1.tgz' },
  { name: 'Barlow / Inter (fontes)', version: '@fontsource 5.3.0', license: 'OFL-1.1', dir: 'public/fonts',
    source: 'https://registry.npmjs.org/@fontsource/barlow e @fontsource/inter' },
];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  }).filter((p) => p !== SBOM);
}

function scan(dir) {
  return Object.fromEntries(walk(path.join(ROOT, dir)).map((f) => [rel(f), sha256(f)]).sort());
}

function generate() {
  const sbom = {
    formato: 'Lista de componentes de terceiros (SBOM simplificado)',
    componentes: COMPONENTS.map(({ dir, ...c }) => ({ ...c, pasta: dir, arquivos: scan(dir) })),
  };
  fs.writeFileSync(SBOM, `${JSON.stringify(sbom, null, 2)}\n`);
  const total = sbom.componentes.reduce((n, c) => n + Object.keys(c.arquivos).length, 0);
  console.log(`SBOM gerado: ${rel(SBOM)} (${total} arquivos)`);
}

// Retorna a lista de problemas (vazia se tudo confere).
function verify() {
  const sbom = JSON.parse(fs.readFileSync(SBOM, 'utf8'));
  const problems = [];
  for (const c of sbom.componentes) {
    const now = scan(c.pasta);
    for (const [f, h] of Object.entries(c.arquivos)) {
      if (!now[f]) problems.push(`faltando: ${f}`);
      else if (now[f] !== h) problems.push(`ALTERADO: ${f}`);
    }
    for (const f of Object.keys(now)) if (!c.arquivos[f]) problems.push(`arquivo novo não listado: ${f}`);
  }
  return problems;
}

if (require.main === module) {
  if (process.argv.includes('--gerar')) {
    generate();
  } else {
    const problems = verify();
    if (problems.length) {
      console.error(`Integridade FALHOU (${problems.length}):\n  ${problems.join('\n  ')}`);
      process.exit(1);
    }
    console.log('Integridade OK: todos os arquivos de terceiros conferem com vendor/SBOM.json');
  }
}

module.exports = { verify };
