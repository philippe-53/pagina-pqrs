const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('crypto');
const { readFile } = require('fs/promises');
const path = require('path');
const { generateTicket } = require('../src/db/solidWasteMigration');
const { withTransaction } = require('../src/utils/transaction');
const { requireRole } = require('../src/middleware/auth');
const {
  getConsultationHistory,
  getConsultationResponses,
  getPqrsForConsultation,
  listPqrsForConsultation
} = require('../src/services/pqrsService');
const { createUser, updateUser } = require('../src/services/userService');
const { isValidPhone } = require('../src/utils/pqrsValidation');
const { createSubmissionToken, isValidSubmissionToken } = require('../src/utils/submissionToken');

test('Inicio organiza rutas, tarifas y oficinas sin inventar horarios ni vigencia', async () => {
  const ejs = require('ejs');
  const html = await ejs.renderFile(path.join(__dirname, '../views/public/home.ejs'), {
    title: 'Inicio', appName: 'Serranía SAS ESP', currentPath: '/', currentUser: null
  });
  assert.equal((html.match(/class="service-action/g) || []).length, 3);
  for (const text of [
    'Rutas y horarios', 'Lunes y viernes', 'cabecera del corregimiento de Albán',
    'no especifica la hora', 'cuatro recolecciones por semana', '10 de agosto de 2026',
    'Los miércoles no hay barrido', 'ocho horas', '7:00 a. m.', 'M1 a M5',
    'mínimo una vez por semana', 'aún en validación', 'Tarifa plena: $13.118 COP',
    '$3.935', '70 %', '$9.183', '$7.870', '40 %', '$5.247',
    '$11.150', '15 %', '$1.968', '$19.677', '$27.202',
    'No se indica su fecha de vigencia', 'Palacio Municipal (Alcaldía)',
    '126 m²', 'todavía no está en funcionamiento'
  ]) assert.ok(html.includes(text), text);
  assert.equal(html.includes('7:00 a. m. a 4:00 p. m.'), false);
  assert.equal(html.includes('COP / mes'), false);
  assert.match(html, /<caption>Tarifas y subsidios/);
  assert.match(html, /scope="col"/);
  assert.match(html, /scope="row"/);
  assert.equal((html.match(/id="office-map"/g) || []).length, 1);
  assert.match(html, /aria-labelledby="office-location-title"/);
  assert.equal((html.match(/<iframe/g) || []).length, 1);
  assert.match(html, /Mapa de Google Maps de la sede 1/);
  assert.ok(html.includes('https://www.google.com/maps?q=4.7625753%2C-76.220856&amp;z=18&amp;output=embed'));
  assert.equal(html.includes('/vendor/leaflet'), false);
  assert.ok(html.includes('4.7625753%2C-76.220856'));
  assert.ok(html.includes('4.762922955561891%2C-76.22051294710205'));
  assert.ok(html.includes('Sede 1: 4.7625753, -76.220856'));
  assert.ok(html.includes('query=4.762922955561891%2C-76.22051294710205'));
});

test('Perfil del administrador muestra los datos institucionales actualizados', async () => {
  const ejs = require('ejs');
  const html = await ejs.renderFile(path.join(__dirname, '../views/admin/dashboard.ejs'), {
    title: 'Panel administrativo',
    appName: 'Serranía SAS ESP',
    currentPath: '/admin',
    currentUser: { fullName: 'Administradora de prueba', role: 'ADMINISTRADOR', profile: { nroDoc: 'DOC123' } },
    flash: null,
    summary: { total_pqrs: 0, abiertos: 0, en_proceso: 0 },
    usersSummary: { total_usuarios: 0 },
    profile: { nombres: 'Admin', apellidos: 'Prueba', nro_doc: 'DOC123', email: 'admin@example.test', telefono: '3000000000' },
    pqrsByState: [],
    recentPqrs: []
  });
  assert.match(html, /NIT de la empresa<\/span><strong>901974106/);
  assert.match(html, /Email institucional<\/span><strong>subaseopqrds@elcairo-valle\.gov\.co/);
  assert.match(html, /Teléfono de contacto<\/span><strong>\+57 320 314 3660/);
  assert.match(html, /Documento del administrador<\/span><strong>DOC123/);
});

test('Consulta de PQRS consulta solo columnas autorizadas', async () => {
  const statements = [];
  const pool = {
    async execute(sql, params) {
      statements.push({ sql, params });
      if (sql.includes('FROM pqrs pq')) return [[{ id_pqrs: 9, ticket: 'SER-TEST', asunto: 'Prueba', tipo: 'Petición', estado: 'Abierto' }]];
      if (sql.includes('FROM historial_pqrs')) return [[{ fecha: '2026-01-01', estado: 'Abierto' }]];
      if (sql.includes('FROM respuesta_pqrs')) return [[{ fecha: '2026-01-02', respuesta: 'Respuesta pública' }]];
      return [[]];
    }
  };
  await listPqrsForConsultation(pool, { q: 'SER-', estado: 'Abierto', sortBy: 'solicitante', order: 'asc' });
  await getPqrsForConsultation(pool, 9);
  await getConsultationHistory(pool, 9);
  await getConsultationResponses(pool, 9);
  assert.equal(statements.length, 4);
  assert.match(statements[0].sql, /pq\.ticket LIKE \? OR pq\.asunto LIKE \? OR pq\.descripcion LIKE/);
  assert.match(statements[0].sql, /ORDER BY pq\.fecha_creacion ASC/);
  for (const { sql } of statements) {
    assert.doesNotMatch(sql, /grupo_etnico|numero_documento|email_contacto|telefono_contacto|nombre_contacto|adjunto_pqrs|h\.comentario|id_persona/);
  }
});

test('Crear accesos permite administrador o consulta, pero no otros roles', async () => {
  const inserted = [];
  const pool = { async execute(sql, params) { inserted.push({ sql, params }); return [{}]; } };
  await createUser(pool, { id_persona: 12, nombre_usuario: 'lector', clave: 'clave-segura', rol: 'CONSULTA_PQRS', activo: true });
  assert.equal(inserted[0].params[3], 'CONSULTA_PQRS');
  await assert.rejects(
    createUser(pool, { id_persona: 13, nombre_usuario: 'residente', clave: 'clave-segura', rol: 'RESIDENTE' }),
    /Rol no permitido/
  );
  const existingPool = { async execute() { return [[{ id_usuario: 1 }]]; } };
  await assert.rejects(updateUser(existingPool, 1, { rol: 'SUPERVISOR' }), /Rol no permitido/);
});

test('Crear usuario sin persona disponible crea persona y cuenta en una transacción', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO persona')) return [{ insertId: 55 }];
      if (sql.includes('INSERT INTO usuario_app')) return [{ insertId: 27 }];
      throw new Error('SQL inesperado');
    }
  };
  await createUser({
    async getConnection() { return connection; }
  }, {
    id_persona: null,
    persona: {
      tipo_doc: 'CC', nro_doc: '12345678', nombres: 'Auxiliar', apellidos: 'Prueba',
      email: '', telefono: ''
    },
    nombre_usuario: 'auxiliar',
    clave: 'clave-segura',
    rol: 'CONSULTA_PQRS',
    activo: true
  });
  const personInsert = calls.find(call => call && typeof call === 'object' && call.sql.includes('INSERT INTO persona'));
  const userInsert = calls.find(call => call && typeof call === 'object' && call.sql.includes('INSERT INTO usuario_app'));
  assert.deepEqual(personInsert.params, ['CC', '12345678', 'Auxiliar', 'Prueba', null, null]);
  assert.equal(userInsert.params[0], 55);
  assert.equal(userInsert.params[1], 'auxiliar');
  assert.equal(userInsert.params[3], 'CONSULTA_PQRS');
  assert.deepEqual(calls.filter(call => typeof call === 'string'), ['begin', 'commit', 'release']);
});

test('Formulario de creación permite ingresar nueva persona cuando no hay opciones existentes', async () => {
  const ejs = require('ejs');
  const html = await ejs.renderFile(path.join(__dirname, '../views/admin/users/form.ejs'), {
    title: 'Crear usuario',
    appName: 'Serranía SAS ESP',
    currentPath: '/admin/usuarios/nuevo',
    currentUser: { fullName: 'Admin', role: 'ADMINISTRADOR', profile: null },
    flash: null,
    mode: 'create',
    user: null,
    personas: [],
    errors: []
  });
  assert.match(html, /Crear persona nueva/);
  assert.match(html, /Datos de la persona nueva/);
  assert.match(html, /name="nombres"/);
  assert.match(html, /name="apellidos"/);
  assert.match(html, /name="nro_doc"/);
  assert.match(html, /value="CONSULTA_PQRS"/);
  assert.match(html, /value="ADMINISTRADOR"/);
});

test('Detalle de consulta limita el HTML y oculta datos privados adicionales', async () => {
  const ejs = require('ejs');
  const html = await ejs.renderFile(path.join(__dirname, '../views/consultation/pqrs/detail.ejs'), {
    title: 'Detalle de PQRS',
    appName: 'Serranía SAS ESP',
    currentPath: '/consulta-pqrs/9',
    currentUser: { fullName: 'Lector', role: 'CONSULTA_PQRS', profile: null },
    flash: null,
    pqrs: {
      ticket: 'SER-TEST', tipo: 'Petición', asunto: 'Prueba', estado: 'Abierto',
      fecha_creacion: '2026-01-01', descripcion: 'Descripción de prueba',
      email: 'PRIVADO_EMAIL', telefono: 'PRIVADO_TELEFONO',
      grupo_etnico: 'PRIVADO_ETNIA', numero_documento: 'PRIVADO_DOCUMENTO'
    },
    history: [{ fecha: '2026-01-01', estado: 'Abierto', comentario: 'PRIVADO_COMENTARIO' }],
    responses: [{ fecha: '2026-01-02', respuesta: 'Respuesta visible', id_persona: 'PRIVADO_AUTOR' }]
  });
  for (const privateValue of ['PRIVADO_EMAIL', 'PRIVADO_TELEFONO', 'PRIVADO_ETNIA', 'PRIVADO_DOCUMENTO', 'PRIVADO_COMENTARIO', 'PRIVADO_AUTOR']) {
    assert.equal(html.includes(privateValue), false, privateValue);
  }
  assert.match(html, /SER-TEST/);
  assert.match(html, /Descripción de prueba/);
  assert.match(html, /Respuesta visible/);
  assert.equal(html.includes('/admin/'), false);
  assert.equal(html.includes('adjunto'), false);
});

test('Rol de consulta solo accede a lectura de PQRS y no entra a rutas administrativas', async t => {
  const express = require('express');
  const createAdminRoutes = require('../src/routes/adminRoutes');
  const createConsultationRoutes = require('../src/routes/consultationRoutes');
  const app = express();
  app.set('views', path.join(__dirname, '../views'));
  app.set('view engine', 'ejs');
  app.use((req, res, next) => {
    const role = req.get('x-test-role');
    req.session = { user: role ? { role, fullName: 'Lector de prueba', profile: null } : null };
    res.locals.currentUser = req.session.user;
    res.locals.flash = null;
    res.locals.appName = 'Serranía SAS ESP';
    res.locals.currentPath = req.path;
    res.locals.pqrsTypes = ['Petición'];
    next();
  });
  const pool = {
    async execute(sql) {
      if (sql.includes('FROM pqrs pq')) {
        return sql.includes('WHERE pq.id_pqrs = ?')
          ? [[{ id_pqrs: 9, ticket: 'SER-TEST', tipo: 'Petición', asunto: 'Prueba', descripcion: 'Descripción visible', estado: 'Abierto', fecha_creacion: '2026-01-01' }]]
          : [[{ id_pqrs: 9, ticket: 'SER-TEST', tipo: 'Petición', asunto: 'Prueba', estado: 'Abierto', fecha_creacion: '2026-01-01' }]];
      }
      if (sql.includes('FROM estado_pqrs')) return [[{ id_estado: 1, nombre: 'Abierto' }]];
      if (sql.includes('FROM historial_pqrs')) return [[{ estado: 'Abierto', fecha: '2026-01-01' }]];
      if (sql.includes('FROM respuesta_pqrs')) return [[{ respuesta: 'Respuesta visible', fecha: '2026-01-02' }]];
      return [[]];
    }
  };
  app.use('/consulta-pqrs', createConsultationRoutes(pool));
  app.use('/admin', createAdminRoutes(pool));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const list = await fetch(`${base}/consulta-pqrs`, { headers: { 'x-test-role': 'CONSULTA_PQRS' } });
  const listHtml = await list.text();
  assert.equal(list.status, 200);
  assert.match(listHtml, /SER-TEST/);
  assert.match(listHtml, /href="\/consulta-pqrs\/9"/);
  assert.equal(listHtml.includes('/admin'), false);

  const detail = await fetch(`${base}/consulta-pqrs/9`, { headers: { 'x-test-role': 'CONSULTA_PQRS' } });
  assert.equal(detail.status, 200);
  assert.match(await detail.text(), /Descripción visible/);

  const admin = await fetch(`${base}/admin/usuarios`, {
    headers: { 'x-test-role': 'CONSULTA_PQRS', redirect: 'manual' },
    redirect: 'manual'
  });
  assert.equal(admin.status, 403);

  const write = await fetch(`${base}/consulta-pqrs/9/responder`, {
    method: 'POST',
    headers: { 'x-test-role': 'CONSULTA_PQRS' }
  });
  assert.equal(write.status, 404);
});

test('Teléfonos: de 7 a 15 dígitos y separadores admitidos', () => {
  for (const phone of ['1234567', '3001234567', '+57 (300) 123-4567', '+123456789012345']) {
    assert.equal(isValidPhone(phone), true, phone);
  }
  for (const phone of ['abc', '123456', '1'.repeat(16), '300+1234567', '-------', '3001234567abc']) {
    assert.equal(isValidPhone(phone), false, phone);
  }
});

test('Cada formulario tiene un token firmado ligado a su sesión', () => {
  const token = createSubmissionToken('sesion-prueba');
  assert.notEqual(createSubmissionToken('sesion-prueba'), token);
  assert.equal(isValidSubmissionToken(token, 'sesion-prueba'), true);
  assert.equal(isValidSubmissionToken(token, 'otra-sesion'), false);
  assert.equal(isValidSubmissionToken('0'.repeat(64) + '.' + '0'.repeat(64), 'sesion-prueba'), false);
  assert.equal(isValidSubmissionToken(undefined, 'sesion-prueba'), false);
});

test('Tickets aleatorios, únicos y con formato de consulta', () => {
  const tickets = Array.from({ length: 1000 }, generateTicket);
  assert.equal(new Set(tickets).size, tickets.length);
  tickets.forEach(ticket => assert.match(ticket, /^SER-[A-F0-9]{24}$/));
});

test('Una transacción fallida revierte y libera la conexión', async () => {
  const calls = [];
  const connection = Object.fromEntries(['beginTransaction', 'commit', 'rollback', 'release'].map(name => [
    name, async () => calls.push(name)
  ]));
  await assert.rejects(withTransaction({ getConnection: async () => connection }, async () => {
    throw new Error('Fallo al guardar historial');
  }), /Fallo al guardar historial/);
  assert.deepEqual(calls, ['beginTransaction', 'rollback', 'release']);
});

test('Una sesión anterior de residente no puede acceder al dashboard', () => {
  let forbidden = false;
  const response = {
    status(code) { assert.equal(code, 403); return this; },
    render(view) { assert.equal(view, 'errors/forbidden'); forbidden = true; }
  };
  requireRole('ADMINISTRADOR')({ session: { user: { role: 'RESIDENTE' } } }, response, () => assert.fail('Acceso indebido'));
  assert.equal(forbidden, true);
});

test('Flujo HTTP y persistencia MySQL local aislada', { skip: process.env.TEST_MYSQL !== '1' }, async t => {
  const mysql = require('mysql2/promise');
  const bcrypt = require('bcryptjs');
  const database = `pqrs_test_${randomBytes(8).toString('hex')}`;
  const adminPassword = randomBytes(18).toString('hex');
  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD || '',
    multipleStatements: true
  });
  let server;
  let pool;
  try {
    const schema = await readFile(path.join(__dirname, '..', 'scripts', 'local-mysql.sql'), 'utf8');
    await connection.query(schema.replaceAll('gestion_conjuntos', database));
    await connection.execute("INSERT INTO estado_pqrs (nombre) VALUES ('Abierto')");
    const [[person]] = await connection.query("SELECT id_persona FROM persona WHERE nro_doc = '1001'");
    const [[unit]] = await connection.query('SELECT id_unidad FROM unidad LIMIT 1');
    const [legacy] = await connection.execute(
      "INSERT INTO pqrs (id_persona, id_unidad, id_estado, tipo, asunto, descripcion) VALUES (?, ?, 1, 'Queja', 'Registro anterior', 'Conservar registro anterior')",
      [person.id_persona, unit.id_unidad]
    );
    await connection.execute(
      "INSERT INTO usuario_app (id_persona, nombre_usuario, clave_hash, rol) VALUES (?, 'legacy', ?, 'RESIDENTE')",
      [person.id_persona, await bcrypt.hash('test-legacy-password', 4)]
    );
    Object.assign(process.env, {
      DB_HOST: '127.0.0.1', DB_PORT: String(process.env.TEST_DB_PORT || 3306),
      DB_USER: process.env.TEST_DB_USER || 'root', DB_PASSWORD: process.env.TEST_DB_PASSWORD || '',
      DB_NAME: database, SESSION_SECRET: randomBytes(32).toString('hex'), ADMIN_DEFAULT_PASSWORD: adminPassword
    });
    const createApp = require('../src/app');
    pool = require('../src/db/pool');
    const app = await createApp();
    server = await new Promise(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    function client() {
      let cookie = '';
      return async (url, body) => {
        const headers = {};
        if (cookie) headers.cookie = cookie;
        const multipart = body instanceof FormData;
        if (body && !multipart) headers['content-type'] = 'application/x-www-form-urlencoded';
        const response = await fetch(base + url, {
          method: body ? 'POST' : 'GET', headers,
          body: body ? multipart ? body : new URLSearchParams(body) : undefined, redirect: 'manual'
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const bytes = Buffer.from(await response.arrayBuffer());
        return { status: response.status, location: response.headers.get('location'), html: bytes.toString('utf8'), bytes, headers: response.headers };
      };
    }
    const tokenFrom = page => {
      const match = page.html.match(/name="form_token" value="([^"]+)"/);
      assert.ok(match, 'El formulario debe incluir un token de sesión');
      return match[1];
    };
    const publicClient = client();
    const adminClient = client();
    let token;
    let submissionToken;
    let ticket;
    let id;
    const payload = {
      nombre_contacto: 'Persona de prueba', email_contacto: 'persona@example.test', telefono_contacto: '3001234567',
      tipo_documento: 'Pasaporte', numero_documento: 'QA12345678', grupo_etnico: 'No aplica',
      direccion: 'Calle de prueba 123', tipo: 'Queja', servicio: 'Recolección de residuos',
      asunto: 'Falta de recolección', descripcion: '<script>alert("prueba")</script> No pasó el vehículo.',
      autorizacion: 'si'
    };

    await t.test('La migración conserva registros anteriores y es idempotente', async () => {
      const { getPqrsById } = require('../src/services/pqrsService');
      const before = await getPqrsById(pool, legacy.insertId);
      assert.equal(before.id_persona, person.id_persona);
      assert.equal(before.id_unidad, unit.id_unidad);
      assert.match(before.ticket, /^SER-[A-F0-9]{24}$/);
      await require('../src/db/bootstrap').bootstrapDatabase(pool);
      assert.equal((await getPqrsById(pool, legacy.insertId)).ticket, before.ticket);
    });
    await t.test('Inicio y formulario públicos, sin cuenta', async () => {
      const home = await publicClient('/');
      assert.equal(home.status, 200);
      assert.match(home.html, /Serranía/);
      assert.match(home.html, /Bienvenidos a Serranía/);
      assert.match(home.html, /class="home-hero lobby-cover"/);
      assert.match(home.html, /class="lobby-cover-image" src="\/images\/carrusel\/IMG_3140.webp"/);
      assert.equal(home.html.includes('lobby-backdrop'), false);
      assert.match(home.html, /href="\/atencion-ciudadano"/);
      assert.match(home.html, /class="site-logo"[^>]+alt="Serranía SAS ESP"[^>]+width="640" height="200"/);
      assert.match(home.html, /rel="icon"[^>]+href="\/images\/serrania-logo.png"/);
      const logo = await publicClient('/images/serrania-logo.png');
      assert.equal(logo.status, 200);
      assert.equal(logo.headers.get('content-type'), 'image/png');
      assert.deepEqual(logo.bytes, await readFile(path.join(__dirname, '..', 'public', 'images', 'serrania-logo.png')));
      assert.match((await publicClient('/login')).html, /site-logo site-logo-auth/);
      const form = await publicClient('/pqrs/nueva');
      token = tokenFrom(form);
      submissionToken = form.html.match(/name="submission_token" value="([^"]+)"/)[1];
      payload.submission_token = submissionToken;
    });
    await t.test('Lobby, atención ciudadana y quiénes somos tienen navegación y contenido independientes', async () => {
      const attention = await publicClient('/atencion-ciudadano');
      assert.equal(attention.status, 200);
      assert.match(attention.html, /Registrar una PQRS/);
      assert.match(attention.html, /href="\/pqrs\/nueva"/);
      assert.match(attention.html, /href="\/consultar"/);
      assert.equal(attention.html.includes('data-carousel'), false);
      assert.match(attention.html, /href="\/atencion-ciudadano" aria-current="page"/);
      const about = await publicClient('/quienes-somos');
      assert.equal(about.status, 200);
      for (const heading of ['Visión', 'Misión', 'Objetivos generales', 'Objetivos específicos']) {
        assert.ok(about.html.includes(`<h2>${heading}</h2>`));
      }
      assert.equal((about.html.match(/institutional-card/g) || []).length, 4);
      assert.equal(about.html.includes('data-carousel'), false);
      assert.match(about.html, /href="\/quienes-somos" aria-current="page"/);
      for (const route of ['/pqrs/nueva', '/consultar']) {
        const page = await publicClient(route);
        assert.match(page.html, /href="\/atencion-ciudadano" aria-current="page"/);
      }
    });
    await t.test('Gestor normativo público: navegación activa y descarga íntegra del CCU', async () => {
      const page = await publicClient('/gestor-normativo');
      assert.equal(page.status, 200);
      assert.match(page.html, /href="\/gestor-normativo" aria-current="page"/);
      assert.match(page.html, /Contrato de Condiciones Uniformes \(CCU\)/);
      assert.match(page.html, /Superintendencia de Servicios Públicos Domiciliarios/);
      assert.match(page.html, /href="\/gestor-normativo\/ccu\/descargar" download="Contrato-de-Condiciones-Uniformes.pdf"/);
      const document = await publicClient('/gestor-normativo/ccu/descargar');
      assert.equal(document.status, 200);
      assert.equal(document.headers.get('content-type'), 'application/pdf');
      assert.match(document.headers.get('content-disposition'), /attachment; filename="Contrato-de-Condiciones-Uniformes.pdf"/);
      assert.equal(document.bytes.toString('ascii', 0, 5), '%PDF-');
      assert.deepEqual(document.bytes, await readFile(path.join(__dirname, '..', 'public', 'documents', 'contrato-condiciones-uniformes.pdf')));
    });
    await t.test('Decreto 1077 de 2015: contenedor independiente y PDF íntegro', async () => {
      const page = await publicClient('/gestor-normativo');
      assert.equal(page.status, 200);
      assert.match(page.html, /id="decree-title">Decreto 1077 de 2015/);
      assert.equal((page.html.match(/class="service-action regulatory-document"/g) || []).length, 2);
      const url = '/documents/Decreto-1077-de-2015-Sector-Vivienda,-Ciudad-y-Territorio-Gestor-Normativo.pdf';
      assert.ok(page.html.includes(`href="${url}" download="Decreto-1077-de-2015.pdf"`));
      const document = await publicClient(url);
      assert.equal(document.status, 200);
      assert.equal(document.headers.get('content-type'), 'application/pdf');
      assert.equal(document.bytes.toString('ascii', 0, 5), '%PDF-');
      assert.deepEqual(document.bytes, await readFile(path.join(__dirname, '..', 'public', 'documents', path.basename(url))));
    });
    await t.test('Inicio sin carrusel conserva la portada y los tres contenedores institucionales', async () => {
      const home = await publicClient('/');
      assert.equal(home.status, 200);
      assert.equal(home.html.includes('data-carousel'), false);
      assert.equal(home.html.includes('lobby-gallery'), false);
      assert.equal((home.html.match(/class="service-action/g) || []).length, 3);
      assert.match(home.html, /Rutas y horarios/);
      assert.match(home.html, /Lunes y viernes/);
      assert.match(home.html, /no especifica la hora de recolección/);
      assert.match(home.html, /Tarifa plena: \$13\.118 COP/);
      assert.match(home.html, /No se indica su fecha de vigencia/);
      assert.match(home.html, /Carrera 5 con Calle 9, esquina, Palacio Municipal/);
      assert.match(home.html, /class="lobby-cover-image"/);
      for (const file of ['IMG_3140']) {
        const image = await publicClient(`/images/carrusel/${file}.webp`);
        assert.equal(image.status, 200);
        assert.equal(image.headers.get('content-type'), 'image/webp');
        assert.equal(image.bytes.toString('ascii', 0, 4), 'RIFF');
        assert.equal(image.bytes.toString('ascii', 8, 12), 'WEBP');
        assert.ok(image.bytes.length < 400000);
      }
    });
    await t.test('Mapa de oficina: ubicación exacta, nombre accesible y enlace alternativo', async () => {
      const home = await publicClient('/');
      assert.match(home.html, /aria-labelledby="office-location-title"/);
      assert.match(home.html, /id="office-map" class="office-map"/);
      assert.match(home.html, /google\.com\/maps\?q=4\.7625753%2C-76\.220856&amp;z=18&amp;output=embed/);
      assert.match(home.html, /loading="lazy"/);
      assert.match(home.html, /google\.com\/maps\/search\/\?api=1&amp;query=4\.7625753%2C-76\.220856/);
      assert.match(home.html, /target="_blank" rel="noopener noreferrer"/);
    });
    await t.test('Footer público: contacto legal, redes oficiales y derechos 2026', async () => {
      for (const route of ['/', '/atencion-ciudadano', '/quienes-somos', '/gestor-normativo', '/pqrs/nueva', '/consultar']) {
        const page = await publicClient(route);
        assert.match(page.html, /href="\/gestor-normativo"/);
        assert.equal((page.html.match(/class="footer-contact-card"/g) || []).length, 4);
        assert.match(page.html, /<strong>NIT:<\/strong> 901974106/);
        assert.match(page.html, /Pendiente de publicación/);
        assert.match(page.html, /mailto:subaseopqrds@elcairo-valle\.gov\.co/);
        assert.match(page.html, /instagram\.com\/serraniadmon/);
        assert.match(page.html, /facebook\.com\/share\/1FuEyBySPH\//);
        assert.match(page.html, /https:\/\/wa\.me\/573203143660/);
        assert.match(page.html, /\+57 320 314 3660/);
        assert.match(page.html, /© 2026 Serranía SAS ESP\. Todos los derechos reservados/);
        assert.match(page.html, /aria-label="Redes sociales y WhatsApp de Serranía"/);
        const footer = page.html.match(/<footer class="public-footer">[\s\S]*?<\/footer>/)[0];
        assert.equal(footer.includes('Volver al inicio'), false);
        assert.match(footer, /class="footer-bottom">[\s\S]*?<nav class="footer-socials"/);
      }
    });
    await t.test('Rechaza formularios falsificados, incompletos y fuera de límites', async () => {
      assert.equal((await publicClient('/pqrs/nueva', payload)).status, 403);
      for (const changes of [
        { nombre_contacto: '' }, { asunto: 'a'.repeat(181) }, { descripcion: 'a'.repeat(5001) },
        { email_contacto: 'invalido' }, { tipo: 'Otro' }, { servicio: 'No existe' }, { autorizacion: '' },
        { telefono_contacto: 'abc' }, { telefono_contacto: '123456' }, { telefono_contacto: '1'.repeat(16) },
        { tipo_documento: '' }, { tipo_documento: 'OTRO' }, { numero_documento: '' },
        { numero_documento: 'A'.repeat(31) }, { numero_documento: '<script>' },
        { grupo_etnico: '' }, { grupo_etnico: 'OTRO' }
      ]) {
        assert.equal((await publicClient('/pqrs/nueva', { ...payload, form_token: token, ...changes })).status, 400);
      }
      const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM pqrs');
      assert.equal(count.total, 1);
    });
    await t.test('Rechaza identificadores de envío sin firma o de otra sesión', async () => {
      for (const submission_token of ['', '0'.repeat(64) + '.' + '0'.repeat(64), createSubmissionToken('otra-sesion')]) {
        assert.equal((await publicClient('/pqrs/nueva', { ...payload, form_token: token, submission_token })).status, 403);
      }
    });
    await t.test('Registra PQRS abierta, genera ticket y no crea cuentas ni acepta estado inyectado', async () => {
      const result = await publicClient('/pqrs/nueva', {
        ...payload, form_token: token, estado_pqrs: 'Solucionado', id_persona: '1', id_unidad: '1'
      });
      assert.equal(result.status, 302);
      assert.equal(result.location, '/pqrs/registrada');
      const confirmation = await publicClient(result.location);
      assert.equal(confirmation.status, 200);
      ticket = confirmation.html.match(/SER-[A-F0-9]{24}/)[0];
      const [[row]] = await pool.execute('SELECT * FROM pqrs WHERE ticket = ?', [ticket]);
      id = row.id_pqrs;
      assert.equal(row.estado_pqrs, 'Abierto');
      assert.equal(row.id_persona, null);
      assert.equal(row.id_unidad, null);
      const [[accounts]] = await pool.query('SELECT COUNT(*) AS total FROM usuario_app');
      assert.equal(accounts.total, 2);
      await publicClient('/pqrs/registrada');
      const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM pqrs');
      assert.equal(count.total, 2);
    });
    await t.test('Consulta desde otra sesión, sin exponer los datos personales', async () => {
      const visitor = client();
      const formToken = tokenFrom(await visitor('/consultar'));
      const result = await visitor('/consultar', { form_token: formToken, ticket: ticket.toLowerCase() });
      assert.equal(result.status, 200);
      assert.match(result.html, /Abierto/);
      assert.match(result.html, /PQRS creada en la plataforma/);
      for (const secret of [payload.nombre_contacto, payload.email_contacto, payload.telefono_contacto, payload.direccion, payload.descripcion, payload.numero_documento]) {
        assert.equal(result.html.includes(secret), false);
      }
      for (const invalid of ['1', "' OR 1=1 --", 'SER-' + '0'.repeat(24)]) {
        assert.equal((await visitor('/consultar', { form_token: formToken, ticket: invalid })).status, 404);
      }
    });
    await t.test('Nadie sin sesión administrativa puede gestionar PQRS', async () => {
      for (const url of ['/admin', `/admin/pqrs/${id}`, '/admin/reportes', '/admin/usuarios']) {
        assert.equal((await publicClient(url)).location, '/login');
      }
      for (const url of [`/admin/pqrs/${id}/editar`, `/admin/pqrs/${id}/responder`, `/admin/pqrs/${id}/eliminar`, '/resident/pqrs/nueva']) {
        assert.equal((await publicClient(url, { estado_pqrs: 'Solucionado', respuesta: 'No autorizada' })).location, '/login');
      }
      const resident = client();
      assert.equal((await resident('/login', { username: 'legacy', password: 'test-legacy-password' })).location, '/login');
      assert.equal((await resident('/admin')).location, '/login');
    });
    await t.test('Administrador ve dashboard, ticket, solicitante y descripción escapada', async () => {
      assert.equal((await adminClient('/login', { username: 'admin', password: adminPassword })).location, '/admin');
      for (const url of ['/admin', '/admin/pqrs', '/admin/reportes', '/admin/usuarios', `/admin/pqrs/${id}/editar`]) {
        assert.equal((await adminClient(url)).status, 200, url);
      }
      const detail = await adminClient(`/admin/pqrs/${id}`);
      const dashboard = await adminClient('/admin');
      assert.match(dashboard.html, /NIT de la empresa<\/span><strong>901974106<\/strong>/);
      assert.match(dashboard.html, /subaseopqrds@elcairo-valle\.gov\.co/);
      assert.match(dashboard.html, /\+57 320 314 3660/);
      assert.match(detail.html, /site-logo site-logo-sidebar/);
      assert.match(detail.html, /Persona de prueba/);
      assert.match(detail.html, /QA12345678/);
      assert.match(detail.html, /No aplica/);
      assert.match(detail.html, /&lt;script&gt;/);
      assert.equal(detail.html.includes(payload.descripcion), false);
      assert.match((await adminClient(`/admin/pqrs?q=${ticket}`)).html, /Falta de recolección/);
    });
    await t.test('La edición mantiene la PQRS pública visible y registra cambio de estado', async () => {
      const endpoint = `/admin/pqrs/${id}/editar`;
      assert.equal((await adminClient(endpoint, { ...payload, tipo: 'NO_EXISTE', estado_pqrs: 'Abierto' })).status, 400);
      assert.equal((await require('../src/services/pqrsService').getPqrsById(pool, id)).tipo, 'Queja');
      assert.equal((await adminClient(endpoint, { ...payload, estado_pqrs: 'Inventado' })).status, 400);
      assert.equal((await adminClient(endpoint, { ...payload, estado_pqrs: 'En proceso' })).status, 302);
      const [[row]] = await pool.execute('SELECT id_unidad, estado_pqrs FROM pqrs WHERE id_pqrs = ?', [id]);
      assert.equal(row.id_unidad, null);
      assert.equal(row.estado_pqrs, 'En proceso');
      const history = await require('../src/services/pqrsService').getHistoryByPqrs(pool, id);
      assert.equal(history.length, 2);
      assert.equal(history[1].estado, 'En proceso');
      await adminClient(endpoint, { ...payload, estado_pqrs: 'En proceso' });
      assert.equal((await require('../src/services/pqrsService').getHistoryByPqrs(pool, id)).length, 2);
    });
    await t.test('Respuesta oficial y solución aparecen en consulta pública y en trayectoria', async () => {
      await adminClient(`/admin/pqrs/${id}/responder`, { respuesta: 'Se programó y completó la recolección.', nuevo_estado: 'Solucionado' });
      const result = await publicClient('/consultar', { form_token: token, ticket });
      assert.equal(result.status, 200);
      assert.match(result.html, /Se programó y completó la recolección/);
      assert.match(result.html, /Estado actualizado a En proceso/);
      assert.match(result.html, /Estado actualizado a Solucionado/);
      assert.equal((await require('../src/services/pqrsService').getHistoryByPqrs(pool, id)).length, 3);
      await adminClient(`/admin/pqrs/${id}/responder`, { respuesta: 'Respuesta posterior prohibida' });
      assert.equal((await require('../src/services/pqrsService').getResponsesByPqrs(pool, id)).length, 1);
    });
    await t.test('Una nueva solicitud recibe otro ticket', async () => {
      const form = await publicClient('/pqrs/nueva');
      const nextToken = form.html.match(/name="submission_token" value="([^"]+)"/)[1];
      await publicClient('/pqrs/nueva', { ...payload, form_token: token, submission_token: nextToken });
      const confirmation = await publicClient('/pqrs/registrada');
      assert.notEqual(confirmation.html.match(/SER-[A-F0-9]{24}/)[0], ticket);
    });
    await t.test('Doble envío y reintento devuelven un solo ticket e historial', async () => {
      const form = await publicClient('/pqrs/nueva');
      const submission_token = form.html.match(/name="submission_token" value="([^"]+)"/)[1];
      const body = { ...payload, asunto: 'Doble envío concurrente', form_token: token, submission_token };
      const responses = await Promise.all(Array.from({ length: 5 }, () => publicClient('/pqrs/nueva', body)));
      responses.forEach(response => assert.equal(response.status, 302));
      const [rows] = await pool.execute('SELECT id_pqrs, ticket FROM pqrs WHERE asunto = ?', [body.asunto]);
      assert.equal(rows.length, 1);
      assert.equal((await require('../src/services/pqrsService').getHistoryByPqrs(pool, rows[0].id_pqrs)).length, 1);
      await publicClient('/pqrs/nueva', body);
      assert.match((await publicClient('/pqrs/registrada')).html, new RegExp(rows[0].ticket));
      const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM pqrs WHERE asunto = ?', [body.asunto]);
      assert.equal(count.total, 1);
      const [notifications] = await pool.execute('SELECT destinatario FROM notificacion_pqrs WHERE id_pqrs = ?', [rows[0].id_pqrs]);
      assert.deepEqual(notifications.map(row => row.destinatario).sort(), ['persona@example.test', 'subaseopqrds@elcairo-valle.gov.co'].sort());
    });
    await t.test('Validación conserva el identificador de envío y permite corregir el formulario', async () => {
      const form = await publicClient('/pqrs/nueva');
      const submission_token = form.html.match(/name="submission_token" value="([^"]+)"/)[1];
      const response = await publicClient('/pqrs/nueva', { ...payload, form_token: token, submission_token, email_contacto: 'incorrecto' });
      assert.equal(response.status, 400);
      assert.ok(response.html.includes(submission_token));
      assert.ok(response.html.includes(payload.nombre_contacto));
      assert.equal((await publicClient('/pqrs/nueva', { ...payload, form_token: token, submission_token })).status, 302);
    });
    await t.test('Acepta datos al máximo de longitud y teléfono internacional', async () => {
      const form = await publicClient('/pqrs/nueva');
      const submission_token = form.html.match(/name="submission_token" value="([^"]+)"/)[1];
      const response = await publicClient('/pqrs/nueva', {
        ...payload, form_token: token, submission_token, nombre_contacto: 'N'.repeat(150), direccion: 'D'.repeat(255),
        asunto: 'A'.repeat(180), descripcion: 'X'.repeat(5000), telefono_contacto: '+57 (300) 123-4567'
      });
      assert.equal(response.status, 302);
      const [[row]] = await pool.query('SELECT CHAR_LENGTH(asunto) AS asunto, CHAR_LENGTH(descripcion) AS descripcion FROM pqrs ORDER BY id_pqrs DESC LIMIT 1');
      assert.equal(row.asunto, 180);
      assert.equal(row.descripcion, 5000);
    });
    await t.test('Las rutas inexistentes presentan HTTP 404 con navegación pública', async () => {
      for (const visitor of [publicClient, adminClient]) {
        const response = await visitor('/ruta-inexistente-qa');
        assert.equal(response.status, 404);
        assert.match(response.html, /Página no encontrada/);
        assert.match(response.html, /href="\/consultar"/);
      }
    });
    await t.test('Editar un usuario inexistente informa error; guardar sin cambios sigue siendo válido', async () => {
      const response = await adminClient('/admin/usuarios/999999/editar', { nombre_usuario: 'inexistente', rol: 'ADMINISTRADOR', activo: 'on' });
      assert.equal(response.location, '/admin/usuarios');
      const list = await adminClient(response.location);
      assert.match(list.html, /El usuario solicitado no existe/);
      assert.equal(list.html.includes('El usuario fue actualizado correctamente.'), false);
      const [[admin]] = await pool.execute('SELECT id_usuario FROM usuario_app WHERE nombre_usuario = ?', ['admin']);
      await adminClient(`/admin/usuarios/${admin.id_usuario}/editar`, { nombre_usuario: 'admin', rol: 'ADMINISTRADOR', activo: 'on' });
      assert.match((await adminClient('/admin/usuarios')).html, /El usuario fue actualizado correctamente/);
    });
    await t.test('Un fallo del historial revierte también la creación de la PQRS', async () => {
      const [[before]] = await pool.query('SELECT COUNT(*) AS total FROM pqrs');
      await pool.query("CREATE TRIGGER reject_test_history BEFORE INSERT ON historial_pqrs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fallo controlado de prueba'");
      try {
        await assert.rejects(require('../src/services/pqrsService').createPqrs(pool, payload), /Fallo controlado/);
      } finally {
        await pool.query('DROP TRIGGER reject_test_history');
      }
      const [[after]] = await pool.query('SELECT COUNT(*) AS total FROM pqrs');
      assert.equal(after.total, before.total);
    });
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
    const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1cAAAAASUVORK5CYII=', 'base64');
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
    async function attachmentForm(content, name, mime) {
      const form = await publicClient('/pqrs/nueva');
      const multipart = new FormData();
      for (const [key, value] of Object.entries({
        ...payload, form_token: token,
        submission_token: form.html.match(/name="submission_token" value="([^"]+)"/)[1]
      })) multipart.set(key, value);
      if (content) multipart.set('adjunto', new Blob([content], { type: mime }), name);
      return multipart;
    }
    await t.test('Documento y grupo étnico obligatorios: opciones completas y orden del formulario', async () => {
      const { documentTypes, ethnicGroups } = require('../src/utils/pqrsValidation');
      const form = await publicClient('/pqrs/nueva');
      assert.equal(documentTypes.length, 4);
      assert.equal(ethnicGroups.length, 7);
      for (const value of [...documentTypes, ...ethnicGroups]) assert.ok(form.html.includes(value));
      assert.ok(form.html.indexOf('name="tipo_documento"') < form.html.indexOf('name="numero_documento"'));
      assert.match(form.html, /enctype="multipart\/form-data"/);
      for (let index = 0; index < ethnicGroups.length; index++) {
        const body = await attachmentForm();
        body.set('tipo_documento', documentTypes[index % documentTypes.length]);
        body.set('grupo_etnico', ethnicGroups[index]);
        assert.equal((await publicClient('/pqrs/nueva', body)).status, 302);
        const confirmation = await publicClient('/pqrs/registrada');
        const ticket = confirmation.html.match(/SER-[A-F0-9]{24}/)[0];
        const [[row]] = await pool.execute('SELECT tipo_documento, numero_documento, grupo_etnico FROM pqrs WHERE ticket = ?', [ticket]);
        assert.equal(row.tipo_documento, documentTypes[index % documentTypes.length]);
        assert.equal(row.grupo_etnico, ethnicGroups[index]);
        assert.equal(row.numero_documento, payload.numero_documento);
        const result = await publicClient('/consultar', { form_token: token, ticket });
        assert.equal(result.html.includes(payload.numero_documento), false);
        assert.equal(result.html.includes(ethnicGroups[index]), false);
      }
    });
    await t.test('PDF, PNG y JPG se guardan y solo el administrador puede descargarlos', async () => {
      for (const [content, name, mime] of [
        [pdfBytes, 'prueba.pdf', 'application/pdf'], [pngBytes, 'prueba.png', 'image/png'], [jpegBytes, 'prueba.jpg', 'image/jpeg']
      ]) {
        const body = await attachmentForm(content, name, mime);
        const responses = await Promise.all([publicClient('/pqrs/nueva', body), publicClient('/pqrs/nueva', body)]);
        responses.forEach(response => assert.equal(response.status, 302));
        const confirmation = await publicClient('/pqrs/registrada');
        const ticket = confirmation.html.match(/SER-[A-F0-9]{24}/)[0];
        const [[row]] = await pool.execute('SELECT id_pqrs FROM pqrs WHERE ticket = ?', [ticket]);
        const route = `/admin/pqrs/${row.id_pqrs}/adjunto`;
        assert.equal((await publicClient(route)).location, '/login');
        const download = await adminClient(route);
        assert.equal(download.status, 200);
        assert.deepEqual(download.bytes, content);
        assert.match(download.headers.get('content-disposition'), /^attachment;/);
        assert.equal(download.headers.get('cache-control'), 'no-store');
        const [attachments] = await pool.execute('SELECT id_pqrs FROM adjunto_pqrs WHERE id_pqrs = ?', [row.id_pqrs]);
        assert.equal(attachments.length, 1);
        assert.match((await adminClient(`/admin/pqrs/${row.id_pqrs}`)).html, /Descargar adjunto/);
        const lookup = await publicClient('/consultar', { form_token: token, ticket });
        assert.equal(lookup.html.includes('/adjunto'), false);
        await adminClient(`/admin/pqrs/${row.id_pqrs}/eliminar`, {});
        const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM adjunto_pqrs WHERE id_pqrs = ?', [row.id_pqrs]);
        assert.equal(count.total, 0);
      }
      assert.equal((await adminClient('/admin/pqrs/999999/adjunto')).status, 404);
    });
    await t.test('Rechaza archivos falsos, extensiones no admitidas y múltiples adjuntos sin crear PQRS', async () => {
      const [[before]] = await pool.query('SELECT COUNT(*) AS total FROM pqrs');
      for (const [bytes, name, mime] of [
        [Buffer.from('no es un pdf'), 'prueba.pdf', 'application/pdf'],
        [pdfBytes, 'prueba.png', 'image/png'], [pdfBytes, 'prueba.html', 'text/html'],
        [pngBytes, 'prueba.png', 'application/pdf']
      ]) {
        assert.equal((await publicClient('/pqrs/nueva', await attachmentForm(bytes, name, mime))).status, 400);
      }
      const multiple = await attachmentForm(pdfBytes, 'uno.pdf', 'application/pdf');
      multiple.append('adjunto', new Blob([pdfBytes], { type: 'application/pdf' }), 'dos.pdf');
      assert.equal((await publicClient('/pqrs/nueva', multiple)).status, 400);
      const [[after]] = await pool.query('SELECT COUNT(*) AS total FROM pqrs');
      assert.equal(before.total, after.total);
    });
    await t.test('Un fallo del almacenamiento del adjunto revierte solicitud e historial', async () => {
      const [[before]] = await pool.query('SELECT COUNT(*) AS total FROM pqrs');
      const [[historyBefore]] = await pool.query('SELECT COUNT(*) AS total FROM historial_pqrs');
      await pool.query("CREATE TRIGGER reject_test_attachment BEFORE INSERT ON adjunto_pqrs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fallo controlado de adjunto'");
      try {
        await assert.rejects(require('../src/services/pqrsService').createPqrs(pool, {
          ...payload, adjunto: { buffer: pdfBytes, mimetype: 'application/pdf' }
        }), /Fallo controlado de adjunto/);
      } finally {
        await pool.query('DROP TRIGGER reject_test_attachment');
      }
      const [[after]] = await pool.query('SELECT COUNT(*) AS total FROM pqrs');
      const [[historyAfter]] = await pool.query('SELECT COUNT(*) AS total FROM historial_pqrs');
      assert.equal(after.total, before.total);
      assert.equal(historyAfter.total, historyBefore.total);
    });
    await t.test('Límite exacto de 10 MB: acepta el máximo y rechaza un byte adicional', async () => {
      const max = 10 * 1024 * 1024;
      const bytes = Buffer.alloc(max, 32);
      pdfBytes.copy(bytes);
      const response = await publicClient('/pqrs/nueva', await attachmentForm(bytes, 'limite.pdf', 'application/pdf'));
      assert.equal(response.status, 302);
      const confirmation = await publicClient('/pqrs/registrada');
      const ticket = confirmation.html.match(/SER-[A-F0-9]{24}/)[0];
      const [[row]] = await pool.execute('SELECT id_pqrs FROM pqrs WHERE ticket = ?', [ticket]);
      assert.equal((await adminClient(`/admin/pqrs/${row.id_pqrs}/adjunto`)).bytes.length, max);
      const oversized = await publicClient('/pqrs/nueva', await attachmentForm(Buffer.concat([bytes, Buffer.from('x')]), 'grande.pdf', 'application/pdf'));
      assert.equal(oversized.status, 400);
      assert.match(oversized.html, /supera el máximo de 10 MB/);
      await adminClient(`/admin/pqrs/${row.id_pqrs}/eliminar`, {});
    });
    await t.test('La cola no notifica registros antiguos y persiste fallos sin perder el ticket', async () => {
      const { processNotification } = require('../src/services/notificationService');
      const [[legacyNotifications]] = await pool.execute('SELECT COUNT(*) AS total FROM notificacion_pqrs WHERE id_pqrs = ?', [legacy.insertId]);
      assert.equal(legacyNotifications.total, 0);
      const [[job]] = await pool.query("SELECT * FROM notificacion_pqrs WHERE estado = 'pendiente' ORDER BY id_notificacion LIMIT 1");
      const settings = { user: 'sender@example.test' };
      const errors = [];
      await processNotification(pool, { sendMail: async () => {
        const error = new Error('No publicar esta informacion');
        error.code = 'EAUTH';
        throw error;
      } }, settings, { error: message => errors.push(message) });
      const [[failed]] = await pool.execute('SELECT * FROM notificacion_pqrs WHERE id_notificacion = ?', [job.id_notificacion]);
      assert.equal(failed.estado, 'pendiente');
      assert.equal(failed.intentos, 1);
      assert.equal(failed.ultimo_error, 'EAUTH');
      assert.ok(failed.proximo_intento > new Date(Date.now() - 1000));
      assert.equal(errors.length, 1);
      assert.equal(errors[0].includes('No publicar'), false);
      assert.ok(await require('../src/services/pqrsService').getPqrsById(pool, job.id_pqrs));
      await pool.execute('UPDATE notificacion_pqrs SET proximo_intento = NOW() WHERE id_notificacion = ?', [job.id_notificacion]);
      const messages = [];
      const transport = { sendMail: async message => {
        messages.push(message);
        return { accepted: [message.to.address], rejected: [] };
      } };
      await Promise.all([processNotification(pool, transport, settings), processNotification(pool, transport, settings)]);
      assert.equal(messages.filter(message => message.to.address === job.destinatario && message.messageId.includes(`-${job.id_notificacion}@`)).length, 1);
      const [[sent]] = await pool.execute('SELECT * FROM notificacion_pqrs WHERE id_notificacion = ?', [job.id_notificacion]);
      assert.equal(sent.estado, 'enviada');
      assert.equal(sent.intentos, 2);
      assert.equal(sent.ultimo_error, null);
      while (await processNotification(pool, transport, settings)) {}
      const sentCount = messages.length;
      assert.equal(await processNotification(pool, transport, settings), false);
      assert.equal(messages.length, sentCount);
      assert.ok(messages.some(message => message.to.address === payload.email_contacto));
      assert.ok(messages.some(message => message.to.address === 'subaseopqrds@elcairo-valle.gov.co'));
      assert.ok(messages.every(message => !message.cc && !message.bcc && !message.attachments));
    });
    await t.test('Un fallo de la cola revierte también ticket e historial', async () => {
      const [[before]] = await pool.query('SELECT COUNT(*) AS total FROM pqrs');
      const [[historyBefore]] = await pool.query('SELECT COUNT(*) AS total FROM historial_pqrs');
      await pool.query("CREATE TRIGGER reject_test_notification BEFORE INSERT ON notificacion_pqrs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fallo controlado de correo'");
      try {
        await assert.rejects(require('../src/services/pqrsService').createPqrs(pool, payload), /Fallo controlado de correo/);
      } finally {
        await pool.query('DROP TRIGGER reject_test_notification');
      }
      assert.equal((await pool.query('SELECT COUNT(*) AS total FROM pqrs'))[0][0].total, before.total);
      assert.equal((await pool.query('SELECT COUNT(*) AS total FROM historial_pqrs'))[0][0].total, historyBefore.total);
    });
    await t.test('Mismo correo institucional y solicitante: una sola notificación', async () => {
      const newId = await require('../src/services/pqrsService').createPqrs(pool, {
        ...payload, email_contacto: 'subaseopqrds@elcairo-valle.gov.co'
      });
      const [rows] = await pool.execute('SELECT * FROM notificacion_pqrs WHERE id_pqrs = ?', [newId]);
      assert.equal(rows.length, 1);
    });
    await t.test('Rechazo SMTP queda pendiente y un envío interrumpido se recupera', async () => {
      const { processNotification } = require('../src/services/notificationService');
      const settings = { user: 'sender@example.test' };
      const errors = [];
      await processNotification(pool, { sendMail: async () => ({ accepted: [], rejected: ['rejected@example.test'] }) }, settings, { error: message => errors.push(message) });
      assert.match(errors[0], /ERECIPIENT/);
      const [[job]] = await pool.query("SELECT * FROM notificacion_pqrs WHERE ultimo_error = 'ERECIPIENT' LIMIT 1");
      assert.equal(job.estado, 'pendiente');
      await pool.execute(
        "UPDATE notificacion_pqrs SET estado = 'enviando', bloqueo = ?, proximo_intento = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id_notificacion = ?",
        [randomBytes(18).toString('hex'), job.id_notificacion]
      );
      await processNotification(pool, { sendMail: async message => ({ accepted: [message.to.address], rejected: [] }) }, settings);
      const [[recovered]] = await pool.execute('SELECT estado, intentos FROM notificacion_pqrs WHERE id_notificacion = ?', [job.id_notificacion]);
      assert.equal(recovered.estado, 'enviada');
      assert.equal(recovered.intentos, 2);
    });
    await t.test('La eliminación administrativa limpia respuestas, historial y notificaciones', async () => {
      await adminClient(`/admin/pqrs/${id}/eliminar`, {});
      assert.equal(await require('../src/services/pqrsService').getPqrsById(pool, id), null);
      assert.deepEqual(await require('../src/services/pqrsService').getResponsesByPqrs(pool, id), []);
      assert.deepEqual(await require('../src/services/pqrsService').getHistoryByPqrs(pool, id), []);
      assert.deepEqual((await pool.execute('SELECT * FROM notificacion_pqrs WHERE id_pqrs = ?', [id]))[0], []);
    });
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.end();
  }
});
