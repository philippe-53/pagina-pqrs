const bcrypt = require('bcryptjs');
const config = require('../config');
const { migrateSolidWaste } = require('./solidWasteMigration');

const canonicalStates = [
  { name: 'Abierto', description: 'PQRS abierta para gestión y actualización' },
  { name: 'En proceso', description: 'PQRS en revisión o trámite' },
  { name: 'Solucionado', description: 'PQRS resuelta por la administración' }
];

async function ensureState(pool, name, description) {
  const [rows] = await pool.execute('SELECT id_estado FROM estado_pqrs WHERE LOWER(nombre) = LOWER(?) LIMIT 1', [name]);
  if (rows.length === 0) {
    await pool.execute('INSERT INTO estado_pqrs (nombre, descripcion) VALUES (?, ?)', [name, description]);
  }
}

// Asegura que los estados base existan en la tabla estado_pqrs.
async function ensureStates(pool) {
  for (const state of canonicalStates) {
    await ensureState(pool, state.name, state.description);
  }
}

// Elimina el estado legado Cerrado y lo migra a Solucionado si existe.
async function migrateLegacyClosedState(pool) {
  const [closedRows] = await pool.execute("SELECT id_estado FROM estado_pqrs WHERE LOWER(nombre) = 'cerrado' LIMIT 1");
  if (!closedRows.length) {
    return;
  }

  const [solvedRows] = await pool.execute("SELECT id_estado FROM estado_pqrs WHERE LOWER(nombre) = 'solucionado' LIMIT 1");
  if (!solvedRows.length) {
    return;
  }

  const closedId = closedRows[0].id_estado;
  const solvedId = solvedRows[0].id_estado;

  await pool.execute("UPDATE pqrs SET id_estado = ?, estado_pqrs = ? WHERE id_estado = ? OR LOWER(estado_pqrs) = 'cerrado'", [solvedId, 'Solucionado', closedId]);
  await pool.execute('UPDATE historial_pqrs SET id_estado = ? WHERE id_estado = ?', [solvedId, closedId]);
  await pool.execute('DELETE FROM estado_pqrs WHERE id_estado = ?', [closedId]);
}

// Crea el usuario administrador semilla usando la tabla de autenticación ya definida en el DDL.
async function ensureDefaultAdmin(pool) {
  const [personaRows] = await pool.execute(
    'SELECT id_persona FROM persona WHERE LOWER(email) = LOWER(?) OR nro_doc = ?',
    ['admin@gestionconjuntos.local', '900000001']
  );

  let adminPersonaId = personaRows.length ? personaRows[0].id_persona : null;

  if (!adminPersonaId) {
    const [result] = await pool.execute(
      `INSERT INTO persona (tipo_doc, nro_doc, nombres, apellidos, email, telefono, fecha_nacimiento, estado_persona)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['CC', '900000001', 'Administrador', 'General', 'admin@gestionconjuntos.local', '3000000000', '1980-01-01', 'Activo']
    );
    adminPersonaId = result.insertId;
  }

  const [userRows] = await pool.execute('SELECT id_usuario FROM usuario_app WHERE nombre_usuario = ? LIMIT 1', ['admin']);
  if (userRows.length === 0) {
    const hash = await bcrypt.hash(config.defaults.adminPassword, 10);
    await pool.execute(
      'INSERT INTO usuario_app (id_persona, nombre_usuario, clave_hash, rol, activo) VALUES (?, ?, ?, ?, 1)',
      [adminPersonaId, 'admin', hash, 'ADMINISTRADOR']
    );
  }
}

// Conserva las tablas originales y adapta las PQRS al canal público.
async function bootstrapDatabase(pool) {
  await migrateSolidWaste(pool);
  await ensureStates(pool);
  await migrateLegacyClosedState(pool);
  await ensureDefaultAdmin(pool);
}

module.exports = {
  bootstrapDatabase,
  canonicalStates
};