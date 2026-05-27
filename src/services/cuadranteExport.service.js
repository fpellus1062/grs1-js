/**
 * Exportación del cuadrante de asignaciones a Excel (.xlsx)
 * Usa ExcelJS para formato profesional:
 *  - Fila cabecera congelada con fondo del color del equipo (pelotón)
 *  - Celdas de actividad coloreadas con el color real de la actividad
 *  - Columnas de agente: TIP + Apellidos + Nombre + Empleo
 *  - Columna por cada fecha del rango
 *  - Soporte para borrador o definitivo
 */

// @ts-nocheck
'use strict';

const ExcelJS = require('exceljs');
const db = require('../config/db');

// ── helpers ──────────────────────────────────────────────────

/** Convierte un color CSS hex (#RRGGBB o #RRGGBBAA) a ARGB de 8 dígitos */
function toARGB(css, alpha = 'FF') {
  if (!css) return null;
  const hex = css.replace('#', '');
  if (hex.length === 6) return (alpha + hex).toUpperCase();
  if (hex.length === 8) return hex.toUpperCase();
  return null;
}

/** Texto legible (negro o blanco) sobre un fondo ARGB */
function contrasteARGB(argb) {
  if (!argb || argb.length < 8) return '00000000';
  const r = parseInt(argb.slice(2, 4), 16);
  const g = parseInt(argb.slice(4, 6), 16);
  const b = parseInt(argb.slice(6, 8), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140 ? 'FF000000' : 'FFFFFFFF';
}

function fillSolid(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function borderThin() {
  const s = { style: 'thin', color: { argb: 'FFD0D0D0' } };
  return { top: s, left: s, bottom: s, right: s };
}

function intervalToExcelDuration(value) {
  if (value == null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value / 24;
  }

  if (typeof value === 'object') {
    const days = Number(value.days || 0);
    const hours = Number(value.hours || 0);
    const minutes = Number(value.minutes || 0);
    const seconds = Number(value.seconds || 0);
    const milliseconds = Number(value.milliseconds || 0);
    return (
      days +
      hours / 24 +
      minutes / 1440 +
      seconds / 86400 +
      milliseconds / 86400000
    );
  }

  const text = String(value).trim();
  const match = text.match(
    /^(?:(-?\d+)\s+days?\s+)?(-?\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/i
  );
  if (!match) return null;

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  return days + hours / 24 + minutes / 1440 + seconds / 86400;
}

function sanitizeSheetName(name) {
  return String(name || '')
    .replace(/[\\/*?:[\]]/g, '-')
    .slice(0, 31);
}

function buildMonthDates(anio, mes) {
  const year = Number(anio);
  const month = Number(mes);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return [];
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = [];
  for (let day = 1; day <= daysInMonth; day++) {
    dates.push(
      `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    );
  }
  return dates;
}

function buildWorkbookPorDia({ wb, agentes, filas, fechasSeleccionadas }) {
  const columnas = [
    { key: 'peloton_id', header: 'Pelotón ID', width: 12 },
    { key: 'peloton', header: 'Pelotón', width: 14 },
    { key: 'escalafon', header: 'Escalafón', width: 12 },
    { key: 'tip', header: 'TIP', width: 10 },
    { key: 'agente_id', header: 'Agente ID', width: 10 },
    { key: 'nombre', header: 'Nombre', width: 16 },
    { key: 'apellido_1', header: 'Apellido 1', width: 16 },
    { key: 'apellido_2', header: 'Apellido 2', width: 16 },
    { key: 'nombre_completo', header: 'Nombre completo', width: 34 },
    { key: 'empleo', header: 'Empleo', width: 16 },
    { key: 'titulacion', header: 'Titulación', width: 20 },
    { key: 'telefono', header: 'Teléfono', width: 14 },
    { key: 'grupo', header: 'Grupo', width: 10 },
    { key: 'fecha', header: 'Fecha', width: 12 },
    { key: 'grupo_servicio', header: 'Grupo servicio', width: 20 },
    { key: 'actividad', header: 'Actividad', width: 14 },
    { key: 'actividad_nombre', header: 'Actividad nombre', width: 40 },
    { key: 'hora_inicio', header: 'Hora inicio', width: 10 },
    { key: 'hora_fin', header: 'Hora fin', width: 10 },
    { key: 'duracion_horas', header: 'Duración horas', width: 14 },
    { key: 'observaciones', header: 'Observaciones', width: 28 },
  ];

  fechasSeleccionadas.forEach((fechaIso) => {
    const sheetName = sanitizeSheetName(fechaIso);
    const ws = wb.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = columnas;
    //ws.getColumn('duracion_horas').numFmt = '[h]:mm:ss';
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columnas.length },
    };

    const header = ws.getRow(1);
    header.height = 22;
    header.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = fillSolid('FF1E4D2B');
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = borderThin();
    });

    const rowsDia = filas
      .filter((r) => String(r.fecha).slice(0, 10) === fechaIso)
      .sort((a, b) => Number(a.agente_id || 0) - Number(b.agente_id || 0));

    const agentesOrdenados = (agentes || []).slice().sort((a, b) => {
      const p1 = String(a.peloton_id || '').localeCompare(
        String(b.peloton_id || ''),
        'es',
        { sensitivity: 'base' }
      );
      if (p1) return p1;
      const j1 = String(a.empleo_jerarquia || '9999999').localeCompare(
        String(b.empleo_jerarquia || '9999999')
      );
      if (j1) return j1;
      const antA = a.fecha_ant_empleo
        ? new Date(a.fecha_ant_empleo).getTime()
        : Infinity;
      const antB = b.fecha_ant_empleo
        ? new Date(b.fecha_ant_empleo).getTime()
        : Infinity;
      if (antA !== antB) return antA - antB;
      const ap1 = String(a.apellido_1 || '').localeCompare(
        String(b.apellido_1 || ''),
        'es',
        { sensitivity: 'base' }
      );
      if (ap1) return ap1;
      const ap2 = String(a.apellido_2 || '').localeCompare(
        String(b.apellido_2 || ''),
        'es',
        { sensitivity: 'base' }
      );
      if (ap2) return ap2;
      return String(a.nombre || '').localeCompare(
        String(b.nombre || ''),
        'es',
        { sensitivity: 'base' }
      );
    });

    const rowsByAgente = new Map();
    rowsDia.forEach((r) => {
      const agenteId = Number(r.agente_id || 0);
      if (!agenteId) return;
      if (!rowsByAgente.has(agenteId)) rowsByAgente.set(agenteId, []);
      rowsByAgente.get(agenteId).push(r);
    });

    const durColIdx = columnas.findIndex((c) => c.key === 'duracion_horas') + 1;
    let totalHoras = 0;

    agentesOrdenados.forEach((ag) => {
      const rowsAg = rowsByAgente.get(Number(ag.id)) || [];
      const first = rowsAg[0] || {};

      const actividades = Array.from(
        new Set(rowsAg.map((x) => x.actividad).filter(Boolean))
      );
      const actividadesNombre = Array.from(
        new Set(rowsAg.map((x) => x.actividad_nombre).filter(Boolean))
      );
      const gruposServicio = Array.from(
        new Set(rowsAg.map((x) => x.grupo_servicio).filter(Boolean))
      );

      let horaInicio = null;
      let horaFin = null;
      let horasNum = 0.0;
      rowsAg.forEach((x) => {
        const inicio = x.hora_inicio ? String(x.hora_inicio).slice(0, 5) : null;
        const fin = x.hora_fin ? String(x.hora_fin).slice(0, 5) : null;
        if (inicio && (!horaInicio || inicio < horaInicio)) horaInicio = inicio;
        if (fin && (!horaFin || fin > horaFin)) horaFin = fin;
        const h = intervalToExcelDuration(x.duracion_horas);
        if (h != null) horasNum += h * 24;
      });
      horasNum = Number(horasNum.toFixed(2));
      totalHoras += horasNum;

      const row = ws.addRow({
        peloton_id: ag.peloton_id ?? '',
        peloton: ag.peloton ?? '',
        escalafon: ag.escalafon ?? '',
        tip: ag.tip ?? '',
        agente_id: ag.id ?? '',
        nombre: ag.nombre ?? '',
        apellido_1: ag.apellido_1 ?? '',
        apellido_2: ag.apellido_2 ?? '',
        nombre_completo: [ag.apellido_1, ag.apellido_2, ag.nombre]
          .filter(Boolean)
          .join(' ')
          .trim(),
        empleo: ag.empleo ?? '',
        titulacion: ag.titulacion ?? '',
        telefono: ag.telefono ?? '',
        grupo: ag.grupo ?? '',
        fecha: fechaIso,
        grupo_servicio: gruposServicio.join(' | '),
        actividad: actividades.join('/'),
        actividad_nombre: actividadesNombre.join(' | '),
        hora_inicio: horaInicio || '',
        hora_fin: horaFin || '',
        duracion_horas: horasNum,
        observaciones: first.observaciones ?? '',
      });

      row.eachCell((c) => {
        c.border = borderThin();
        c.alignment = { vertical: 'middle', wrapText: true };
        c.font = { size: 9 };
      });

      const durCell = row.getCell(durColIdx);
      durCell.alignment = { horizontal: 'right', vertical: 'middle' };
      durCell.numFmt = '0.00';

      const actividadColorRaw = rowsAg.find(
        (x) => x.actividad_color && toARGB(x.actividad_color, 'FF')
      )?.actividad_color;
      const actividadColor = toARGB(actividadColorRaw, 'FF');
      if (actividadColor) {
        const actividadIdx =
          columnas.findIndex((c) => c.key === 'actividad') + 1;
        const actividadNombreIdx =
          columnas.findIndex((c) => c.key === 'actividad_nombre') + 1;
        [row.getCell(actividadIdx), row.getCell(actividadNombreIdx)].forEach(
          (cell) => {
            cell.fill = fillSolid(actividadColor);
            cell.font = {
              size: 9,
              bold: true,
              color: { argb: contrasteARGB(actividadColor) },
            };
          }
        );
      }
    });

    // ── Fila de total de horas ────────────────────────────────
    const totalRow = ws.addRow([]);
    totalRow.height = 18;
    ws.mergeCells(totalRow.number, 1, totalRow.number, durColIdx - 1);
    const labelCell = totalRow.getCell(1);
    labelCell.value = 'Total horas';
    labelCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    labelCell.fill = fillSolid('FF1E4D2B');
    labelCell.alignment = {
      horizontal: 'right',
      vertical: 'middle',
      indent: 1,
    };
    labelCell.border = borderThin();

    const totalCell = totalRow.getCell(durColIdx);
    totalCell.value = Number(totalHoras.toFixed(2));
    totalCell.numFmt = '0.00';
    totalCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    totalCell.fill = fillSolid('FF1E4D2B');
    totalCell.alignment = { horizontal: 'right', vertical: 'middle' };
    totalCell.border = borderThin();

    // Colorear también las celdas del merge restantes
    for (let ci = durColIdx + 1; ci <= columnas.length; ci++) {
      const c = totalRow.getCell(ci);
      c.fill = fillSolid('FF1E4D2B');
      c.border = borderThin();
    }
  });
}

// ── Obtener datos ─────────────────────────────────────────────

async function obtenerDatos({ anio, mes, borrador_id, ars_unidad_id }) {
  // Agentes completos (incluye los sin asignaciones ese período)
  const agentesRes = await db.query({
    text: `
    SELECT ag.id, ag.tip, ag.nombre,
          ag.peloton_id,
           ag.apellido_1, ag.apellido_2,
           ag.escalafon,
           ag.orden_gc    AS orden_gc,
           ag.fecha_ant_empleo,
           ag.aptitudes   AS titulacion,
           ag.telefono,
           e.descripcion  AS empleo,
           e.jerarquia    AS empleo_jerarquia,
           e.grupo        AS grupo,
           e.color        AS empleo_color,
           p.descripcion  AS peloton,
           p.color        AS peloton_color
    FROM agentes ag
    LEFT JOIN agentes_empleo    e ON e.id_empleo  = ag.empleo_id
    LEFT JOIN agentes_peloton   p ON p.id_peloton = ag.peloton_id
    WHERE ag.ars_unidad_id = $1 AND ag.fecha_baja IS NULL
    ORDER BY ag.escalafon, ag.peloton_id, e.jerarquia ASC, ag.fecha_ant_empleo ASC, ag.apellido_1, ag.apellido_2, ag.nombre
  `,
    values: [ars_unidad_id],
  });

  let filas = [];

  if (borrador_id) {
    const res = await db.query({
      text: `
      SELECT
        ag.peloton_id,
        ag.tip,
        ab.agente_id,
        ag.escalafon,
        ag.orden_gc AS orden_gc,
        ag.aptitudes    AS titulacion,
        ag.telefono,
        ag.nombre,
        ag.apellido_1,
        ag.apellido_2,
        CONCAT(ag.apellido_1, ' ', ag.apellido_2, ', ', ag.nombre) AS nombre_completo,
        ae.descripcion  AS empleo,
        ae.grupo,
        ae.color        AS empleo_color,
        p.descripcion   AS peloton,
        p.color         AS peloton_color,
        ab.fecha::date::text AS fecha,
        t.codigo        AS turno_codigo,
        t.nombre        AS turno_nombre,
        t.color         AS turno_color,
        a.actividad,
        a.nombre        AS actividad_nombre,
        a.color         AS actividad_color,
        ga.nombre       AS grupo_servicio,
        a.hora_inicio::text,
        a.hora_fin::text,
        (a.hora_fin - a.hora_inicio) AS duracion_horas,
        ab.observaciones
      FROM asignaciones_borrador ab
      JOIN agentes ag ON ag.id = ab.agente_id
      JOIN turnos t   ON t.id_turno = ab.turno_id
      LEFT JOIN asignaciones_borrador_servicios abs ON abs.asignacion_borrador_id = ab.id
      LEFT JOIN actividades a   ON a.id_actividad = abs.actividad_id
      LEFT JOIN grupos_actividad ga ON ga.id_grupo = a.grupo_id
      LEFT JOIN agentes_empleo ae ON ae.id_empleo  = ag.empleo_id
      LEFT JOIN agentes_peloton p  ON p.id_peloton  = ag.peloton_id
      WHERE ab.borrador_id = $1
        AND ab.ars_unidad_id = $2
      ORDER BY ag.escalafon, ag.peloton_id, ae.jerarquia ASC, ag.fecha_ant_empleo ASC, ag.apellido_1, ag.apellido_2, ab.fecha
    `,
      values: [borrador_id, ars_unidad_id],
    });
    filas = res.rows;
  } else {
    const res = await db.query({
      text: `
      SELECT
        ag.peloton_id,
        ag.tip,
        asig.agente_id,
        ag.escalafon,
        ag.orden_gc AS orden_gc,
        ag.aptitudes    AS titulacion,
        ag.telefono,
        ag.nombre,
        ag.apellido_1,
        ag.apellido_2,
        CONCAT(ag.apellido_1, ' ', ag.apellido_2, ', ', ag.nombre) AS nombre_completo,
        ae.descripcion  AS empleo,
        ae.grupo,
        ae.color        AS empleo_color,
        p.descripcion   AS peloton,
        p.color         AS peloton_color,
        asig.fecha::date::text AS fecha,
        t.codigo        AS turno_codigo,
        t.nombre        AS turno_nombre,
        t.color         AS turno_color,
        a.actividad,
        a.nombre        AS actividad_nombre,
        a.color         AS actividad_color,
        ga.nombre       AS grupo_servicio,
        a.hora_inicio::text,
        a.hora_fin::text,
        (a.hora_fin - a.hora_inicio) AS duracion_horas,
        asig.observaciones
      FROM asignaciones asig
      JOIN agentes ag ON ag.id = asig.agente_id
      JOIN turnos t   ON t.id_turno = asig.turno_id
      LEFT JOIN asignaciones_servicios aserv ON aserv.asignacion_id = asig.id
      LEFT JOIN actividades a   ON a.id_actividad = aserv.actividad_id
      LEFT JOIN grupos_actividad ga ON ga.id_grupo = a.grupo_id
      LEFT JOIN agentes_empleo ae ON ae.id_empleo  = ag.empleo_id
      LEFT JOIN agentes_peloton p  ON p.id_peloton  = ag.peloton_id
      WHERE asig.anio = $1 AND asig.mes = $2 AND asig.ars_unidad_id = $3
      ORDER BY ag.escalafon, ag.peloton_id, ae.jerarquia ASC, ag.fecha_ant_empleo ASC, ag.apellido_1, ag.apellido_2, asig.fecha
    `,
      values: [anio, mes, ars_unidad_id],
    });
    filas = res.rows;
  }

  return { agentes: agentesRes.rows, filas };
}

// ── Construir libro Excel ─────────────────────────────────────

async function construirExcel({ anio, mes, borrador_id, ars_unidad_id, fechas }) {
  const { agentes, filas } = await obtenerDatos({
    anio,
    mes,
    borrador_id,
    ars_unidad_id,
  });

  // Mapa fecha → (agente_id → { codigo, color, obs, actividades[] })
  // Una fila por actividad (LEFT JOIN), se agrupa aquí
  const mapaAsig = {};

  for (const f of filas) {
    const fecha = String(f.fecha).slice(0, 10);
    if (!mapaAsig[fecha]) mapaAsig[fecha] = {};
    if (!mapaAsig[fecha][f.agente_id]) {
      mapaAsig[fecha][f.agente_id] = {
        obs: f.observaciones || '',
        actividades: [],
      };
    }
    if (f.actividad) {
      mapaAsig[fecha][f.agente_id].actividades.push({
        codigo: f.actividad,
        nombre: f.actividad_nombre,
        color: f.actividad_color,
        hora_inicio: f.hora_inicio,
        hora_fin: f.hora_fin,
        duracion_horas: f.duracion_horas,
      });
    }
  }

  // En modo normal, el Excel debe mostrar todas las columnas de día del mes,
  // incluso cuando no existan asignaciones en una fecha.
  const fechasSeleccionadas = Array.isArray(fechas)
    ? Array.from(
        new Set(
          fechas
            .map((f) => String(f || '').slice(0, 10))
            .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
        )
      ).sort()
    : [];
  const fechasCuadrante = fechasSeleccionadas.length
    ? fechasSeleccionadas
    : buildMonthDates(anio, mes);

  // ── Workbook ──────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = `${ars_unidad_id || 'GRS'} Dashboard`;
  wb.created = new Date();
  wb.modified = new Date();

  // ── Hoja principal ────────────────────────────────────────
  const ws = wb.addWorksheet('Cuadrante', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    views: [{ state: 'frozen', ySplit: 1, xSplit: 9 }],
  });

  const HEADER_BG = 'FF1E4D2B';
  const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
  const DIAS_ES = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

  const headerValues = [
    'Pelotón',
    'Escalafón',
    'TIP',
    'Apellidos',
    'Nombre',
    'Empleo',
    'Grupo',
    'Titulación',
    'Teléfono',
    ...fechasCuadrante.map((f) => {
      const d = new Date(f + 'T00:00:00');
      return `${DIAS_ES[d.getDay()]}\n${String(d.getDate()).padStart(2, '0')}`;
    }),
    'Total Horas',
  ];

  const headerRow = ws.getRow(1);
  headerValues.forEach((v, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = v;
    cell.font = HEADER_FONT;
    cell.fill = fillSolid(HEADER_BG);
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
    cell.border = borderThin();
  });
  headerRow.height = 28;

  // ── AutoFiltro en columnas A–I (fila 1) ─────────────────────────
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };

  // ── Columnas ──────────────────────────────────────────────
  ws.getColumn(1).width = 12; // Pelotón
  ws.getColumn(2).width = 12; // Escalafón
  ws.getColumn(3).width = 8; // TIP
  ws.getColumn(4).width = 18; // Apellidos
  ws.getColumn(5).width = 14; // Nombre
  ws.getColumn(6).width = 14; // Empleo
  ws.getColumn(7).width = 10; // Grupo
  ws.getColumn(8).width = 18; // Titulación
  ws.getColumn(9).width = 12; // Teléfono
  for (let c = 10; c <= 9 + fechasCuadrante.length; c++) ws.getColumn(c).width = 7;
  const totalHorasCol = 10 + fechasCuadrante.length;
  ws.getColumn(totalHorasCol).width = 11; // Total Horas

  // ── Filas de agentes ──────────────────────────────────────
  let rowIndex = 2;
  const totalHorasPorDia = Object.fromEntries(fechasCuadrante.map((f) => [f, 0]));
  let totalHorasGeneral = 0;

  for (const ag of agentes) {
    const apellidos = [ag.apellido_1, ag.apellido_2].filter(Boolean).join(' ');

    const row = ws.getRow(rowIndex);
    row.height = 16;

    const pelotonARGB = toARGB(ag.peloton_color, 'FF');
    const empleoARGB = toARGB(ag.empleo_color, 'FF');

    const cellPel = row.getCell(1);
    const cellEsc = row.getCell(2);
    const cellTip = row.getCell(3);
    const cellApe = row.getCell(4);
    const cellNom = row.getCell(5);
    const cellEmp = row.getCell(6);
    const cellGru = row.getCell(7);
    const cellTit = row.getCell(8);
    const cellTel = row.getCell(9);

    cellPel.value = ag.peloton || '';
    cellEsc.value = ag.escalafon || '';
    cellTip.value = ag.tip || '';
    cellApe.value = apellidos;
    cellNom.value = ag.nombre || '';
    cellEmp.value = ag.empleo || '';
    cellGru.value = ag.grupo || '';
    cellTit.value = ag.titulacion || '';
    cellTel.value = ag.telefono || '';

    [
      cellPel,
      cellEsc,
      cellTip,
      cellApe,
      cellNom,
      cellEmp,
      cellGru,
      cellTit,
      cellTel,
    ].forEach((c) => {
      c.font = { size: 9 };
      c.alignment = { vertical: 'middle' };
      c.border = borderThin();
    });

    if (pelotonARGB) {
      cellPel.fill = fillSolid(pelotonARGB);
      cellPel.font = {
        size: 9,
        bold: true,
        color: { argb: contrasteARGB(pelotonARGB) },
      };
    }

    if (empleoARGB) {
      cellEmp.fill = fillSolid(empleoARGB);
      cellEmp.font = { size: 9, color: { argb: contrasteARGB(empleoARGB) } };
      cellGru.fill = fillSolid(empleoARGB);
      cellGru.font = { size: 9, color: { argb: contrasteARGB(empleoARGB) } };
    }

    let totalHorasFila = 0;

    // Celdas de turno por fecha
    fechasCuadrante.forEach((fecha, fi) => {
      const asig = mapaAsig[fecha]?.[ag.id];
      const cell = row.getCell(10 + fi);
      cell.border = borderThin();
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.font = { size: 8, bold: true };

      if (asig) {
        const duracionDia = asig.actividades.reduce(
          (acc, a) =>
            acc + (intervalToExcelDuration(a.duracion_horas) || 0) * 24,
          0
        );
        totalHorasFila += duracionDia;
        totalHorasPorDia[fecha] += duracionDia;

        const actividadCodigos = asig.actividades
          .map((a) => a.codigo)
          .filter(Boolean);
        const primeraHora = asig.actividades.find((a) => a.hora_inicio);
        const horaStr = primeraHora
          ? `\n${String(primeraHora.hora_inicio).slice(0, 5)}-${String(primeraHora.hora_fin).slice(0, 5)}`
          : '';
        cell.value = actividadCodigos.length
          ? `${actividadCodigos.join('/')}${horaStr}`
          : horaStr
            ? horaStr.trim()
            : '';

        const actividadColor =
          asig.actividades.find((a) => a.color && toARGB(a.color, 'FF'))
            ?.color || null;
        const argb = toARGB(actividadColor, 'FF');
        if (argb) {
          cell.fill = fillSolid(argb);
          cell.font = {
            size: 8,
            bold: true,
            color: { argb: contrasteARGB(argb) },
          };
        }
        // Nota: observaciones + actividades
        const noteLines = [];
        if (asig.obs) noteLines.push(`Obs: ${asig.obs}`);
        asig.actividades.forEach((a) => {
          let linea = a.nombre || a.codigo;
          if (a.hora_inicio)
            linea += ` (${a.hora_inicio.slice(0, 5)}-${a.hora_fin.slice(0, 5)}, ${a.duracion_horas}h)`;
          noteLines.push(linea);
        });
        if (noteLines.length) cell.note = noteLines.join('\n');
      } else {
        // Fin de semana: tono gris muy suave
        const d = new Date(fecha + 'T00:00:00').getDay();
        if (d === 0 || d === 6) {
          cell.fill = fillSolid('FFF2F2F2');
        }
      }
    });

    const totalCell = row.getCell(totalHorasCol);
    totalCell.value = Number(totalHorasFila.toFixed(2));
    totalCell.font = { size: 9, bold: true };
    totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
    totalCell.border = borderThin();
    totalCell.fill = fillSolid('FFF3F6F8');

    totalHorasGeneral += totalHorasFila;

    rowIndex++;
  }

  // Fila final: total de horas por día
  const totalDiaRow = ws.getRow(rowIndex);
  totalDiaRow.height = 18;
  ws.mergeCells(rowIndex, 1, rowIndex, 9);
  const totalLabelCell = totalDiaRow.getCell(1);
  totalLabelCell.value = 'Total horas/día';
  totalLabelCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  totalLabelCell.fill = fillSolid('FF1E4D2B');
  totalLabelCell.alignment = {
    horizontal: 'left',
    vertical: 'middle',
    indent: 1,
  };
  totalLabelCell.border = borderThin();

  fechasCuadrante.forEach((fecha, fi) => {
    const c = totalDiaRow.getCell(10 + fi);
    c.value = Number((totalHorasPorDia[fecha] || 0).toFixed(2));
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fillSolid('FF1E4D2B');
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = borderThin();
  });

  const totalGeneralCell = totalDiaRow.getCell(totalHorasCol);
  totalGeneralCell.value = Number(totalHorasGeneral.toFixed(2));
  totalGeneralCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  totalGeneralCell.fill = fillSolid('FF1E4D2B');
  totalGeneralCell.alignment = { horizontal: 'center', vertical: 'middle' };
  totalGeneralCell.border = borderThin();

  return wb;
}

// ── Export ────────────────────────────────────────────────────

exports.exportarXlsx = async (
  res,
  { anio, mes, borrador_id, nombreBorrador, modo, fechas, user, ars_unidad_id }
) => {
  let wb;

  if (modo === 'por_dia') {
    wb = new ExcelJS.Workbook();
    const { agentes, filas } = await obtenerDatos({
      anio,
      mes,
      borrador_id,
      user,
      ars_unidad_id,
    });
    const fechasSeleccionadas = (fechas || []).filter(Boolean);
    if (!fechasSeleccionadas.length) {
      throw new Error('No hay fechas seleccionadas para exportar por día');
    }
    buildWorkbookPorDia({ wb, agentes, filas, fechasSeleccionadas });
  } else {
    wb = await construirExcel({
      anio,
      mes,
      borrador_id,
      nombreBorrador,
      user,
      ars_unidad_id,
      fechas,
    });
  }

  const MESES_ES = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  const mesLit = MESES_ES[Number(mes) - 1] || mes;
  const suffixBase = borrador_id ? `_borrador${borrador_id}` : '_definitivo';
  const suffix = modo === 'por_dia' ? `${suffixBase}_por_dia` : suffixBase;
  const filename = `cuadrante_${anio}_${mesLit}${suffix}.xlsx`;

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Es más robusto responder con buffer completo para evitar respuestas pendientes
  // cuando el stream HTTP no finaliza correctamente en ciertos entornos.
  const data = await wb.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  res.setHeader('Content-Length', String(buffer.length));
  res.status(200).send(buffer);
};
