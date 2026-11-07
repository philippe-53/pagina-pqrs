const bcrypt = require('bcryptjs');

// Valida credenciales contra usuario_app y complementa la sesion con datos de persona.
async function authenticateUser(pool, username, password) {
  const [rows] = await pool.execute(
    `SELECT u.id_usuario, u.id_persona, u.nombre_usuario, u.clave_hash, u.rol, u.activo,
            p.nombres, p.apellidos, p.tipo_doc, p.nro_doc, p.email, p.telefono, p.estado_persona
     FROM usuario_app u
     INNER JOIN persona p ON p.id_persona = u.id_persona
     WHERE LOWER(u.nombre_usuario) = LOWER(?)
     LIMIT 1`,
    [username]
  );

  if (rows.length === 0) {
    return null;
  }

  const user = rows[0];
  if (!user.activo) {
    return { disabled: true };
  }

  // La contraseña se valida contra el hash almacenado en la base de datos.
  const valid = await bcrypt.compare(password, user.clave_hash);
  if (!valid) {
    return null;
  }

  // Actualiza el ultimo acceso para dejar trazabilidad del ingreso.
  await pool.execute('UPDATE usuario_app SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id_usuario = ?', [user.id_usuario]);

  return {
    idUsuario: user.id_usuario,
    idPersona: user.id_persona,
    username: user.nombre_usuario,
    role: user.rol,
    fullName: `${user.nombres} ${user.apellidos}`,
    profile: {
      tipoDoc: user.tipo_doc,
      nroDoc: user.nro_doc,
      email: user.email,
      telefono: user.telefono,
      estadoPersona: user.estado_persona
    }
  };
}

module.exports = {
  authenticateUser
};