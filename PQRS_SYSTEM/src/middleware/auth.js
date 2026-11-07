// Middleware de autenticacion, autorizacion y mensajes flash para la app.
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  return next();
}

// Limita una ruta a uno o varios roles permitidos.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('errors/forbidden', {
        title: 'Acceso restringido'
      });
    }

    return next();
  };
}

// Expone la sesion y los mensajes flash a todas las vistas EJS.
function attachUserToLocals(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  return next();
}

// Guarda un mensaje temporal para mostrarlo en la siguiente respuesta.
function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

module.exports = {
  requireAuth,
  requireRole,
  attachUserToLocals,
  setFlash
};