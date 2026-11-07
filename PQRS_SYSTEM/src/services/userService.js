const bcrypt = require('bcryptjs');
const { normalizeText } = require('../utils/sql');
const { withTransaction } = require('../utils/transaction');

// Recupera el perfil completo del usuario autenticado.
async function getUserProfile(pool, idUsuario) {
  const [rows] = await pool.execute(
    `SELECT u.id_usuario, u.id_persona, u.nombre_usuario, u.rol, u.activo, u.creado_en, u.ultimo_acceso,
            p.tipo_doc, p.nro_doc, p.nombres, p.apellidos, p.email, p.telefono, p.estado_persona,
            r.rol AS rol_unidad,
            u2.numero AS numero_unidad,
            c.nombre AS conjunto
     FROM usuario_app u
     INNER JOIN persona p ON p.id_persona = u.id_persona
     LEFT JOIN responsable r ON r.id_persona = p.id_persona
     LEFT JOIN unidad u2 ON u2.id_unidad = r.id_unidad
     LEFT JOIN piso pi ON pi.id_piso = u2.id_piso
     LEFT JOIN torre t ON t.id_torre = pi.id_torre
     LEFT JOIN conjunto c ON c.id_conjunto = t.id_conjunto
     WHERE u.id_usuario = ?
     LIMIT 1`,
    [idUsuario]
  );

  return rows[0] || null;
}

// Lista usuarios del sistema con filtros opcionales.
async function listUsers(pool, filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.q) {
    const q = `%${filters.q}%`;
    conditions.push('(u.nombre_usuario LIKE ? OR p.nombres LIKE ? OR p.apellidos LIKE ? OR p.nro_doc LIKE ? OR p.email LIKE ?)');
    params.push(q, q, q, q, q);
  }

  if (filters.rol) {
    conditions.push('u.rol = ?');
    params.push(filters.rol);
  }

  if (typeof filters.activo !== 'undefined' && filters.activo !== '') {
    conditions.push('u.activo = ?');
    params.push(Number(filters.activo));
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.execute(
    `SELECT u.id_usuario, u.nombre_usuario, u.rol, u.activo, u.creado_en, u.ultimo_acceso,
            p.id_persona, p.nombres, p.apellidos, p.nro_doc, p.email, p.telefono, p.estado_persona,
            (SELECT COUNT(*) FROM pqrs pq WHERE pq.id_persona = p.id_persona) AS total_pqrs
     FROM usuario_app u
     INNER JOIN persona p ON p.id_persona = u.id_persona
     ${whereClause}
     ORDER BY p.nombres ASC, p.apellidos ASC`,
    params
  );

  return rows;
}

// Retorna personas que aun no tienen cuenta en usuario_app.
async function listPersonasWithoutUser(pool) {
  const [rows] = await pool.execute(`
    SELECT p.id_persona, p.nro_doc, CONCAT(p.nombres, ' ', p.apellidos) AS nombre_completo, p.email, p.estado_persona
    FROM persona p
    LEFT JOIN usuario_app u ON u.id_persona = p.id_persona
    WHERE u.id_usuario IS NULL
    ORDER BY p.nombres ASC, p.apellidos ASC
  `);
  return rows;
}

// Crea una cuenta de acceso para una persona seleccionada.
async function createUser(pool, data) {
  const nombreUsuario = normalizeText(data.nombre_usuario);
  const clave = normalizeText(data.clave);
  const rol = normalizeText(data.rol).toUpperCase();
  const person = data.persona;

  if (!nombreUsuario || !clave || (!data.id_persona && !person) || !rol) {
    throw new Error('Datos incompletos para crear el usuario');
  }
  if (!['ADMINISTRADOR', 'CONSULTA_PQRS'].includes(rol)) {
    throw new Error('Rol no permitido para crear usuario');
  }

  const hash = await bcrypt.hash(clave, 10);
  if (person) {
    await withTransaction(pool, async connection => {
      const [personResult] = await connection.execute(
        `INSERT INTO persona (tipo_doc, nro_doc, nombres, apellidos, email, telefono, estado_persona)
         VALUES (?, ?, ?, ?, ?, ?, 'Activo')`,
        [
          person.tipo_doc, normalizeText(person.nro_doc), normalizeText(person.nombres),
          normalizeText(person.apellidos), normalizeText(person.email) || null,
          normalizeText(person.telefono) || null
        ]
      );
      await connection.execute(
        'INSERT INTO usuario_app (id_persona, nombre_usuario, clave_hash, rol, activo) VALUES (?, ?, ?, ?, ?)',
        [personResult.insertId, nombreUsuario, hash, rol, data.activo ? 1 : 0]
      );
    });
    return;
  }

  await pool.execute(
    'INSERT INTO usuario_app (id_persona, nombre_usuario, clave_hash, rol, activo) VALUES (?, ?, ?, ?, ?)',
    [data.id_persona, nombreUsuario, hash, rol, data.activo ? 1 : 0]
  );
}

// Actualiza nombre de usuario, rol, estado o contraseña.
async function updateUser(pool, idUsuario, data) {
  const [existing] = await pool.execute('SELECT id_usuario FROM usuario_app WHERE id_usuario = ?', [idUsuario]);
  if (!existing.length) return false;
  const fields = [];
  const params = [];

  if (data.nombre_usuario) {
    fields.push('nombre_usuario = ?');
    params.push(normalizeText(data.nombre_usuario));
  }

  if (data.rol) {
    const role = normalizeText(data.rol).toUpperCase();
    if (!['ADMINISTRADOR', 'CONSULTA_PQRS', 'RESIDENTE'].includes(role)) {
      throw new Error('Rol no permitido para actualizar usuario');
    }
    fields.push('rol = ?');
    params.push(role);
  }

  if (typeof data.activo !== 'undefined') {
    fields.push('activo = ?');
    params.push(data.activo ? 1 : 0);
  }

  if (data.clave) {
    const hash = await bcrypt.hash(normalizeText(data.clave), 10);
    fields.push('clave_hash = ?');
    params.push(hash);
  }

  if (!fields.length) {
    return true;
  }

  params.push(idUsuario);
  const [result] = await pool.execute(`UPDATE usuario_app SET ${fields.join(', ')} WHERE id_usuario = ?`, params);
  return result.affectedRows > 0;
}

// Resume totales de usuarios para el panel administrativo.
async function getUsersSummary(pool) {
  const [rows] = await pool.execute(`
    SELECT
      COUNT(*) AS total_usuarios,
      SUM(CASE WHEN rol = 'ADMINISTRADOR' THEN 1 ELSE 0 END) AS administradores,
      SUM(CASE WHEN rol = 'RESIDENTE' THEN 1 ELSE 0 END) AS residentes,
      SUM(CASE WHEN activo = 1 THEN 1 ELSE 0 END) AS activos
    FROM usuario_app
  `);
  return rows[0] || { total_usuarios: 0, administradores: 0, residentes: 0, activos: 0 };
}

module.exports = {
  getUserProfile,
  listUsers,
  listPersonasWithoutUser,
  createUser,
  updateUser,
  getUsersSummary
};