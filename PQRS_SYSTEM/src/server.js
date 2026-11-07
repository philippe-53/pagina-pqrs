const fs = require('fs');
const path = require('path');
const config = require('./config');
const createApp = require('./app');
const pool = require('./db/pool');
const { startNotificationWorker } = require('./services/notificationService');

const PID_FILE = path.join(__dirname, '..', 'server.pid');

async function start() {
  const app = await createApp();
  const stopNotifications = startNotificationWorker(pool, config.mail);

  const server = app.listen(config.port, () => {
    console.log(`${config.appName} ejecutándose en http://localhost:${config.port}`);
  });

  // El PID permite detener solo esta instancia, sin matar otros procesos Node.
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), { encoding: 'utf8' });
  } catch (err) {
    console.warn('No se pudo escribir server.pid:', err.message);
  }

  const removePid = () => {
    try {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch (err) {
      console.error('No se pudo eliminar server.pid:', err.code);
    }
  };
  let closing = false;
  const cleanup = async () => {
    if (closing) return;
    closing = true;
    try {
      await stopNotifications();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await pool.end();
      removePid();
      process.exit(0);
    } catch (err) {
      console.error('No se pudo cerrar la aplicación correctamente:', err.code || 'ERROR');
      process.exit(1);
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', removePid);
}

// Si algo falla al construir la app, se informa y se termina el proceso.
start().catch(error => {
  console.error('No fue posible iniciar la aplicación:', error);
  process.exit(1);
});