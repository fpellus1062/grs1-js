const db = require('../config/db');
const { DateTime } = require('luxon');

function parsePositiveIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(
    new Set(
      values
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );
}

function buildWeeks(fechaInicio, fechaFin) {
  const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const inicio = isDate(fechaInicio) ? DateTime.fromISO(fechaInicio, { zone: 'utc' }) : null;
  const fin = isDate(fechaFin) ? DateTime.fromISO(fechaFin, { zone: 'utc' }) : null;
  if (!inicio || !fin || !inicio.isValid || !fin.isValid || inicio > fin) {
    throw new Error('Selecciona fechas de inicio y fin válidas, con inicio anterior o igual a fin');
  }

  const semanas = [];
  let lunes = inicio.startOf('week');
  while (lunes <= fin) {
    const domingo = lunes.plus({ days: 6 });
    semanas.push({
      num_semana: semanas.length + 1,
      fecha_inicio: (lunes < inicio ? inicio : lunes).toISODate(),
      fecha_fin: (domingo > fin ? fin : domingo).toISODate(),
    });
    lunes = lunes.plus({ weeks: 1 });
  }
  return semanas;
}

function buildReport({ periodo, semanas, actividades, counts }) {
  const activityIds = (actividades || []).map((item) => Number(item.id_actividad));
  const agentes = new Map();

  (counts || []).forEach((count) => {
    const agenteId = Number(count.agente_id);
    const actividadId = Number(count.actividad_id);
    const semana = Number(count.num_semana);
    if (!agenteId || !activityIds.includes(actividadId) || !semana) return;

    if (!agentes.has(agenteId)) {
      agentes.set(agenteId, {
        agente_id: agenteId,
        tip: String(count.tip || ''),
        nombre: String(count.nombre || ''),
        empleo: String(count.empleo || ''),
        peloton: String(count.peloton || ''),
      });
    }

    const row = agentes.get(agenteId);
    row[`a${actividadId}_s${semana}`] =
      Number(row[`a${actividadId}_s${semana}`] || 0) + Number(count.dias_distintos || 0);
  });

  const rows = Array.from(agentes.values()).map((row) => {
    let totalGeneral = 0;
    activityIds.forEach((actividadId) => {
      const total = (semanas || []).reduce((sum, semana) => {
        const field = `a${actividadId}_s${Number(semana.num_semana)}`;
        row[field] = Number(row[field] || 0);
        return sum + row[field];
      }, 0);
      row[`a${actividadId}_total`] = total;
      row[`a${actividadId}_ajuste`] = 0;
      row[`a${actividadId}_final`] = total;
      totalGeneral += total;
    });
    row.total_calculado = totalGeneral;
    row.total_ajuste = 0;
    row.total_final = totalGeneral;
    return row;
  }).filter((row) => row.total_calculado !== 0);

  rows.sort((a, b) =>
    String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' }) ||
    String(a.tip).localeCompare(String(b.tip), 'es', { sensitivity: 'base' })
  );

  const actividadesConTotal = (actividades || []).filter((activity) =>
    rows.some((row) => Number(row[`a${Number(activity.id_actividad)}_total`] || 0) !== 0)
  );

  return {
    periodo,
    semanas: semanas || [],
    actividades: actividadesConTotal,
    rows,
  };
}

exports.getContexto = async () => {
  const columnasRes = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'grupos_actividad'`
  );
  const columnas = new Set(columnasRes.rows.map((row) => String(row.column_name || '')));
  const nivelCol = columnas.has('nivel_id')
    ? 'nivel_id'
    : columnas.has('nivel')
      ? 'nivel'
      : null;
  const gruposRes = await db.query(
    `SELECT id_grupo, nombre, parent_id_grupo,
              ${nivelCol ? `${nivelCol}::int` : '1::int'} AS nivel,
              orden, activo
         FROM grupos_actividad
        WHERE COALESCE(activo, true) = true
        ORDER BY COALESCE(${nivelCol || '1'}, 9999), COALESCE(orden, 0), nombre, id_grupo`
  );

  const grupos = gruposRes.rows.map((group) => ({ ...group }));
  const gruposById = new Map(grupos.map((group) => [Number(group.id_grupo), group]));
  const getPath = (group) => {
    const path = [];
    const visited = new Set();
    let current = group;
    while (current && !visited.has(Number(current.id_grupo))) {
      const id = Number(current.id_grupo);
      visited.add(id);
      path.unshift(`${String(current.orden == null ? 0 : current.orden).padStart(8, '0')}:${String(current.nombre || '')}`);
      current = gruposById.get(Number(current.parent_id_grupo));
    }
    return path;
  };
  grupos.forEach((group) => {
    const path = getPath(group);
    group.profundidad = Math.max(1, path.length);
    group.path = path.join('|');
  });
  grupos.sort((a, b) =>
    String(a.path).localeCompare(String(b.path), 'es', { sensitivity: 'base' }) ||
    Number(a.id_grupo) - Number(b.id_grupo)
  );

  return { grupos };
}

exports.getActividadesGrupo = async (grupoIds) => {
  const ids = parsePositiveIds(grupoIds);
  if (!ids.length) throw new Error('Selecciona al menos un grupo');
  const { rows } = await db.query(
    `WITH RECURSIVE descendientes AS (
       SELECT id_grupo
         FROM grupos_actividad
        WHERE id_grupo = ANY($1::int[])
       UNION
       SELECT g.id_grupo
         FROM grupos_actividad g
         JOIN descendientes d ON g.parent_id_grupo = d.id_grupo
     )
     SELECT a.id_actividad, a.actividad, a.nombre, a.grupo_id,
            (SELECT g.nombre FROM grupos_actividad g WHERE g.id_grupo = a.grupo_id) AS grupo_nombre
       FROM actividades a
       JOIN descendientes d ON d.id_grupo = a.grupo_id
      WHERE a.fecha_baja IS NULL
      ORDER BY grupo_nombre, a.actividad, a.nombre, a.id_actividad`,
    [ids]
  );
  return rows;
};

exports.getInforme = async ({ arsUnidadId, fechaInicio, fechaFin, soloPernoctas = false, grupoIds, actividadIds }) => {
  const ids = parsePositiveIds(actividadIds);
  const semanas = buildWeeks(fechaInicio, fechaFin);
  const periodo = { fecha_inicio: fechaInicio, fecha_fin: fechaFin, solo_pernoctas: soloPernoctas };
  const actividadesDisponibles = await exports.getActividadesGrupo(grupoIds);
  const permitidas = new Set(actividadesDisponibles.map((item) => Number(item.id_actividad)));
  const actividades = actividadesDisponibles.filter((item) =>
    permitidas.has(Number(item.id_actividad)) && ids.includes(Number(item.id_actividad))
  );

  if (ids.length && actividades.length !== ids.length) {
    throw new Error('Alguna actividad no pertenece a los grupos seleccionados');
  }

  if (!actividades.length) {
    return buildReport({
      periodo,
      semanas,
      actividades,
      counts: [],
    });
  }

  const selectedIds = actividades.map((item) => Number(item.id_actividad));
  const { rows } = await db.query(
    `SELECT ag.id AS agente_id,
            COALESCE(ag.tip, '') AS tip,
            TRIM(CONCAT_WS(' ', ag.apellido_1, ag.apellido_2, ag.nombre)) AS nombre,
            COALESCE(e.descripcion, '') AS empleo,
            COALESCE(p.descripcion, '') AS peloton,
            s.actividad_id,
            ((date_trunc('week', asig.fecha)::date - date_trunc('week', $3::date)::date) / 7 + 1)::int AS num_semana,
            COUNT(DISTINCT asig.fecha)::int AS dias_distintos
       FROM asignaciones asig
       JOIN asignaciones_servicios s ON s.asignacion_id = asig.id
       JOIN agentes ag ON ag.id = asig.agente_id
       LEFT JOIN agentes_empleo e ON e.id_empleo = ag.empleo_id
       LEFT JOIN agentes_peloton p ON p.id_peloton = ag.peloton_id
      WHERE asig.ars_unidad_id = $1
        AND asig.dia = 1
        AND s.actividad_id = ANY($2::int[])
        AND asig.fecha BETWEEN $3::date AND $4::date
        AND (NOT $5::boolean OR asig.turno_id = 99999)
        AND ag.fecha_baja IS NULL
        AND COALESCE(ag.situacion_id, '') <> 'REBASE'
      GROUP BY ag.id, ag.tip, ag.apellido_1, ag.apellido_2, ag.nombre,
               e.descripcion, p.descripcion, s.actividad_id, num_semana
      ORDER BY ag.apellido_1, ag.apellido_2, ag.nombre, s.actividad_id, num_semana`,
    [arsUnidadId, selectedIds, fechaInicio, fechaFin, soloPernoctas]
  );

  return buildReport({
    periodo,
    semanas,
    actividades,
    counts: rows,
  });
};

exports.parsePositiveIds = parsePositiveIds;
exports.buildReport = buildReport;
exports.buildWeeks = buildWeeks;
