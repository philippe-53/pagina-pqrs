const { normalizeText } = require('../utils/sql');
const { generateTicket } = require('../db/solidWasteMigration');
const { withTransaction } = require('../utils/transaction');
const { enqueueNotifications } = require('./notificationService');

// Mapea el criterio de ordenamiento visible en la interfaz al campo SQL real.
function mapSortField(sortBy) {
  switch (sortBy) {
    case 'asunto':
      return 'pq.asunto';
    case 'tipo':
      return 'pq.tipo';
    case 'estado':
      return 'COALESCE(pq.estado_pqrs, ep.nombre)';
    case 'solicitante':
      return "COALESCE(pq.nombre_contacto, per.nombres)";
    case 'unidad':
      return 'COALESCE(pq.direccion, u.numero)';
    case 'fecha':
    default:
      return 'pq.fecha_creacion';
  }
}

const allowedStateNames = ['Abierto', 'En proceso', 'Solucionado'];

// Normaliza estados de entrada para unificar variantes como "abierta" o "cerrado".
function normalizeStateValue(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'abierta' || normalized === 'abierto') {
    return 'Abierto';
  }
  if (normalized === 'en proceso' || normalized === 'proceso') {
    return 'En proceso';
  }
  if (normalized === 'solucionado' || normalized === 'resuelto') {
    return 'Solucionado';
  }
  if (normalized === 'cerrado' || normalized === 'cerrada') {
    return 'Solucionado';
  }
  return 'Abierto';
}

// Obtiene el id del estado para relacionarlo con la PQRS.
async function getStateIdByName(pool, name) {
  const [rows] = await pool.execute('SELECT id_estado FROM estado_pqrs WHERE LOWER(nombre) = LOWER(?) LIMIT 1', [name]);
  return rows.length ? rows[0].id_estado : null;
}

// Lista los estados disponibles para formularios y filtros.
async function getStateOptions(pool) {
  const [rows] = await pool.execute(
    `SELECT id_estado, nombre, descripcion
     FROM estado_pqrs
     WHERE nombre IN (${allowedStateNames.map(() => '?').join(', ')})
     ORDER BY id_estado ASC`,
    allowedStateNames
  );
  return rows;
}

// Lista PQRS con filtros, busqueda y ordenamiento usando JOIN con tablas del dominio.
async function listPqrs(pool, filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.role === 'RESIDENTE') {
    conditions.push('pq.id_persona = ?');
    params.push(filters.idPersona);
  }

  if (filters.estado) {
    conditions.push('(LOWER(pq.estado_pqrs) = LOWER(?) OR LOWER(ep.nombre) = LOWER(?))');
    params.push(filters.estado, filters.estado);
  }

  if (filters.tipo) {
    conditions.push('LOWER(pq.tipo) = LOWER(?)');
    params.push(filters.tipo);
  }

  if (filters.q) {
    const q = `%${String(filters.q).trim()}%`;
    conditions.push('(pq.asunto LIKE ? OR pq.descripcion LIKE ? OR pq.estado_pqrs LIKE ? OR per.nombres LIKE ? OR per.apellidos LIKE ? OR u.numero LIKE ? OR pq.ticket LIKE ? OR pq.nombre_contacto LIKE ? OR pq.direccion LIKE ?)');
    params.push(q, q, q, q, q, q, q, q, q);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderField = mapSortField(filters.sortBy);
  const orderDirection = String(filters.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const [rows] = await pool.execute(
    `SELECT pq.id_pqrs, pq.id_persona, pq.id_unidad, pq.id_estado, pq.tipo, pq.asunto, pq.descripcion,
            pq.fecha_creacion, pq.estado_pqrs, pq.ticket, pq.direccion, pq.servicio,
            ep.nombre AS estado_nombre,
            COALESCE(pq.nombre_contacto, CONCAT(per.nombres, ' ', per.apellidos)) AS solicitante,
            COALESCE(pq.email_contacto, per.email) AS email, COALESCE(pq.telefono_contacto, per.telefono) AS telefono,
            u.numero AS unidad
     FROM pqrs pq
     LEFT JOIN persona per ON per.id_persona = pq.id_persona
     LEFT JOIN unidad u ON u.id_unidad = pq.id_unidad
     INNER JOIN estado_pqrs ep ON ep.id_estado = pq.id_estado
     ${whereClause}
     ORDER BY ${orderField} ${orderDirection}, pq.id_pqrs DESC`,
    params
  );

  return rows;
}

// Lista PQRS sin consultar datos personales para cuentas de solo lectura.
async function listPqrsForConsultation(pool, filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.estado) {
    conditions.push('(LOWER(pq.estado_pqrs) = LOWER(?) OR LOWER(ep.nombre) = LOWER(?))');
    params.push(filters.estado, filters.estado);
  }
  if (filters.tipo) {
    conditions.push('LOWER(pq.tipo) = LOWER(?)');
    params.push(filters.tipo);
  }
  if (filters.q) {
    const query = `%${String(filters.q).trim()}%`;
    conditions.push('(pq.ticket LIKE ? OR pq.asunto LIKE ? OR pq.descripcion LIKE ? OR pq.tipo LIKE ? OR pq.estado_pqrs LIKE ?)');
    params.push(query, query, query, query, query);
  }

  const orderFields = {
    asunto: 'pq.asunto',
    estado: 'COALESCE(pq.estado_pqrs, ep.nombre)',
    tipo: 'pq.tipo',
    fecha: 'pq.fecha_creacion'
  };
  const orderField = orderFields[filters.sortBy] || orderFields.fecha;
  const orderDirection = String(filters.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.execute(
    `SELECT pq.id_pqrs, pq.ticket, pq.asunto, pq.tipo, pq.fecha_creacion,
            COALESCE(pq.estado_pqrs, ep.nombre) AS estado
     FROM pqrs pq
     INNER JOIN estado_pqrs ep ON ep.id_estado = pq.id_estado
     ${whereClause}
     ORDER BY ${orderField} ${orderDirection}, pq.id_pqrs DESC`,
    params
  );
  return rows;
}

// Obtiene únicamente los campos autorizados para lectura limitada de una PQRS.
async function getPqrsForConsultation(pool, idPqrs) {
  const [rows] = await pool.execute(
    `SELECT pq.id_pqrs, pq.ticket, pq.tipo, pq.asunto, pq.descripcion, pq.fecha_creacion,
            COALESCE(pq.estado_pqrs, ep.nombre) AS estado
     FROM pqrs pq
     INNER JOIN estado_pqrs ep ON ep.id_estado = pq.id_estado
     WHERE pq.id_pqrs = ?
     LIMIT 1`,
    [idPqrs]
  );
  return rows[0] || null;
}

async function getConsultationHistory(pool, idPqrs) {
  const [rows] = await pool.execute(
    `SELECT h.fecha, e.nombre AS estado
     FROM historial_pqrs h
     INNER JOIN estado_pqrs e ON e.id_estado = h.id_estado
     WHERE h.id_pqrs = ?
     ORDER BY h.fecha ASC, h.id_historial ASC`,
    [idPqrs]
  );
  return rows;
}

async function getConsultationResponses(pool, idPqrs) {
  const [rows] = await pool.execute(
    'SELECT fecha, respuesta FROM respuesta_pqrs WHERE id_pqrs = ? ORDER BY fecha DESC, id_respuesta DESC',
    [idPqrs]
  );
  return rows;
}

// Recupera el detalle de una PQRS con sus relaciones principales.
async function getPqrsById(pool, idPqrs) {
  const [rows] = await pool.execute(
    `SELECT pq.id_pqrs, pq.id_persona, pq.id_unidad, pq.id_estado, pq.tipo, pq.asunto, pq.descripcion,
            pq.fecha_creacion, pq.estado_pqrs, pq.ticket, pq.direccion, pq.servicio,
            pq.tipo_documento, pq.numero_documento, pq.grupo_etnico,
            ep.nombre AS estado_nombre,
            COALESCE(pq.nombre_contacto, CONCAT(per.nombres, ' ', per.apellidos)) AS solicitante,
            COALESCE(pq.email_contacto, per.email) AS email, COALESCE(pq.telefono_contacto, per.telefono) AS telefono,
            u.numero AS unidad,
            u.id_unidad
     FROM pqrs pq
     LEFT JOIN persona per ON per.id_persona = pq.id_persona
     LEFT JOIN unidad u ON u.id_unidad = pq.id_unidad
     INNER JOIN estado_pqrs ep ON ep.id_estado = pq.id_estado
     WHERE pq.id_pqrs = ?
     LIMIT 1`,
    [idPqrs]
  );

  return rows[0] || null;
}

// Devuelve las unidades asociadas a una persona responsable.
async function getUnitsForPersona(pool, idPersona) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT u.id_unidad, u.numero, tu.nombre AS tipo_unidad, c.nombre AS conjunto
     FROM responsable r
     INNER JOIN unidad u ON u.id_unidad = r.id_unidad
     INNER JOIN piso p ON p.id_piso = u.id_piso
     INNER JOIN torre t ON t.id_torre = p.id_torre
     INNER JOIN conjunto c ON c.id_conjunto = t.id_conjunto
     INNER JOIN tipo_unidad tu ON tu.id_tipo_unidad = u.id_tipo_unidad
     WHERE r.id_persona = ?
     ORDER BY c.nombre ASC, u.numero ASC`,
    [idPersona]
  );
  return rows;
}

// Devuelve todas las unidades para el administrador.
async function getAllUnits(pool) {
  const [rows] = await pool.execute(
    `SELECT u.id_unidad, u.numero, tu.nombre AS tipo_unidad, c.nombre AS conjunto
     FROM unidad u
     INNER JOIN piso p ON p.id_piso = u.id_piso
     INNER JOIN torre t ON t.id_torre = p.id_torre
     INNER JOIN conjunto c ON c.id_conjunto = t.id_conjunto
     INNER JOIN tipo_unidad tu ON tu.id_tipo_unidad = u.id_tipo_unidad
     ORDER BY c.nombre ASC, u.numero ASC`
  );
  return rows;
}

// Valida si una unidad tiene al menos un responsable activo (ocupada).
async function isUnitOccupied(pool, idUnidad) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM responsable WHERE id_unidad = ? AND LOWER(COALESCE(estado_responsable, '')) = 'activo' LIMIT 1`,
    [idUnidad]
  );
  return rows.length > 0;
}

// Inserta una respuesta oficial sobre una PQRS (usada por administradores).
async function addResponse(pool, idPqrs, idPersona, respuesta, nuevoEstado) {
  return withTransaction(pool, async connection => {
    const [rows] = await connection.execute('SELECT estado_pqrs FROM pqrs WHERE id_pqrs = ? FOR UPDATE', [idPqrs]);
    if (!rows.length || normalizeStateValue(rows[0].estado_pqrs) === 'Solucionado') {
      throw new Error('La PQRS no existe o ya fue solucionada.');
    }
    await connection.execute(
      'INSERT INTO respuesta_pqrs (id_pqrs, id_persona, fecha, respuesta) VALUES (?, ?, CURRENT_DATE, ?)',
      [idPqrs, idPersona, respuesta]
    );

    if (typeof nuevoEstado !== 'undefined' && nuevoEstado !== null) {
      await updatePqrsRecord(connection, idPqrs, { estado_pqrs: nuevoEstado });
    }
  });
}

// Obtiene las respuestas asociadas a una PQRS.
async function getResponsesByPqrs(pool, idPqrs) {
  const [rows] = await pool.execute('SELECT id_pqrs, id_persona, fecha, respuesta FROM respuesta_pqrs WHERE id_pqrs = ? ORDER BY fecha DESC, id_respuesta DESC', [idPqrs]);
  return rows;
}

// Inserta una PQRS y deja un registro inicial en historial_pqrs.
async function createPqrs(pool, data) {
  try {
    return await withTransaction(pool, async connection => {
      const stateName = normalizeStateValue(data.estado_pqrs || 'Abierto');
      const stateId = data.id_estado || (await getStateIdByName(connection, stateName));

      const [result] = await connection.execute(
        `INSERT INTO pqrs (id_persona, id_unidad, id_estado, tipo, asunto, descripcion, fecha_creacion, estado_pqrs,
                      ticket, nombre_contacto, email_contacto, telefono_contacto, direccion, servicio, submission_key,
                      tipo_documento, numero_documento, grupo_etnico)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.id_persona || null, data.id_unidad || null, stateId, data.tipo, data.asunto, data.descripcion,
          data.fecha_creacion || null, stateName, generateTicket(), data.nombre_contacto || null,
          data.email_contacto || null, data.telefono_contacto || null, data.direccion || null, data.servicio || null,
          data.submission_key || null, data.tipo_documento || null, data.numero_documento || null, data.grupo_etnico || null]
      );

      if (stateId) {
        await connection.execute(
          'INSERT INTO historial_pqrs (id_pqrs, id_estado, fecha, comentario) VALUES (?, ?, CURRENT_DATE, ?)',
          [result.insertId, stateId, 'PQRS creada en la plataforma']
        );
      }
      if (data.adjunto) {
        const extension = data.adjunto.mimetype === 'application/pdf' ? 'pdf' : data.adjunto.mimetype === 'image/png' ? 'png' : 'jpg';
        await connection.execute(
          'INSERT INTO adjunto_pqrs (id_pqrs, nombre, tipo, contenido) VALUES (?, ?, ?, ?)',
          [result.insertId, `adjunto.${extension}`, data.adjunto.mimetype, data.adjunto.buffer]
        );
      }

      let email = data.email_contacto;
      if (!email && data.id_persona) {
        const [people] = await connection.execute('SELECT email FROM persona WHERE id_persona = ?', [data.id_persona]);
        email = people[0]?.email;
      }
      await enqueueNotifications(connection, result.insertId, email);
      return result.insertId;
    });
  } catch (error) {
    // El índice único arbitra los reintentos, incluso entre solicitudes concurrentes.
    if (error.code === 'ER_DUP_ENTRY' && data.submission_key) {
      const [rows] = await pool.execute('SELECT id_pqrs FROM pqrs WHERE submission_key = ?', [data.submission_key]);
      if (rows.length) return rows[0].id_pqrs;
    }
    throw error;
  }
}

// Actualiza una PQRS y, si cambia el estado, registra la trazabilidad.
async function updatePqrs(pool, idPqrs, data) {
  return withTransaction(pool, async connection => {
    await connection.execute('SELECT id_pqrs FROM pqrs WHERE id_pqrs = ? FOR UPDATE', [idPqrs]);
    return updatePqrsRecord(connection, idPqrs, data);
  });
}

async function updatePqrsRecord(pool, idPqrs, data) {
  const current = await getPqrsById(pool, idPqrs);
  if (!current) {
    throw new Error('PQRS no encontrada');
  }

  const fields = [];
  const params = [];

  if (typeof data.direccion !== 'undefined') {
    fields.push('direccion = ?');
    params.push(normalizeText(data.direccion));
  }

  if (typeof data.tipo !== 'undefined') {
    fields.push('tipo = ?');
    params.push(normalizeText(data.tipo));
  }

  if (typeof data.asunto !== 'undefined') {
    fields.push('asunto = ?');
    params.push(normalizeText(data.asunto));
  }

  if (typeof data.descripcion !== 'undefined') {
    fields.push('descripcion = ?');
    params.push(normalizeText(data.descripcion));
  }

  if (typeof data.id_unidad !== 'undefined') {
    fields.push('id_unidad = ?');
    params.push(data.id_unidad);
  }

  if (typeof data.estado_pqrs !== 'undefined') {
    const stateName = normalizeStateValue(data.estado_pqrs);
    const stateId = data.id_estado || (await getStateIdByName(pool, stateName));
    fields.push('id_estado = ?');
    params.push(stateId);
    fields.push('estado_pqrs = ?');
    params.push(stateName);

    if (stateId && stateName !== normalizeStateValue(current.estado_pqrs || current.estado_nombre)) {
      await pool.execute('INSERT INTO historial_pqrs (id_pqrs, id_estado, fecha, comentario) VALUES (?, ?, CURRENT_DATE, ?)', [idPqrs, stateId, `Estado actualizado a ${stateName}`]);
    }
  }

  if (!fields.length) {
    return;
  }

  params.push(idPqrs);
  await pool.execute(`UPDATE pqrs SET ${fields.join(', ')} WHERE id_pqrs = ?`, params);
}

async function getHistoryByPqrs(pool, idPqrs) {
  const [rows] = await pool.execute(
    `SELECT h.fecha, h.comentario, e.nombre AS estado
     FROM historial_pqrs h INNER JOIN estado_pqrs e ON e.id_estado = h.id_estado
     WHERE h.id_pqrs = ? ORDER BY h.fecha ASC, h.id_historial ASC`,
    [idPqrs]
  );
  return rows;
}

async function getPublicPqrsByTicket(pool, ticket) {
  const [rows] = await pool.execute(
    'SELECT id_pqrs, ticket, tipo, servicio, fecha_creacion, estado_pqrs FROM pqrs WHERE ticket = ? LIMIT 1',
    [ticket]
  );
  return rows[0] || null;
}

// Elimina una PQRS solo desde el flujo administrativo, borrando antes sus trazas.
async function deletePqrs(pool, idPqrs) {
  return withTransaction(pool, async connection => {
    await connection.execute('DELETE FROM respuesta_pqrs WHERE id_pqrs = ?', [idPqrs]);
    await connection.execute('DELETE FROM historial_pqrs WHERE id_pqrs = ?', [idPqrs]);
    await connection.execute('DELETE FROM pqrs WHERE id_pqrs = ?', [idPqrs]);
  });
}

// Resume datos para el panel administrativo usando la vista del dashboard.
async function getPqrsDashboard(pool) {
  const [rows] = await pool.execute('SELECT * FROM vista_pqrs_dashboard LIMIT 1');
  return rows[0] || { total_pqrs: 0, abiertos: 0, solucionados: 0, en_proceso: 0 };
}

// Agrupa PQRS por estado para reportes.
async function getPqrsByState(pool) {
  const [rows] = await pool.execute(`
    SELECT COALESCE(pq.estado_pqrs, ep.nombre) AS estado, COUNT(*) AS total
    FROM pqrs pq
    INNER JOIN estado_pqrs ep ON ep.id_estado = pq.id_estado
    GROUP BY COALESCE(pq.estado_pqrs, ep.nombre)
    ORDER BY total DESC
  `);
  return rows;
}

// Agrupa PQRS por tipo para reportes.
async function getPqrsByType(pool) {
  const [rows] = await pool.execute(`
    SELECT COALESCE(tipo, 'Sin tipo') AS tipo, COUNT(*) AS total
    FROM pqrs
    GROUP BY COALESCE(tipo, 'Sin tipo')
    ORDER BY total DESC
  `);
  return rows;
}

module.exports = {
  listPqrs,
  listPqrsForConsultation,
  getPqrsForConsultation,
  getConsultationHistory,
  getConsultationResponses,
  getPqrsById,
  createPqrs,
  updatePqrs,
  deletePqrs,
  getPqrsDashboard,
  getPqrsByState,
  getPqrsByType,
  getStateOptions,
  getUnitsForPersona,
  getAllUnits,
  isUnitOccupied,
  addResponse,
  getResponsesByPqrs,
  normalizeStateValue,
  getHistoryByPqrs,
  getPublicPqrsByTicket
};