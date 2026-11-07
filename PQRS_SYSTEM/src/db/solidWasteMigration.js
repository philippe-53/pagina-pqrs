const { randomBytes } = require('crypto');

function generateTicket() {
  return `SER-${randomBytes(12).toString('hex').toUpperCase()}`;
}

async function migrateSolidWaste(pool) {
  const [columns] = await pool.execute(
    'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    ['pqrs']
  );
  const existing = new Map(columns.map(column => [column.COLUMN_NAME, column]));
  for (const name of ['id_persona', 'id_unidad']) {
    const column = existing.get(name);
    if (column && column.IS_NULLABLE === 'NO') {
      if (!/^(?:int|bigint|smallint|mediumint)(?:\(\d+\))?(?: unsigned)?$/i.test(column.COLUMN_TYPE)) {
        throw new Error(`Tipo de columna no compatible para migrar ${name}`);
      }
      await pool.query(`ALTER TABLE pqrs MODIFY COLUMN ${name} ${column.COLUMN_TYPE} NULL`);
    }
  }
  const additions = {
    ticket: 'VARCHAR(28) NULL',
    nombre_contacto: 'VARCHAR(150) NULL',
    email_contacto: 'VARCHAR(150) NULL',
    telefono_contacto: 'VARCHAR(30) NULL',
    direccion: 'VARCHAR(255) NULL',
    servicio: 'VARCHAR(80) NULL',
    submission_key: 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL',
    tipo_documento: 'VARCHAR(40) NULL',
    numero_documento: 'VARCHAR(30) NULL',
    grupo_etnico: 'VARCHAR(60) NULL'
  };
  for (const [name, definition] of Object.entries(additions)) {
    if (!existing.has(name)) {
      await pool.query(`ALTER TABLE pqrs ADD COLUMN ${name} ${definition}`);
    }
  }
  const [indexes] = await pool.query("SHOW INDEX FROM pqrs WHERE Key_name = 'uq_pqrs_ticket'");
  if (!indexes.length) {
    await pool.query('ALTER TABLE pqrs ADD UNIQUE KEY uq_pqrs_ticket (ticket)');
  }
  const [submissionIndexes] = await pool.query("SHOW INDEX FROM pqrs WHERE Key_name = 'uq_pqrs_submission'");
  if (!submissionIndexes.length) {
    await pool.query('ALTER TABLE pqrs ADD UNIQUE KEY uq_pqrs_submission (submission_key)');
  }
  const [pending] = await pool.query('SELECT id_pqrs FROM pqrs WHERE ticket IS NULL');
  for (const row of pending) {
    await pool.execute('UPDATE pqrs SET ticket = ? WHERE id_pqrs = ? AND ticket IS NULL', [generateTicket(), row.id_pqrs]);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS adjunto_pqrs (
    id_pqrs INT UNSIGNED NOT NULL PRIMARY KEY,
    nombre VARCHAR(180) NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    contenido MEDIUMBLOB NOT NULL,
    CONSTRAINT fk_adjunto_pqrs FOREIGN KEY (id_pqrs) REFERENCES pqrs (id_pqrs) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notificacion_pqrs (
    id_notificacion INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id_pqrs INT UNSIGNED NOT NULL,
    destinatario VARCHAR(254) NOT NULL,
    estado ENUM('pendiente', 'enviando', 'enviada') NOT NULL DEFAULT 'pendiente',
    intentos INT UNSIGNED NOT NULL DEFAULT 0,
    proximo_intento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    bloqueo CHAR(36) NULL,
    enviada_en DATETIME NULL,
    ultimo_error VARCHAR(50) NULL,
    UNIQUE KEY uq_notificacion_destinatario (id_pqrs, destinatario),
    KEY idx_notificacion_pendiente (estado, proximo_intento),
    CONSTRAINT fk_notificacion_pqrs FOREIGN KEY (id_pqrs) REFERENCES pqrs (id_pqrs) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
}

module.exports = { migrateSolidWaste, generateTicket };
