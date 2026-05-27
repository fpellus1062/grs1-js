/**
 * resumenActividadesExcel.service.js
 * Genera un resumen de actividades agrupado por Pelotón × Día × Actividad
 * y lo exporta como Excel (ExcelJS).
 */

'use strict';

const ExcelJS = require('exceljs');

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function buildFileTimestamp(value) {
  const dt = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(dt);
  const pick = (type) => {
    const found = parts.find((p) => p.type === type);
    return found ? found.value : '00';
  };
  return `${pick('year')}${pick('month')}${pick('day')}_${pick('hour')}${pick('minute')}${pick('second')}`;
}

// ── buildResumenData ───────────────────────────────────────────────────────

/**
 * Procesa el cuadrante raw + meta y devuelve filas de resumen agrupadas
 * por día + actividad para los días seleccionados.
 *
 * @param {object} cuadranteData - Resultado de service.getCuadrante
 * @param {object} metaData      - Resultado de service.getMeta
 * @param {string[]} fechasFiltro - Fechas ISO a incluir (vacío = todas)
 * @returns {Array<object>} Filas ordenadas por código / nombre de actividad
 */
function buildResumenData(cuadranteData, metaData, fechasFiltro) {
  const isBorrador = !!(
    cuadranteData.control &&
    cuadranteData.control.borrador_id &&
    cuadranteData.control.estado !== 'sin_borrador'
  );
  const rows = isBorrador
    ? cuadranteData.borrador || []
    : cuadranteData.definitivo || [];

  const rawServicios = isBorrador
    ? cuadranteData.borradorServicios || []
    : cuadranteData.definitivoServicios || [];
  const keyField = isBorrador ? 'asignacion_borrador_id' : 'asignacion_id';

  // Mapa asignacionId → servicios[]
  const serviciosMap = new Map();
  rawServicios.forEach((s) => {
    const k = Number(s[keyField]);
    if (!k) return;
    if (!serviciosMap.has(k)) serviciosMap.set(k, []);
    serviciosMap.get(k).push(s);
  });

  // Mapa actividadId → info
  const actividadMap = new Map();
  (metaData.actividades || []).forEach((a) => {
    actividadMap.set(Number(a.id_actividad), {
      codigo: String(a.actividad || a.codigo || '').trim(),
      nombre: String(a.nombre || '').trim(),
    });
  });

  const fechasSet =
    fechasFiltro && fechasFiltro.length ? new Set(fechasFiltro) : null;

  // Grupos: key = `${fecha}|||${actId}`
  const grupos = new Map();

  rows.forEach((row) => {
    const fecha = row.fecha
      ? String(row.fecha).slice(0, 10)
      : `${row.anio}-${String(row.mes).padStart(2, '0')}-${String(row.dia).padStart(2, '0')}`;

    if (fechasSet && !fechasSet.has(fecha)) return;

    const agenteId = Number(row.agente_id);

    // Actividades desde servicios o actividad_ids
    const servicios = serviciosMap.get(Number(row.id)) || [];
    let actIds = servicios.length
      ? servicios.map((s) => Number(s.actividad_id)).filter(Boolean)
      : (Array.isArray(row.actividad_ids) ? row.actividad_ids : [])
          .map(Number)
          .filter(Boolean);

    actIds = Array.from(new Set(actIds));

    if (!actIds.length) return; // Filas sin actividad no se contabilizan

    actIds.forEach((actId) => {
      const gKey = `${fecha}|||${actId}`;
      if (!grupos.has(gKey)) {
        grupos.set(gKey, {
          fecha,
          actId,
          agentes: new Set(),
        });
      }
      const g = grupos.get(gKey);
      g.agentes.add(agenteId);
    });
  });

  // Convertir a array con info completa
  const result = [];
  grupos.forEach((g) => {
    const actInfo = actividadMap.get(g.actId) || {
      codigo: '',
      nombre: 'Sin actividad',
    };

    result.push({
      fecha: g.fecha,
      actividad_id: g.actId,
      actividad_codigo: actInfo.codigo,
      actividad_nombre: actInfo.nombre,
      count_agentes: g.agentes.size,
    });
  });

  result.sort((a, b) => {
    const f1 = String(a.fecha || '').localeCompare(String(b.fecha || ''), 'es');
    if (f1 !== 0) return f1;
    const c1 = String(a.actividad_codigo || '').localeCompare(
      String(b.actividad_codigo || ''),
      'es'
    );
    if (c1 !== 0) return c1;
    return String(a.actividad_nombre || '').localeCompare(
      String(b.actividad_nombre || ''),
      'es'
    );
  });

  return result;
}

// ── buildResumenExcel ──────────────────────────────────────────────────────

/**
 * Genera el workbook ExcelJS con celdas combinadas para el pelotón.
 *
 * @param {object} res - Express response (se envía directamente)
 * @param {Array<object>} resumenRows - Resultado de buildResumenData
 * @param {object} options - { anio, mes, titulo?, fechaDesde, fechaHasta, fechaImpresion }
 */
async function exportarResumenExcel(
  res,
  resumenRows,
  { anio, mes, titulo, fechaDesde, fechaHasta, fechaImpresion }
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GRS1';
  wb.created = new Date();

  const ws = wb.addWorksheet('Resumen Actividades', {
    views: [{ state: 'frozen', ySplit: 4, xSplit: 0 }],
  });

  const COLS = [
    { header: 'Total Agentes', key: 'total_global', width: 14 },
    { header: 'Día', key: 'fecha', width: 14 },
    { header: 'Código Actividad', key: 'actividad_codigo', width: 18 },
    { header: 'Descripción Actividad', key: 'actividad_nombre', width: 38 },
    { header: 'Agentes', key: 'agentes', width: 12 },
  ];
  ws.columns = COLS;

  const GC_GREEN    = 'FF276836';
  const GC_LIGHT    = 'FF3a7d4a';
  const BORDER_GRAY = 'FFdde8e0';

  const fmtDateEs = (iso) => {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(iso);
    return `${m[3]}/${m[2]}/${m[1]}`;
  };

  const fmtDateTimeEs = (value) => {
    const dt = value ? new Date(value) : new Date();
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(dt);
  };

  // ── Cabecera superior ──
  ws.mergeCells(1, 1, 1, COLS.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value =
    titulo ||
    `Servicios del mes del cuadrante ${MESES[(mes || 1) - 1] || mes} ${anio}`;
  titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: GC_GREEN },
  };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, COLS.length);
  const rangeCell = ws.getCell(2, 1);
  rangeCell.value = `Año ${anio}. Día desde ${fmtDateEs(fechaDesde)} hasta ${fmtDateEs(fechaHasta)}`;
  rangeCell.font = { size: 10, color: { argb: 'FF1F3D2A' } };
  rangeCell.alignment = { horizontal: 'left', vertical: 'middle' };
  rangeCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEAF3ED' },
  };
  ws.getRow(2).height = 18;

  ws.mergeCells(3, 1, 3, COLS.length);
  const printCell = ws.getCell(3, 1);
  printCell.value = `Fecha y hora de impresión: ${fmtDateTimeEs(fechaImpresion)}`;
  printCell.font = { size: 9, color: { argb: 'FF34593E' }, italic: true };
  printCell.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(3).height = 16;

  // ── Fila de cabecera ──
  const hdr = ws.getRow(4);
  hdr.height = 18;
  COLS.forEach((col, i) => {
    const cell = hdr.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GC_LIGHT } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'medium', color: { argb: GC_GREEN } } };
  });

  // ── Datos ──
  if (!resumenRows.length) {
    ws.mergeCells(5, 1, 5, COLS.length);
    const emptyRow = ws.getRow(5);
    emptyRow.getCell(1).value = 'Sin datos para el período/días seleccionados.';
    emptyRow.getCell(1).alignment = { horizontal: 'center' };
    emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF888888' } };
  } else {
    const actividadMap = new Map();
    resumenRows.forEach((d) => {
      const key = `${String(d.fecha || '').slice(0, 10)}|||${Number(d.actividad_id) || 0}`;
      if (!actividadMap.has(key)) {
        actividadMap.set(key, {
          fecha: String(d.fecha || '').slice(0, 10),
          actividad_id: key,
          actividad_codigo: String(d.actividad_codigo || '').trim(),
          actividad_nombre: String(d.actividad_nombre || '').trim() || 'Sin actividad',
          total_agentes: 0,
        });
      }
      const acc = actividadMap.get(key);
      acc.total_agentes += Number(d.count_agentes) || 0;
    });

    const actividadRows = Array.from(actividadMap.values()).sort((a, b) => {
      const f1 = String(a.fecha || '').localeCompare(String(b.fecha || ''), 'es');
      if (f1 !== 0) return f1;
      const c1 = String(a.actividad_codigo || '').localeCompare(
        String(b.actividad_codigo || ''),
        'es'
      );
      if (c1 !== 0) return c1;
      return String(a.actividad_nombre || '').localeCompare(
        String(b.actividad_nombre || ''),
        'es'
      );
    });

    const totalGlobal = actividadRows.reduce(
      (acc, row) => acc + (Number(row.total_agentes) || 0),
      0
    );

    const startRow = 5;

    actividadRows.forEach((d, index) => {
      const row = ws.getRow(startRow + index);
      row.height = 16;

      row.getCell(2).value = fmtDateEs(d.fecha);
      row.getCell(2).font = { size: 10, bold: true };
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };

      row.getCell(3).value = d.actividad_codigo;
      row.getCell(3).font = { size: 10, bold: true };
      row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };

      row.getCell(4).value = d.actividad_nombre;
      row.getCell(4).font = { size: 10 };
      row.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' };

      row.getCell(5).value = d.total_agentes;
      row.getCell(5).font = { size: 10, bold: true };
      row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };

      if (index % 2 === 1) {
        for (let c = 2; c <= COLS.length; c++) {
          row.getCell(c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF4FAF5' },
          };
        }
      }

      for (let c = 1; c <= COLS.length; c++) {
        row.getCell(c).border = {
          top: { style: 'thin', color: { argb: BORDER_GRAY } },
          left: { style: 'thin', color: { argb: BORDER_GRAY } },
          bottom: { style: 'thin', color: { argb: BORDER_GRAY } },
          right: { style: 'thin', color: { argb: BORDER_GRAY } },
        };
      }
    });

    const endRow = startRow + actividadRows.length - 1;
    if (actividadRows.length > 1) {
      ws.mergeCells(startRow, 1, endRow, 1);
    }
    const totalCell = ws.getCell(startRow, 1);
    totalCell.value = totalGlobal;
    totalCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
    totalCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: GC_GREEN },
    };
  }

  // ── Enviar respuesta ──
  const mesStr = String(mes || '').padStart(2, '0');
  const filename = `resumen-actividades-${anio}-${mesStr}-${buildFileTimestamp(fechaImpresion)}.xlsx`;

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`
  );

  await wb.xlsx.write(res);
  res.end();
}

module.exports = { buildResumenData, exportarResumenExcel };
