// Ponto de entrada do .exe (ver tools/build-exe.js).
const resources = require('./resources');

if (resources.IS_EXE) {
  require('./exe-install').ensureInstalled().then((run) => {
    if (run) require('./server');
    else process.exit(0);
  });
} else {
  require('./server');
}
