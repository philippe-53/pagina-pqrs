const multer = require('multer');
const path = require('path');

const maxAttachmentSize = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxAttachmentSize, files: 1, fields: 20, parts: 21, fieldSize: 20000 }
}).single('adjunto');

function parseAttachment(req, res, next) {
  upload(req, res, error => {
    if (!error) return next();
    if (!(error instanceof multer.MulterError)) return next(error);
    req.uploadError = error.code === 'LIMIT_FILE_SIZE'
      ? 'El adjunto supera el máximo de 10 MB.'
      : 'No se pudo recibir el formulario. Adjunte un único archivo y revise los campos.';
    return next();
  });
}

function validateAttachment(file) {
  if (!file) return null;
  const extension = path.extname(file.originalname).toLowerCase();
  const buffer = file.buffer;
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const pdf = buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  const valid = (extension === '.png' && file.mimetype === 'image/png' && png)
    || (['.jpg', '.jpeg'].includes(extension) && file.mimetype === 'image/jpeg' && jpeg)
    || (extension === '.pdf' && file.mimetype === 'application/pdf' && pdf);
  if (!valid || !file.size || file.size > maxAttachmentSize) {
    return 'Adjunte una imagen JPG/PNG o un PDF válido, de máximo 10 MB.';
  }
  return null;
}

module.exports = { parseAttachment, validateAttachment, maxAttachmentSize };
