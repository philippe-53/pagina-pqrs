const express = require('express');
const controller = require('../controllers/publicController');
const { parseAttachment } = require('../middleware/attachment');

function createPublicRoutes(pool) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  router.post('/pqrs/nueva', parseAttachment, controller.formToken, (req, res, next) => controller.handleCreate(req, res, next, pool));
  router.use(controller.formToken);
  router.get('/', controller.renderHome);
  router.get('/atencion-ciudadano', controller.renderAttention);
  router.get('/quienes-somos', controller.renderAbout);
  router.get('/gestor-normativo', controller.renderRegulatory);
  router.get('/gestor-normativo/ccu/descargar', controller.downloadCcu);
  router.get('/pqrs/nueva', controller.renderCreate);
  router.get('/pqrs/registrada', controller.renderConfirmation);
  router.get('/consultar', controller.renderLookup);
  router.post('/consultar', (req, res, next) => controller.handleLookup(req, res, next, pool));
  return router;
}

module.exports = createPublicRoutes;
