const express = require('express');
const { requireRole } = require('../middleware/auth');
const controller = require('../controllers/consultationController');

function createConsultationRoutes(pool) {
  const router = express.Router();
  router.use(requireRole('CONSULTA_PQRS'));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', (req, res, next) => controller.renderList(req, res, next, pool));
  router.get('/:id', (req, res, next) => controller.renderDetail(req, res, next, pool));
  return router;
}

module.exports = createConsultationRoutes;
