const { setFlash } = require('../middleware/auth');
const {
  listUsers,
  listPersonasWithoutUser,
  createUser,
  updateUser,
  getUsersSummary
} = require('../services/userService');

const creatableRoles = ['ADMINISTRADOR', 'CONSULTA_PQRS'];
const editableRoles = [...creatableRoles, 'RESIDENTE'];
const personDocumentTypes = ['CC', 'CE', 'Pasaporte', 'NIT'];
const personDocumentPattern = /^[A-Za-z0-9][A-Za-z0-9. \-]{2,29}$/;

// Muestra el listado, filtros y resumen de usuarios para el administrador.
async function renderUsersList(req, res, next, pool) {
  try {
    const filters = {
      q: String(req.query.q || '').trim(),
      rol: String(req.query.rol || '').trim(),
      activo: typeof req.query.activo !== 'undefined' ? req.query.activo : ''
    };

    const [users, personas, summary] = await Promise.all([
      listUsers(pool, filters),
      listPersonasWithoutUser(pool),
      getUsersSummary(pool)
    ]);

    return res.render('admin/users/index', {
      title: 'Usuarios del sistema',
      users,
      personas,
      filters,
      summary
    });
  } catch (error) {
    return next(error);
  }
}

// Muestra el formulario para crear una nueva cuenta de acceso.
async function renderUserCreate(req, res, next, pool) {
  try {
    const personas = await listPersonasWithoutUser(pool);
    return res.render('admin/users/form', {
      title: 'Crear usuario',
      mode: 'create',
      user: null,
      personas,
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

// Valida y crea usuarios del sistema sobre la tabla usuario_app.
async function handleUserCreate(req, res, next, pool) {
  try {
    const errors = [];
    const idPersona = String(req.body.id_persona || '').trim();
    const creatingPerson = !idPersona;
    if (!creatingPerson && (!/^\d+$/.test(idPersona) || Number(idPersona) <= 0)) {
      errors.push('Seleccione una persona válida.');
    }
    if (!String(req.body.nombre_usuario || '').trim()) errors.push('El nombre de usuario es obligatorio.');
    if (!String(req.body.clave || '').trim()) errors.push('La contraseña es obligatoria.');
    if (!creatableRoles.includes(req.body.rol)) errors.push('Seleccione Administrador o Consulta de PQRS.');
    if (creatingPerson) {
      if (!personDocumentTypes.includes(req.body.tipo_doc)) errors.push('Seleccione un tipo de documento válido.');
      if (!personDocumentPattern.test(String(req.body.nro_doc || '').trim())) errors.push('Ingrese un documento de 3 a 30 caracteres.');
      if (!String(req.body.nombres || '').trim() || String(req.body.nombres).trim().length > 100) errors.push('Ingrese los nombres (máximo 100 caracteres).');
      if (!String(req.body.apellidos || '').trim() || String(req.body.apellidos).trim().length > 100) errors.push('Ingrese los apellidos (máximo 100 caracteres).');
      const email = String(req.body.email || '').trim();
      if (email && (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.push('Ingrese un correo válido de máximo 150 caracteres.');
      if (String(req.body.telefono || '').length > 30) errors.push('El teléfono admite máximo 30 caracteres.');
    }

    if (errors.length) {
      const personas = await listPersonasWithoutUser(pool);
      return res.status(400).render('admin/users/form', {
        title: 'Crear usuario',
        mode: 'create',
        user: { ...req.body, id_persona: idPersona },
        personas,
        errors
      });
    }

    await createUser(pool, {
      id_persona: creatingPerson ? null : Number(idPersona),
      persona: creatingPerson ? {
        tipo_doc: req.body.tipo_doc,
        nro_doc: String(req.body.nro_doc).trim(),
        nombres: String(req.body.nombres).trim(),
        apellidos: String(req.body.apellidos).trim(),
        email: String(req.body.email || '').trim(),
        telefono: String(req.body.telefono || '').trim()
      } : null,
      nombre_usuario: req.body.nombre_usuario,
      clave: req.body.clave,
      rol: req.body.rol,
      activo: req.body.activo === 'on' || req.body.activo === '1'
    });

    setFlash(req, 'success', 'El usuario fue creado correctamente.');
    return res.redirect('/admin/usuarios');
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'error', 'Ya existe ese nombre de usuario o documento, o la persona ya tiene una cuenta.');
      return res.redirect('/admin/usuarios/nuevo');
    }
    return next(error);
  }
}

// Muestra el formulario de edicion de un usuario existente.
async function renderUserEdit(req, res, next, pool) {
  try {
    const users = await listUsers(pool, { q: '', rol: '', activo: '' });
    const user = users.find(item => String(item.id_usuario) === String(req.params.id));

    if (!user) {
      setFlash(req, 'error', 'El usuario solicitado no existe.');
      return res.redirect('/admin/usuarios');
    }

    return res.render('admin/users/form', {
      title: 'Editar usuario',
      mode: 'edit',
      user,
      personas: [],
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

// Actualiza datos de acceso, rol o estado del usuario.
async function handleUserUpdate(req, res, next, pool) {
  try {
    if (!editableRoles.includes(req.body.rol)) {
      setFlash(req, 'error', 'Seleccione un rol válido.');
      return res.redirect(`/admin/usuarios/${req.params.id}/editar`);
    }

    const updated = await updateUser(pool, req.params.id, {
      nombre_usuario: req.body.nombre_usuario,
      rol: req.body.rol,
      activo: req.body.activo === 'on' || req.body.activo === '1',
      clave: req.body.clave || ''
    });

    if (!updated) {
      setFlash(req, 'error', 'El usuario solicitado no existe.');
      return res.redirect('/admin/usuarios');
    }

    setFlash(req, 'success', 'El usuario fue actualizado correctamente.');
    return res.redirect('/admin/usuarios');
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'error', 'No se pudo guardar porque el nombre de usuario ya existe.');
      return res.redirect(`/admin/usuarios/${req.params.id}/editar`);
    }
    return next(error);
  }
}

module.exports = {
  renderUsersList,
  renderUserCreate,
  handleUserCreate,
  renderUserEdit,
  handleUserUpdate
};