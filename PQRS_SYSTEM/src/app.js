const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');

const config = require('./config');
const pool = require('./db/pool');
const { bootstrapDatabase } = require('./db/bootstrap');
const { attachUserToLocals, requireRole } = require('./middleware/auth');
const createAuthRoutes = require('./routes/authRoutes');
const createAdminRoutes = require('./routes/adminRoutes');
const createConsultationRoutes = require('./routes/consultationRoutes');
const createPublicRoutes = require('./routes/publicRoutes');
const { types } = require('./utils/pqrsValidation');

async function createApp() {
  // Inicializa la base de datos lógica antes de exponer rutas HTTP.
  await bootstrapDatabase(pool);

  const app = express();

  if (config.isProduction) app.set('trust proxy', 1);

  // Motor de vistas y carpeta base de plantillas.
  app.set('views', path.join(config.rootPath, 'views'));
  app.set('view engine', 'ejs');

  // Middleware de seguridad, lectura de formularios y recursos estaticos.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(express.static(path.join(config.rootPath, 'public')));
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        maxAge: 1000 * 60 * 60 * 8
      }
    })
  );

  // Expone usuario autenticado y mensajes temporales a todas las vistas.
  app.use(attachUserToLocals);
  app.use((req, res, next) => {
    res.locals.appName = config.appName;
    res.locals.currentPath = req.path;
    res.locals.pqrsTypes = types;
    return next();
  });

  // Divide la aplicacion por contexto funcional y por rol.
  app.use('/', createAuthRoutes(pool));
  app.use('/consulta-pqrs', createConsultationRoutes(pool));
  app.use('/admin', createAdminRoutes(pool));
  app.use('/resident', requireRole('ADMINISTRADOR'), (req, res) => res.redirect('/admin'));
  app.use('/', createPublicRoutes(pool));

  app.use((req, res) => {
    return res.status(404).render('errors/not-found', { title: 'Página no encontrada' });
  });

  // Redireccion por defecto cuando la URL no coincide con ninguna ruta conocida.
  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) {
      return next(error);
    }
    return res.status(500).render('errors/server', {
      title: 'Error interno',
      errorMessage: 'Se produjo un error inesperado al procesar la solicitud.'
    });
  });

  return app;
}

module.exports = createApp;