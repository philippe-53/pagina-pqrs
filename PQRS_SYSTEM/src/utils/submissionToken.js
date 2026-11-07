const { randomBytes, createHmac, timingSafeEqual } = require('crypto');

function sign(nonce, sessionToken) {
  return createHmac('sha256', sessionToken).update(nonce).digest('hex');
}

function createSubmissionToken(sessionToken) {
  const nonce = randomBytes(32).toString('hex');
  return `${nonce}.${sign(nonce, sessionToken)}`;
}

function isValidSubmissionToken(token, sessionToken) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return false;
  const [nonce, signature] = token.split('.');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(nonce, sessionToken), 'hex'));
}

module.exports = { createSubmissionToken, isValidSubmissionToken };
