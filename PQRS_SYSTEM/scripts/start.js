const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PID_FILE = path.join(__dirname, '..', 'server.pid');
const SCRIPT = path.join(__dirname, '..', 'src', 'server.js');

function startDetached() {
  const node = process.execPath;
  const child = spawn(node, [SCRIPT], {
    detached: true,
    stdio: 'ignore'
  });

  // Allow the parent to exit while the child keeps running
  child.unref();

  try {
    fs.writeFileSync(PID_FILE, String(child.pid), { encoding: 'utf8' });
    console.log(`Servidor iniciado en segundo plano (PID ${child.pid})`);
  } catch (err) {
    console.error('No se pudo escribir server.pid:', err.message);
    process.exit(1);
  }
}

startDetached();
