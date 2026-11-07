async function downloadAttachment(req, res, next, pool) {
  try {
    const [rows] = await pool.execute('SELECT nombre, tipo, contenido FROM adjunto_pqrs WHERE id_pqrs = ?', [req.params.id]);
    if (!rows.length) return res.status(404).render('errors/not-found', { title: 'Adjunto no encontrado' });
    const file = rows[0];
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.attachment(file.nombre);
    res.type(file.tipo);
    return res.send(file.contenido);
  } catch (error) {
    return next(error);
  }
}

module.exports = { downloadAttachment };
