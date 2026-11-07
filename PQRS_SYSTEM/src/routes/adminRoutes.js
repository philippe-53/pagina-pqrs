const express = require('express');
const { requireRole } = require('../middleware/auth');
const dashboardController = require('../controllers/dashboardController');
const pqrsController = require('../controllers/pqrsController');
const userController = require('../controllers/userController');
const reportController = require('../controllers/reportController');
const { downloadAttachment } = require('../controllers/attachmentController');

// Rutas exclusivas del administrador con control total del sistema.
function createAdminRoutes(pool) {
  const router = express.Router();

  router.use(requireRole('ADMINISTRADOR'));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', (req, res, next) => dashboardController.renderAdminDashboard(req, res, next, pool));
  router.get('/pqrs', (req, res, next) => pqrsController.renderAdminList(req, res, next, pool));
  router.get('/pqrs/nueva', (req, res) => res.redirect('/pqrs/nueva'));
  router.post('/pqrs/nueva', (req, res) => res.redirect(303, '/pqrs/nueva'));
  router.get('/pqrs/:id', (req, res, next) => pqrsController.renderDetail(req, res, next, pool, 'ADMINISTRADOR'));
  router.get('/pqrs/:id/adjunto', (req, res, next) => downloadAttachment(req, res, next, pool));
  router.post('/pqrs/:id/responder', (req, res, next) => pqrsController.handleAddResponse(req, res, next, pool));
  router.get('/pqrs/:id/editar', (req, res, next) => pqrsController.renderEdit(req, res, next, pool, 'ADMINISTRADOR'));
  router.post('/pqrs/:id/editar', (req, res, next) => pqrsController.handleUpdate(req, res, next, pool, 'ADMINISTRADOR'));
  router.post('/pqrs/:id/eliminar', (req, res, next) => pqrsController.handleDelete(req, res, next, pool));

  router.get('/usuarios', (req, res, next) => userController.renderUsersList(req, res, next, pool));
  router.get('/usuarios/nuevo', (req, res, next) => userController.renderUserCreate(req, res, next, pool));
  router.post('/usuarios/nuevo', (req, res, next) => userController.handleUserCreate(req, res, next, pool));
  router.get('/usuarios/:id/editar', (req, res, next) => userController.renderUserEdit(req, res, next, pool));
  router.post('/usuarios/:id/editar', (req, res, next) => userController.handleUserUpdate(req, res, next, pool));

  router.get('/reportes', (req, res, next) => reportController.renderReports(req, res, next, pool));
  router.get('/reportes/descargar', (req, res, next) => reportController.downloadReports(req, res, next, pool));

  return router;
}

module.exports = createAdminRoutes;