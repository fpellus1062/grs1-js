const db = require('../config/db');
const { randomUUID } = require('crypto');
const { DateTime } = require('luxon');
const { withRetry } = require('../utils/retry');

let _ledgerObservacionesColumnCache = null;

// ── Transacción genérica ─────────────────────────────────────
async function withTransaction(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function parseDateToIsoDay(raw, errorMessage) {
  const value = String(raw || '').trim();
  if (!value) {
    throw new Error(errorMessage);
  }

  let dt = DateTime.fromISO(value, { zone: 'utc' });
  if (!dt.isValid && value.includes(' ')) {
    dt = DateTime.fromISO(value.replace(' ', 'T'), { zone: 'utc' });
  }
  if (!dt.isValid) {
    dt = DateTime.fromSQL(value, { zone: 'utc' });
  }

  if (!dt.isValid) {
    throw new Error(errorMessage);
  }

  return dt.toUTC().toISODate();
}

function normalizeDateInput(raw) {
  return parseDateToIsoDay(raw, 'Fecha inválida, formato esperado YYYY-MM-DD');
}

function normalizeNullableDate(raw) {
  if (raw == null || raw === '') return null;
  return normalizeDateInput(raw);
}

function normalizeDayKey(raw) {
  return parseDateToIsoDay(raw, 'Fecha inválida para cálculo de rachas consecutivas');
}

function ensureDateRange(fechaDesde, fechaHasta) {
  const from = normalizeDateInput(fechaDesde);
  const to = normalizeDateInput(fechaHasta || fechaDesde);
  if (to < from) {
    throw new Error('La fecha hasta no puede ser anterior a la fecha desde');
  }
  return { from, to };
}

function normalizeEmpleoId(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value || value.toLowerCase() === 'null') return null;
  return value;
}

function roundToOneDecimal(raw) {
  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10) / 10;
}

function roundToOneDecimalAllowZero(raw) {
  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10) / 10;
}

function normalizeNullablePositiveInt(raw, fieldName) {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} inválido`);
  }
  return value;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeTipoDia(raw) {
  const value = String(raw || 'periodo').trim().toLowerCase();
  const allowed = ['periodo', 'festivo', 'fin_semana', 'laborable'];
  return allowed.includes(value) ? value : 'periodo';
}

function normalizeCategoriaRegla(raw) {
  if (raw == null || raw === '') return null;
  const value = String(raw).trim();
  if (value === 'Regla_Especial' || value === 'Descanso_Semanal_Cuadrante') {
    return 'Regla_Especial';
  }
  const allowed = ['Regla_Normal', 'Regla_Especial'];
  if (!allowed.includes(value)) {
    throw new Error('Categoria de regla inválida');
  }
  return value;
}

async function hasLedgerObservacionesColumn(client) {
  if (_ledgerObservacionesColumnCache != null) {
    return _ledgerObservacionesColumnCache;
  }

  const executor = client || db;
  const result = await executor.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'asignaciones_ledger_movimientos'
        AND column_name = 'observaciones'
      LIMIT 1`
  );

  _ledgerObservacionesColumnCache = !!(result.rows && result.rows.length);
  return _ledgerObservacionesColumnCache;
}

function ensureValidScope({ actividadId, grupoId, condicionAlcance }) {
  if (condicionAlcance === 'cualquier_actividad') {
    if (actividadId != null || grupoId != null) {
      throw new Error(
        'Para alcance "cualquier_actividad" no debe informar actividad ni grupo'
      );
    }
    return;
  }

  if (condicionAlcance === 'actividad') {
    if (actividadId == null || grupoId != null) {
      throw new Error(
        'Para alcance "actividad" debe informar actividad y no grupo'
      );
    }
    return;
  }

  if (condicionAlcance === 'grupo') {
    if (grupoId == null || actividadId != null) {
      throw new Error('Para alcance "grupo" debe informar grupo y no actividad');
    }
    return;
  }

  const hasActividad = actividadId != null;
  const hasGrupo = grupoId != null;
  if ((hasActividad && hasGrupo) || (!hasActividad && !hasGrupo)) {
    throw new Error('Debe informar actividad o grupo (uno solo)');
  }
}

async function resolvePreviewRange({
  arsUnidadId,
  borradorId,
  agenteId,
  actividadId,
  fecha,
  fechaHasta,
}) {
  const fromInput = normalizeNullableDate(fecha);
  const toInput = normalizeNullableDate(fechaHasta);

  if (toInput) {
    if (!fromInput) {
      throw new Error('Debe informar Fecha cuando use Fecha hasta');
    }
    return ensureDateRange(fromInput, toInput);
  }

  if (!borradorId) {
    throw new Error(
      'Debe seleccionar un borrador cuando no informe Fecha hasta'
    );
  }

  const result = await db.query(
    `SELECT MIN(ab.fecha)::date::text AS fecha_desde,
            MAX(ab.fecha)::date::text AS fecha_hasta
       FROM asignaciones_borrador ab
       JOIN asignaciones_borrador_servicios bs
         ON bs.asignacion_borrador_id = ab.id
      WHERE ab.borrador_id = $1
        AND ab.ars_unidad_id::text = $2::text
        AND ab.agente_id = $3
        AND bs.actividad_id = $4`,
    [borradorId, arsUnidadId, agenteId, actividadId]
  );

  const row = result.rows[0] || null;
  if (!row?.fecha_desde || !row?.fecha_hasta) {
    throw new Error(
      'El borrador seleccionado no contiene fechas para el agente y la actividad indicados'
    );
  }

  return ensureDateRange(row.fecha_desde, row.fecha_hasta);
}

async function getAgenteContext(agenteId, arsUnidadId) {
  const result = await db.query(
    `SELECT ag.id AS agente_id,
            ag.empleo_id,
            e.descripcion AS empleo_nombre,
            ag.nombre,
            ag.apellido_1,
            ag.apellido_2
       FROM agentes ag
        LEFT JOIN agentes_empleo e ON e.id_empleo::text = ag.empleo_id::text
      WHERE ag.id = $1 AND ag.ars_unidad_id::text = $2::text AND ag.fecha_baja IS NULL`,
    [agenteId, arsUnidadId]
  );

  if (!result.rows.length) {
    throw new Error('Agente no encontrado para la agrupación seleccionada o dado de baja');
  }

  return result.rows[0];
}

async function resolveApplicableRule({
  arsUnidadId,
  actividadId,
  empleoId,
  fecha,
  fechaHasta,
  diasTrabajados = null,  // Cuando se provee, filtra reglas cuya condicion_dias no supera el umbral
                          // y prioriza la más específica (mayor condicion_dias) para resolver solapamientos modulares.
}) {
  const empleoIdNormalized = normalizeEmpleoId(empleoId);
  const params = [arsUnidadId, actividadId, fecha, empleoIdNormalized, fechaHasta || null];

  let diasWhere = '';
  let diasOrder = '';
  if (diasTrabajados != null && Number.isFinite(Number(diasTrabajados))) {
    params.push(Number(diasTrabajados));
    diasWhere = `AND (r.condicion_dias IS NULL OR r.condicion_dias <= $${params.length}::numeric)`;
    diasOrder = 'r.condicion_dias DESC,';
  }

  const result = await db.query(
    `WITH RECURSIVE grp AS (
       SELECT a.grupo_id AS id_grupo, 0 AS depth
         FROM actividades a
        WHERE a.id_actividad = $2::integer
          AND a.grupo_id IS NOT NULL
       UNION ALL
       SELECT g.parent_id_grupo AS id_grupo, grp.depth + 1 AS depth
         FROM grupos_actividad g
         JOIN grp ON grp.id_grupo = g.id_grupo
        WHERE g.parent_id_grupo IS NOT NULL
     )
     SELECT r.*,
            a.nombre AS actividad_nombre,
            a.actividad AS actividad_codigo,
            ga.nombre AS grupo_nombre,
            e.descripcion AS empleo_nombre,
            CASE
              WHEN r.actividad_id = $2::integer THEN 0
              WHEN r.grupo_id IS NOT NULL THEN 1
              ELSE 2
            END AS scope_rank,
            COALESCE((
              SELECT MIN(grp.depth) FROM grp WHERE grp.id_grupo = r.grupo_id
            ), 9999) AS group_depth,
            CASE WHEN r.empleo_id::text = $4::text THEN 0 ELSE 1 END AS empleo_rank
       FROM asignaciones_reglas r
  LEFT JOIN actividades a ON a.id_actividad = r.actividad_id
  LEFT JOIN grupos_actividad ga ON ga.id_grupo = r.grupo_id
  LEFT JOIN agentes_empleo e ON e.id_empleo::text = r.empleo_id::text
      WHERE r.ars_unidad_id::text = $1::text
        AND r.activo = true
        AND (r.categoria_regla IS NULL OR r.categoria_regla = 'Regla_Normal')
        AND r.vigencia_desde <= $3::date
        AND (r.vigencia_hasta IS NULL OR r.vigencia_hasta >= $5::date)
        AND (r.empleo_id IS NULL OR r.empleo_id::text = $4::text)
        AND (
          r.actividad_id = $2::integer
          OR (
            r.grupo_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM grp WHERE grp.id_grupo = r.grupo_id
            )
          )
        )
        ${diasWhere}
      ORDER BY scope_rank ASC, group_depth ASC, empleo_rank ASC, ${diasOrder} r.prioridad ASC, r.id DESC
      LIMIT 1`,
    params
  );

  return result.rows[0] || null;
}

async function getSaldoAnterior({ arsUnidadId, agenteId, empleoId, fecha }) {
  const empleoIdNormalized = normalizeEmpleoId(empleoId);
  const result = await db.query(
    `SELECT COALESCE(SUM(signo * cantidad_dias), 0)::numeric(12,2) AS saldo
       FROM asignaciones_ledger_movimientos
      WHERE ars_unidad_id::text = $1::text
        AND agente_id = $2
        AND COALESCE(empleo_id::text, '__NULL__') = COALESCE($3::text, '__NULL__')
        AND fecha < $4::date`,
    [arsUnidadId, agenteId, empleoIdNormalized, fecha]
  );

  return Number(result.rows[0]?.saldo || 0);
}

async function countCrucesFestivosEnRango({
  arsUnidadId,
  fechaDesde,
  fechaHasta,
}) {
  const { from, to } = ensureDateRange(fechaDesde, fechaHasta);
  const result = await db.query(
    `SELECT COUNT(*)::int AS cruces
       FROM generate_series($2::date, $3::date, interval '1 day') d(fecha)
      WHERE EXISTS (
        SELECT 1
          FROM festivos f
          JOIN calendarios c ON c.id = f.calendario_id
         WHERE c.ars_unidad_id::text = $1::text
           AND c.activo = true
           AND (
             (f.es_recurrente = false AND f.fecha::date = d.fecha::date)
             OR (
               f.es_recurrente = true
               AND EXTRACT(MONTH FROM f.fecha::date) = EXTRACT(MONTH FROM d.fecha::date)
               AND EXTRACT(DAY FROM f.fecha::date) = EXTRACT(DAY FROM d.fecha::date)
             )
           )
      )`,
    [arsUnidadId, from, to]
  );
  return Number(result.rows[0]?.cruces || 0);
}

async function countDiasEnRango({ fechaDesde, fechaHasta }) {
  const { from, to } = ensureDateRange(fechaDesde, fechaHasta);
  const result = await db.query(
    `SELECT COUNT(*)::int AS total
       FROM generate_series($1::date, $2::date, interval '1 day') d(fecha)`,
    [from, to]
  );
  return Number(result.rows[0]?.total || 0);
}

async function resolveBorradorRangeForAgente({ arsUnidadId, borradorId }) {
  const result = await db.query(
    `SELECT cp.fecha_inicio::text AS fecha_desde,
            cp.fecha_fin::text AS fecha_hasta
       FROM asignaciones_borradores b
       JOIN cuadrantes_planificacion cp
         ON cp.ars_unidad_id::text = b.ars_unidad_id::text
        AND cp.anio_referencia = b.anio
        AND cp.mes_referencia = b.mes
        AND cp.estado <> 'archivado'
      WHERE b.id = $1
        AND b.ars_unidad_id::text = $2::text
      ORDER BY cp.updated_at DESC, cp.id DESC
      LIMIT 1`,
    [borradorId, arsUnidadId]
  );

  const row = result.rows[0] || null;
  if (!row?.fecha_desde || !row?.fecha_hasta) {
    throw new Error(
      'No existe cuadrante_planificacion activo para el periodo del borrador seleccionado'
    );
  }

  return ensureDateRange(row.fecha_desde, row.fecha_hasta);
}

async function getDiasBorrador({
  arsUnidadId,
  borradorId,
  agenteId,
  condicionAlcance,
  actividadIdFiltro,
  grupoIdFiltro,
  excluirFestivos,
  tipoDia,
}) {
  const scope = String(condicionAlcance || 'cualquier_actividad');
  const params = [arsUnidadId, borradorId, agenteId];
  const where = [
    'ab.ars_unidad_id::text = $1::text',
    'ab.borrador_id = $2',
    'ab.agente_id = $3',
  ];

  const requiereServicios = scope !== 'cualquier_actividad';
  let joinActividades = false;
  let withRecursive = '';

  if (scope === 'actividad' && Number.isInteger(actividadIdFiltro) && actividadIdFiltro > 0) {
    params.push(actividadIdFiltro);
    where.push(`bs.actividad_id = $${params.length}`);
  } else if (scope === 'grupo' && Number.isInteger(grupoIdFiltro) && grupoIdFiltro > 0) {
    joinActividades = true;
    params.push(grupoIdFiltro);
    withRecursive = `WITH RECURSIVE grp_target AS (
       SELECT $${params.length}::integer AS id_grupo
       UNION ALL
       SELECT g.id_grupo
         FROM grupos_actividad g
         JOIN grp_target gt ON g.parent_id_grupo = gt.id_grupo
     )`;
    where.push(
      'a.grupo_id IS NOT NULL AND EXISTS (SELECT 1 FROM grp_target gt WHERE gt.id_grupo = a.grupo_id)'
    );
  }

  const tipoDiaNorm = normalizeTipoDia(tipoDia);
  const festivoAbSql = `EXISTS (
      SELECT 1
        FROM festivos f
        JOIN calendarios c ON c.id = f.calendario_id
       WHERE c.ars_unidad_id::text = $1::text
         AND c.activo = true
         AND (
           (f.es_recurrente = false AND f.fecha::date = ab.fecha::date)
           OR (
             f.es_recurrente = true
             AND EXTRACT(MONTH FROM f.fecha::date) = EXTRACT(MONTH FROM ab.fecha::date)
             AND EXTRACT(DAY FROM f.fecha::date) = EXTRACT(DAY FROM ab.fecha::date)
           )
         )
    )`;

  if (tipoDiaNorm === 'festivo') {
    where.push(festivoAbSql);
  } else if (tipoDiaNorm === 'fin_semana') {
    where.push('EXTRACT(ISODOW FROM ab.fecha::date) IN (6,7)');
  } else if (tipoDiaNorm === 'laborable') {
    where.push('EXTRACT(ISODOW FROM ab.fecha::date) BETWEEN 1 AND 5');
    where.push(`NOT ${festivoAbSql}`);
  } else if (excluirFestivos) {
    where.push(`NOT EXISTS (
      SELECT 1
        FROM festivos f
        JOIN calendarios c ON c.id = f.calendario_id
       WHERE c.ars_unidad_id::text = $1::text
         AND c.activo = true
         AND (
           (f.es_recurrente = false AND f.fecha::date = ab.fecha::date)
           OR (
             f.es_recurrente = true
             AND EXTRACT(MONTH FROM f.fecha::date) = EXTRACT(MONTH FROM ab.fecha::date)
             AND EXTRACT(DAY FROM f.fecha::date) = EXTRACT(DAY FROM ab.fecha::date)
           )
         )
    )`);
  }

  const result = await db.query(
    `${withRecursive}
     SELECT DISTINCT ab.fecha::date::text AS fecha
       FROM asignaciones_borrador ab
       ${requiereServicios ? 'JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id' : ''}
       ${joinActividades ? 'JOIN actividades a ON a.id_actividad = bs.actividad_id' : ''}
      WHERE ${where.join(' AND ')}
      ORDER BY fecha ASC`,
    params
  );

  return result.rows.map((r) => String(r.fecha));
}

async function getDiasCuadranteEnRango({
  arsUnidadId,
  fechaDesde,
  fechaHasta,
  excluirFestivos,
  soloFestivos,
  tipoDia,
}) {
  const { from, to } = ensureDateRange(fechaDesde, fechaHasta);
  const tipoDiaNorm = normalizeTipoDia(
    tipoDia || (soloFestivos ? 'festivo' : 'periodo')
  );

  const festivoExistsSql = `EXISTS (
      SELECT 1
        FROM festivos f
        JOIN calendarios c ON c.id = f.calendario_id
       WHERE c.ars_unidad_id::text = $1::text
         AND c.activo = true
         AND (
           (f.es_recurrente = false AND f.fecha::date = d.fecha::date)
           OR (
             f.es_recurrente = true
             AND EXTRACT(MONTH FROM f.fecha::date) = EXTRACT(MONTH FROM d.fecha::date)
             AND EXTRACT(DAY FROM f.fecha::date) = EXTRACT(DAY FROM d.fecha::date)
           )
         )
    )`;

  let whereSql = '';
  let requiereArsParam = false;
  if (tipoDiaNorm === 'festivo' || soloFestivos) {
    whereSql = `WHERE ${festivoExistsSql}`;
    requiereArsParam = true;
  } else if (tipoDiaNorm === 'fin_semana') {
    whereSql = 'WHERE EXTRACT(ISODOW FROM d.fecha::date) IN (6,7)';
  } else if (tipoDiaNorm === 'laborable') {
    whereSql = `WHERE EXTRACT(ISODOW FROM d.fecha::date) BETWEEN 1 AND 5 AND NOT ${festivoExistsSql}`;
    requiereArsParam = true;
  } else if (excluirFestivos) {
    whereSql = `WHERE NOT ${festivoExistsSql}`;
    requiereArsParam = true;
  }

  const usaFiltroGenerico = Boolean(whereSql);

  const sql = usaFiltroGenerico
    ? requiereArsParam
      ? `SELECT d.fecha::date::text AS fecha
           FROM generate_series($2::date, $3::date, interval '1 day') d(fecha)
           ${whereSql}
        ORDER BY d.fecha::date ASC`
      : `SELECT d.fecha::date::text AS fecha
           FROM generate_series($1::date, $2::date, interval '1 day') d(fecha)
           ${whereSql}
        ORDER BY d.fecha::date ASC`
    : `SELECT d.fecha::date::text AS fecha
         FROM generate_series($1::date, $2::date, interval '1 day') d(fecha)
      ORDER BY d.fecha::date ASC`;

  const params = usaFiltroGenerico
    ? requiereArsParam
      ? [arsUnidadId, from, to]
      : [from, to]
    : [from, to];

  const result = await db.query(sql, params);

  return result.rows.map((r) => String(r.fecha));
}

async function resolveFechaInsercionManual({ arsUnidadId, fechaBase }) {
  const base = normalizeDateInput(fechaBase);
  const festivos = await getDiasCuadranteEnRango({
    arsUnidadId,
    fechaDesde: base,
    fechaHasta: base,
    soloFestivos: true,
    excluirFestivos: false,
    tipoDia: 'festivo',
  });

  if (Array.isArray(festivos) && festivos.length > 0) {
    const siguiente = DateTime.fromISO(base, { zone: 'utc' }).plus({ days: 1 });
    return normalizeDateInput(siguiente.toISODate());
  }

  return base;
}

function calcularDetalleRachasConsecutivas(fechas, n) {
  const diasModulo = Number(n);
  if (!Number.isFinite(diasModulo) || diasModulo <= 0) {
    return {
      modulos_totales: 0,
      rachas: [],
    };
  }

  const set = new Set((fechas || []).map((f) => normalizeDayKey(f)));
  if (!set.size) {
    return {
      modulos_totales: 0,
      rachas: [],
    };
  }

  const ordered = Array.from(set).sort();
  const rachas = [];
  let total = 0;
  let streak = 1;
  let streakStart = ordered[0];

  const cerrarRacha = (endDate) => {
    const modulosRacha = Math.floor(streak / diasModulo);
    total += modulosRacha;
    rachas.push({
      inicio: streakStart,
      fin: endDate,
      dias: streak,
      modulos: modulosRacha,
    });
  };

  for (let i = 1; i < ordered.length; i += 1) {
    const prev = DateTime.fromISO(ordered[i - 1], { zone: 'utc' });
    const curr = DateTime.fromISO(ordered[i], { zone: 'utc' });
    const diffDias = curr.diff(prev, 'days').days;
    if (diffDias === 1) {
      streak += 1;
    } else {
      cerrarRacha(ordered[i - 1]);
      streak = 1;
      streakStart = ordered[i];
    }
  }

  cerrarRacha(ordered[ordered.length - 1]);

  return {
    modulos_totales: total,
    rachas,
  };
}

exports.listReglas = async ({ arsUnidadId, filters = {} }) => {
  /** @type {any} */
  const safeFilters = filters || {};
  const params = [arsUnidadId];
  const where = ['r.ars_unidad_id::text = $1::text'];

  if (safeFilters.actividad_id) {
    params.push(safeFilters.actividad_id);
    where.push(`r.actividad_id = $${params.length}`);
  }

  if (safeFilters.grupo_id) {
    params.push(safeFilters.grupo_id);
    where.push(`r.grupo_id = $${params.length}`);
  }

  if (hasOwn(safeFilters, 'empleo_id')) {
    params.push(normalizeEmpleoId(safeFilters.empleo_id));
    where.push(
      `COALESCE(r.empleo_id::text, '__NULL__') = COALESCE($${params.length}::text, '__NULL__')`
    );
  }

  if (safeFilters.fecha) {
    params.push(safeFilters.fecha);
    where.push(`r.vigencia_desde <= $${params.length}::date`);
    where.push(
      `(r.vigencia_hasta IS NULL OR r.vigencia_hasta >= $${params.length}::date)`
    );
  }

  if (hasOwn(safeFilters, 'activo')) {
    params.push(Boolean(safeFilters.activo));
    where.push(`r.activo = $${params.length}`);
  }

  if (hasOwn(safeFilters, 'categoria_regla')) {
    const categoriaRegla = normalizeCategoriaRegla(safeFilters.categoria_regla);
    if (categoriaRegla == null) {
      where.push("(r.categoria_regla IS NULL OR r.categoria_regla = 'Regla_Normal')");
    } else {
      params.push(categoriaRegla);
      where.push(`r.categoria_regla = $${params.length}`);
    }
  }

  const result = await db.query(
    `SELECT r.id,
            r.ars_unidad_id,
            r.actividad_id,
          r.grupo_id,
            a.actividad AS actividad_codigo,
            a.nombre AS actividad_nombre,
          ga.nombre AS grupo_nombre,
            r.empleo_id::text AS empleo_id,
            e.descripcion AS empleo_nombre,
            r.tipo_movimiento,
            r.unidad,
            r.valor,
            r.aplica_cruce_festivo,
            r.tipo_dia,
            r.condicion_dias,
            r.condicion_tipo,
            r.condicion_alcance,
            r.excluir_festivos,
            r.vigencia_desde::text,
            r.vigencia_hasta::text,
            r.prioridad,
            r.activo,
            r.categoria_regla,
            r.descripcion,
            r.created_by,
            r.updated_by,
            r.created_at,
            r.updated_at
       FROM asignaciones_reglas r
      LEFT JOIN actividades a ON a.id_actividad = r.actividad_id
      LEFT JOIN grupos_actividad ga ON ga.id_grupo = r.grupo_id
      LEFT JOIN agentes_empleo e ON e.id_empleo::text = r.empleo_id::text
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(a.nombre, ga.nombre), r.prioridad, r.id DESC`,
    params
  );

  return result.rows;
};

exports.createRegla = async (data, user, arsUnidadId) => {
  const condicionAlcance = String(
    data.condicion_alcance || 'cualquier_actividad'
  ).trim();

  let actividadId = normalizeNullablePositiveInt(
    data.actividad_id,
    'Actividad'
  );
  let grupoId = normalizeNullablePositiveInt(data.grupo_id, 'Grupo');

  if (condicionAlcance === 'cualquier_actividad') {
    actividadId = null;
    grupoId = null;
  } else if (condicionAlcance === 'actividad') {
    grupoId = null;
  } else if (condicionAlcance === 'grupo') {
    actividadId = null;
  }

  ensureValidScope({ actividadId, grupoId, condicionAlcance });

  const payload = {
    actividad_id: actividadId,
    grupo_id: grupoId,
    empleo_id: normalizeEmpleoId(data.empleo_id),
    tipo_movimiento: data.tipo_movimiento,
    unidad: data.unidad || 'dias',
    valor: Number(data.valor),
    tipo_dia: normalizeTipoDia(
      hasOwn(data, 'tipo_dia') ? data.tipo_dia : 'periodo'
    ),
    condicion_dias:
      data.tipo_movimiento === 'disfrute'
        ? roundToOneDecimalAllowZero(data.condicion_dias)
        : roundToOneDecimal(data.condicion_dias),
    condicion_tipo: data.condicion_tipo || 'en_periodo',
    condicion_alcance: condicionAlcance,
    excluir_festivos: hasOwn(data, 'excluir_festivos')
      ? Boolean(data.excluir_festivos)
      : true,
    vigencia_desde: normalizeDateInput(data.vigencia_desde),
    vigencia_hasta: normalizeNullableDate(data.vigencia_hasta),
    prioridad: data.prioridad || 100,
    activo: hasOwn(data, 'activo') ? Boolean(data.activo) : true,
    categoria_regla: normalizeCategoriaRegla(data.categoria_regla),
    descripcion: data.descripcion || null,
    created_by: user && user.id ? Number(user.id) : null,
  };
  payload.aplica_cruce_festivo = payload.tipo_dia === 'festivo';

  const result = await db.query(
    `INSERT INTO asignaciones_reglas
      (ars_unidad_id, actividad_id, grupo_id, empleo_id, tipo_movimiento, unidad, valor,
       aplica_cruce_festivo, tipo_dia, condicion_dias, condicion_tipo, condicion_alcance, excluir_festivos,
       vigencia_desde, vigencia_hasta, prioridad, activo, categoria_regla, descripcion, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
     RETURNING *`,
    [
      arsUnidadId,
      payload.actividad_id,
      payload.grupo_id,
      payload.empleo_id,
      payload.tipo_movimiento,
      payload.unidad,
      payload.valor,
      payload.aplica_cruce_festivo,
      payload.tipo_dia,
      payload.condicion_dias,
      payload.condicion_tipo,
      payload.condicion_alcance,
      payload.excluir_festivos,
      payload.vigencia_desde,
      payload.vigencia_hasta,
      payload.prioridad,
      payload.activo,
      payload.categoria_regla,
      payload.descripcion,
      payload.created_by,
    ]
  );

  return result.rows[0];
};

exports.updateRegla = async (id, data, user, arsUnidadId) => {
  const found = await db.query(
    'SELECT * FROM asignaciones_reglas WHERE id = $1 AND ars_unidad_id::text = $2::text',
    [id, arsUnidadId]
  );

  if (!found.rows.length) {
    throw new Error('Regla no encontrada');
  }

  const current = found.rows[0];
  const condicionAlcancePatch = hasOwn(data, 'condicion_alcance')
    ? data.condicion_alcance
    : current.condicion_alcance || 'cualquier_actividad';
  const hasActividad = hasOwn(data, 'actividad_id');
  const hasGrupo = hasOwn(data, 'grupo_id');
  let actividadId = hasActividad
    ? normalizeNullablePositiveInt(data.actividad_id, 'Actividad')
    : current.actividad_id;
  let grupoId = hasGrupo
    ? normalizeNullablePositiveInt(data.grupo_id, 'Grupo')
    : current.grupo_id;

  if (condicionAlcancePatch === 'cualquier_actividad') {
    actividadId = null;
    grupoId = null;
  } else if (condicionAlcancePatch === 'actividad') {
    grupoId = null;
  } else if (condicionAlcancePatch === 'grupo') {
    actividadId = null;
  }

  ensureValidScope({
    actividadId,
    grupoId,
    condicionAlcance: condicionAlcancePatch,
  });

  const next = {
    actividad_id: actividadId,
    grupo_id: grupoId,
    empleo_id: hasOwn(data, 'empleo_id')
      ? normalizeEmpleoId(data.empleo_id)
      : current.empleo_id,
    tipo_movimiento: hasOwn(data, 'tipo_movimiento')
      ? data.tipo_movimiento
      : current.tipo_movimiento,
    unidad: hasOwn(data, 'unidad') ? data.unidad : current.unidad,
    valor: hasOwn(data, 'valor')
      ? Number(data.valor)
      : Number(current.valor),
    tipo_dia: normalizeTipoDia(
      hasOwn(data, 'tipo_dia')
        ? data.tipo_dia
        : current.tipo_dia || (current.aplica_cruce_festivo ? 'festivo' : 'periodo')
    ),
    condicion_dias: hasOwn(data, 'condicion_dias')
      ? ((hasOwn(data, 'tipo_movimiento')
          ? data.tipo_movimiento
          : current.tipo_movimiento) === 'disfrute'
          ? roundToOneDecimalAllowZero(data.condicion_dias)
          : roundToOneDecimal(data.condicion_dias))
      : ((hasOwn(data, 'tipo_movimiento')
          ? data.tipo_movimiento
          : current.tipo_movimiento) === 'disfrute'
          ? roundToOneDecimalAllowZero(current.condicion_dias)
          : roundToOneDecimal(current.condicion_dias || 1)),
    condicion_tipo: hasOwn(data, 'condicion_tipo')
      ? data.condicion_tipo
      : current.condicion_tipo || 'en_periodo',
    condicion_alcance: condicionAlcancePatch,
    excluir_festivos: hasOwn(data, 'excluir_festivos')
      ? Boolean(data.excluir_festivos)
      : Boolean(current.excluir_festivos),
    vigencia_desde: hasOwn(data, 'vigencia_desde')
      ? normalizeDateInput(data.vigencia_desde)
      : current.vigencia_desde,
    vigencia_hasta: hasOwn(data, 'vigencia_hasta')
      ? normalizeNullableDate(data.vigencia_hasta)
      : current.vigencia_hasta,
    prioridad: hasOwn(data, 'prioridad')
      ? data.prioridad
      : current.prioridad,
    activo: hasOwn(data, 'activo')
      ? Boolean(data.activo)
      : current.activo,
    categoria_regla: hasOwn(data, 'categoria_regla')
      ? normalizeCategoriaRegla(data.categoria_regla)
      : current.categoria_regla || null,
    descripcion: hasOwn(data, 'descripcion')
      ? data.descripcion || null
      : current.descripcion,
    updated_by: user && user.id ? Number(user.id) : null,
  };
  next.aplica_cruce_festivo = next.tipo_dia === 'festivo';

  const result = await db.query(
    `UPDATE asignaciones_reglas
        SET actividad_id = $1,
            grupo_id = $2,
            empleo_id = $3,
            tipo_movimiento = $4,
            unidad = $5,
            valor = $6,
            aplica_cruce_festivo = $7,
            tipo_dia = $8,
            condicion_dias = $9,
            condicion_tipo = $10,
            condicion_alcance = $11,
            excluir_festivos = $12,
            vigencia_desde = $13,
            vigencia_hasta = $14,
            prioridad = $15,
            activo = $16,
            categoria_regla = $17,
            descripcion = $18,
            updated_by = $19,
            updated_at = now()
          WHERE id = $20 AND ars_unidad_id::text = $21::text
      RETURNING *`,
    [
      next.actividad_id,
      next.grupo_id,
      next.empleo_id,
      next.tipo_movimiento,
      next.unidad,
      next.valor,
      next.aplica_cruce_festivo,
      next.tipo_dia,
      next.condicion_dias,
      next.condicion_tipo,
      next.condicion_alcance,
      next.excluir_festivos,
      next.vigencia_desde,
      next.vigencia_hasta,
      next.prioridad,
      next.activo,
      next.categoria_regla,
      next.descripcion,
      next.updated_by,
      id,
      arsUnidadId,
    ]
  );

  return result.rows[0];
};

exports.deleteRegla = async (id, user, arsUnidadId) => {
  const userId = user && user.id ? Number(user.id) : null;
  const result = await db.query(
    `UPDATE asignaciones_reglas
        SET activo = false,
            updated_by = $1,
            updated_at = now()
      WHERE id = $2 AND ars_unidad_id::text = $3::text
      RETURNING id`,
    [userId, id, arsUnidadId]
  );

  if (!result.rows.length) {
    throw new Error('Regla no encontrada');
  }

  return { id: Number(id) };
};

async function calculatePreviewImpacto(input, arsUnidadId) {
  const motor = require('./reglas-motor.service');
  return motor.calcularPreviewImpacto(input, arsUnidadId);
}

exports.previewImpacto = async (input, arsUnidadId) => {
  return calculatePreviewImpacto(input, arsUnidadId);
};

exports.actualizarSaldosMensuales = async (params) => {
  return actualizarSaldosMensuales(params);
};

exports.actualizarSaldosMensualesConClient = async (client, params) => {
  return actualizarSaldosMensualesConClient(client, params);
};

exports.calcularDetalleRachas = (fechas, n) => {
  return calcularDetalleRachasConsecutivas(fechas, n);
};

exports.getDiasBorrador = async (params) => {
  return getDiasBorrador(params);
};

exports.__previewLegacy = {
  resolvePreviewRange,
  resolveBorradorRangeForAgente,
  getAgenteContext,
  resolveApplicableRule,
  getSaldoAnterior,
  countCrucesFestivosEnRango,
  countDiasEnRango,
  getDiasBorrador,
  getDiasCuadranteEnRango,
  calcularDetalleRachasConsecutivas,
};

// Grupo de funciones para persistir movimientos manuales basados en reglas, con justificación y control de impacto
exports.persistirMovimientoManual = async (input, user, arsUnidadId) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const observaciones = String(input.observaciones || '').trim();
    if (observaciones.length < 5) {
      throw new Error(
        'Debe informar una justificación manual de al menos 5 caracteres'
      );
    }

    const preview =
      input && input.preview_snapshot && input.preview_snapshot.aplica
        ? input.preview_snapshot
        : await calculatePreviewImpacto(input, arsUnidadId);

    if (!preview || !preview.aplica) {
      throw new Error(
        (preview && preview.motivo) ||
          'No aplica ninguna regla para persistir movimiento manual'
      );
    }

    if (!Number.isFinite(preview.cantidad) || Number(preview.cantidad) <= 0) {
      throw new Error(
        'La cantidad de días calculada debe ser mayor que cero para grabar el movimiento manual'
      );
    }

    // Saldo negativo permitido — no se bloquea por saldo

    const fechaBase = normalizeDateInput(
      preview && preview.fecha
        ? preview.fecha
        : input && input.fecha
          ? input.fecha
          : null
    );

    const fecha = await resolveFechaInsercionManual({
      arsUnidadId,
      fechaBase,
    });
    const fechaDt = DateTime.fromISO(fecha, { zone: 'utc' });
    const anio = fechaDt.year;
    const mes = fechaDt.month;
    const actividadMovimientoId = Number(input.actividad_id);
    if (!Number.isInteger(actividadMovimientoId) || actividadMovimientoId === 0) {
      throw new Error('Actividad inválida para persistencia manual');
    }

    const sourceKey = `manual:${arsUnidadId}:${preview.agente.id}:${actividadMovimientoId}:${fecha}:${randomUUID()}`;

    const tipoMovimiento = String(
      (preview && preview.regla && preview.regla.tipo_movimiento) || ''
    )
      .trim()
      .toLowerCase();
    const signoMovimiento =
      tipoMovimiento === 'disfrute' ? -1 : 1;

    const metadata = {
      manual: true,
      justificacion_manual: true,
      origen_preview: true,
      fecha_preview: preview.fecha,
      fecha_insercion: fecha,
      fecha_hasta: preview.fecha_hasta,
      base_calculo: preview.base_calculo,
      cruces_festivos: preview.cruces_festivos,
    };

    const userId = user && user.id ? Number(user.id) : null;
    const hasObservacionesColumn = await hasLedgerObservacionesColumn(client);

    const observacionesColumnSql = hasObservacionesColumn
      ? ', observaciones'
      : '';
    const observacionesValueSql = hasObservacionesColumn
      ? ',$17'
      : '';

    // Insertar movimiento dentro de la transacción
    const insertParams = [
      arsUnidadId,
      preview.agente.id,
      preview.agente.empleo_id || null,
      actividadMovimientoId,
      Number(preview.regla.id) > 0 ? Number(preview.regla.id) : null,
      anio,
      mes,
      fecha,
      preview.regla.tipo_movimiento,
      signoMovimiento,
      Number(preview.cantidad),
      Number(preview.saldo_anterior),
      Number(preview.saldo_proyectado),
      sourceKey,
      JSON.stringify(metadata),
      userId,
    ];
    if (hasObservacionesColumn) {
      insertParams.push(observaciones);
    }

    const result = await client.query(
      `INSERT INTO asignaciones_ledger_movimientos
          (ars_unidad_id, agente_id, empleo_id, actividad_id, regla_id,
           borrador_id, anio, mes, fecha, origen, tipo_movimiento,
           signo, cantidad_dias, saldo_antes, saldo_despues,
         source_kind, source_key, metadata, usuario_id${observacionesColumnSql})
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8::date,'manual',$9,$10,$11,$12,$13,
           'manual',$14,$15::jsonb,$16${observacionesValueSql})
       RETURNING id, ars_unidad_id, agente_id, empleo_id, actividad_id, regla_id,
                 anio, mes, fecha::text AS fecha, origen, tipo_movimiento,
                 signo, cantidad_dias, saldo_antes, saldo_despues, source_key, created_at`,
      insertParams
    );

    // Actualizar saldos mensuales dentro de la misma transacción
    const saldosMensuales = await actualizarSaldosMensualesConClient(client, {
      arsUnidadId,
      agenteId: preview.agente.id,
      empleoId: preview.agente.empleo_id || null,
      anio,
      mes,
    });

    await client.query('COMMIT');

    return {
      movimiento: result.rows[0],
      saldos_mensuales: saldosMensuales,
      preview,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

exports.persistirMovimientoManualBulk = async (input, user, arsUnidadId) => {
  const { items, observaciones } = input;

  return withRetry(() =>
    withTransaction(async (client) => {
      const results = [];
      const hasObservacionesColumn = await hasLedgerObservacionesColumn(client);

      for (const itemInput of items) {
        const arsId = arsUnidadId || 'default';

        // Resolver agente real desde la DB usando el agente_id del item (no del snapshot compartido)
        const agenteId = Number(itemInput.agente_id);
        if (!Number.isInteger(agenteId) || agenteId <= 0) {
          throw new Error(`agente_id inválido: ${itemInput.agente_id}`);
        }
        const agenteResult = await client.query(
          `SELECT id, tip, empleo_id FROM agentes WHERE id = $1`,
          [agenteId]
        );
        if (!agenteResult.rows.length) {
          throw new Error(`Agente no encontrado: ${agenteId}`);
        }
        const agenteReal = agenteResult.rows[0];

        // Recalcular preview por agente para evitar reutilizar cantidades de un snapshot compartido.
        const preview = await calculatePreviewImpacto(
          Object.assign({}, itemInput, {
            agente_id: agenteId,
            preview_snapshot: null,
          }),
          arsId
        );

        if (!preview || !preview.aplica || !preview.regla) {
          continue;
        }

        const cantidad = Number(preview.cantidad);
        if (!Number.isFinite(cantidad) || cantidad <= 0) {
          continue;
        }

        const fechaBase = DateTime.fromISO(
          preview && preview.fecha
            ? preview.fecha
            : itemInput && itemInput.fecha
              ? itemInput.fecha
              : null,
          { zone: 'utc' }
        );
        if (!fechaBase.isValid) {
          throw new Error(`Fecha inválida: ${itemInput.fecha || preview.fecha}`);
        }

        const fecha = fechaBase.toISODate();
        const fechaDt = DateTime.fromISO(fecha, { zone: 'utc' });
        const anio = fechaDt.year;
        const mes = fechaDt.month;
        const actividadMovimientoId = Number(itemInput.actividad_id);
        if (!Number.isInteger(actividadMovimientoId) || actividadMovimientoId === 0) {
          throw new Error('Actividad inválida para persistencia manual');
        }

        const sourceKey = `manual:${arsId}:${agenteId}:${actividadMovimientoId}:${fecha}:${randomUUID()}`;

        const tipoMovimiento = String(
          (preview && preview.regla && preview.regla.tipo_movimiento) || ''
        )
          .trim()
          .toLowerCase();
        const signoMovimiento =
          tipoMovimiento === 'disfrute' ? -1 : 1;

        // Recalcular saldo real del agente desde la DB (el snapshot puede ser compartido)
        const empleoIdNorm = normalizeEmpleoId(agenteReal.empleo_id || null);
        const saldoResult = await client.query(
          `SELECT COALESCE(SUM(signo * cantidad_dias), 0)::numeric(12,2) AS saldo
             FROM asignaciones_ledger_movimientos
            WHERE ars_unidad_id::text = $1::text
              AND agente_id = $2
              AND COALESCE(empleo_id::text, '__NULL__') = COALESCE($3::text, '__NULL__')
              AND fecha < $4::date`,
          [arsId, agenteId, empleoIdNorm, fecha]
        );
        const saldoAnterior = Number(saldoResult.rows[0]?.saldo || 0);
        const saldoProyectado = Number((saldoAnterior + signoMovimiento * cantidad).toFixed(2));

        const metadata = {
          manual: true,
          justificacion_manual: true,
          origen_preview: true,
          fecha_preview: preview.fecha,
          fecha_insercion: fecha,
          fecha_hasta: preview.fecha_hasta,
          base_calculo: preview.base_calculo,
          cruces_festivos: preview.cruces_festivos,
        };

        const userId = user && user.id ? Number(user.id) : null;

        const observacionesColumnSql = hasObservacionesColumn
          ? ', observaciones'
          : '';
        const observacionesValueSql = hasObservacionesColumn
          ? ',$17'
          : '';

        // Insertar movimiento dentro de la transacción
        const insertParams = [
          arsId,
          agenteId,
          agenteReal.empleo_id || null,
          actividadMovimientoId,
          Number(preview.regla.id) > 0 ? Number(preview.regla.id) : null,
          anio,
          mes,
          fecha,
          tipoMovimiento,
          signoMovimiento,
          cantidad,
          saldoAnterior,
          saldoProyectado,
          sourceKey,
          JSON.stringify(metadata),
          userId,
        ];
        if (hasObservacionesColumn) {
          insertParams.push(observaciones);
        }

        const result = await client.query(
          `INSERT INTO asignaciones_ledger_movimientos
              (ars_unidad_id, agente_id, empleo_id, actividad_id, regla_id,
               borrador_id, anio, mes, fecha, origen, tipo_movimiento,
               signo, cantidad_dias, saldo_antes, saldo_despues,
             source_kind, source_key, metadata, usuario_id${observacionesColumnSql})
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8::date,'manual',$9,$10,$11,$12,$13,
               'manual',$14,$15::jsonb,$16${observacionesValueSql})
           RETURNING id, ars_unidad_id, agente_id, empleo_id, actividad_id, regla_id,
                     anio, mes, fecha::text AS fecha, origen, tipo_movimiento,
                     signo, cantidad_dias, saldo_antes, saldo_despues, source_key, created_at`,
          insertParams
        );

        results.push({
          movimiento: result.rows[0],
          preview,
        });

        // Actualizar saldos mensuales dentro de la misma transacción
        await actualizarSaldosMensualesConClient(client, {
          arsUnidadId: arsId,
          agenteId: agenteId,
          empleoId: agenteReal.empleo_id || null,
          anio,
          mes,
        });
      }

      await client.query('COMMIT');

      return {
        movimientos: results.map((r) => r.movimiento),
        count: results.length,
      };
    })
  );
};

async function actualizarSaldosMensuales({
  arsUnidadId,
  agenteId,
  empleoId,
  anio,
  mes,
}) {
  const empleoIdNormalized = normalizeEmpleoId(empleoId);

  // 1. Obtener saldo del mes anterior (saldo_final del mes anterior = saldo_inicial de este mes)
  const saldoAnteriorResult = await db.query(
    `SELECT COALESCE(saldo_final, 0)::numeric(12,2) AS saldo_inicial
       FROM asignaciones_ledger_saldos_mensuales
      WHERE ars_unidad_id::text = $1::text
        AND agente_id = $2
        AND COALESCE(empleo_id::text, '__NULL__') = COALESCE($3::text, '__NULL__')
        AND (anio < $4 OR (anio = $4 AND mes < $5))
      ORDER BY anio DESC, mes DESC
      LIMIT 1`,
    [arsUnidadId, agenteId, empleoIdNormalized, anio, mes]
  );

  const saldoInicial = Number(saldoAnteriorResult.rows[0]?.saldo_inicial || 0);

  // 2. Calcular totales del mes actual
  const totalResult = await db.query(
    `SELECT SUM(CASE WHEN signo = 1 THEN cantidad_dias ELSE 0 END)::numeric(12,2) AS total_devengado,
            SUM(CASE WHEN signo = -1 THEN cantidad_dias ELSE 0 END)::numeric(12,2) AS total_disfrutado
       FROM asignaciones_ledger_movimientos
      WHERE ars_unidad_id::text = $1::text
        AND agente_id = $2
        AND COALESCE(empleo_id::text, '__NULL__') = COALESCE($3::text, '__NULL__')
        AND anio = $4
        AND mes = $5`,
    [arsUnidadId, agenteId, empleoIdNormalized, anio, mes]
  );

  const totalDevengado = Number(totalResult.rows[0]?.total_devengado || 0);
  const totalDisfrutado = Number(totalResult.rows[0]?.total_disfrutado || 0);
  const saldoFinal = Number(
    (saldoInicial + totalDevengado - totalDisfrutado).toFixed(2)
  );

  // 3. UPSERT en saldos_mensuales
  await db.query(
    `INSERT INTO asignaciones_ledger_saldos_mensuales
      (ars_unidad_id, agente_id, empleo_id, anio, mes,
       saldo_inicial, total_devengado, total_disfrutado, saldo_final, actualizado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (ars_unidad_id, agente_id, empleo_id, anio, mes)
     DO UPDATE SET
       total_devengado = EXCLUDED.total_devengado,
       total_disfrutado = EXCLUDED.total_disfrutado,
       saldo_final = EXCLUDED.saldo_final,
       actualizado_en = now()`,
    [
      arsUnidadId,
      agenteId,
      empleoIdNormalized,
      anio,
      mes,
      saldoInicial,
      totalDevengado,
      totalDisfrutado,
      saldoFinal,
    ]
  );

  return {
    ars_unidad_id: arsUnidadId,
    agente_id: agenteId,
    empleo_id: empleoIdNormalized,
    anio,
    mes,
    saldo_inicial: saldoInicial,
    total_devengado: totalDevengado,
    total_disfrutado: totalDisfrutado,
    saldo_final: saldoFinal,
  };
}

// Versión con client para transacciones
async function actualizarSaldosMensualesConClient(
  client,
  { arsUnidadId, agenteId, empleoId, anio, mes }
) {
  const empleoIdNormalized = normalizeEmpleoId(empleoId);

  // 1. Obtener saldo del mes anterior (saldo_final del mes anterior = saldo_inicial de este mes)
  const saldoAnteriorResult = await client.query(
    `SELECT COALESCE(saldo_final, 0)::numeric(12,2) AS saldo_inicial
       FROM asignaciones_ledger_saldos_mensuales
      WHERE ars_unidad_id::text = $1::text
        AND agente_id = $2
        AND COALESCE(empleo_id::text, '__NULL__') = COALESCE($3::text, '__NULL__')
        AND (anio < $4 OR (anio = $4 AND mes < $5))
      ORDER BY anio DESC, mes DESC
      LIMIT 1`,
    [arsUnidadId, agenteId, empleoIdNormalized, anio, mes]
  );

  const saldoInicial = Number(saldoAnteriorResult.rows[0]?.saldo_inicial || 0);

  // 2. Calcular totales del mes actual
  const totalResult = await client.query(
    `SELECT SUM(CASE WHEN signo = 1 THEN cantidad_dias ELSE 0 END)::numeric(12,2) AS total_devengado,
            SUM(CASE WHEN signo = -1 THEN cantidad_dias ELSE 0 END)::numeric(12,2) AS total_disfrutado
       FROM asignaciones_ledger_movimientos
      WHERE ars_unidad_id::text = $1::text
        AND agente_id = $2
        AND COALESCE(empleo_id::text, '__NULL__') = COALESCE($3::text, '__NULL__')
        AND anio = $4
        AND mes = $5`,
    [arsUnidadId, agenteId, empleoIdNormalized, anio, mes]
  );

  const totalDevengado = Number(totalResult.rows[0]?.total_devengado || 0);
  const totalDisfrutado = Number(totalResult.rows[0]?.total_disfrutado || 0);
  const saldoFinal = Number(
    (saldoInicial + totalDevengado - totalDisfrutado).toFixed(2)
  );

  // 3. UPSERT en saldos_mensuales
  await client.query(
    `INSERT INTO asignaciones_ledger_saldos_mensuales
      (ars_unidad_id, agente_id, empleo_id, anio, mes,
       saldo_inicial, total_devengado, total_disfrutado, saldo_final, actualizado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (ars_unidad_id, agente_id, empleo_id, anio, mes)
     DO UPDATE SET
       total_devengado = EXCLUDED.total_devengado,
       total_disfrutado = EXCLUDED.total_disfrutado,
       saldo_final = EXCLUDED.saldo_final,
       actualizado_en = now()`,
    [
      arsUnidadId,
      agenteId,
      empleoIdNormalized,
      anio,
      mes,
      saldoInicial,
      totalDevengado,
      totalDisfrutado,
      saldoFinal,
    ]
  );

  return {
    ars_unidad_id: arsUnidadId,
    agente_id: agenteId,
    empleo_id: empleoIdNormalized,
    anio,
    mes,
    saldo_inicial: saldoInicial,
    total_devengado: totalDevengado,
    total_disfrutado: totalDisfrutado,
    saldo_final: saldoFinal,
  };
}

exports.getSaldosPeriodo = async ({
  arsUnidadId,
  anio,
  mes,
  agente_id,
  empleo_id,
}) => {
  const params = [arsUnidadId, anio, mes];
  const where = [
    'm.ars_unidad_id::text = $1::text',
    'm.anio = $2',
    'm.mes = $3',
  ];

  if (agente_id) {
    params.push(agente_id);
    where.push(`m.agente_id = $${params.length}`);
  }

  if (empleo_id) {
    params.push(normalizeEmpleoId(empleo_id));
    where.push(`m.empleo_id::text = $${params.length}::text`);
  }

  const result = await db.query(
    `SELECT m.agente_id,
            ag.apellido_1,
            ag.apellido_2,
            ag.nombre,
            m.empleo_id::text AS empleo_id,
            e.descripcion AS empleo_nombre,
            SUM(CASE WHEN m.signo = 1 THEN m.cantidad_dias ELSE 0 END)::numeric(12,2) AS total_devengado,
            SUM(CASE WHEN m.signo = -1 THEN m.cantidad_dias ELSE 0 END)::numeric(12,2) AS total_disfrutado,
            SUM(m.signo * m.cantidad_dias)::numeric(12,2) AS saldo_neto
       FROM asignaciones_ledger_movimientos m
       JOIN agentes ag ON ag.id = m.agente_id
      LEFT JOIN agentes_empleo e ON e.id_empleo::text = m.empleo_id::text
      WHERE ${where.join(' AND ')}
          GROUP BY m.agente_id, ag.apellido_1, ag.apellido_2, ag.nombre, m.empleo_id::text, e.descripcion
      ORDER BY ag.apellido_1, ag.apellido_2, ag.nombre, e.descripcion`,
    params
  );

  return result.rows;
};

exports.getLedgerSaldosMensuales = async ({
  arsUnidadId,
  anio,
  mes,
  agente_id,
}) => {
  const params = [arsUnidadId];
  const where = ['m.ars_unidad_id::text = $1::text'];

  if (agente_id) {
    params.push(agente_id);
    where.push(`m.agente_id = $${params.length}`);
  }

  // Usar m.anio/m.mes (derivados del cuadrante del borrador) para que el acumulado
  // coincida exactamente con lo que muestra ledger-movimientos, aunque la fecha
  // calendario del movimiento caiga en un año distinto.
  let saldoInicialExpr = '0::numeric(12,2)';
  let totalDevengadoExpr =
    `SUM(CASE WHEN m.signo = 1 THEN m.cantidad_dias ELSE 0 END)::numeric(12,2)`;
  let totalDisfrutadoExpr =
    `SUM(CASE WHEN m.signo = -1 THEN m.cantidad_dias ELSE 0 END)::numeric(12,2)`;
  let havingExpr = `SUM(ABS(m.cantidad_dias)) >= 0`;

  if (anio) {
    const y = Number(anio);
    if (mes) {
      const mNum = Number(mes);
      params.push(y);
      const anioPos = params.length;
      params.push(mNum);
      const mesPos = params.length;

      saldoInicialExpr =
        `SUM(CASE WHEN m.anio < $${anioPos} OR (m.anio = $${anioPos} AND m.mes < $${mesPos}) THEN m.signo * m.cantidad_dias ELSE 0 END)::numeric(12,2)`;
      totalDevengadoExpr =
        `SUM(CASE WHEN m.anio = $${anioPos} AND m.mes = $${mesPos} AND m.signo = 1 THEN m.cantidad_dias ELSE 0 END)::numeric(12,2)`;
      totalDisfrutadoExpr =
        `SUM(CASE WHEN m.anio = $${anioPos} AND m.mes = $${mesPos} AND m.signo = -1 THEN m.cantidad_dias ELSE 0 END)::numeric(12,2)`;
      havingExpr =
        `SUM(CASE WHEN m.anio < $${anioPos} OR (m.anio = $${anioPos} AND m.mes < $${mesPos}) THEN m.signo * m.cantidad_dias ELSE 0 END) <> 0
         OR SUM(CASE WHEN m.anio = $${anioPos} AND m.mes = $${mesPos} THEN ABS(m.cantidad_dias) ELSE 0 END) > 0`;
    } else {
      params.push(y);
      const anioPos = params.length;

      saldoInicialExpr =
        `SUM(CASE WHEN m.anio < $${anioPos} THEN m.signo * m.cantidad_dias ELSE 0 END)::numeric(12,2)`;
      totalDevengadoExpr =
        `SUM(CASE WHEN m.anio = $${anioPos} AND m.signo = 1 THEN m.cantidad_dias ELSE 0 END)::numeric(12,2)`;
      totalDisfrutadoExpr =
        `SUM(CASE WHEN m.anio = $${anioPos} AND m.signo = -1 THEN m.cantidad_dias ELSE 0 END)::numeric(12,2)`;
      havingExpr =
        `SUM(CASE WHEN m.anio < $${anioPos} THEN m.signo * m.cantidad_dias ELSE 0 END) <> 0
         OR SUM(CASE WHEN m.anio = $${anioPos} THEN ABS(m.cantidad_dias) ELSE 0 END) > 0`;
    }
  }

  const result = await db.query(
    `SELECT
            MIN(m.id) AS id,
            m.agente_id,
            MAX(ag.tip) AS tip,
            MAX(ag.apellido_1) AS apellido_1,
            MAX(ag.apellido_2) AS apellido_2,
            MAX(ag.nombre) AS nombre,
            MAX(ag.escalafon) AS escalafon,
            MAX(COALESCE(m.empleo_id::text, ag.empleo_id::text)) AS empleo_id,
            COALESCE(MAX(e.descripcion), 'Sin empleo') AS empleo_nombre,
            MAX(e.color) AS empleo_color,
            ${anio ? Number(anio) : 'NULL'}::int AS anio,
            ${mes ? Number(mes) : 'NULL'}::int AS mes,
            ${saldoInicialExpr} AS saldo_inicial,
            ${totalDevengadoExpr} AS total_devengado,
            ${totalDisfrutadoExpr} AS total_disfrutado,
            (${saldoInicialExpr} + ${totalDevengadoExpr} - ${totalDisfrutadoExpr})::numeric(12,2) AS saldo_final,
            MAX(m.created_at) AS actualizado_en
       FROM asignaciones_ledger_movimientos m
       JOIN agentes ag ON ag.id = m.agente_id
  LEFT JOIN agentes_empleo e ON e.id_empleo::text = COALESCE(m.empleo_id::text, ag.empleo_id::text)
      WHERE ${where.join(' AND ')}
      GROUP BY m.agente_id
      HAVING ${havingExpr}
      ORDER BY MAX(ag.escalafon), MAX(ag.apellido_1), MAX(ag.apellido_2), MAX(ag.nombre), COALESCE(MAX(e.descripcion), 'Sin empleo')`,
    params
  );

  return result.rows;
};

exports.getLedgerAgentes = async ({ arsUnidadId, anio }) => {
  const params = [arsUnidadId];
  const where = ['m.ars_unidad_id::text = $1::text'];
  if (anio) {
    params.push(anio);
    where.push(`m.anio = $${params.length}`);
  }
  const result = await db.query(
    `SELECT DISTINCT
            ag.id        AS agente_id,
            ag.tip,
            ag.apellido_1,
            ag.apellido_2,
            ag.nombre
       FROM asignaciones_ledger_movimientos m
       JOIN agentes ag ON ag.id = m.agente_id
      WHERE ${where.join(' AND ')}
      ORDER BY ag.apellido_1, ag.apellido_2, ag.nombre`,
    params
  );
  return result.rows;
};

exports.getLedgerMovimientos = async ({
  arsUnidadId,
  anio,
  mes,
  agente_id,
}) => {
  const hasObservacionesColumn = await hasLedgerObservacionesColumn();
  const params = [arsUnidadId, agente_id];
  const baseWhere = [
    'm.ars_unidad_id::text = $1::text',
    'm.agente_id = $2',
  ];
  const viewWhere = [];

  if (anio) {
    params.push(anio);
    viewWhere.push(`calc.anio = $${params.length}`);
  }

  if (mes) {
    params.push(mes);
    viewWhere.push(`calc.mes = $${params.length}`);
  }

  const result = await db.query(
    `WITH calc AS (
        SELECT m.id,
               m.fecha,
               m.anio,
               m.mes,
               m.agente_id,
               m.empleo_id,
               m.origen,
               m.borrador_id,
               m.tipo_movimiento,
               m.signo,
               m.cantidad_dias,
               m.source_kind,
               m.source_key,
               m.created_at,
               m.actividad_id,
               m.regla_id,
               m.metadata,
               ${hasObservacionesColumn ? 'm.observaciones,' : ''}
               COALESCE(
                 SUM(m.signo * m.cantidad_dias) OVER (
                   PARTITION BY m.ars_unidad_id::text,
                                m.agente_id
                   ORDER BY m.fecha ASC, m.created_at ASC, m.id ASC
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ),
                 0
               )::numeric(12,2) AS saldo_despues_calc
          FROM asignaciones_ledger_movimientos m
         WHERE ${baseWhere.join(' AND ')}
      )
      SELECT calc.id,
            calc.fecha,
            ag.tip,
            ag.apellido_1,
            ag.apellido_2,
            ag.nombre,
            COALESCE(calc.empleo_id::text, ag.empleo_id::text) AS empleo_id,
            COALESCE(ae_mov.descripcion, ae_ag.descripcion) AS empleo_nombre,
            COALESCE(ae_mov.color, ae_ag.color) AS empleo_color,
            calc.origen,
            b.nombre AS borrador_nombre,
            calc.tipo_movimiento,
            calc.signo,
            calc.cantidad_dias::numeric(10,2) AS cantidad_dias,
            (calc.saldo_despues_calc - (calc.signo * calc.cantidad_dias))::numeric(12,2) AS saldo_antes,
            calc.saldo_despues_calc::numeric(12,2) AS saldo_despues,
            calc.source_kind,
            calc.source_key,
            calc.created_at,
            calc.actividad_id,
            a.actividad AS actividad_codigo,
            a.nombre AS actividad_nombre,
            calc.regla_id,
            calc.borrador_id,
              calc.metadata,
              ${hasObservacionesColumn ? 'calc.observaciones' : "COALESCE(calc.metadata->>'observaciones', NULL)"} AS observaciones
       FROM calc
  LEFT JOIN agentes ag ON ag.id = calc.agente_id
  LEFT JOIN actividades a ON a.id_actividad = calc.actividad_id
  LEFT JOIN asignaciones_borradores b ON b.id = calc.borrador_id
  LEFT JOIN agentes_empleo ae_mov ON ae_mov.id_empleo::text = calc.empleo_id::text
  LEFT JOIN agentes_empleo ae_ag ON ae_ag.id_empleo::text = ag.empleo_id::text
      WHERE ${viewWhere.length ? viewWhere.join(' AND ') : '1=1'}
      ORDER BY calc.fecha DESC, calc.created_at DESC, calc.id DESC`,
    params
  );

  return result.rows;
};
