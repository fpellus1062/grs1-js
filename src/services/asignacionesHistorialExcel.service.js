const ExcelJS = require('exceljs');

// ── Helpers de color ─────────────────────────────────────────────────────────

function normalizeHex(value) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const h = raw.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
}

function toArgb(hexColor) {
  const h = normalizeHex(hexColor);
  return h ? `FF${h.slice(1)}` : null;
}

// Número de columna (1-based) a letra Excel
function colLetter(n) {
  let s = '';
  let m = n;
  while (m > 0) {
    m--;
    s = String.fromCharCode(65 + (m % 26)) + s;
    m = Math.floor(m / 26);
  }
  return s;
}

// ── Filtro: último cambio por (agente + día) ──────────────────────────────────

function filterLatestEntries(logs) {
  if (!Array.isArray(logs) || !logs.length) return logs;
  const map = new Map();
  for (const entry of logs) {
    const day = entry.fecha ? String(entry.fecha).slice(0, 10) : '__MASIVO__';
    const key = `${entry.agente_id || ''}|${day}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, entry);
    } else {
      const tE = new Date(existing.created_at || 0).getTime();
      const tN = new Date(entry.created_at || 0).getTime();
      if (tN > tE) map.set(key, entry);
    }
  }
  return Array.from(map.values());
}

// ── Extrae claves de días de un entry ──────────────────────────────────────

function extractDayKeysFromEntry(entry) {
  const keys = new Set();
  
  if (entry.datos_anteriores && typeof entry.datos_anteriores === 'object') {
    if (entry.datos_anteriores.fechas && typeof entry.datos_anteriores.fechas === 'object') {
      Object.keys(entry.datos_anteriores.fechas).forEach(k => keys.add(k));
    }
  }
  
  if (entry.datos_nuevos && typeof entry.datos_nuevos === 'object') {
    if (entry.datos_nuevos.fechas && typeof entry.datos_nuevos.fechas === 'object') {
      Object.keys(entry.datos_nuevos.fechas).forEach(k => keys.add(k));
    }
  }

  if (!keys.size && entry.fecha) {
    keys.add(String(entry.fecha).slice(0, 10));
  }
  
  return Array.from(keys);
}

function getDayDataFromEntry(entry, dayKey, side) {
  const datos = side === 'before' ? entry.datos_anteriores : entry.datos_nuevos;
  if (!datos || typeof datos !== 'object') return undefined;

  if (datos.fechas && typeof datos.fechas === 'object') {
    if (!(dayKey in datos.fechas)) return undefined;
    return datos.fechas[dayKey];
  }

  const entryDay = entry.fecha ? String(entry.fecha).slice(0, 10) : null;
  if (!entryDay || entryDay !== dayKey) return undefined;
  return datos;
}

// ── Consolida historial por agente ──────────────────────────────────────────

function consolidateHistorialByAgent(logs) {
  const consolidated = {};
  
  for (const entry of logs) {
    const agenteId = entry.agente_id || '';
    if (!consolidated[agenteId]) {
      consolidated[agenteId] = {
        agente_id: entry.agente_id,
        agente_apellido1: entry.agente_apellido1,
        agente_apellido2: entry.agente_apellido2,
        agente_nombre: entry.agente_nombre,
        agente_tip: entry.agente_tip,
        empleo_nombre: entry.empleo_nombre,
        dayValues: {}
      };
    }
    
    const dayKeys = extractDayKeysFromEntry(entry);
    dayKeys.forEach(dayKey => {
      if (!consolidated[agenteId].dayValues[dayKey]) {
        consolidated[agenteId].dayValues[dayKey] = {
          before: null,
          after: null
        };
      }

      const beforeDayData = getDayDataFromEntry(entry, dayKey, 'before');
      const afterDayData = getDayDataFromEntry(entry, dayKey, 'after');

      if (beforeDayData !== undefined) {
        consolidated[agenteId].dayValues[dayKey].before = {
          fechas: {
            [dayKey]: beforeDayData,
          },
        };
      }

      if (afterDayData !== undefined) {
        consolidated[agenteId].dayValues[dayKey].after = {
          fechas: {
            [dayKey]: afterDayData,
          },
        };
      }
    });
  }
  
  return Object.values(consolidated);
}

// ── Extrae richText para las actividades de un día concreto ──────────────────
// Devuelve:
//   null  → ese día no existe en los datos (celda vacía)
//   '—'   → día existe pero fue borrado (datos_anteriores con fechas[day] = null)
//   richText[] → array con partes de ExcelJS richText

function getDayRichText(datos, dayKey, logFecha, actMap) {
  if (!datos || typeof datos !== 'object') return null;

  let dayData = null;

  if (datos.fechas && typeof datos.fechas === 'object') {
    if (!(dayKey in datos.fechas)) return null;
    dayData = datos.fechas[dayKey];
    if (dayData === null) return '—'; // borrado
  } else {
    const entryDay = logFecha ? String(logFecha).slice(0, 10) : null;
    if (entryDay !== dayKey) return null;
    dayData = datos;
  }

  if (!dayData || typeof dayData !== 'object') return '—';

  const raw = dayData.actividad_ids;
  const actIds = Array.isArray(raw)
    ? raw.map(Number).filter(Boolean)
    : raw
    ? [Number(raw)].filter(Boolean)
    : [];

  if (!actIds.length) return '—';

  const parts = [];
  actIds.forEach((id, idx) => {
    const act = actMap.get(id);
    const label = act
      ? act.nombre
        ? `${act.codigo} - ${act.nombre}`
        : act.codigo
      : `#${id}`;
    const color = act
      ? normalizeHex(act.actividad_color || act.color)
      : null;

    if (idx > 0) parts.push({ text: ' / ' });
    if (color) {
      parts.push({ text: label, font: { size: 10, bold: true, color: { argb: toArgb(color) } } });
    } else {
      parts.push({ text: label, font: { size: 10} });
    }
  });

  return parts;
}

// ── Aplica fondo de fila a las celdas 1..totalCols ───────────────────────────

function fillRow(row, argbBg, totalCols) {
  for (let c = 1; c <= totalCols; c++) {
    row.getCell(c).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: argbBg },
    };
  }
}

// ── Función principal ────────────────────────────────────────────────────────

async function buildHistorialExcel(
  res,
  { logs, anio, mes, nombreBorrador, planningDays, actividades }
) {
  const actMap = new Map(
    (actividades || []).map((a) => [Number(a.id_actividad), a])
  );

  const filtered = filterLatestEntries(logs || []);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'GRS1';
  wb.created = new Date();

  const ws = wb.addWorksheet('Historial');

  // ── Definición de columnas ────────────────────────────────────────────────
  const fixedCols = [
    { header: 'Estado',   key: 'estado',  width: 12 },
    { header: 'TIP',      key: 'tip',     width: 10 },
    { header: 'Agente',   key: 'agente',  width: 30 },
    { header: 'Empleo',   key: 'empleo',  width: 22 },
  ];
  const dayCols = (planningDays || []).map((d, i) => ({
    header: d.label,
    key: `day_${i}`,
    width: 24,
  }));

  ws.columns = [...fixedCols, ...dayCols];

  const totalCols = ws.columns.length;

  // ── Cabecera: bold, fondo gris ────────────────────────────────────────────
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 10 };
  for (let c = 1; c <= totalCols; c++) {
    const cell = headerRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF9EB3D8' } },
    };
  }
  headerRow.height = 18;

  // AutoFilter en toda la cabecera
  ws.autoFilter = `A1:${colLetter(totalCols)}1`;

  // Freeze: primera fila + primeras 4 columnas (A-D)
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1, activeCell: 'E2' }];

  // ── Consolidar historial por agente ────────────────────────────────────────
  const consolidated = consolidateHistorialByAgent(filtered).sort((a, b) => {
    const nameA = [a.agente_apellido1, a.agente_apellido2, a.agente_nombre]
      .filter(Boolean)
      .join(' ');
    const nameB = [b.agente_apellido1, b.agente_apellido2, b.agente_nombre]
      .filter(Boolean)
      .join(' ');
    return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
  });

  // ── Filas de datos ────────────────────────────────────────────────────────
  consolidated.forEach((agent) => {
    const agentName =
      [agent.agente_apellido1, agent.agente_apellido2, agent.agente_nombre]
        .filter(Boolean)
        .join(' ') || 'Acción global';

    // — Fila Anterior —
    const antRow = ws.addRow({
      estado:  'Anterior',
      tip:     agent.agente_tip || '',
      agente:  agentName,
      empleo:  agent.empleo_nombre || '',
    });
    fillRow(antRow, 'FFFFF5F5', totalCols);
    antRow.getCell('A').font = { bold: true, color: { argb: 'FFC0392B' } };
    antRow.alignment = { vertical: 'top', wrapText: false };

    (planningDays || []).forEach((d, i) => {
      const cell = antRow.getCell(5 + i);
      const dayData = agent.dayValues[d.key];
      const rich = dayData
        ? getDayRichText(dayData.before, d.key, null, actMap)
        : null;
      if (rich === null) {
        cell.value = '';
      } else if (typeof rich === 'string') {
        cell.value = rich;
        cell.font = { size: 10};
      } else {
        const allPlain = rich.every((p) => !p.font);
        cell.value = allPlain
          ? rich.map((p) => p.text).join('')
          : { richText: rich };
        if (allPlain) cell.font = { size: 10};
      }
      cell.alignment = { wrapText: true, vertical: 'top' };
    });

    // — Fila Posterior —
    const postRow = ws.addRow({
      estado:  'Posterior',
      tip:     agent.agente_tip || '',
      agente:  agentName,
      empleo:  agent.empleo_nombre || '',
    });
    fillRow(postRow, 'FFF0FAF0', totalCols);
    postRow.getCell('A').font = { bold: true, color: { argb: 'FF1A7A3C' } };
    postRow.alignment = { vertical: 'top', wrapText: false };

    (planningDays || []).forEach((d, i) => {
      const cell = postRow.getCell(5 + i);
      const dayData = agent.dayValues[d.key];
      const rich = dayData
        ? getDayRichText(dayData.after, d.key, null, actMap)
        : null;
      if (rich === null) {
        cell.value = '';
      } else if (typeof rich === 'string') {
        cell.value = rich;
        cell.font = { size: 10};
      } else {
        const allPlain = rich.every((p) => !p.font);
        cell.value = allPlain
          ? rich.map((p) => p.text).join('')
          : { richText: rich };
        if (allPlain) cell.font = { size: 10};
      }
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });

  // ── Enviar respuesta ──────────────────────────────────────────────────────
  const safeName = (nombreBorrador || `${anio}${String(mes).padStart(2, '0')}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60);
  const filename = `historial_${safeName}_${anio}${String(mes).padStart(2, '0')}.xlsx`;

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { buildHistorialExcel };
