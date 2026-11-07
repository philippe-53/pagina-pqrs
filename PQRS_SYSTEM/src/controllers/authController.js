const { setFlash } = require('../middleware/auth');
const { authenticateUser } = require('../services/authService');

function getHomeForRole(role) {
  if (role === 'ADMINISTRADOR') return '/admin';
  if (role === 'CONSULTA_PQRS') return '/consulta-pqrs';
  return '/';
}

function renderLogin(req, res) {
  if (req.session.user) {
    return res.redirect(getHomeForRole(req.session.user.role));
  }

  return res.render('auth/login', {
    title: 'Ingreso al sistema',
    layout: 'auth'
  });
}

async function login(req, res, next, pool) {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();

    if (!username || !password) {
      setFlash(req, 'error', 'Debe completar usuario y contraseña.');
      return res.redirect('/login');
    }

    const user = await authenticateUser(pool, username, password);

    if (!user) {
      setFlash(req, 'error', 'Credenciales inválidas.');
      return res.redirect('/login');
    }

    if (user.disabled) {
      setFlash(req, 'error', 'El usuario se encuentra deshabilitado.');
      return res.redirect('/login');
    }

    if (!['ADMINISTRADOR', 'CONSULTA_PQRS'].includes(user.role)) {
      setFlash(req, 'error', 'Esta cuenta no tiene acceso al sistema interno de PQRS.');
      return res.redirect('/login');
    }

    req.session.user = {
      idUsuario: user.idUsuario,
      idPersona: user.idPersona,
      username: user.username,
      role: user.role,
      fullName: user.fullName,
      profile: user.profile
    };

    setFlash(req, 'success', `Bienvenido, ${user.fullName}.`);
    return res.redirect(getHomeForRole(user.role));
  } catch (error) {
    return next(error);
  }
}

function logout(req, res, next) {
  req.session.destroy(error => {
    if (error) {
      return next(error);
    }
    return res.redirect('/login');
  });
}

module.exports = {
  renderLogin,
  login,
  logout
};