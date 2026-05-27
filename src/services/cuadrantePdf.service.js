'use strict';

const path = require('path');
const pdfmake = require('pdfmake');
const { DateTime } = require('luxon');
const db = require('../config/db');

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

const ZONE = 'Europe/Madrid';
const MONTHS_ES = [
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

function formatIsoDate(iso, fmt) {
  const dt = DateTime.fromISO(String(iso || '').slice(0, 10), {
    zone: ZONE,
  }).setLocale('es');
  return dt.isValid ? dt.toFormat(fmt) : String(iso || '').slice(0, 10);
}

function pelotonTextColor(bg) {
  const hex = String(bg || '').replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Luminance formula (WCAG)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#1f2937' : '#ffffff';
}

function safeText(value) {
  const text = String(value == null ? '' : value).trim();
  return text || '—';
}

function buildFilename({ anio, mes, arsId, borrador_id }) {
  const mesLit = MONTHS_ES[Number(mes) - 1] || String(mes);
  const suffix = borrador_id ? `_borrador${borrador_id}` : '_definitivo';
  const now = DateTime.now().setZone(ZONE);
  const timestamp = now.toFormat('yyyyMMdd_HHmmss');
  return `servicio_${String(arsId || 'GRS').replace(/[^a-z0-9_-]+/gi, '_')}_${anio}_${mesLit}${suffix}_${timestamp}.pdf`;
}

async function getArsMeta(ars_unidad_id) {
  if (!ars_unidad_id) {
    return { id_unidad: 'GRS', provincia: '' };
  }

  const result = await db.query(
    'SELECT id_unidad, poblacion, provincia FROM ars WHERE id_unidad = $1 LIMIT 1',
    [ars_unidad_id]
  );

  return result.rows[0] || { id_unidad: ars_unidad_id, provincia: '' };
}

async function obtenerFilasPdf({ anio, mes, borrador_id, ars_unidad_id }) {

  if (borrador_id) {
    const res = await db.query({
      text: `
        SELECT
          ag.peloton_id,
          ag.escalafon,
          ag.orden_gc AS orden_gc,
          ag.tip,
          ag.aptitudes AS titulacion,
          ag.telefono,
          CONCAT(ag.apellido_1, ' ', ag.apellido_2, ', ', ag.nombre) AS nombre_completo,
          ae.descripcion AS empleo,
          ae.jerarquia AS empleo_jerarquia,
          ag.fecha_ant_empleo,
          p.descripcion AS peloton,
          p.color AS peloton_color,
          ab.fecha::date::text AS fecha,
          ga.nombre AS grupo_servicio,
          a.nombre AS actividad_nombre,
          t.nombre AS turno_nombre,
          a.hora_inicio::text,
          a.hora_fin::text
        FROM asignaciones_borrador ab
        JOIN agentes ag ON ag.id = ab.agente_id
        JOIN turnos t ON t.id_turno = ab.turno_id
        LEFT JOIN asignaciones_borrador_servicios abs ON abs.asignacion_borrador_id = ab.id
        LEFT JOIN actividades a ON a.id_actividad = abs.actividad_id
        LEFT JOIN grupos_actividad ga ON ga.id_grupo = a.grupo_id
        LEFT JOIN agentes_empleo ae ON ae.id_empleo = ag.empleo_id
        LEFT JOIN agentes_peloton p ON p.id_peloton = ag.peloton_id
        WHERE ab.borrador_id = $1
          AND ab.ars_unidad_id = $2
        ORDER BY ab.fecha, ag.escalafon, ag.peloton_id, ae.jerarquia ASC, ag.fecha_ant_empleo ASC, ag.apellido_1, ag.apellido_2, ag.nombre, a.nombre
      `,
      values: [borrador_id, ars_unidad_id],
    });
    return res.rows;
  }

  const res = await db.query({
    text: `
      SELECT
        ag.peloton_id,
        ag.escalafon,
        ag.orden_gc AS orden_gc,
        ag.tip,
        ag.aptitudes AS titulacion,
        ag.telefono,
        CONCAT(ag.apellido_1, ' ', ag.apellido_2, ', ', ag.nombre) AS nombre_completo,
        ae.descripcion AS empleo,
        ae.jerarquia AS empleo_jerarquia,
        ag.fecha_ant_empleo,
        p.descripcion AS peloton,
        p.color AS peloton_color,
        asig.fecha::date::text AS fecha,
        ga.nombre AS grupo_servicio,
        a.nombre AS actividad_nombre,
        t.nombre AS turno_nombre,
        a.hora_inicio::text,
        a.hora_fin::text
      FROM asignaciones asig
      JOIN agentes ag ON ag.id = asig.agente_id
      JOIN turnos t ON t.id_turno = asig.turno_id
      LEFT JOIN asignaciones_servicios aserv ON aserv.asignacion_id = asig.id
      LEFT JOIN actividades a ON a.id_actividad = aserv.actividad_id
      LEFT JOIN grupos_actividad ga ON ga.id_grupo = a.grupo_id
      LEFT JOIN agentes_empleo ae ON ae.id_empleo = ag.empleo_id
      LEFT JOIN agentes_peloton p ON p.id_peloton = ag.peloton_id
      WHERE asig.anio = $1
        AND asig.mes = $2
        AND asig.ars_unidad_id = $3
      ORDER BY asig.fecha, ag.escalafon, ag.peloton_id, ae.jerarquia ASC, ag.fecha_ant_empleo ASC, ag.apellido_1, ag.apellido_2, ag.nombre, a.nombre
    `,
    values: [anio, mes, ars_unidad_id],
  });

  return res.rows;
}

function buildPelotonTable({
  fecha,
  peloton,
  pelotonColor,
  rows,
  arsLabel,
  provincia,
}) {
  const widths = [100, 160, 50, 120, 54];
  const body = [];
  const title = `Servicio ${arsLabel}${provincia ? ` · ${provincia}` : ''}`;

  body.push([
    {
      colSpan: widths.length,
      border: [false, false, false, false],
      margin: [0, 0, 0, 8],
      columns: [
        {
          text: title,
          bold: true,
          fontSize: 18,
          color: '#276836',
          alignment: 'left',
        },
        {
          text: formatIsoDate(fecha, "dd 'de' LLLL yyyy"),
          bold: true,
          fontSize: 18,
          color: '#276836',
          alignment: 'right',
        },
      ],
    },
    ...new Array(widths.length - 1).fill({}),
  ]);

  const pelFill =
    pelotonColor && /^#[0-9a-fA-F]{6}$/.test(pelotonColor)
      ? pelotonColor
      : '#276836';
  const pelText = pelotonTextColor(pelFill);
  body.push([
    {
      text: `Pelotón: ${safeText(peloton)}`,
      colSpan: widths.length,
      bold: true,
      fontSize: 12,
      color: pelText,
      fillColor: pelFill,
      margin: [6, 6, 6, 6],
    },
    ...new Array(widths.length - 1).fill({}),
  ]);

  body.push([
    { text: 'EMPLEO', bold: true, fillColor: '#e8efe9', margin: [4, 4, 4, 4] },
    {
      text: 'APELLIDOS Y NOMBRE',
      bold: true,
      fillColor: '#e8efe9',
      margin: [4, 4, 4, 4],
    },
    { text: 'TIP', bold: true, fillColor: '#e8efe9', margin: [4, 4, 4, 4] },
    {
      text: 'SERVICIO',
      bold: true,
      fillColor: '#e8efe9',
      margin: [4, 4, 4, 4],
    },
    {
      text: 'TELÉFONO',
      bold: true,
      fillColor: '#e8efe9',
      margin: [4, 4, 4, 4],
    },
  ]);

  rows.forEach((row) => {
    body.push([
      { text: safeText(row.empleo), margin: [4, 3, 4, 3] },
      { text: safeText(row.nombre_completo), margin: [4, 3, 4, 3] },
      { text: safeText(row.tip), alignment: 'center', margin: [4, 3, 4, 3] },
      {
        text: safeText(row.actividad_nombre || row.turno_nombre),
        margin: [4, 3, 4, 3],
      },
      {
        text: safeText(row.telefono),
        alignment: 'center',
        margin: [4, 3, 4, 3],
      },
    ]);
  });

  return {
    table: {
      headerRows: 3,
      widths,
      body,
    },
    layout: {
      hLineColor: (i) => (i <= 2 ? '#ffffff' : '#cbd5e1'),
      vLineColor: (i) =>
        i === 0 || i === widths.length ? '#cbd5e1' : '#d8e0e7',
      hLineWidth: (i) => (i <= 2 ? 0 : 0.5),
      vLineWidth: (i) => (i === 0 || i === widths.length ? 0.5 : 0.5),
    },
  };
}

exports.exportarPdf = async (
  res,
  { anio, mes, borrador_id, fechas, user, ars_unidad_id }
) => {
  const [arsMeta, filas] = await Promise.all([
    getArsMeta(ars_unidad_id),
    obtenerFilasPdf({ anio, mes, borrador_id, ars_unidad_id }),
  ]);

  const fechasSolicitadas = Array.isArray(fechas) ? fechas.filter(Boolean) : [];
  const fechasDisponibles = Array.from(
    new Set(
      (filas || [])
        .map((row) => String(row.fecha || '').slice(0, 10))
        .filter(Boolean)
    )
  ).sort();
  const fechasPdf = fechasSolicitadas.length
    ? fechasSolicitadas
    : fechasDisponibles;

  if (!fechasPdf.length) {
    throw new Error('No hay fechas disponibles para exportar a PDF');
  }
  const  filasResumen = [];
  const timestamp = DateTime.now().setZone(ZONE).setLocale('es');
  const timestampLabel = timestamp.toFormat('dd/LL/yyyy HH:mm:ss');
  const usuarioNombre =
    String(
      (user && (user.nombre || user.username || user.email)) || '—'
    ).trim() || '—';
  const arsLabel =
    arsMeta && arsMeta.id_unidad ? arsMeta.id_unidad : ars_unidad_id || 'GRS';
  const provincia =
    arsMeta && arsMeta.poblacion
      ? String(arsMeta.poblacion).trim()
      : arsMeta && arsMeta.provincia
        ? String(arsMeta.provincia).trim()
        : '';

  const logoPath = path.join(__dirname, '../../public/logogrs1_.png');
  /** @type {any[]} */
  const content = [
    {
      stack: [
        { text: 'Parte de Nombramientos', bold: true, fontSize: 24, color: '#276836', margin: [0, 0, 0, 14] },
        { image: logoPath, width: 180, height: 200, margin: [0, 0, 0, 12] },
        { text: `ARS Activo: ${arsLabel}${provincia ? ` · ${provincia}` : ''}`, fontSize: 20, margin: [0, 0, 0, 8] },
        { text: `Fecha: ${timestamp.toFormat("cccc, dd 'de' LLLL 'de' yyyy · HH:mm:ss")}`, fontSize: 13 },
      ],
      alignment: 'center',
      margin: [24, 220, 24, 0],
    },
  ];
  fechasPdf.forEach((fecha) => {
    const filasDia = (filas || [])
      .filter((row) => String(row.fecha || '').slice(0, 10) === fecha)
      .sort((a, b) => {
        const pelCmp = String(a.peloton || '').localeCompare(
          String(b.peloton || ''),
          'es',
          { sensitivity: 'base' }
        );
        if (pelCmp !== 0) return pelCmp;
        const jerCmp = String(a.empleo_jerarquia || '9999999').localeCompare(
          String(b.empleo_jerarquia || '9999999')
        );
        if (jerCmp !== 0) return jerCmp;
        return String(a.nombre_completo || '').localeCompare(
          String(b.nombre_completo || ''),
          'es',
          { sensitivity: 'base' }
        );
      });
    // Acumular filas para resumen general por pelotón y servicio
    filasResumen.push(...filasDia);
    const pelotones = new Map();
    const pelotonColors = new Map();
    filasDia.forEach((row) => {
      const key = String(row.peloton || 'Sin pelotón').trim() || 'Sin pelotón';
      if (!pelotones.has(key)) pelotones.set(key, []);
      pelotones.get(key).push(row);
      if (!pelotonColors.has(key) && row.peloton_color)
        pelotonColors.set(key, row.peloton_color);
    });

    if (!pelotones.size) {
      return;
    }

    Array.from(pelotones.entries()).forEach(([peloton, rows]) => {
      const pelotonColor = pelotonColors.get(peloton) || null;
      const block = buildPelotonTable({
        fecha,
        peloton,
        pelotonColor,
        rows,
        arsLabel,
        provincia,
      });
      block.pageBreak = 'before';
      content.push(block);
    });
      
  });

  if (!content.length) {
    throw new Error('No hay datos disponibles para exportar a PDF');
  }
  // Construir tabla resumen de agentes por pelotón y servicio (con celdas combinadas por pelotón)
  if (filasResumen && filasResumen.length > 0) {
    const resumenPorPeloton = new Map();
    filasResumen.forEach((row) => {
      const peloton =
        String(row.peloton || 'Sin pelotón').trim() || 'Sin pelotón';
      const servicio =
        String(row.actividad_nombre || row.turno_nombre || '—').trim() || '—';
      if (!resumenPorPeloton.has(peloton)) {
        resumenPorPeloton.set(peloton, {
          color:
            row.peloton_color && /^#[0-9a-fA-F]{6}$/.test(row.peloton_color)
              ? row.peloton_color
              : '#276836',
          servicios: new Map(),
        });
      }
      const grupo = resumenPorPeloton.get(peloton);
      grupo.servicios.set(servicio, (grupo.servicios.get(servicio) || 0) + 1);
    });

    /** @type {any[]} */
    const resumenBody = [
      [
        {
          text: 'Resumen  Servicios por Pelotón',
          colSpan: 3,
          bold: true,
          fillColor: '#dfe9e2',
          color: '#1f2937',
          fontSize: 11,
          margin: [4, 6, 4, 6],
          alignment: 'left',
        },
        {},
        {},
      ],
      [
        {
          text: 'PELOTÓN',
          bold: true,
          fillColor: '#e8efe9',
          margin: [4, 4, 4, 4],
        },
        {
          text: 'SERVICIO',
          bold: true,
          fillColor: '#e8efe9',
          margin: [4, 4, 4, 4],
        },
        {
          text: 'AGENTES',
          bold: true,
          fillColor: '#e8efe9',
          margin: [4, 4, 4, 4],
          alignment: 'center',
        },
      ],
    ];

    const pelotonesOrdenados = Array.from(resumenPorPeloton.entries()).sort(
      (a, b) =>
        String(a[0]).localeCompare(String(b[0]), 'es', { sensitivity: 'base' })
    );

    pelotonesOrdenados.forEach(([peloton, data]) => {
      const pelFill = data.color || '#276836';
      const pelText = pelotonTextColor(pelFill);
      const serviciosOrdenados = Array.from(data.servicios.entries()).sort(
        (a, b) =>
          String(a[0]).localeCompare(String(b[0]), 'es', {
            sensitivity: 'base',
          })
      );

      serviciosOrdenados.forEach(([servicio, count], idx) => {
        if (idx === 0) {
          resumenBody.push([
            {
              text: peloton,
              rowSpan: serviciosOrdenados.length,
              bold: true,
              color: pelText,
              fillColor: pelFill,
              margin: [4, 3, 4, 3],
            },
            { text: servicio, margin: [4, 3, 4, 3] },
            { text: String(count), alignment: 'center', margin: [4, 3, 4, 3] },
          ]);
          return;
        }

        resumenBody.push([
          {},
          { text: servicio, margin: [4, 3, 4, 3] },
          { text: String(count), alignment: 'center', margin: [4, 3, 4, 3] },
        ]);
      });
    });

    content.push({
      table: {
        headerRows: 2,
        widths: [130, '*', 80],
        body: resumenBody,
      },
      margin: [24, 0, 24, 0],
      pageBreak: 'before',
    });
  }

  /** @type {any} */
  const docDefinition = {
    info: {
      title: `Servicio ${arsLabel}`,
      author: arsLabel,
      creator: 'GRS Dashboard',
    },
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [24, 22, 24, 28],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 7,
      color: '#1f2937',
    },
    footer: (currentPage, pageCount) => ({
      margin: [24, 6, 24, 0],
      columns: [
        {
          text: `Impreso por: ${usuarioNombre}`,
          alignment: 'left',
          fontSize: 8,
          color: '#64748b',
        },
        {
          text: timestampLabel,
          alignment: 'center',
          fontSize: 8,
          color: '#64748b',
        },
        {
          text: `${currentPage}/${pageCount}`,
          alignment: 'right',
          fontSize: 8,
          color: '#64748b',
        },
      ],
    }),
    content,
  };

  const pdf = pdfmake.createPdf(docDefinition);
  const buffer = await pdf.getBuffer();
  const filename = buildFilename({ anio, mes, arsId: arsLabel, borrador_id });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(buffer);
};
