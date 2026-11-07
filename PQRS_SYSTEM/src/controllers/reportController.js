const ExcelJS = require('exceljs');
const { listPqrs, getStateOptions } = require('../services/pqrsService');
const { buildFilters } = require('../utils/pqrsFilters');
const { getUsersSummary } = require('../services/userService');

// Construye reportes del sistema usando agregaciones y resumenes SQL.
async function renderReports(req, res, next, pool) {
  try {
    const filters = buildFilters(req.query);
    const [pqrs, states, userSummary] = await Promise.all([
      listPqrs(pool, filters),
      getStateOptions(pool),
      getUsersSummary(pool)
    ]);
    const summarize = field => {
      const totals = new Map();
      for (const row of pqrs) {
        const value = field === 'estado' ? row.estado_pqrs || row.estado_nombre : row.tipo || 'Sin tipo';
        totals.set(value, (totals.get(value) || 0) + 1);
      }
      return Array.from(totals, ([value, total]) => ({ [field]: value, total })).sort((a, b) => b.total - a.total);
    };

    return res.render('admin/reports', {
      title: 'Reportes',
      byState: summarize('estado'),
      byType: summarize('tipo'),
      pqrs,
      states,
      filters,
      userSummary
    });
  } catch (error) {
    return next(error);
  }
}

async function downloadReports(req, res, next, pool) {
  try {
    const pqrs = await listPqrs(pool, buildFilters(req.query));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('PQRS', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Ticket', key: 'ticket', width: 32 },
      { header: 'Asunto', key: 'asunto', width: 40 },
      { header: 'Solicitante', key: 'solicitante', width: 30 },
      { header: 'Correo', key: 'email', width: 35 },
      { header: 'Teléfono', key: 'telefono', width: 22 },
      { header: 'Dirección', key: 'direccion', width: 40 },
      { header: 'Servicio', key: 'servicio', width: 30 },
      { header: 'Tipo', key: 'tipo', width: 18 },
      { header: 'Estado', key: 'estado', width: 20 },
      { header: 'Fecha de creación', key: 'fecha', width: 24 },
      { header: 'Descripción', key: 'descripcion', width: 60 }
    ];
    for (const row of pqrs) {
      sheet.addRow({
        ...row, direccion: row.direccion || row.unidad || '',
        estado: row.estado_pqrs || row.estado_nombre, fecha: row.fecha_creacion
      });
    }
    sheet.getColumn('fecha').numFmt = 'dd/mm/yyyy hh:mm';
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF07568C' } };
    sheet.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true }; });
    sheet.autoFilter = { from: 'A1', to: `K${Math.max(1, sheet.rowCount)}` };
    const buffer = await workbook.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="reportes-pqrs.xlsx"',
      'Cache-Control': 'no-store'
    });
    return res.send(Buffer.from(buffer));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  renderReports,
  downloadReports
};