const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PID_FILE = path.join(__dirname, '..', 'server.pid');

function readPid() {
  if (!fs.existsSync(PID_FILE)) {
    console.error('No existe server.pid. ¿Está la aplicación en ejecución?');
    process.exit(1);
  }
  const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
  const pid = parseInt(raw, 10);
  if (!pid) {
    console.error('PID inválido en server.pid:', raw);
    process.exit(1);
  }
  return pid;
}

function removePidFile() {
  try { fs.unlinkSync(PID_FILE); } catch (err) {}
}

function stopPid(pid) {
  try {
    // Intentar señalizar al proceso (funciona en Windows y Unix)
    process.kill(pid, 'SIGTERM');
    console.log(`Enviada señal SIGTERM al PID ${pid}`);
  } catch (err) {
    console.warn('No se pudo enviar SIGTERM, intentando taskkill (Windows):', err.message);
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'inherit' });
      console.log(`Proceso ${pid} terminado con taskkill`);
    } catch (err2) {
      console.error('No se pudo terminar el proceso:', err2.message);
      process.exit(1);
    }
  }
}

function main() {
  const pid = readPid();
  stopPid(pid);
  // esperar un momento para que el proceso cierre
  setTimeout(() => {
    removePidFile();
    console.log('server.pid eliminado');
    process.exit(0);
  }, 500);
}

main();
