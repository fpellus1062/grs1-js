const ExcelJS = require('exceljs');

/**
 * Normaliza color hex a formato RRGGBB
 */
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

/**
 * Convierte hex a ARGB para ExcelJS
 */
function toArgb(hexColor) {
  const h = normalizeHex(hexColor);
  return h ? `FF${h.slice(1)}` : null;
}

/**
 * Retorna color de texto (blanco o gris) basado en luminancia del fondo
 */
function textArgbForBackground(hexColor) {
  const h = normalizeHex(hexColor);
  if (!h) return 'FF1F2937';
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.58 ? 'FF1F2937' : 'FFFFFFFF';
}

/**
 * Convierte número de columna (1-based) a letra Excel
 */
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

/**
 * Formatea una fecha como "lun 15/jun" o similar
 */
function formatDateHeader(isoDateStr) {
  if (!isoDateStr) return '';
  const parts = isoDateStr.split('-');
  if (parts.length !== 3) return isoDateStr;
  
  const d = new Date(isoDateStr + 'T00:00:00Z');
  const dayNames = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  
  const dayName = dayNames[d.getUTCDay()];
  const day = d.getUTCDate();
  const monthName = monthNames[d.getUTCMonth()];
  
  return dayName + ' ' + day + '/' + monthName;
}

/**
 * Obtiene la actividad para un agente en una fecha específica
 */
function getActividadForDay(agente_id, isoDate, asignaciones) {
  const found = asignaciones.find(a => 
    String(a.agente_id) === String(agente_id) && 
    String(a.fecha).slice(0, 10) === String(isoDate)
  );
  return found ? found.actividad_id : null;
}

/**
 * Obtiene la actividad por ID
 */
function getActividadById(actividadId, actividades) {
  return actividades.find(a => Number(a.id_actividad || a.id) === Number(actividadId));
}

/**
 * Genera Excel con agentes seleccionados y sus asignaciones
 */
async function buildPlanificacionAgentesExcel(res, { agentes = [], asignaciones = [], fechas = [], actividades = [], fechaHoy = new Date() }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GRS1';
  wb.created = fechaHoy;

  const ws = wb.addWorksheet('Planificación');

  // Definición de columnas fijas (metadata del agente)
  const fixedCols = [
    { header: 'Pelotón', key: 'peloton', width: 16 },
    { header: 'Empleo', key: 'empleo', width: 16 },
    { header: 'Aptitudes', key: 'aptitudes', width: 15 },
    { header: 'Apellidos y Nombre', key: 'agente', width: 28 },
    { header: 'TIP', key: 'tip', width: 10 },
    { header: 'Situación', key: 'situacion', width: 18 },
  ];

  // Columnas de fechas (cada día es una columna)
  const dayCols = (fechas || []).map((isoDate, i) => ({
    header: formatDateHeader(isoDate),
    key: `day_${i}`,
    width: 14,
  }));

  ws.columns = [...fixedCols, ...dayCols];

  const totalCols = ws.columns.length;

  // ── Cabecera: bold, fondo azul claro ────────────────────────────────────
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: 'FF1F2937' } };
  for (let c = 1; c <= totalCols; c++) {
    const cell = headerRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF9EB3D8' } },
    };
  }
  headerRow.height = 22;

  // AutoFilter en toda la cabecera
  ws.autoFilter = `A1:${colLetter(totalCols)}1`;

  // Freeze: primera fila + columnas fijas
  ws.views = [{ 
    state: 'frozen', 
    xSplit: fixedCols.length, 
    ySplit: 1, 
    activeCell: `${colLetter(fixedCols.length + 1)}2` 
  }];

  // ── Agregar filas de datos ────────────────────────────────────────────────
  let rowNum = 2;
  
  // Pre-indexar asignaciones para búsqueda rápida O(1)
  const assignmentIndex = new Map();
  if (Array.isArray(asignaciones)) {
    asignaciones.forEach(a => {
      const fechaISO = String(a.fecha || '').slice(0, 10);
      const key = `${a.agente_id}|${fechaISO}`;
      assignmentIndex.set(key, a.actividad_id);
    });
  }

  // Pre-indexar actividades con colores pre-calculados
  const actividadMap = new Map();
  const activityColorCache = new Map();
  if (Array.isArray(actividades)) {
    actividades.forEach(a => {
      const id = Number(a.id_actividad || a.id);
      if (id) {
        actividadMap.set(id, a);
        const bgHex = a.color || a.grupo_color || '#e8f5e9';
        const bgArgb = toArgb(bgHex);
        const textArgb = textArgbForBackground(bgHex);
        activityColorCache.set(id, { bgArgb, textArgb });
      }
    });
  }

  for (const agente of agentes) {
    const row = ws.getRow(rowNum);

    // Datos fijos del agente
    row.getCell('peloton').value = agente.peloton_desc || '';
    row.getCell('empleo').value = agente.empleo_desc || agente.empleo_id || '';
    row.getCell('aptitudes').value = agente.aptitudes || '';
    row.getCell('agente').value = agente.nombre || '';
    row.getCell('tip').value = agente.tip || '';
    
    const situacion = [agente.situacion_id, agente.situacion_desc]
      .filter(Boolean)
      .join(' · ');
    row.getCell('situacion').value = situacion;

    // Estilos para datos fijos
    for (let c = 1; c <= fixedCols.length; c++) {
      const cell = row.getCell(c);
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = {
        right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      };
    }

    // Columnas de fechas con actividades - búsqueda O(1) en Map
    fechas.forEach((isoDate, dayIdx) => {
      const cellCol = fixedCols.length + dayIdx + 1;
      const cell = row.getCell(cellCol);

      // Búsqueda rápida en assignmentIndex
      const key = `${agente.agente_id}|${isoDate}`;
      const actividadId = assignmentIndex.get(key);
      
      if (actividadId) {
        const act = actividadMap.get(Number(actividadId));
        if (act) {
          const label = [act.codigo || act.actividad, act.nombre]
            .filter(Boolean)
            .join(' - ');
          cell.value = label;
          
          // Color pre-calculado
          const colors = activityColorCache.get(Number(actividadId));
          if (colors && colors.bgArgb) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: colors.bgArgb },
            };
            cell.font = { 
              size: 9, 
              bold: true, 
              color: { argb: colors.textArgb } 
            };
          }
        } else {
          cell.value = `#${actividadId}`;
          cell.font = { size: 9, italic: true };
        }
      } else {
        cell.value = '';
      }

      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      };
    });

    row.height = 24;
    rowNum++;
  }

  // Enviar archivo
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  
  const fecha = fechaHoy;
  const nombreArchivo = 'Planificacion_Agentes_' +
    fecha.getFullYear() + '-' +
    String(fecha.getMonth() + 1).padStart(2, '0') + '-' +
    String(fecha.getDate()).padStart(2, '0') + '.xlsx';
  
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

  await wb.xlsx.write(res);
}

module.exports = {
  buildPlanificacionAgentesExcel,
};
