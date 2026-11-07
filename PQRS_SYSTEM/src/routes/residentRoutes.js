const express = require('express');
const { requireRole } = require('../middleware/auth');
const dashboardController = require('../controllers/dashboardController');
const pqrsController = require('../controllers/pqrsController');

// Rutas del residente enfocadas en sus propias PQRS.
function createResidentRoutes(pool) {
  const router = express.Router();

  router.use(requireRole('RESIDENTE'));

  router.get('/', (req, res, next) => dashboardController.renderResidentDashboard(req, res, next, pool));
  router.get('/pqrs', (req, res, next) => pqrsController.renderResidentList(req, res, next, pool));
  router.get('/pqrs/nueva', (req, res, next) => pqrsController.renderResidentCreate(req, res, next, pool));
  router.post('/pqrs/nueva', (req, res, next) => pqrsController.handleCreate(req, res, next, pool, 'RESIDENTE'));
  router.get('/pqrs/:id', (req, res, next) => pqrsController.renderDetail(req, res, next, pool, 'RESIDENTE'));
  router.get('/pqrs/:id/editar', (req, res, next) => pqrsController.renderEdit(req, res, next, pool, 'RESIDENTE'));
  router.post('/pqrs/:id/editar', (req, res, next) => pqrsController.handleUpdate(req, res, next, pool, 'RESIDENTE'));

  return router;
}

module.exports = createResidentRoutes;