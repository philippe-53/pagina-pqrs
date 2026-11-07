const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');
const { enqueueNotifications, createMailTransport, notificationMessage, processNotification, startNotificationWorker } = require('../src/services/notificationService');

test('Las nuevas PQRS notifican al destino configurado y al solicitante', async () => {
  const { mail } = require('../src/config');
  const inserts = [];
  const connection = {
    async execute(sql, params) {
      assert.match(sql, /INSERT INTO notificacion_pqrs/);
      inserts.push(params);
    }
  };
  await enqueueNotifications(connection, 42, 'user@example.test');
  assert.deepEqual(inserts, [
    [42, mail.institutionalRecipient.trim().toLowerCase()],
    [42, 'user@example.test']
  ]);
  inserts.length = 0;
  await enqueueNotifications(connection, 43, mail.institutionalRecipient);
  assert.deepEqual(inserts, [[43, mail.institutionalRecipient.trim().toLowerCase()]]);
});

test('Sin contraseña no se afirma envío y la cola no se procesa', async () => {
  assert.throws(() => createMailTransport({ user: 'sender@example.test' }), /SMTP_PASSWORD/);
  const errors = [];
  const stop = startNotificationWorker({}, {}, { error: message => errors.push(message) });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /pendientes/);
  await stop();
});

test('El correo contiene el ticket, no datos personales ni adjuntos', () => {
  const message = notificationMessage({
    ticket: 'SER-' + 'A'.repeat(24), id_notificacion: 1, destinatario: 'user@example.test',
    numero_documento: 'DATO_PRIVADO', grupo_etnico: 'DATO_PRIVADO', descripcion: 'DATO_PRIVADO'
  }, { user: 'sender@example.test' });
  assert.deepEqual(message.to, { address: 'user@example.test' });
  assert.match(message.subject, /SER-A{24}/);
  assert.match(message.text, /Consultar ticket/);
  assert.equal(JSON.stringify(message).includes('DATO_PRIVADO'), false);
  assert.match(message.html, /¡Gracias por tu solicitud!/);
  assert.match(message.html, /SER-A{24}/);
  assert.match(message.html, /Consultar mi PQRS/);
  assert.match(message.html, /www\.serraniasas\.com/);
  assert.match(message.text, /www\.serraniasas\.com: https:\/\/www\.serraniasas\.com/);
  assert.match(message.html, /<td align="center" style="padding:28px 24px 12px;text-align:center;">/);
  assert.match(message.html, /display:block;margin:0 auto/);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].cid, 'serrania-logo');
  assert.equal(message.attachments[0].contentDisposition, 'inline');
  assert.ok(Buffer.isBuffer(message.attachments[0].content));
  assert.equal(message.cc, undefined);
  assert.equal(message.bcc, undefined);
});

test('La empresa recibe un aviso de gestión con logo centrado y enlace administrativo', () => {
  const message = notificationMessage({
    ticket: 'SER-' + 'E'.repeat(24), id_notificacion: 2, destinatario: 'TEAM@EXAMPLE.TEST',
    descripcion: 'DATO_PRIVADO', email_contacto: 'DATO_PRIVADO'
  }, {
    user: 'sender@example.test', institutionalRecipient: 'team@example.test',
    publicUrl: 'https://pqrs.example.test'
  });
  assert.match(message.subject, /^Nueva PQRS recibida - Ticket SER-E{24}$/);
  assert.match(message.text, /¡Nueva PQRS recibida!/);
  assert.match(message.text, /Estimado\(a\) colaborador\(a\)/);
  assert.match(message.text, /atención y gestión oportuna/);
  assert.match(message.html, /Gestionar PQRS/);
  assert.equal(message.html.includes('www.serraniasas.com'), false);
  assert.match(message.html, /href="https:\/\/pqrs.example.test\/admin\/pqrs"/);
  assert.match(message.html, /background-color:#e2f1fc/);
  assert.match(message.html, /display:block;margin:0 auto/);
  assert.equal(message.html.includes('¡Gracias por tu solicitud!'), false);
  assert.equal(message.html.includes('Consultar mi PQRS'), false);
  assert.equal(JSON.stringify(message).includes('DATO_PRIVADO'), false);
});

test('El botón usa la URL pública sin ticket y escapa contenido HTML', () => {
  const message = notificationMessage({
    ticket: '<script>alert(1)</script>', id_notificacion: 1, destinatario: 'user@example.test'
  }, { user: 'sender@example.test', publicUrl: 'https://pqrs.example.test/?secret=123#fragment' });
  assert.match(message.html, /href="https:\/\/pqrs.example.test\/consultar"/);
  assert.match(message.html, /href="https:\/\/www\.serraniasas\.com"[^>]*>www\.serraniasas\.com<\/a>/);
  assert.match(message.text, /www\.serraniasas\.com: https:\/\/www\.serraniasas\.com/);
  assert.equal(message.html.includes('<script>'), false);
  assert.match(message.html, /&lt;script&gt;/);
  assert.equal(message.html.includes('secret=123'), false);
  assert.throws(() => notificationMessage({
    ticket: 'SER-' + 'A'.repeat(24), id_notificacion: 1, destinatario: 'user@example.test'
  }, { user: 'sender@example.test', publicUrl: 'javascript:alert(1)' }), /APP_PUBLIC_URL/);
});

test('La cola envía confirmaciones separadas al equipo y al cliente', async () => {
  const jobs = ['team@example.test', 'client@example.test'].map((destinatario, index) => ({
    destinatario, id_notificacion: index + 1, intentos: 0, ticket: 'SER-' + 'C'.repeat(24)
  }));
  const sent = [];
  const marked = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query() { return [[jobs.shift()]]; },
    async execute() {}
  };
  const pool = {
    async getConnection() { return connection; },
    async execute(sql, params) {
      assert.match(sql, /estado = 'enviada'/);
      marked.push(params[0]);
    }
  };
  const transport = {
    async sendMail(message) {
      sent.push(message);
      return { accepted: [message.to.address], rejected: [] };
    }
  };
  const settings = {
    user: 'sender@example.test', publicUrl: 'https://pqrs.example.test',
    institutionalRecipient: 'team@example.test'
  };
  await processNotification(pool, transport, settings);
  await processNotification(pool, transport, settings);
  assert.deepEqual(sent.map(message => message.to.address), ['team@example.test', 'client@example.test']);
  assert.deepEqual(marked, [1, 2]);
  assert.match(sent[0].html, /Gestionar PQRS/);
  assert.match(sent[0].subject, /^Nueva PQRS recibida/);
  assert.match(sent[1].html, /¡Gracias por tu solicitud!/);
  assert.match(sent[1].html, /Consultar mi PQRS/);
  assert.match(sent[1].subject, /^PQRS recibida/);
  for (const message of sent) {
    assert.match(message.html, /SER-C{24}/);
    assert.equal(message.cc, undefined);
    assert.equal(message.bcc, undefined);
  }
});

test('La confirmación web conserva el ticket real y la consulta POST protegida', async () => {
  const ticket = 'SER-' + 'D'.repeat(24);
  const html = await ejs.renderFile(path.join(__dirname, '../views/public/confirmation.ejs'), {
    title: 'PQRS registrada', appName: 'Serranía SAS ESP',
    currentPath: '/pqrs/registrada', currentUser: null,
    ticket, publicFormToken: 'token-prueba'
  });
  assert.match(html, /¡Gracias por tu solicitud!/);
  assert.match(html, new RegExp(ticket));
  assert.match(html, /method="POST" action="\/consultar"/);
  assert.match(html, /name="form_token" value="token-prueba"/);
  assert.match(html, /esta pantalla no confirma su entrega/);
});

test('Entrega SMTP local real con remitente, destinatario y ticket correctos', async () => {
  const commands = [];
  let content = '';
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 localhost SMTP test\r\n');
    let buffer = '';
    let data = false;
    socket.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            data = false;
            socket.write('250 Message accepted\r\n');
          } else content += line + '\r\n';
        } else {
          commands.push(line);
          if (line.startsWith('EHLO')) socket.write('250 localhost\r\n');
          else if (line === 'DATA') { data = true; socket.write('354 Send message\r\n'); }
          else if (line === 'QUIT') socket.end('221 Bye\r\n');
          else socket.write('250 OK\r\n');
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = nodemailer.createTransport({
    host: '127.0.0.1', port: server.address().port, ignoreTLS: true,
    connectionTimeout: 2000, socketTimeout: 2000
  });
  try {
    const result = await transport.sendMail(notificationMessage({
      ticket: 'SER-' + 'B'.repeat(24), id_notificacion: 42, destinatario: 'user@example.test'
    }, { user: 'sender@example.test' }));
    assert.deepEqual(result.accepted, ['user@example.test']);
    assert.ok(commands.includes('MAIL FROM:<sender@example.test>'));
    assert.ok(commands.includes('RCPT TO:<user@example.test>'));
    assert.match(content, /SER-B{24}/);
    assert.match(content, /Message-ID: <pqrs-SER-B{24}-42@example.test>/i);
    assert.match(content, /Content-Type: text\/html/i);
    assert.match(content, /Content-ID: <serrania-logo>/i);
  } finally {
    transport.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
