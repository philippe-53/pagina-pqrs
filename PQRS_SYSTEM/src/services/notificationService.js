const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const { withTransaction } = require('../utils/transaction');

const mailTemplate = fs.readFileSync(path.join(__dirname, '../../views/mail/confirmation.ejs'), 'utf8');
const mailLogo = fs.readFileSync(path.join(__dirname, '../../public/images/serrania-logo.png'));

async function enqueueNotifications(connection, idPqrs, email) {
  const { mail } = require('../config');
  const recipients = new Set([mail.institutionalRecipient, email].filter(Boolean).map(value => value.trim().toLowerCase()));
  for (const recipient of recipients) {
    await connection.execute(
      'INSERT INTO notificacion_pqrs (id_pqrs, destinatario) VALUES (?, ?)',
      [idPqrs, recipient]
    );
  }
}

function createMailTransport(settings) {
  if (!settings.password) throw new Error('Configure SMTP_PASSWORD con una contraseña de aplicación de Google.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.user)) throw new Error('SMTP_USER debe ser un correo válido.');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000
  });
}

function notificationMessage(job, settings) {
  const institutionalRecipient = settings.institutionalRecipient || require('../config').mail.institutionalRecipient;
  const isCompany = job.destinatario.trim().toLowerCase() === institutionalRecipient.trim().toLowerCase();
  const lookupUrl = new URL(settings.publicUrl || require('../config').mail.publicUrl);
  if (!['http:', 'https:'].includes(lookupUrl.protocol) || lookupUrl.username || lookupUrl.password) {
    throw new Error('APP_PUBLIC_URL debe ser una dirección HTTP o HTTPS sin credenciales.');
  }
  lookupUrl.pathname = isCompany ? '/admin/pqrs' : '/consultar';
  lookupUrl.search = '';
  lookupUrl.hash = '';
  const consultationUrl = lookupUrl.href;
  const websiteUrl = 'https://www.serraniasas.com';
  return {
    from: { name: 'Serranía SAS ESP - PQRS', address: settings.user },
    to: { address: job.destinatario },
    messageId: `<pqrs-${job.ticket}-${job.id_notificacion}@${settings.user.split('@')[1]}>`,
    subject: `${isCompany ? 'Nueva PQRS recibida' : 'PQRS recibida'} - Ticket ${job.ticket}`,
    text: (isCompany ? [
      'Serranía SAS ESP',
      '¡Nueva PQRS recibida!',
      'Estimado(a) colaborador(a):',
      'Le informamos que se ha registrado una nueva PQRS en nuestro sistema, para su atención y gestión oportuna.',
      `Número de ticket: ${job.ticket}`,
      'Por favor, ingrese al sistema para revisar los detalles de la solicitud y realizar el seguimiento correspondiente.',
      `Gestionar PQRS: ${consultationUrl}`,
      'Inicie sesión con una cuenta administrativa y busque el número de ticket indicado.',
      'El ticket es privado. No lo publique ni lo comparta con terceros.',
      'Serranía SAS ESP | Comprometidos con un municipio más limpio.'
    ] : [
      'Serranía SAS ESP',
      '¡Gracias por tu solicitud!',
      'Hemos recibido tu PQRS en Serranía SAS ESP. Tu solicitud ha sido registrada y será atendida en el menor tiempo posible por nuestro equipo.',
      `Número de ticket: ${job.ticket}`,
      `Consultar mi PQRS: ${consultationUrl}`,
      'Para consultar su trayectoria y las respuestas oficiales, selecciona «Consultar ticket» e ingresa el número indicado.',
      'Guarde este número. El ticket es privado; no lo publique ni lo comparta con terceros.',
      'Este mensaje confirma el registro, no la solución de la solicitud.',
      'Serranía SAS ESP | Comprometidos con un municipio más limpio.',
      `www.serraniasas.com: ${websiteUrl}`
    ]).join('\n\n'),
    html: ejs.render(mailTemplate, { ticket: job.ticket, consultationUrl, websiteUrl, isCompany }),
    attachments: [{
      filename: 'serrania-logo.png',
      content: mailLogo,
      contentType: 'image/png',
      cid: 'serrania-logo',
      contentDisposition: 'inline'
    }],
    disableFileAccess: true,
    disableUrlAccess: true
  };
}

async function processNotification(pool, transport, settings, logger = console) {
  const job = await withTransaction(pool, async connection => {
    const [rows] = await connection.query(
      `SELECT n.id_notificacion, n.destinatario, n.intentos, pq.ticket
       FROM notificacion_pqrs n INNER JOIN pqrs pq ON pq.id_pqrs = n.id_pqrs
       WHERE n.estado IN ('pendiente', 'enviando') AND n.proximo_intento <= NOW()
       ORDER BY n.id_notificacion LIMIT 1 FOR UPDATE`
    );
    if (!rows.length) return null;
    const claimed = { ...rows[0], bloqueo: randomUUID() };
    await connection.execute(
      `UPDATE notificacion_pqrs SET estado = 'enviando', bloqueo = ?, intentos = intentos + 1,
       proximo_intento = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id_notificacion = ?`,
      [claimed.bloqueo, claimed.id_notificacion]
    );
    return claimed;
  });
  if (!job) return false;
  try {
    const result = await transport.sendMail(notificationMessage(job, settings));
    if (!result.accepted || result.accepted.length !== 1 ||
        result.accepted[0].toLowerCase() !== job.destinatario.toLowerCase() ||
        (result.rejected && result.rejected.length)) {
      const error = new Error('SMTP no aceptó el destinatario.');
      error.code = 'ERECIPIENT';
      throw error;
    }
  } catch (error) {
    const code = /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'SMTP_ERROR';
    logger.error(`Notificación ${job.id_notificacion} pendiente de reintento (${code}).`);
    const delay = Math.min(3600, 60 * 2 ** Math.min(job.intentos, 6));
    await pool.execute(
      `UPDATE notificacion_pqrs SET estado = 'pendiente', bloqueo = NULL, ultimo_error = ?,
       proximo_intento = TIMESTAMPADD(SECOND, ?, NOW()) WHERE id_notificacion = ? AND bloqueo = ?`,
      [code, delay, job.id_notificacion, job.bloqueo]
    );
    return true;
  }
  await pool.execute(
    `UPDATE notificacion_pqrs SET estado = 'enviada', enviada_en = NOW(), bloqueo = NULL,
     ultimo_error = NULL WHERE id_notificacion = ? AND bloqueo = ?`,
    [job.id_notificacion, job.bloqueo]
  );
  return true;
}

function startNotificationWorker(pool, settings, logger = console) {
  if (!settings.password) {
    logger.error('Correo no configurado: falta SMTP_PASSWORD. Las notificaciones quedan pendientes en la base de datos.');
    return async () => {};
  }
  const transport = createMailTransport(settings);
  let stopped = false;
  let timer;
  let running;
  const run = async () => {
    try {
      for (let count = 0; count < 20 && !stopped; count++) {
        if (!await processNotification(pool, transport, settings, logger)) break;
      }
    } catch (error) {
      logger.error(`No se pudo procesar la cola de correo (${error.code || 'ERROR'}).`);
    }
    if (!stopped) timer = setTimeout(() => { running = run(); }, 5000);
  };
  running = run();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
    transport.close();
  };
}

module.exports = { enqueueNotifications, createMailTransport, notificationMessage, processNotification, startNotificationWorker };
