const { randomBytes, createHash } = require('crypto');
const path = require('path');
const config = require('../config');
const { types, services, phonePattern, isValidPhone, documentTypes, ethnicGroups, documentPattern } = require('../utils/pqrsValidation');
const { validateAttachment, maxAttachmentSize } = require('../middleware/attachment');
const { createSubmissionToken, isValidSubmissionToken } = require('../utils/submissionToken');
const {
  createPqrs, getPqrsById, getPublicPqrsByTicket, getHistoryByPqrs, getResponsesByPqrs
} = require('../services/pqrsService');

const limits = { nombre_contacto: 150, numero_documento: 30, email_contacto: 150, telefono_contacto: 30, direccion: 255, asunto: 180, descripcion: 5000 };
const formOptions = { types, services, phonePattern, documentTypes, ethnicGroups, documentPattern, maxAttachmentSize };

function formToken(req, res, next) {
  if (!req.session.publicFormToken) req.session.publicFormToken = randomBytes(32).toString('hex');
  res.locals.publicFormToken = req.session.publicFormToken;
  if (req.method === 'POST' && !req.uploadError && req.body.form_token !== req.session.publicFormToken) {
    return res.status(403).render('errors/forbidden', { title: 'Formulario no válido. Recargue la página.' });
  }
  return next();
}

function renderHome(req, res) {
  return res.render('public/home', { title: 'Inicio' });
}

function renderAttention(req, res) {
  return res.render('public/attention', { title: 'Atención y servicios al ciudadano' });
}

function renderAbout(req, res) {
  return res.render('public/about', { title: 'Quiénes somos' });
}

function renderRegulatory(req, res) {
  return res.render('public/regulatory', { title: 'Gestor normativo' });
}

function downloadCcu(req, res, next) {
  return res.download(
    path.join(config.rootPath, 'public', 'documents', 'contrato-condiciones-uniformes.pdf'),
    'Contrato-de-Condiciones-Uniformes.pdf',
    error => {
      if (error) return next(error);
    }
  );
}

function renderCreate(req, res) {
  return res.render('public/form', {
    title: 'Registrar PQRS', values: {}, errors: [], ...formOptions,
    submissionToken: createSubmissionToken(req.session.publicFormToken)
  });
}

async function handleCreate(req, res, next, pool) {
  try {
    if (req.uploadError) {
      return res.status(400).render('public/form', {
        title: 'Registrar PQRS', values: req.body || {}, errors: [req.uploadError], ...formOptions,
        submissionToken: createSubmissionToken(req.session.publicFormToken)
      });
    }
    const submissionToken = req.body.submission_token;
    if (!isValidSubmissionToken(submissionToken, req.session.publicFormToken)) {
      return res.status(403).render('errors/forbidden', { title: 'Formulario no válido. Recargue la página.' });
    }
    const values = {};
    for (const field of [...Object.keys(limits), 'tipo', 'servicio', 'tipo_documento', 'grupo_etnico']) {
      values[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : '';
    }
    const errors = [];
    for (const [field, max] of Object.entries(limits)) {
      if (!values[field] || values[field].length > max) {
        errors.push(`Complete ${field.replace(/_/g, ' ')} con un máximo de ${max} caracteres.`);
      }
    }
    if (!types.includes(values.tipo)) errors.push('Seleccione un tipo de PQRS válido.');
    if (!services.includes(values.servicio)) errors.push('Seleccione un servicio válido.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email_contacto)) errors.push('Ingrese un correo electrónico válido.');
    if (!isValidPhone(values.telefono_contacto)) errors.push('Ingrese un teléfono de 7 a 15 dígitos. Puede incluir + al inicio, espacios, guiones y paréntesis.');
    if (!documentTypes.includes(values.tipo_documento)) errors.push('Seleccione un tipo de documento válido.');
    if (!new RegExp(`^${documentPattern}$`).test(values.numero_documento)) errors.push('Ingrese un número de documento de 3 a 30 caracteres, sin símbolos distintos de punto, espacio o guion.');
    if (!ethnicGroups.includes(values.grupo_etnico)) errors.push('Seleccione un grupo étnico o «No aplica».');
    const attachmentError = validateAttachment(req.file);
    if (attachmentError) errors.push(attachmentError);
    if (req.body.autorizacion !== 'si') errors.push('Debe autorizar el tratamiento de los datos para tramitar su solicitud.');
    if (errors.length) {
      return res.status(400).render('public/form', { title: 'Registrar PQRS', values, errors, ...formOptions, submissionToken });
    }
    const id = await createPqrs(pool, {
      ...values, estado_pqrs: 'Abierto',
      adjunto: req.file,
      submission_key: createHash('sha256').update(submissionToken).digest('hex')
    });
    const pqrs = await getPqrsById(pool, id);
    req.session.registeredTicket = pqrs.ticket;
    return res.redirect('/pqrs/registrada');
  } catch (error) {
    return next(error);
  }
}

function renderConfirmation(req, res) {
  if (!req.session.registeredTicket) return res.redirect('/consultar');
  return res.render('public/confirmation', { title: 'PQRS registrada', ticket: req.session.registeredTicket });
}

function renderLookup(req, res) {
  return res.render('public/lookup', { title: 'Consultar PQRS', ticket: '', pqrs: null, history: [], responses: [], error: null });
}

async function handleLookup(req, res, next, pool) {
  try {
    res.set('Cache-Control', 'no-store');
    const ticket = typeof req.body.ticket === 'string' ? req.body.ticket.trim().toUpperCase() : '';
    const valid = /^SER-[A-F0-9]{24}$/.test(ticket);
    const pqrs = valid ? await getPublicPqrsByTicket(pool, ticket) : null;
    const history = pqrs ? await getHistoryByPqrs(pool, pqrs.id_pqrs) : [];
    const responses = pqrs ? await getResponsesByPqrs(pool, pqrs.id_pqrs) : [];
    return res.status(pqrs ? 200 : 404).render('public/lookup', {
      title: 'Consultar PQRS', ticket, pqrs, history, responses,
      error: pqrs ? null : 'No encontramos una PQRS con ese ticket. Verifique el número e intente nuevamente.'
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { formToken, renderHome, renderAttention, renderAbout, renderRegulatory, downloadCcu, renderCreate, handleCreate, renderConfirmation, renderLookup, handleLookup };
