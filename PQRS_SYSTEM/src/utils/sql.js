function escapeLike(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function normalizeText(value) {
  return String(value || '').trim();
}

module.exports = {
  escapeLike,
  normalizeText
};