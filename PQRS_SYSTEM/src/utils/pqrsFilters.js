function buildFilters(query) {
  return {
    q: String(query.q || '').trim(),
    estado: String(query.estado || '').trim(),
    tipo: String(query.tipo || '').trim(),
    sortBy: String(query.sortBy || 'fecha').trim(),
    order: String(query.order || 'desc').trim()
  };
}

module.exports = { buildFilters };
