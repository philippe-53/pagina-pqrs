const path = require('path');
require('dotenv').config();

const rootPath = path.resolve(__dirname, '../..');
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || 'pqrs-demo-secret-change-me';

if (isProduction && sessionSecret.length < 32) {
  throw new Error('En producción, SESSION_SECRET debe tener al menos 32 caracteres aleatorios.');
}

module.exports = {
  appName: 'Serranía SAS ESP',
  rootPath,
  isProduction,
  port: Number(process.env.PORT || 3000),
  sessionSecret,
  mail: {
    user: process.env.SMTP_USER || 'subaseopqrds@elcairo-valle.gov.co',
    password: process.env.SMTP_PASSWORD || '',
    institutionalRecipient: process.env.PQRS_NOTIFICATION_EMAIL || 'criscamilo555@gmail.com',
    publicUrl: process.env.APP_PUBLIC_URL || `http://localhost:${Number(process.env.PORT || 3000)}`
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gestion_conjuntos'
  },
  defaults: {
    adminPassword: process.env.ADMIN_DEFAULT_PASSWORD || 'Admin123*',
    residentPassword: process.env.RESIDENT_DEFAULT_PASSWORD || '123456'
  }
};