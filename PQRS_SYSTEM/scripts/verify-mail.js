const { mail } = require('../src/config');
const { createMailTransport } = require('../src/services/notificationService');

async function verify() {
  const transport = createMailTransport(mail);
  try {
    await transport.verify();
    console.log('Conexión y autenticación con Gmail verificadas. No se envió ningún correo.');
  } finally {
    transport.close();
  }
}

verify().catch(error => {
  console.error('No se pudo verificar Gmail:', error.code || error.message);
  process.exitCode = 1;
});
