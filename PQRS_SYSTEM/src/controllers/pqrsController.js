const { setFlash } = require('../middleware/auth');
const { types } = require('../utils/pqrsValidation');
const { buildFilters } = require('../utils/pqrsFilters');
const {
  listPqrs,
  getPqrsById,
  createPqrs,
  updatePqrs,
  deletePqrs,
  getStateOptions,
  getUnitsForPersona,
  getAllUnits,
  getHistoryByPqrs,
  normalizeStateValue
} = require('../services/pqrsService');

// Valida los campos minimos de una PQRS antes de enviar el SQL.
function validatePqrsInput(body, requireUnit = true) {
  const errors = [];
  if (!types.includes(body.tipo)) errors.push('Seleccione un tipo de PQRS válido.');
  if (!String(body.asunto || '').trim()) errors.push('El asunto es obligatorio.');
  if (!String(body.descripcion || '').trim()) errors.push('La descripción es obligatoria.');
  if (requireUnit && !String(body.id_unidad || '').trim()) errors.push('Debe seleccionar una unidad.');
  if (String(body.asunto || '').length > 180) errors.push('El asunto admite hasta 180 caracteres.');
  if (String(body.descripcion || '').length > 5000) errors.push('La descripción admite hasta 5000 caracteres.');
  if (String(body.direccion || '').length > 255) errors.push('La dirección admite hasta 255 caracteres.');
  return errors;
}

// Lista PQRS para el panel administrativo.
async function renderAdminList(req, res, next, pool) {
  try {
    const filters = buildFilters(req.query);
    const pqrs = await listPqrs(pool, { role: 'ADMINISTRADOR', ...filters });
    const states = await getStateOptions(pool);

    return res.render('admin/pqrs/index', {
      title: 'Gestión de PQRS',
      pqrs,
      filters,
      states
    });
  } catch (error) {
    return next(error);
  }
}

// Lista PQRS visibles para el residente autenticado.
async function renderResidentList(req, res, next, pool) {
  try {
    const filters = buildFilters(req.query);
    const pqrs = await listPqrs(pool, { role: 'RESIDENTE', idPersona: req.session.user.idPersona, ...filters });
    const states = await getStateOptions(pool);

    return res.render('resident/pqrs/index', {
      title: 'Mis PQRS',
      pqrs,
      filters,
      states
    });
  } catch (error) {
    return next(error);
  }
}

function normalizeCurrentState(pqrs) {
  return normalizeStateValue(pqrs.estado_pqrs || pqrs.estado_nombre);
}

function canResidentViewDetail(pqrs) {
  const currentState = normalizeCurrentState(pqrs);
  return ['En proceso', 'Solucionado'].includes(currentState);
}

// Renderiza el formulario de nueva PQRS para el administrador.
async function renderAdminCreate(req, res, next, pool) {
  try {
    const states = await getStateOptions(pool);
    const units = await getAllUnits(pool);
    return res.render('admin/pqrs/form', {
      title: 'Nueva PQRS',
      pqrs: null,
      states,
      units,
      mode: 'create',
      canEditState: true,
      initialState: 'Abierto',
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

// Renderiza el formulario de nueva PQRS para el residente.
async function renderResidentCreate(req, res, next, pool) {
  try {
    const states = await getStateOptions(pool);
    const units = await getUnitsForPersona(pool, req.session.user.idPersona);
    return res.render('resident/pqrs/form', {
      title: 'Crear PQRS',
      pqrs: null,
      states,
      units,
      mode: 'create',
      canEditState: false,
      initialState: 'Abierto',
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

// Inserta una PQRS y aplica la regla de negocio del rol correspondiente.
async function handleCreate(req, res, next, pool, role) {
  try {
    const errors = validatePqrsInput(req.body);
    if (errors.length) {
      const states = await getStateOptions(pool);
      const units = role === 'ADMINISTRADOR' ? await getAllUnits(pool) : await getUnitsForPersona(pool, req.session.user.idPersona);
      return res.status(400).render(role === 'ADMINISTRADOR' ? 'admin/pqrs/form' : 'resident/pqrs/form', {
        title: 'Crear PQRS',
        pqrs: req.body,
        states,
        units,
        mode: 'create',
        canEditState: role === 'ADMINISTRADOR',
        initialState: normalizeStateValue(req.body.estado_pqrs || 'Abierto'),
        errors
      });
    }

    // Si el creador es un residente, validar que la unidad está ocupada y marcar como 'Abierto'
    if (role === 'RESIDENTE') {
      const ocupada = await require('../services/pqrsService').isUnitOccupied(pool, Number(req.body.id_unidad));
      if (!ocupada) {
        const states = await getStateOptions(pool);
        const units = await getUnitsForPersona(pool, req.session.user.idPersona);
        return res.status(400).render('resident/pqrs/form', {
          title: 'Crear PQRS',
          pqrs: req.body,
          states,
          units,
          mode: 'create',
          canEditState: false,
          initialState: 'Abierto',
          errors: ['No se puede crear PQRS para unidades sin responsable (unidad no ocupada).']
        });
      }
    }

    await createPqrs(pool, {
      id_persona: role === 'ADMINISTRADOR' ? Number(req.body.id_persona || req.session.user.idPersona) : req.session.user.idPersona,
      id_unidad: Number(req.body.id_unidad),
      tipo: String(req.body.tipo).trim(),
      asunto: String(req.body.asunto).trim(),
      descripcion: String(req.body.descripcion).trim(),
      fecha_creacion: req.body.fecha_creacion || null,
      estado_pqrs: role === 'ADMINISTRADOR' ? req.body.estado_pqrs : 'Abierto'
    });

    setFlash(req, 'success', 'La PQRS fue registrada correctamente.');
    return res.redirect(role === 'ADMINISTRADOR' ? '/admin/pqrs' : '/resident/pqrs');
  } catch (error) {
    return next(error);
  }
}

// Muestra detalle de una PQRS y las respuestas asociadas (admin / residente).
async function renderDetail(req, res, next, pool, role) {
  try {
    const pqrs = await getPqrsById(pool, req.params.id);
    if (!pqrs) {
      setFlash(req, 'error', 'La PQRS solicitada no existe.');
      return res.redirect(role === 'ADMINISTRADOR' ? '/admin/pqrs' : '/resident/pqrs');
    }

    if (role === 'RESIDENTE' && pqrs.id_persona !== req.session.user.idPersona) {
      return res.status(403).render('errors/forbidden', { title: 'Acceso restringido' });
    }

    if (role === 'RESIDENTE' && !canResidentViewDetail(pqrs)) {
      return res.status(403).render('errors/forbidden', { title: 'Acceso restringido' });
    }

    const responses = await require('../services/pqrsService').getResponsesByPqrs(pool, req.params.id);
    const history = await getHistoryByPqrs(pool, req.params.id);
    const [attachments] = await pool.execute('SELECT nombre FROM adjunto_pqrs WHERE id_pqrs = ?', [req.params.id]);
    const states = await getStateOptions(pool);
    return res.render(role === 'ADMINISTRADOR' ? 'admin/pqrs/detail' : 'resident/pqrs/detail', {
      title: 'Detalle PQRS',
      pqrs,
      responses,
      history,
      attachment: attachments[0] || null,
      states,
      currentState: normalizeCurrentState(pqrs),
      canRespond: role === 'ADMINISTRADOR' && normalizeCurrentState(pqrs) !== 'Solucionado'
    });
  } catch (error) {
    return next(error);
  }
}

// Permite al administrador añadir una respuesta oficial a una PQRS.
async function handleAddResponse(req, res, next, pool) {
  try {
    const idPqrs = Number(req.params.id);
    const respuesta = String(req.body.respuesta || '').trim();
    const nuevoEstado = req.body.nuevo_estado || null;
    const pqrs = await getPqrsById(pool, idPqrs);

    if (nuevoEstado && !['Abierto', 'En proceso', 'Solucionado'].includes(nuevoEstado)) {
      setFlash(req, 'error', 'Seleccione un estado válido.');
      return res.redirect(`/admin/pqrs/${idPqrs}`);
    }

    if (!respuesta) {
      setFlash(req, 'error', 'La respuesta no puede estar vacía.');
      return res.redirect(`/admin/pqrs/${idPqrs}`);
    }

    if (!pqrs) {
      setFlash(req, 'error', 'La PQRS solicitada no existe.');
      return res.redirect('/admin/pqrs');
    }

    if (normalizeCurrentState(pqrs) === 'Solucionado') {
      setFlash(req, 'error', 'No puede adjuntar más respuestas a una PQRS solucionada.');
      return res.redirect(`/admin/pqrs/${idPqrs}`);
    }

    await require('../services/pqrsService').addResponse(pool, idPqrs, req.session.user.idPersona, respuesta, nuevoEstado || null);
    setFlash(req, 'success', 'Respuesta registrada correctamente.');
    return res.redirect(`/admin/pqrs/${idPqrs}`);
  } catch (error) {
    return next(error);
  }
}

// Carga la PQRS para edición y verifica permisos y estado.
async function renderEdit(req, res, next, pool, role) {
  try {
    const pqrs = await getPqrsById(pool, req.params.id);
    if (!pqrs) {
      setFlash(req, 'error', 'La PQRS solicitada no existe.');
      return res.redirect(role === 'ADMINISTRADOR' ? '/admin/pqrs' : '/resident/pqrs');
    }

    if (role === 'RESIDENTE' && pqrs.id_persona !== req.session.user.idPersona) {
      return res.status(403).render('errors/forbidden', { title: 'Acceso restringido' });
    }

    if (role === 'RESIDENTE' && normalizeStateValue(pqrs.estado_pqrs || pqrs.estado_nombre) !== 'Abierto') {
      setFlash(req, 'error', 'Solo puede editar PQRS que estén abiertas.');
      return res.redirect('/resident/pqrs');
    }

    const states = await getStateOptions(pool);
    const units = role === 'ADMINISTRADOR' ? await getAllUnits(pool) : await getUnitsForPersona(pool, req.session.user.idPersona);

    return res.render(role === 'ADMINISTRADOR' ? 'admin/pqrs/form' : 'resident/pqrs/form', {
      title: 'Editar PQRS',
      pqrs,
      states,
      units,
      mode: 'edit',
      canEditState: role === 'ADMINISTRADOR',
      initialState: normalizeStateValue(pqrs.estado_pqrs || pqrs.estado_nombre),
      errors: []
    });
  } catch (error) {
    return next(error);
  }
}

// Actualiza una PQRS respetando restricciones por rol y estado.
async function handleUpdate(req, res, next, pool, role) {
  try {
    const pqrs = await getPqrsById(pool, req.params.id);
    if (!pqrs) {
      setFlash(req, 'error', 'La PQRS solicitada no existe.');
      return res.redirect(role === 'ADMINISTRADOR' ? '/admin/pqrs' : '/resident/pqrs');
    }

    if (role === 'RESIDENTE' && pqrs.id_persona !== req.session.user.idPersona) {
      return res.status(403).render('errors/forbidden', { title: 'Acceso restringido' });
    }

    if (role === 'RESIDENTE' && normalizeStateValue(pqrs.estado_pqrs || pqrs.estado_nombre) !== 'Abierto') {
      setFlash(req, 'error', 'Solo puede actualizar PQRS abiertas.');
      return res.redirect('/resident/pqrs');
    }

    const errors = validatePqrsInput(req.body, role === 'RESIDENTE');
    if (role === 'ADMINISTRADOR' && !['Abierto', 'En proceso', 'Solucionado'].includes(req.body.estado_pqrs)) {
      errors.push('Seleccione un estado válido.');
    }
    if (errors.length) {
      const states = await getStateOptions(pool);
      const units = role === 'ADMINISTRADOR' ? await getAllUnits(pool) : await getUnitsForPersona(pool, req.session.user.idPersona);
      return res.status(400).render(role === 'ADMINISTRADOR' ? 'admin/pqrs/form' : 'resident/pqrs/form', {
        title: 'Editar PQRS',
        pqrs: { ...pqrs, ...req.body },
        states,
        units,
        mode: 'edit',
        canEditState: role === 'ADMINISTRADOR',
        initialState: normalizeStateValue(req.body.estado_pqrs || pqrs.estado_pqrs),
        errors
      });
    }

    const updateData = {
      id_unidad: pqrs.id_unidad,
      tipo: String(req.body.tipo).trim(),
      asunto: String(req.body.asunto).trim(),
      descripcion: String(req.body.descripcion).trim()
    };

    if (role === 'ADMINISTRADOR') {
      updateData.direccion = String(req.body.direccion || '').trim();
      updateData.estado_pqrs = req.body.estado_pqrs || pqrs.estado_pqrs;
    }

    await updatePqrs(pool, req.params.id, updateData);
    setFlash(req, 'success', 'La PQRS fue actualizada correctamente.');
    return res.redirect(role === 'ADMINISTRADOR' ? '/admin/pqrs' : '/resident/pqrs');
  } catch (error) {
    return next(error);
  }
}

// Elimina una PQRS solamente desde el flujo administrativo.
async function handleDelete(req, res, next, pool) {
  try {
    await deletePqrs(pool, req.params.id);
    setFlash(req, 'success', 'La PQRS fue eliminada.');
    return res.redirect('/admin/pqrs');
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  renderAdminList,
  renderResidentList,
  renderAdminCreate,
  renderResidentCreate,
  handleCreate,
  renderEdit,
  handleUpdate,
  handleDelete,
  renderDetail,
  handleAddResponse
};