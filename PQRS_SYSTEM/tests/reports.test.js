const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const ExcelJS = require('exceljs');
const createAdminRoutes = require('../src/routes/adminRoutes');
const { types } = require('../src/utils/pqrsValidation');

test('Reportes HTTP: filtros compartidos, columnas Excel, permisos y errores', async t => {
  const records = [
    { ticket: 'SER-PRUEBA', asunto: '=1+1', solicitante: 'Persona de prueba', email: 'qa@example.test',
      telefono: '001234567', direccion: 'Calle 1', servicio: 'Recolección', tipo: 'Queja',
      estado_pqrs: 'Abierto', fecha_creacion: new Date('2026-11-04T01:00:00Z'), descripcion: '+Texto de prueba' },
    { ticket: 'SER-OTRO', asunto: 'Otro caso', tipo: 'Petición', estado_pqrs: 'Solucionado' }
  ];
  const queries = [];
  let fail = false;
  const pool = {
    async execute(sql, params = []) {
      if (fail) throw new Error('Fallo de consulta');
      if (sql.includes('FROM usuario_app')) return [[{ total_usuarios: 2, administradores: 1, residentes: 1, activos: 2 }]];
      if (sql.includes('SELECT id_estado')) return [[{ nombre: 'Abierto' }, { nombre: 'Solucionado' }]];
      queries.push({ sql, params });
      let rows = records;
      if (params.includes('Queja')) rows = rows.filter(row => row.tipo === 'Queja');
      if (params.includes('Abierto')) rows = rows.filter(row => row.estado_pqrs === 'Abierto');
      if (params.includes('%SER-PRUEBA%')) rows = rows.filter(row => row.ticket === 'SER-PRUEBA');
      if (params.includes('%SIN-RESULTADOS%')) rows = [];
      return [rows];
    }
  };
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use((req, res, next) => {
    req.session = { user: req.headers['x-test-role'] ? { role: req.headers['x-test-role'] } : null };
    Object.assign(res.locals, { currentUser: req.session.user, currentPath: req.path, flash: null, appName: 'Serranía SAS ESP', pqrsTypes: types });
    next();
  });
  app.use('/admin', createAdminRoutes(pool));
  app.use((error, req, res, next) => res.status(500).send(error.message));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (url, role = 'ADMINISTRADOR') => fetch(base + url, {
    redirect: 'manual', headers: role ? { 'x-test-role': role } : {}
  });
  try {
    await t.test('La página y Excel usan los mismos filtros y orden', async () => {
      const query = '?q=SER-PRUEBA&estado=Abierto&tipo=Queja&sortBy=asunto&order=asc';
      const page = await get('/admin/reportes' + query);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /Descargar Excel/);
      assert.match(html, /1 PQRS coinciden/);
      assert.ok(!html.includes('SER-OTRO'));
      const response = await get('/admin/reportes/descargar' + query);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('content-disposition'), /reportes-pqrs.xlsx/);
      assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      assert.deepEqual(queries[0].params, queries[1].params);
      assert.match(queries[1].sql, /ORDER BY pq.asunto ASC/);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      const sheet = workbook.getWorksheet('PQRS');
      assert.equal(sheet.rowCount, 2);
      assert.equal(sheet.columnCount, 11);
      assert.equal(sheet.getCell('A1').value, 'Ticket');
      assert.equal(sheet.getCell('B2').value, '=1+1');
      assert.equal(sheet.getCell('B2').type, ExcelJS.ValueType.String);
      assert.equal(sheet.getCell('E2').value, '001234567');
      assert.ok(sheet.getCell('J2').value instanceof Date);
      assert.equal(sheet.getCell('K2').value, '+Texto de prueba');
      assert.equal(sheet.views[0].ySplit, 1);
      assert.ok(sheet.autoFilter);
    });
    await t.test('Sin coincidencias descarga encabezados sin datos', async () => {
      const response = await get('/admin/reportes/descargar?q=SIN-RESULTADOS');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      assert.equal(workbook.getWorksheet('PQRS').rowCount, 1);
    });
    await t.test('Sin filtros descarga todos los resultados', async () => {
      const response = await get('/admin/reportes/descargar');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      assert.equal(workbook.getWorksheet('PQRS').rowCount, 3);
    });
    await t.test('Deniega descarga pública y a residentes', async () => {
      const publicResponse = await get('/admin/reportes/descargar', null);
      assert.equal(publicResponse.status, 302);
      assert.equal(publicResponse.headers.get('location'), '/login');
      assert.equal((await get('/admin/reportes/descargar', 'RESIDENTE')).status, 403);
    });
    await t.test('Un error de consulta no entrega un archivo de éxito', async () => {
      fail = true;
      const response = await get('/admin/reportes/descargar');
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('content-disposition'), null);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
