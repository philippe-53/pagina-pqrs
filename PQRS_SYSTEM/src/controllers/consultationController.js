const { buildFilters } = require('../utils/pqrsFilters');
const {
  getConsultationHistory,
  getConsultationResponses,
  getPqrsForConsultation,
  getStateOptions,
  listPqrsForConsultation
} = require('../services/pqrsService');

async function renderList(req, res, next, pool) {
  try {
    const filters = buildFilters(req.query);
    const [pqrs, states] = await Promise.all([
      listPqrsForConsultation(pool, filters),
      getStateOptions(pool)
    ]);
    return res.render('consultation/pqrs/index', {
      title: 'Consulta de PQRS',
      pqrs,
      filters,
      states
    });
  } catch (error) {
    return next(error);
  }
}

async function renderDetail(req, res, next, pool) {
  try {
    const pqrs = await getPqrsForConsultation(pool, req.params.id);
    if (!pqrs) {
      return res.status(404).render('errors/not-found', { title: 'PQRS no encontrada' });
    }

    const [history, responses] = await Promise.all([
      getConsultationHistory(pool, pqrs.id_pqrs),
      getConsultationResponses(pool, pqrs.id_pqrs)
    ]);
    return res.render('consultation/pqrs/detail', {
      title: 'Detalle de PQRS',
      pqrs,
      history,
      responses
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { renderList, renderDetail };
