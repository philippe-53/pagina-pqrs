const express = require('express');
const authController = require('../controllers/authController');

// Rutas publicas de acceso y cierre de sesion.
function createAuthRoutes(pool) {
  const router = express.Router();

  router.get('/login', authController.renderLogin);
  router.post('/login', (req, res, next) => authController.login(req, res, next, pool));
  router.get('/logout', authController.logout);

  return router;
}

module.exports = createAuthRoutes;