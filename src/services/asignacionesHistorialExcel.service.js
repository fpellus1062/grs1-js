const ExcelJS = require('exceljs');
const {
  normalizeHexColor,
  hexToArgb,
  textArgbForHexBackground,
} = require('../utils/color');

// ── Helpers de color ─────────────────────────────────────────────────────────

function toArgb(hexColor) {
  return hexToArgb(hexColor, 'FF');
}

function textArgbForBackground(hexColor) {
  return textArgbForHexBackground(hexColor, {
    threshold: 0.58 * 255,
    fallback: 'FF1F2937',
    dark: 'FF1F2937',
    light: 'FFFFFFFF',
  });
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
        agente_escalafon: entry.agente_escalafon,
        agente_nif: entry.agente_nif,
        agente_titulacion: entry.agente_titulacion,
        agente_telefono: entry.agente_telefono,
        peloton_codigo: entry.peloton_codigo,
        peloton_nombre: entry.peloton_nombre,
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

// ── Extrae payload de celda por actividad en un día concreto ─────────────────
// Devuelve:
//   null  → ese día no existe en los datos (celda vacía)
//   '—'   → día existe pero fue borrado
//   { richText, fillArgb } → celda con texto y color por actividad

function getDayCellPayload(datos, dayKey, logFecha, actMap) {
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

  const firstAct = actMap.get(actIds[0]);
  const bgHex = firstAct
    ? normalizeHexColor(firstAct.actividad_color || firstAct.color)
    : null;
  const textArgb = textArgbForBackground(bgHex);

  const parts = [];
  actIds.forEach((id, idx) => {
    const act = actMap.get(id);
    const label = act
      ? act.nombre
        ? `${act.codigo} - ${act.nombre}`
        : act.codigo
      : `#${id}`;
    if (idx > 0) parts.push({ text: ' / ' });
    parts.push({ text: label, font: { size: 10, bold: true, color: { argb: textArgb } } });
  });

  return {
    richText: parts,
    fillArgb: bgHex ? toArgb(bgHex) : null,
  };
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
    { header: 'Pelotón',            key: 'peloton',    width: 16 },
    { header: 'Empleo',             key: 'empleo',     width: 16 },
    { header: 'Titulación',         key: 'titulacion', width: 18 },
    { header: 'Apellidos y Nombre', key: 'agente',     width: 34 },
    { header: 'TIP',                key: 'tip',        width: 12 },
    { header: 'Grupo',              key: 'grupo',      width: 28 },
    { header: 'Teléfono',           key: 'telefono',   width: 18 },
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

  // Freeze: primera fila + columnas fijas
  ws.views = [{ state: 'frozen', xSplit: fixedCols.length, ySplit: 1, activeCell: `${colLetter(fixedCols.length + 1)}2` }];

  // ── Consolidar historial por agente ────────────────────────────────────────
  const consolidated = consolidateHistorialByAgent(filtered).sort((a, b) => {
    const pelA = String(a.peloton_nombre || a.peloton_codigo || '').trim();
    const pelB = String(b.peloton_nombre || b.peloton_codigo || '').trim();
    const cmpPel = pelA.localeCompare(pelB, 'es', { sensitivity: 'base' });
    if (cmpPel !== 0) return cmpPel;

    const escA = Number(a.agente_escalafon);
    const escB = Number(b.agente_escalafon);
    const aNum = Number.isFinite(escA);
    const bNum = Number.isFinite(escB);
    if (aNum && bNum && escA !== escB) return escA - escB;
    if (aNum !== bNum) return aNum ? -1 : 1;

    const nameA = [a.agente_apellido1, a.agente_apellido2, a.agente_nombre]
      .filter(Boolean)
      .join(' ');
    const nameB = [b.agente_apellido1, b.agente_apellido2, b.agente_nombre]
      .filter(Boolean)
      .join(' ');
    return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
  });

  function summarizeLatestActividad(agentData) {
    const orderedDays = (planningDays || []).length
      ? (planningDays || []).map((d) => d.key)
      : Object.keys(agentData.dayValues || {}).sort();

    if (!orderedDays.length) {
      return { grupo: '' };
    }

    for (let i = orderedDays.length - 1; i >= 0; i--) {
      const dayKey = orderedDays[i];
      const dayData = agentData.dayValues[dayKey];
      const payload = dayData && dayData.after
        ? (
            dayData.after.fechas && typeof dayData.after.fechas === 'object'
              ? dayData.after.fechas[dayKey]
              : dayData.after
          )
        : undefined;
      if (!payload || typeof payload !== 'object') continue;

      const raw = payload.actividad_ids;
      const ids = Array.isArray(raw)
        ? raw.map(Number).filter(Boolean)
        : raw
        ? [Number(raw)].filter(Boolean)
        : [];
      if (!ids.length) continue;

      const acts = ids
        .map((id) => actMap.get(id))
        .filter(Boolean);

      const grupos = Array.from(
        new Set(
          acts
            .map((a) =>
              String(
                a.grupo_nivel3_nombre ||
                  a.grupo_nombre ||
                  a.nivel_grupo_nombre ||
                  a.grupo ||
                  ''
              ).trim()
            )
            .filter(Boolean)
        )
      );

      return { grupo: grupos.join(' / ') };
    }

    return { grupo: '' };
  }

  // ── Filas de datos (solo último estado) ───────────────────────────────────
  consolidated.forEach((agent) => {
    const agentName =
      [agent.agente_apellido1, agent.agente_apellido2, agent.agente_nombre]
        .filter(Boolean)
        .join(' ') || 'Acción global';
    const resumenActividad = summarizeLatestActividad(agent);

    const postRow = ws.addRow({
      peloton: `${agent.peloton_codigo || ''}${agent.peloton_nombre ? ` - ${agent.peloton_nombre}` : ''}`.trim(),
      empleo: agent.empleo_nombre || '',
      titulacion: agent.agente_titulacion || '',
      agente: agentName,
      tip: agent.agente_tip || '',
      grupo: resumenActividad.grupo,
      telefono: agent.agente_telefono || '',
    });

    fillRow(postRow, 'FFF8FAFD', fixedCols.length);
    postRow.alignment = { vertical: 'top', wrapText: false };

    (planningDays || []).forEach((d, i) => {
      const cell = postRow.getCell(fixedCols.length + 1 + i);
      const dayData = agent.dayValues[d.key];
      const payload = dayData
        ? getDayCellPayload(dayData.after, d.key, null, actMap)
        : null;

      if (payload === null) {
        cell.value = '';
      } else if (typeof payload === 'string') {
        cell.value = payload;
        cell.font = { size: 10 };
      } else {
        cell.value = { richText: payload.richText };
        if (payload.fillArgb) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: payload.fillArgb },
          };
        }
      }
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });

  // ── Enviar respuesta ──────────────────────────────────────────────────────
  const safeName = (nombreBorrador || `${anio}${String(mes).padStart(2, '0')}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const filename = `historial_v2_${safeName}_${anio}${String(mes).padStart(2, '0')}_${stamp}.xlsx`;

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { buildHistorialExcel };
