const { getUserProfile, getUsersSummary } = require('../services/userService');
const { getPqrsDashboard, getPqrsByState, getPqrsByType, listPqrs } = require('../services/pqrsService');

// Renderiza los paneles de administrador y residente con datos agregados del negocio.
async function renderAdminDashboard(req, res, next, pool) {
  try {
    const [summary, usersSummary, pqrsByState, pqrsByType, recentPqrs] = await Promise.all([
      getPqrsDashboard(pool),
      getUsersSummary(pool),
      getPqrsByState(pool),
      getPqrsByType(pool),
      listPqrs(pool, { role: 'ADMINISTRADOR', sortBy: 'fecha', order: 'desc' })
    ]);

    const profile = await getUserProfile(pool, req.session.user.idUsuario);

    return res.render('admin/dashboard', {
      title: 'Panel administrativo',
      summary,
      usersSummary,
      pqrsByState,
      pqrsByType,
      recentPqrs: recentPqrs.slice(0, 5),
      profile
    });
  } catch (error) {
    return next(error);
  }
}

// Resume la actividad personal del residente y sus PQRS recientes.
async function renderResidentDashboard(req, res, next, pool) {
  try {
    const profile = await getUserProfile(pool, req.session.user.idUsuario);
    const myPqrs = await listPqrs(pool, { role: 'RESIDENTE', idPersona: req.session.user.idPersona, sortBy: 'fecha', order: 'desc' });

    const summary = {
      total: myPqrs.length,
      abiertas: myPqrs.filter(item => String(item.estado_pqrs || item.estado_nombre).toLowerCase() === 'abierto').length,
      enProceso: myPqrs.filter(item => String(item.estado_pqrs || item.estado_nombre).toLowerCase() === 'en proceso').length,
      solucionadas: myPqrs.filter(item => String(item.estado_pqrs || item.estado_nombre).toLowerCase() === 'solucionado').length
    };

    return res.render('resident/dashboard', {
      title: 'Panel de residente',
      profile,
      summary,
      recentPqrs: myPqrs.slice(0, 5)
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  renderAdminDashboard,
  renderResidentDashboard
};