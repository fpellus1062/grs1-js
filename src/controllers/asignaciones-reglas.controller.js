const service = require('../services/asignaciones-reglas.service');
const ApiError = require('../utils/ApiError');
const ExcelJS = require('exceljs');

function parseOptionalNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHexColor(color) {
  const raw = String(color || '').trim();
  if (!raw) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const h = raw.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }
  return null;
}

function toExcelArgb(hexColor) {
  const hex = normalizeHexColor(hexColor);
  if (!hex) return null;
  return `FF${hex.slice(1)}`;
}

function textArgbForBg(hexColor) {
  const hex = normalizeHexColor(hexColor);
  if (!hex) return 'FF212529';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? 'FF212529' : 'FFFFFFFF';
}

async function writeWorkbookAsXlsx(res, workbook, filename) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

exports.listReglas = async (req, res, next) => {
  try {
    const reglas = await service.listReglas({
      arsUnidadId: req.arsId,
      filters: req.query || {},
    });
    res.json({ ok: true, reglas });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al listar reglas'));
  }
};

exports.createRegla = async (req, res, next) => {
  try {
    const regla = await service.createRegla(req.body, req.user, req.arsId);
    res.status(201).json({ ok: true, message: 'Regla creada', regla });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al crear regla'));
  }
};

exports.updateRegla = async (req, res, next) => {
  try {
    const regla = await service.updateRegla(
      Number(req.params.id),
      req.body,
      req.user,
      req.arsId
    );
   
    res.json({ ok: true, message: 'Regla actualizada', regla });
  } catch (error) {
    const status = (error.message || '').includes('no encontrada') ? 404 : 400;
    next(new ApiError(status, error.message || 'Error al actualizar regla'));
  }
};

exports.deleteRegla = async (req, res, next) => {
  try {
    const result = await service.deleteRegla(
      Number(req.params.id),
      req.user,
      req.arsId
    );
    res.json({ ok: true, message: 'Regla desactivada', ...result });
  } catch (error) {
    const status = (error.message || '').includes('no encontrada') ? 404 : 400;
    next(new ApiError(status, error.message || 'Error al eliminar regla'));
  }
};

exports.previewImpacto = async (req, res, next) => {
  try {
    const preview = await service.previewImpacto(req.body, req.arsId);
    res.json({ ok: true, preview });
  } catch (error) {
    next(
      new ApiError(400, error.message || 'Error al calcular previsualización')
    );
  }
};

exports.getSaldosPeriodo = async (req, res, next) => {
  try {
    const empleoId = req.query.empleo_id
      ? String(req.query.empleo_id).trim() || null
      : null;
    const saldos = await service.getSaldosPeriodo({
      arsUnidadId: req.arsId,
      anio: Number(req.query.anio),
      mes: Number(req.query.mes),
      agente_id: req.query.agente_id ? Number(req.query.agente_id) : null,
      empleo_id: empleoId,
    });
    res.json({ ok: true, saldos });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al obtener saldos'));
  }
};

exports.persistirMovimientoManual = async (req, res, next) => {
  try {
    const result = await service.persistirMovimientoManual(
      req.body,
      req.user,
      req.arsId
    );
    res.status(201).json({
      ok: true,
      message: 'Movimiento manual grabado en ledger',
      ...result,
    });
  } catch (error) {
    next(
      new ApiError(400, error.message || 'Error al grabar movimiento manual')
    );
  }
};

exports.persistirMovimientoManualBulk = async (req, res, next) => {
  try {
    const result = await service.persistirMovimientoManualBulk(
      req.body,
      req.user,
      req.arsId
    );
    res.status(201).json({
      ok: true,
      message: `${result.count} movimientos manuales grabados en ledger`,
      ...result,
    });
  } catch (error) {
    next(
      new ApiError(400, error.message || 'Error al grabar movimientos manuales')
    );
  }
};

exports.getLedgerSaldosMensuales = async (req, res, next) => {
  try {
    const saldos = await service.getLedgerSaldosMensuales({
      arsUnidadId: req.arsId,
      anio: parseOptionalNumber(req.query.anio),
      mes: parseOptionalNumber(req.query.mes),
      agente_id: req.query.agente_id ? Number(req.query.agente_id) : null,
    });
    res.json({ ok: true, saldos });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener saldos mensuales de ledger'
      )
    );
  }
};

exports.exportLedgerSaldosExcel = async (req, res, next) => {
  try {
    const anio = parseOptionalNumber(req.query.anio);
    const saldos = await service.getLedgerSaldosMensuales({
      arsUnidadId: req.arsId,
      anio,
      mes: parseOptionalNumber(req.query.mes),
      agente_id: req.query.agente_id ? Number(req.query.agente_id) : null,
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Acumulados');

    ws.columns = [
      { header: 'TIP', key: 'tip', width: 12 },
      { header: 'Agente', key: 'agente', width: 36 },
      { header: 'Empleo', key: 'empleo', width: 26 },
      { header: 'Saldo inicial', key: 'saldo_inicial', width: 14 },
      { header: 'Total devengado', key: 'total_devengado', width: 16 },
      { header: 'Total disfrutado', key: 'total_disfrutado', width: 16 },
      { header: 'Saldo final', key: 'saldo_final', width: 14 },
    ];

    saldos.forEach((row) => {
      const added = ws.addRow({
        tip: row.tip || '',
        agente: [row.apellido_1, row.apellido_2, row.nombre]
          .filter(Boolean)
          .join(' '),
        empleo: row.empleo_nombre || row.empleo_id || '-',
        saldo_inicial: Number(row.saldo_inicial || 0),
        total_devengado: Number(row.total_devengado || 0),
        total_disfrutado: Number(row.total_disfrutado || 0),
        saldo_final: Number(row.saldo_final || 0),
      });

      const bgArgb = toExcelArgb(row.empleo_color);
      if (bgArgb) {
        const empleoCell = added.getCell('C');
        empleoCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgArgb },
        };
        empleoCell.font = {
          ...(empleoCell.font || {}),
          color: { argb: textArgbForBg(row.empleo_color) },
          bold: false,
        };
      }
    });

    ws.getRow(1).font = { bold: true };
    ['D', 'E', 'F', 'G'].forEach((col) => {
      ws.getColumn(col).numFmt = '0.00';
    });

    await writeWorkbookAsXlsx(
      res,
      wb,
      `ledger-acumulados-${anio || 'todos'}.xlsx`
    );
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al exportar acumulados'));
  }
};

exports.getLedgerAgentes = async (req, res, next) => {
  try {
    const agentes = await service.getLedgerAgentes({
      arsUnidadId: req.arsId,
      anio: req.query.anio ? Number(req.query.anio) : null,
    });
    res.json({ ok: true, agentes });
  } catch (error) {
    next(
      new ApiError(500, error.message || 'Error al obtener agentes del ledger')
    );
  }
};

exports.getLedgerMovimientos = async (req, res, next) => {
  try {
    const movimientos = await service.getLedgerMovimientos({
      arsUnidadId: req.arsId,
      anio: Number(req.query.anio),
      mes: parseOptionalNumber(req.query.mes),
      agente_id: Number(req.query.agente_id),
    });
    res.json({ ok: true, movimientos });
  } catch (error) {
    next(
      new ApiError(500, error.message || 'Error al obtener movimientos ledger')
    );
  }
};

exports.exportLedgerMovimientosExcel = async (req, res, next) => {
  try {
    const anio = Number(req.query.anio);
    const mes = parseOptionalNumber(req.query.mes);
    const agenteId = Number(req.query.agente_id);

    const movimientos = await service.getLedgerMovimientos({
      arsUnidadId: req.arsId,
      anio,
      mes,
      agente_id: agenteId,
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Movimientos');

    ws.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'TIP', key: 'tip', width: 12 },
      { header: 'Agente', key: 'agente', width: 34 },
      { header: 'Empleo', key: 'empleo', width: 24 },
      { header: 'Origen', key: 'origen', width: 12 },
      { header: 'Borrador', key: 'borrador_nombre', width: 28 },
      { header: 'Tipo', key: 'tipo_movimiento', width: 12 },
      { header: 'Días', key: 'cantidad_dias', width: 10 },
      { header: 'Saldo antes', key: 'saldo_antes', width: 12 },
      { header: 'Saldo después', key: 'saldo_despues', width: 14 },
      { header: 'Actividad', key: 'actividad', width: 40 },
    ];

    movimientos.forEach((row) => {
      const added = ws.addRow({
        fecha: row.fecha,
        tip: row.tip || '',
        agente: [row.apellido_1, row.apellido_2, row.nombre]
          .filter(Boolean)
          .join(' '),
        empleo: row.empleo_nombre || row.empleo_id || '-',
        origen: row.origen,
        borrador_nombre: row.borrador_nombre || '-',
        tipo_movimiento: row.tipo_movimiento,
        cantidad_dias: Number(row.cantidad_dias || 0),
        saldo_antes: Number(row.saldo_antes || 0),
        saldo_despues: Number(row.saldo_despues || 0),
        actividad: `${row.actividad_codigo ? `${row.actividad_codigo} - ` : ''}${
          row.actividad_nombre || ''
        }`,
      });

      const bgArgb = toExcelArgb(row.empleo_color);
      if (bgArgb) {
        const empleoCell = added.getCell('D');
        empleoCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgArgb },
        };
        empleoCell.font = {
          ...(empleoCell.font || {}),
          color: { argb: textArgbForBg(row.empleo_color) },
          bold: false,
        };
      }
    });

    ws.getRow(1).font = { bold: true };
    ws.getColumn('cantidad_dias').numFmt = '0.00';
    ws.getColumn('saldo_antes').numFmt = '0.00';
    ws.getColumn('saldo_despues').numFmt = '0.00';

    await writeWorkbookAsXlsx(
      res,
      wb,
      `ledger-movimientos-${anio}${mes ? `-${String(mes).padStart(2, '0')}` : ''}-${agenteId}.xlsx`
    );
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al exportar movimientos'));
  }
};
