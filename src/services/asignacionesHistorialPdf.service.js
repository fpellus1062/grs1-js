const path = require('path');
const pdfmake = require('pdfmake');
const { normalizeHexColor } = require('../utils/color');

// ── Fuentes ──────────────────────────────────────────────────
pdfmake.addFonts({
  Roboto: {
    normal: path.join(
      __dirname,
      '../../node_modules/pdfmake/fonts/Roboto/Roboto-Regular.ttf'
    ),
    bold: path.join(
      __dirname,
      '../../node_modules/pdfmake/fonts/Roboto/Roboto-Medium.ttf'
    ),
    italics: path.join(
      __dirname,
      '../../node_modules/pdfmake/fonts/Roboto/Roboto-Italic.ttf'
    ),
    bolditalics: path.join(
      __dirname,
      '../../node_modules/pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf'
    ),
  },
});

// ── Helpers ──────────────────────────────────────────────────
const MONTHS = [
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

function formatPeriodo(anio, mes) {
  return `${MONTHS[Number(mes) - 1] || mes} ${anio}`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString(
    'es-ES'
  );
}

// Construye mapas id→objeto para búsquedas O(1)
function buildMeta(turnos, actividades) {
  const turnoMap = new Map((turnos || []).map((t) => [Number(t.id_turno), t]));
  const actMap = new Map(
    (actividades || []).map((a) => [Number(a.id_actividad), a])
  );
  return { turnoMap, actMap };
}

function getActividadDisplay(id, actMap) {
  if (!id) {
    return { label: `#${id}`, color: null };
  }
  const a = actMap.get(Number(id));
  if (!a) {
    return { label: `#${id}`, color: null };
  }
  return {
    label: a.nombre ? `${a.codigo} - ${a.nombre}` : a.codigo,
    color: a.actividad_color || a.color || null,
  };
}

function getActividadesRichText(ids, actMap) {
  if (!Array.isArray(ids) || !ids.length) {
    return { richText: '—', sortKey: '—' };
  }

  const chunks = [];
  const labels = [];

  ids.forEach((id, idx) => {
    const act = getActividadDisplay(id, actMap);
    const chipColor = normalizeHexColor(act.color) || '#64748b';
    labels.push(act.label);

    if (idx > 0) {
      chunks.push({ text: ', ', color: '#1f2937' });
    }

    // Marcador en color para identificar visualmente la actividad en PDF.
    chunks.push({ text: '■ ', color: chipColor, bold: true });
    chunks.push({ text: act.label, color: '#1f2937' });
  });

  return { richText: chunks, sortKey: labels.join(', ') };
}

// ── Extrae entradas { fecha, turno_id, actividad_ids, observaciones }[]
// desde cualquier formato de datos (masivo con fechas:{} o individual)
function extractDayEntries(datos, logFecha) {
  if (!datos || typeof datos !== 'object') return [];
  if (datos.fechas && typeof datos.fechas === 'object') {
    return Object.entries(datos.fechas)
      .filter(([, v]) => v !== null && typeof v === 'object')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, v]) => ({ fecha, ...v }));
  }
  // Formato individual
  const fecha =
    datos.fecha || (logFecha ? String(logFecha).slice(0, 10) : null);
  return [
    {
      fecha,
      turno_id: datos.turno_id,
      actividad_ids: datos.actividad_ids,
      observaciones: datos.observaciones,
    },
  ];

}

function formatNuevoServicio(entry, turnoMap, actMap) {
  const actividades = getActividadesRichText(entry.actividad_ids, actMap);
  if (actividades.sortKey === '—') {
    return { richText: '—', sortKey: '—' };
  }
  return actividades;
}

function buildHistorialTable(logs, turnoMap, actMap) {
  const body = [
    [
      {
        text: 'Ordinal',
        bold: true,
        fillColor: '#e2e8f0',
        color: '#0f172a',
        alignment: 'center',
        margin: [0, 4, 0, 4],
      },
      {
        text: 'TIP',
        bold: true,
        fillColor: '#e2e8f0',
        color: '#0f172a',
        alignment: 'center',
        margin: [0, 4, 0, 4],
      },
      {
        text: 'Dia Cuadrante',
        bold: true,
        fillColor: '#e2e8f0',
        color: '#0f172a',
        alignment: 'center',
        margin: [0, 4, 0, 4],
      },
      {
        text: 'Nuevo Servicio',
        bold: true,
        fillColor: '#e2e8f0',
        color: '#0f172a',
        alignment: 'center',
        margin: [0, 4, 0, 4],
      },
    ],
  ];

  const rows = [];
  (logs || []).forEach((log) => {
    const postEntries = extractDayEntries(log.datos_nuevos, log.fecha);
    const entries = postEntries.length
      ? postEntries
      : [{ fecha: log.fecha, turno_id: null, actividad_ids: [] }];

    entries.forEach((entry) => {
      const tip = log.agente_tip || '—';
      const fechaIso = entry.fecha ? String(entry.fecha).slice(0, 10) : null;
      const diaCuadranteDate = fechaIso
        ? new Date(`${fechaIso}T00:00:00`)
        : null;
      const diaCuadrante = diaCuadranteDate ? formatDate(fechaIso) : '—';
      const nuevoServicio = formatNuevoServicio(entry, turnoMap, actMap);
      rows.push({
        tip,
        diaCuadrante,
        diaCuadranteDate,
        nuevoServicioText: nuevoServicio.richText,
        nuevoServicioSort: nuevoServicio.sortKey,
      });
    });
  });

  rows.sort((a, b) => {
    const tipCmp = a.tip.localeCompare(b.tip, 'es', { sensitivity: 'base' });
    if (tipCmp !== 0) return tipCmp;
    const aTime =
      a.diaCuadranteDate instanceof Date ? a.diaCuadranteDate.getTime() : 0;
    const bTime =
      b.diaCuadranteDate instanceof Date ? b.diaCuadranteDate.getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.nuevoServicioSort.localeCompare(b.nuevoServicioSort, 'es', {
      sensitivity: 'base',
    });
  });

  rows.forEach((row, idx) => {
    body.push([
      {
        text: String(idx + 1),
        alignment: 'center',
        margin: [0, 3, 0, 3],
      },
      {
        text: row.tip,
        alignment: 'center',
        margin: [0, 3, 0, 3],
      },
      {
        text: row.diaCuadrante,
        alignment: 'center',
        margin: [0, 3, 0, 3],
      },
      {
        text: row.nuevoServicioText,
        margin: [4, 3, 4, 3],
        alignment: 'left',
      },
    ]);
  });

  return {
    table: {
      headerRows: 1,
      widths: [40, 70, 80, '*'],
      body,
    },
    layout: {
      hLineColor: () => '#cbd5e1',
      vLineColor: () => '#cbd5e1',
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
    },
  };
}

// ── Filtro: solo el último sin-marcar por agente+día + todos los marcados ─
function filterLatestEntries(logs) {
  if (!Array.isArray(logs) || !logs.length) return logs;
  const comunicados = logs.filter((e) => !!e.comunicado_at);
  const sinMarcar = logs.filter((e) => !e.comunicado_at);
  const latestByAgentDay = new Map();
  sinMarcar.forEach((entry) => {
    const day = entry.fecha
      ? String(entry.fecha).slice(0, 10)
      : String(entry.historial_day_key || '__SIN_FECHA_MASIVO__');
    const key = String(entry.agente_id || '') + '|' + day;
    const existing = latestByAgentDay.get(key);
    if (!existing) {
      latestByAgentDay.set(key, entry);
    } else {
      const tExisting = new Date(existing.created_at || 0).getTime();
      const tNew = new Date(entry.created_at || 0).getTime();
      if (
        tNew > tExisting ||
        (tNew === tExisting && Number(entry.id || 0) > Number(existing.id || 0))
      ) {
        latestByAgentDay.set(key, entry);
      }
    }
  });
  return [...comunicados, ...Array.from(latestByAgentDay.values())];
}

// ── Exportar ─────────────────────────────────────────────────
exports.buildHistorialPdf = async (
  {
    anio,
    mes,
    nombreBorrador,
    logs,
    turnos,
    actividades,
    usuarioNombre,
    ars_unidad_id,
    esCopiaComunciados,
    fileBaseName,
    csvFileName,
    csvFilePath,
  }
) => {
  const { turnoMap, actMap } = buildMeta(turnos, actividades);
  const periodo = formatPeriodo(anio, mes);
  const titulo = nombreBorrador
    ? `Historial de cuadrante · ${periodo} · ${nombreBorrador}`
    : `Historial de cuadrante · ${periodo}`;
  const filteredLogs = filterLatestEntries(logs);
  const historialTable = buildHistorialTable(filteredLogs, turnoMap, actMap);
  const tenantLabel = ars_unidad_id || 'GRS';
  const docDefinition = {
    info: {
      title: titulo,
      subject: 'Historial de cambios de asignaciones',
      author: tenantLabel,
      creator: 'GRS Dashboard',
    },
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [28, 70, 28, 36],
    watermark: esCopiaComunciados
      ? { text: 'COPIA DE COMUNICADOS', color: '#b91c1c', opacity: 0.12, bold: true, fontSize: 42, angle: -45 }
      : undefined,
    defaultStyle: { font: 'Roboto', fontSize: 7.5, color: '#1f2937' },
    styles: {
      docTitle: { fontSize: 13, bold: true, color: '#0f172a' },
      docMeta: { fontSize: 7.5, color: '#64748b' },
    },
    //Cabecera y pie de página con información contextual y número de página
    header: (currentPage, pageCount) => ({
      stack: [
        {
          text: 'DIARIO DE CAMBIO DE SERVICIOS',
          alignment: 'center',
          bold: true,
          fontSize: 13,
          color: '#0f172a',
          margin: [28, 14, 28, 2],
        },
        {
          text: [
            nombreBorrador
              ? `Borrador: ${nombreBorrador}`
              : `Período: ${periodo}`,
            usuarioNombre ? `  ·  Propietario: ${usuarioNombre}` : '',
            `  ·  ARS: ${tenantLabel}`,
          ].join(''),
          alignment: 'center',
          fontSize: 7.5,
          color: '#475569',
          margin: [28, 0, 28, 2],
        },
        {
          text: fileBaseName
              ? `Sello: ${csvFilePath}`
              : '',
          alignment: 'center',
          fontSize: 5.5,
          color: '#64748b',
          margin: [28, 0, 28, 2],
        },
        {
          text: `Pág. ${currentPage} / ${pageCount}`,
          alignment: 'right',
          fontSize: 7,
          color: '#94a3b8',
          margin: [28, 0, 28, 0],
        },
      ],
    }),
    footer: () => ({
      text: `Generado el ${new Date().toLocaleString('es-ES')} · ${usuarioNombre ? 'Impreso por: ' + usuarioNombre + ' · ' : ''}${tenantLabel}`,
      alignment: 'center',
      margin: [0, 6, 0, 0],
      fontSize: 6.5,
      color: '#94a3b8',
    }),
    content: (filteredLogs || []).length
      ? [
          {
            text: `${(filteredLogs || []).length} registro(s)`,
            style: 'docMeta',
            margin: [0, 0, 0, 10],
          },
          historialTable,
        ]
      : [
          {
            text: 'No hay cambios registrados para los filtros indicados.',
            color: '#64748b',
            margin: [0, 20, 0, 0],
          },
        ],
  };

  // @ts-ignore
  const pdf = pdfmake.createPdf(docDefinition);
  const buffer = await pdf.getBuffer();
  const safeName = String(fileBaseName || titulo)
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/_+/g, '_');

  return { buffer, fileName: `${safeName}.pdf` };
};

exports.exportarHistorialPdf = async (
  res,
  payload
) => {
  const { buffer, fileName } = await exports.buildHistorialPdf(payload);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName}"`
  );
  res.end(buffer);
};
