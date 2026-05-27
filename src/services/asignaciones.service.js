// ── Servicio: obtener saldo devengo inicial por agente ─────────────
/**
 * Devuelve un objeto { [agente_id]: saldo } con el saldo de devengo acumulado
 * hasta el inicio del mes indicado, para todos los agentes de la unidad.
 * @param {number} anio
 * @param {number} mes
 * @param {string|number} arsUnidadId
 * @returns {Promise<Object>} saldosDevengo
 */
exports.getSaldosDevengoInicial = async (
  anio,
  mes,
  arsUnidadId,
  agenteId = null
) => {
  const arsId = requireArsId(arsUnidadId);
  const client = await db.connect();
  try {
    const saldosDevengo = {};
    const corteFecha = `${anio}-${String(mes).padStart(2, '0')}-01`;
    let query = `SELECT agente_id, COALESCE(SUM(signo * cantidad_dias),0)::numeric(12,2) AS saldo_devengo
         FROM asignaciones_ledger_movimientos
        WHERE ars_unidad_id = $1
          AND fecha < $2`;
    const params = [arsId, corteFecha];
    if (agenteId) {
      query += ' AND agente_id = $3';
      params.push(agenteId);
    }
    query += ' GROUP BY agente_id';
    const saldosRes = await client.query(query, params);
    for (const row of saldosRes.rows) {
      saldosDevengo[row.agente_id] = Number(row.saldo_devengo);
    }
    return saldosDevengo;
  } finally {
    client.release();
  }
};
const db = require('../config/db');
const { tieneAlgunPermiso } = require('./permisos.service');
const ApiError = require('../utils/ApiError');
const { withRetry } = require('../utils/retry');

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

function buildFecha(anio, mes, dia) {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function normalizeFecha(raw, anio, mes) {
  if (!raw) return buildFecha(anio, mes, 1);
  return raw instanceof Date
    ? raw.toISOString().slice(0, 10)
    : String(raw).slice(0, 10);
}

function normalizeFechaCorte(fechaCorteRaw, anio, mes) {
  const fallback = `${anio}-${String(mes).padStart(2, '0')}-01`;
  if (!fechaCorteRaw) return fallback;
  const value = String(fechaCorteRaw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function mergeSaldos(baseMap, deltaMap) {
  const out = { ...baseMap };
  for (const agenteId of Object.keys(deltaMap || {})) {
    out[agenteId] =
      Number(out[agenteId] || 0) + Number(deltaMap[agenteId] || 0);
  }
  return out;
}

function parseNumericCsv(value) {
  if (!value) return [];
  return Array.from(
    new Set(
      String(value)
        .split(',')
        .map((item) => Number(String(item).trim()))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );
}

async function getRequisitosResumenByAgente(client, arsId) {
  const { rows } = await client.query(
    `SELECT a.id AS agente_id,
            COALESCE(SUM(COALESCE(det.completado_total, 0)), 0)::int AS requisitos_completado_total,
            COALESCE(SUM(COALESCE(det.objetivo_total, 0)), 0)::int AS requisitos_objetivo_total,
            CASE
              WHEN COALESCE(SUM(COALESCE(det.objetivo_total, 0)), 0) > 0
                THEN LEAST(
                  100,
                  ROUND(
                    COALESCE(SUM(COALESCE(det.completado_total, 0)), 0)::numeric * 100 /
                    COALESCE(SUM(COALESCE(det.objetivo_total, 0)), 0)::numeric
                  )
                )::int
              ELSE NULL
            END AS requisitos_pct,
            COALESCE(
              json_agg(
                json_build_object(
                  'plantilla_id', det.plantilla_id,
                  'plantilla_nombre', det.plantilla_nombre,
                  'tipo', det.plantilla_tipo,
                  'completado_total', COALESCE(det.completado_total, 0),
                  'objetivo_total', COALESCE(det.objetivo_total, 0),
                  'pct', CASE
                    WHEN COALESCE(det.objetivo_total, 0) > 0
                      THEN LEAST(
                        100,
                        ROUND(COALESCE(det.completado_total, 0)::numeric * 100 / COALESCE(det.objetivo_total, 0)::numeric)
                      )::int
                    ELSE NULL
                  END,
                  'estado', CASE
                    WHEN COALESCE(det.objetivo_total, 0) <= 0 THEN 'sin_objetivo'
                    WHEN LEAST(100, ROUND(COALESCE(det.completado_total, 0)::numeric * 100 / COALESCE(det.objetivo_total, 0)::numeric))::int = 100 THEN 'cumple'
                    WHEN LEAST(100, ROUND(COALESCE(det.completado_total, 0)::numeric * 100 / COALESCE(det.objetivo_total, 0)::numeric))::int > 49 THEN 'en_progreso'
                    ELSE 'vencido'
                  END
                )
                ORDER BY det.plantilla_nombre
              ) FILTER (WHERE det.plantilla_id IS NOT NULL),
              '[]'::json
            ) AS requisitos_detalle_pct
       FROM agentes a
       LEFT JOIN LATERAL (
         SELECT t.id AS plantilla_id,
                t.nombre AS plantilla_nombre,
            t.tipo_requisito AS plantilla_tipo,
                COALESCE(SUM(p.completado_total), 0)::int AS completado_total,
                COALESCE(SUM(p.objetivo_total), 0)::int AS objetivo_total
           FROM agentes_requisitos_plantillas t
           LEFT JOIN agentes_requisitos_periodos p
             ON p.plantilla_id = t.id
            AND p.agente_id = a.id
            AND p.ars_unidad_id = a.ars_unidad_id
          WHERE t.ars_unidad_id = a.ars_unidad_id
            AND t.activo = true
           GROUP BY t.id, t.nombre, t.tipo_requisito
       ) det ON TRUE
      WHERE a.ars_unidad_id = $1
        AND a.fecha_baja IS NULL
      GROUP BY a.id`,
    [arsId]
  );

  const out = {};
  rows.forEach((row) => {
    const agenteId = Number(row.agente_id);
    if (!Number.isInteger(agenteId) || agenteId <= 0) return;

    out[agenteId] = {
      completado_total: Number(row.requisitos_completado_total || 0),
      objetivo_total: Number(row.requisitos_objetivo_total || 0),
      pct:
        row.requisitos_pct == null || Number.isNaN(Number(row.requisitos_pct))
          ? null
          : Number(row.requisitos_pct),
      detalle: Array.isArray(row.requisitos_detalle_pct)
        ? row.requisitos_detalle_pct
        : [],
    };
  });

  return out;
}

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

async function withClient(fn) {
  const client = await db.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function canManageSharedBorradores(user) {
  if (!user) return false;

  // Tokens con RBAC
  if (user.role_id) {
    return await tieneAlgunPermiso(user.role_id, [
      'asignaciones:leer',
      'asignaciones:editar',
      'asignaciones:validar',
    ]);
  }

  // Compatibilidad legacy
  const role = String(user.role || '').toLowerCase();
  return role === 'admin' || role === 'supervisor' || role === 'operador';
}

async function canViewAllBorradores(user) {
  if (!user) return false;

  const permisosSesion = Array.isArray(user.permisos) ? user.permisos : [];
  if (permisosSesion.length > 0) {
    return permisosSesion.some((p) => {
      const key = String(p || '').trim().toLowerCase();
      return key === 'asignaciones:leer';
    });
  }

  return canManageSharedBorradores(user);
}

function isBorradoresVisibilityDebugEnabled() {
  return String(process.env.DEBUG_BORRADORES_VISIBILIDAD || '').trim() === '1';
}

function debugBorradoresVisibility(evento, data) {
  if (!isBorradoresVisibilityDebugEnabled()) return;
  try {
    console.log(
      '[borradores-visibility]',
      JSON.stringify({
        evento,
        ts: new Date().toISOString(),
        ...data,
      })
    );
  } catch (_ignore) {
    // Evita romper el flujo por problemas de serializacion en trazas.
  }
}

function requireArsId(arsUnidadId) {
  if (!arsUnidadId) {
    throw new Error('Agrupacion no resuelta');
  }
  return arsUnidadId;
}

function ensureBorradorNameWithArs(nombre, arsUnidadId) {
  const baseName = String(nombre || 'Borrador').trim() || 'Borrador';
  const arsTag = String(arsUnidadId || '').trim();
  if (!arsTag) return baseName;

  const suffix = `_${arsTag}`;
  return baseName.endsWith(suffix) ? baseName : `${baseName}${suffix}`;
}

// ── Fragmentos SQL reutilizables ─────────────────────────────

const SQL_TURNO_COLS = `
  t.codigo AS turno_codigo,
  t.color  AS turno_color,
  t.nombre AS turno_nombre`;

const SQL_AGENTE_COLS = `
  ag.nombre       AS agente_nombre,
  ag.apellido_1   AS agente_apellido1,
  ag.apellido_2   AS agente_apellido2,
  ag.tip          AS agente_tip,
  ag.escalafon,
  ag.orden_gc,
  ag.pei,
  ag.paef,
  ag.aptitudes,
  ag.comentarios`;

const SQL_CATALOGO_COLS = `
  ag.empleo_id,
  e.descripcion   AS empleo_nombre,
  p.id_peloton    AS peloton_codigo,
  p.descripcion   AS peloton_nombre,
  p.color         AS peloton_color,
  s.descripcion   AS situacion_nombre,
  e.color         AS color_empleo,
  p.color         AS color_peloton,
  s.color         AS color_situacion`;

const SQL_CATALOGO_JOINS = `
  LEFT JOIN agentes_empleo    e ON e.id_empleo    = ag.empleo_id
  LEFT JOIN agentes_peloton   p ON p.id_peloton   = ag.peloton_id
  LEFT JOIN agentes_situacion s ON s.id_situacion = ag.situacion_id`;

const SQL_SERVICIOS_BORRADOR = `
  SELECT bs.asignacion_borrador_id, bs.actividad_id,
         a.actividad AS actividad_codigo, a.nombre AS actividad_nombre
  FROM asignaciones_borrador_servicios bs
  JOIN actividades a ON a.id_actividad = bs.actividad_id
  WHERE bs.asignacion_borrador_id = ANY($1)`;

const SQL_SERVICIOS_DEFINITIVO = `
  SELECT s.asignacion_id, s.actividad_id,
         a.actividad AS actividad_codigo, a.nombre AS actividad_nombre
  FROM asignaciones_servicios s
  JOIN actividades a ON a.id_actividad = s.actividad_id
  WHERE s.asignacion_id = ANY($1)`;

const BORRADOR_RETURNING = `
  RETURNING id, borrador_id, anio, mes, dia, fecha::text AS fecha,
            agente_id, turno_id, observaciones, propietario_id,
            revision, created_at, updated_at`;

// ── WHERE dinámico ───────────────────────────────────────────

function buildDynamicWhere(
  baseParamCount,
  { agente_ids, fechas, prefix = '' }
) {
  const pre = prefix ? `${prefix}.` : '';
  const clauses = [];
  const params = [];
  let idx = baseParamCount;

  if (agente_ids?.length) {
    idx++;
    clauses.push(`AND ${pre}agente_id = ANY($${idx})`);
    params.push(agente_ids);
  }
  if (fechas?.length) {
    idx++;
    clauses.push(`AND ${pre}fecha = ANY($${idx}::date[])`);
    params.push(fechas);
  }

  return { sql: clauses.join(' '), params };
}

// ── Log ──────────────────────────────────────────────────────

async function logAccion(
  client,
  {
    ars_unidad_id,
    anio,
    mes,
    borrador_id,
    accion,
    agente_id,
    dia,
    fecha,
    turno_id,
    observaciones,
    datos_anteriores,
    datos_nuevos,
    detalle,
    usuario_id,
    usuario_nombre,
  }
) {
  await client.query(
    `INSERT INTO asignaciones_log
       (ars_unidad_id, anio, mes, borrador_id, accion, agente_id, dia, fecha, turno_id, observaciones,
        datos_anteriores, datos_nuevos, detalle, usuario_id, usuario_nombre, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, clock_timestamp())`,
    [
      ars_unidad_id,
      anio,
      mes,
      borrador_id || null,
      accion,
      agente_id || null,
      dia || null,
      fecha || null,
      turno_id || null,
      observaciones || null,
      datos_anteriores ? JSON.stringify(datos_anteriores) : null,
      datos_nuevos ? JSON.stringify(datos_nuevos) : null,
      detalle || null,
      usuario_id,
      usuario_nombre || null,
    ]
  );
}

// ── Upsert borrador (UPDATE first, INSERT if missing) ────────

async function touchBorrador(client, borrador_id, arsUnidadId) {
  await client.query(
    `UPDATE asignaciones_borradores
     SET updated_at = now(),
         revision = revision + 1,
         estado = CASE
           WHEN estado = 'validado' THEN 'modificado'
           ELSE estado
         END
     WHERE id = $1 AND ars_unidad_id = $2`,
    [borrador_id, arsUnidadId]
  );
}

async function markDevengosPendientes(client, borrador_id, arsUnidadId) {
  await client.query(
    `UPDATE asignaciones_borradores
     SET devengos_pendientes = true,
         updated_at = now()
     WHERE id = $1 AND ars_unidad_id = $2`,
    [borrador_id, arsUnidadId]
  );
}

async function markDevengosConsolidados(client, borrador_id, arsUnidadId) {
  await client.query(
    `UPDATE asignaciones_borradores
     SET devengos_pendientes = false,
         devengos_updated_at = now(),
         updated_at = now()
     WHERE id = $1 AND ars_unidad_id = $2`,
    [borrador_id, arsUnidadId]
  );
}

async function upsertBorradorRow(
  client,
  {
    borrador_id,
    anio,
    mes,
    dia,
    fecha,
    agente_id,
    turno_id,
    observaciones,
    propietario_id,
    ars_unidad_id,
    expected_revision,
  }
) {
  const hasExpected = expected_revision != null;
  const upd = await client.query(
    `UPDATE asignaciones_borrador
     SET anio = $1, mes = $2, dia = $3,
         turno_id = $4, observaciones = $5, updated_at = now(),
         revision = revision + 1
     WHERE borrador_id = $6
       AND fecha = $7 AND agente_id = $8 AND ars_unidad_id = $9
       AND ($10::bigint IS NULL OR revision = $10)
     ${BORRADOR_RETURNING}`,
    [
      anio,
      mes,
      dia,
      turno_id,
      observaciones || null,
      borrador_id,
      fecha,
      agente_id,
      ars_unidad_id,
      hasExpected ? expected_revision : null,
    ]
  );
  if (upd.rows.length) return upd.rows[0];

  // If expected_revision was provided but UPDATE matched 0 rows, check conflict
  if (hasExpected) {
    const {
      rows: [existing],
    } = await client.query(
      'SELECT id FROM asignaciones_borrador WHERE borrador_id=$1 AND fecha=$2 AND agente_id=$3 AND ars_unidad_id = $4',
      [borrador_id, fecha, agente_id, ars_unidad_id]
    );
    if (existing) {
      throw new ApiError(
        409,
        'Celda modificada por otro usuario. Recargue el cuadrante.',
        { conflict: true }
      );
    }
  }

  try {
    const ins = await client.query(
      `INSERT INTO asignaciones_borrador
         (borrador_id, anio, mes, dia, fecha, agente_id, turno_id,
          observaciones, propietario_id, ars_unidad_id, revision, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, 0, now(), now())
       ${BORRADOR_RETURNING}`,
      [
        borrador_id,
        anio,
        mes,
        dia,
        fecha,
        agente_id,
        turno_id,
        observaciones || null,
        propietario_id,
        ars_unidad_id,
      ]
    );
    return ins.rows[0];
  } catch (error) {
    const duplicateByFecha =
      error?.code === '23505' &&
      String(error?.constraint || '').includes('uq_borrador_agente_fecha');
    if (!duplicateByFecha) throw error;

    const retryUpd = await client.query(
      `UPDATE asignaciones_borrador
       SET anio = $1, mes = $2, dia = $3,
           turno_id = $4, observaciones = $5, updated_at = now(),
           revision = revision + 1
       WHERE borrador_id = $6
         AND fecha = $7 AND agente_id = $8 AND ars_unidad_id = $9
       ${BORRADOR_RETURNING}`,
      [
        anio,
        mes,
        dia,
        turno_id,
        observaciones || null,
        borrador_id,
        fecha,
        agente_id,
        ars_unidad_id,
      ]
    );
    if (retryUpd.rows.length) return retryUpd.rows[0];
    throw error;
  }
}

// ── Sync servicios (batch con unnest) ────────────────────────

async function syncServicios(client, borradorId, actividad_ids, arsUnidadId) {
  await client.query(
    'DELETE FROM asignaciones_borrador_servicios WHERE asignacion_borrador_id = $1 AND ars_unidad_id = $2',
    [borradorId, arsUnidadId]
  );

  if (!actividad_ids?.length) return;

  await client.query(
    `INSERT INTO asignaciones_borrador_servicios (ars_unidad_id, asignacion_borrador_id, actividad_id)
     SELECT $1, $2, unnest($3::int[])
       ON CONFLICT (asignacion_borrador_id, actividad_id) DO NOTHING`,
    [arsUnidadId, borradorId, actividad_ids]
  );
}

// ── Resolución de borradores ─────────────────────────────────

async function getBorradorById(client, borradorId, arsUnidadId) {
  if (!borradorId) return null;
  const { rows } = await client.query(
    'SELECT * FROM asignaciones_borradores WHERE id = $1 AND ars_unidad_id = $2',
    [borradorId, arsUnidadId]
  );
  return rows[0] || null;
}

async function getDefaultBorrador(
  client,
  anio,
  mes,
  propietarioId,
  arsUnidadId
) {
  const { rows } = await client.query(
    `SELECT * FROM asignaciones_borradores
     WHERE anio = $1::int AND mes = $2::int AND propietario_id = $3::int AND ars_unidad_id::text = $4::text
     ORDER BY created_at DESC LIMIT 1`,
    [anio, mes, propietarioId, arsUnidadId]
  );
  return rows[0] || null;
}

async function resolveExistingBorrador(client, { anio, mes, user, arsUnidadId }) {
  // Priorizar borrador canónico (validado/modificado) del período.
  const canonico = await getCanonicoBorradorByPeriodo(client, {
    anio,
    mes,
    arsUnidadId,
  });
  if (canonico) return canonico;

  return getDefaultBorrador(client, anio, mes, user.id, arsUnidadId);
}

async function getCanonicoBorradorByPeriodo(client, {
  anio,
  mes,
  arsUnidadId,
}) {
  const {
    rows: [canonico],
  } = await client.query(
    `SELECT * FROM asignaciones_borradores
     WHERE anio = $1::int AND mes = $2::int
       AND ars_unidad_id::text = $3::text
       AND estado IN ('validado', 'modificado')
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [anio, mes, arsUnidadId]
  );
  return canonico || null;
}

async function lockBorradorPeriodo(client, { anio, mes, arsUnidadId }) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
    [
      'asig:borrador-periodo',
      String(arsUnidadId || ''),
      String(anio || ''),
      String(mes || ''),
    ].join('|'),
  ]);
}

async function assertNoCanonicoBorradorEnPeriodo(
  client,
  { anio, mes, arsUnidadId }
) {
  const canonico = await getCanonicoBorradorByPeriodo(client, {
    anio,
    mes,
    arsUnidadId,
  });
  if (canonico) {
    throw new Error(
      'No se puede crear un nuevo borrador: el período ya tiene un borrador canónico validado/modificado'
    );
  }
}

async function resolveBorrador(
  client,
  { anio, mes, borrador_id, user, autoCreate, nombre, arsUnidadId }
) {
  if (borrador_id) {
    const found = await getBorradorById(
      client,
      Number(borrador_id),
      arsUnidadId
    );
    if (!found) throw new Error('El borrador seleccionado no existe');

    const isOwner = Number(found.propietario_id) === Number(user.id);
    const canViewAll = await canViewAllBorradores(user);
    if (!isOwner && !canViewAll) {
      throw new Error('No tiene permisos para usar este borrador');
    }

    return found;
  }

  const existing = await resolveExistingBorrador(client, {
    anio,
    mes,
    user,
    arsUnidadId,
  });
  if (existing) return existing;
  if (!autoCreate) return null;

  // Evita duplicados cuando varias requests llegan en paralelo sin borrador_id
  // (p.ej. bulk en lotes). Se serializa por unidad/período/usuario.
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text))',
    [
      [
        'asig:auto-borrador',
        String(arsUnidadId || ''),
        String(anio || ''),
        String(mes || ''),
        String(user && user.id ? user.id : ''),
      ].join('|'),
    ]
  );

  const existingAfterLock = await resolveExistingBorrador(client, {
    anio,
    mes,
    user,
    arsUnidadId,
  });
  if (existingAfterLock) return existingAfterLock;

  return createBorradorTx(
    client,
    {
      anio,
      mes,
      nombre: ensureBorradorNameWithArs(nombre || 'Borrador', arsUnidadId),
    },
    user,
    arsUnidadId
  );
}

async function createBorradorTx(client, data, user, arsUnidadId) {
  const { anio, mes, nombre, copia_de_id, observaciones } = data;
  const nombreConArs = ensureBorradorNameWithArs(nombre, arsUnidadId);
  console.log(
    `Creando borrador para ${anio}_${mes}_${nombreConArs}  usuario ${user.id})`
  );
  const {
    rows: [{ next_version }],
  } = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM asignaciones_borradores
     WHERE anio = $1::int AND mes = $2::int AND lower(nombre) = lower($3::text) AND ars_unidad_id::text = $4::text`,
    [anio, mes, nombreConArs, arsUnidadId]
  );
  let borrador = null;
  let versionToTry = Number(next_version || 1);
  for (let i = 0; i < 5; i += 1) {
    try {
      await client.query('SAVEPOINT sp_create_borrador');
      const { rows } = await client.query(
        `INSERT INTO asignaciones_borradores
           (ars_unidad_id, anio, mes, nombre, version, estado, observaciones, propietario_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'borrador',$6,$7, now(), now())
         RETURNING *`,
        [
          arsUnidadId,
          anio,
          mes,
          nombreConArs,
          versionToTry,
          observaciones || null,
          user.id,
        ]
      );
      await client.query('RELEASE SAVEPOINT sp_create_borrador');
      borrador = rows[0] || null;
      break;
    } catch (error) {
      const duplicateNameVersion =
        error?.code === '23505' &&
        [
          'uq_asig_borradores_nombre_version',
          'uq_asig_borradores_ars_nombre_version',
        ].includes(String(error?.constraint || ''));
      try {
        await client.query('ROLLBACK TO SAVEPOINT sp_create_borrador');
      } catch (_rollbackError) {
        // Si el savepoint no existe o la conexion ya esta en rollback, dejamos que salga el error original.
      }
      if (!duplicateNameVersion) throw error;
      versionToTry += 1;
    }
  }

  if (!borrador) {
    throw new Error('No se pudo crear el borrador por conflicto de versión');
  }

  if (copia_de_id) {
    await client.query(
      `INSERT INTO asignaciones_borrador
         (ars_unidad_id, borrador_id, agente_id, anio, mes, dia, fecha,
          turno_id, observaciones, propietario_id, created_at, updated_at)
       SELECT $1::varchar, $2::int, agente_id, $3::int, $4::int, dia, fecha,
              turno_id, observaciones, $5::int, now(), now()
       FROM asignaciones_borrador ab
       WHERE ab.borrador_id = $6::int
         AND ab.ars_unidad_id = $1::varchar`,
      [arsUnidadId, borrador.id, anio, mes, user.id, copia_de_id]
    );

    // Limpieza post-copia: retirar del destino los agentes en baja.
    await client.query(
      `DELETE FROM asignaciones_borrador d
        WHERE d.borrador_id = $1::int
          AND d.ars_unidad_id = $2::varchar
          AND EXISTS (
            SELECT 1
              FROM agentes ag
             WHERE ag.id = d.agente_id
               AND ag.ars_unidad_id = d.ars_unidad_id
               AND ag.fecha_baja IS NOT NULL
          )`,
      [borrador.id, arsUnidadId]
    );

    await client.query(
      `INSERT INTO asignaciones_borrador_servicios (ars_unidad_id, asignacion_borrador_id, actividad_id)
       SELECT DISTINCT $3::varchar, dest.id, srcs.actividad_id
       FROM asignaciones_borrador src
       JOIN asignaciones_borrador dest
         ON dest.borrador_id    = $1::int
        AND dest.agente_id      = src.agente_id
        AND dest.fecha          = src.fecha
        AND dest.ars_unidad_id  = $3::varchar
       JOIN asignaciones_borrador_servicios srcs
         ON srcs.asignacion_borrador_id = src.id
       WHERE src.borrador_id = $2::int AND src.ars_unidad_id = $3::varchar
         AND NOT EXISTS (
           SELECT 1
           FROM asignaciones_borrador_servicios x
           WHERE x.asignacion_borrador_id = dest.id
             AND x.actividad_id = srcs.actividad_id
             AND x.ars_unidad_id = $3::varchar
         )`,
      [borrador.id, copia_de_id, arsUnidadId]
    );
  }

  return borrador;
}

// ── Obtener filas origen (para copiarMes) ────────────────────

async function obtenerFilasOrigen(
  client,
  {
    origen_anio,
    origen_mes,
    origen_borrador_id,
    agente_ids,
    fechas,
    user,
    arsUnidadId,
  }
) {
  async function queryFromBorrador() {
    // @ts-ignore
    const origenBorrador = await resolveBorrador(client, {
      anio: origen_anio,
      mes: origen_mes,
      borrador_id: origen_borrador_id,
      user,
      autoCreate: false,
      arsUnidadId,
    });
    if (!origenBorrador) return [];

    const { sql: borrWhere, params: borrExtra } = buildDynamicWhere(2, {
      agente_ids,
      fechas,
      prefix: 'ab',
    });

    const { rows } = await client.query(
      `SELECT ab.agente_id, ab.fecha::text AS fecha, ab.turno_id, ab.observaciones,
              array_agg(bs.actividad_id) FILTER (WHERE bs.actividad_id IS NOT NULL) AS actividad_ids
       FROM asignaciones_borrador ab
       JOIN agentes ag ON ag.id = ab.agente_id
       LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
       WHERE ab.borrador_id = $1
         AND ab.ars_unidad_id = $2
         AND ag.fecha_baja IS NULL ${borrWhere}
       GROUP BY ab.agente_id, ab.fecha, ab.turno_id, ab.observaciones`,
      [origenBorrador.id, arsUnidadId, ...borrExtra]
    );

    return rows;
  }

  const hasOrigenBorrador =
    Number.isFinite(Number(origen_borrador_id)) &&
    Number(origen_borrador_id) > 0;

  // Si se indicó borrador origen, priorizar SIEMPRE ese dataset.
  if (hasOrigenBorrador) {
    const borrRows = await queryFromBorrador();
    if (borrRows.length) return borrRows;
  }

  // Si no hay borrador explícito o está vacío, intentar definitivo.
  const { sql: defWhere, params: defExtra } = buildDynamicWhere(3, {
    agente_ids,
    fechas,
    prefix: 'asig',
  });

  const defRes = await client.query(
    `SELECT asig.agente_id, asig.fecha::text AS fecha, asig.turno_id, asig.observaciones,
            array_agg(s.actividad_id) FILTER (WHERE s.actividad_id IS NOT NULL) AS actividad_ids
     FROM asignaciones asig
     JOIN agentes ag ON ag.id = asig.agente_id
     LEFT JOIN asignaciones_servicios s ON s.asignacion_id = asig.id
     WHERE asig.anio = $1
       AND asig.mes = $2
       AND asig.ars_unidad_id = $3
       AND ag.fecha_baja IS NULL ${defWhere}
     GROUP BY asig.agente_id, asig.fecha, asig.turno_id, asig.observaciones`,
    [origen_anio, origen_mes, arsUnidadId, ...defExtra]
  );

  if (defRes.rows.length) return defRes.rows;

  // Último fallback a borrador (sin borrador explícito o sin definitivo).
  return queryFromBorrador();
}

// ══════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════

// ── Listar borradores ────────────────────────────────────────

exports.getBorradores = async (anio, mes, user, arsUnidadId) => {
  const arsId = requireArsId(arsUnidadId);
  const canViewAll = await canViewAllBorradores(user);

  const params = [anio, mes, arsId];
  let where = 'WHERE b.anio = $1 AND b.mes = $2 AND b.ars_unidad_id = $3';

  if (!canViewAll) {
    params.push(user.id);
    where += ` AND (b.propietario_id = $${params.length} OR b.estado = 'validado')`;
  }

  const { rows } = await db.query(
    `SELECT b.*,
            COALESCE(
              NULLIF(u.nombre::text, ''),
              NULLIF(u.email::text, ''),
              '#' || b.propietario_id::text
            ) AS propietario_username
     FROM asignaciones_borradores b
     LEFT JOIN usuarios u ON u.id = b.propietario_id
     ${where}
     ORDER BY b.updated_at DESC, b.id DESC`,
    params
  );

  debugBorradoresVisibility('getBorradores', {
    arsId,
    anio: Number(anio),
    mes: Number(mes),
    userId: Number(user && user.id),
    role: String((user && user.role) || ''),
    roleId: Number((user && user.role_id) || 0),
    permisosCount: Array.isArray(user && user.permisos) ? user.permisos.length : 0,
    canViewAll,
    totalRows: rows.length,
  });

  return rows;
};

// ── Períodos efectivos (con datos en definitivo y/o borradores visibles) ──

exports.getPeriodosDisponibles = async (user, arsUnidadId, options = {}) => {
  const arsId = requireArsId(arsUnidadId);
  const canViewAll = await canViewAllBorradores(user);
  const agenteId = Number(options && options.agente_id);
  const hasAgenteFilter = Number.isInteger(agenteId) && agenteId > 0;
  const source =
    options && options.source ? String(options.source).toLowerCase() : null;

  const params = [arsId];
  let definitivoAgenteWhere = '';
  if (hasAgenteFilter) {
    params.push(agenteId);
    definitivoAgenteWhere = ` AND asig.agente_id = $${params.length}`;
  }

  let borradoresVisibilityWhere = '';
  if (!canViewAll) {
    params.push(user.id);
    borradoresVisibilityWhere = ` AND (b.propietario_id = $${params.length} OR b.estado = 'validado')`;
  }

  let borradorAgenteWhere = '';
  if (hasAgenteFilter) {
    params.push(agenteId);
    borradorAgenteWhere = ` AND ab.agente_id = $${params.length}`;
  }

  const { rows } = await db.query(
    `WITH periodos_definitivo AS (
       SELECT DISTINCT asig.anio, asig.mes,
              TRUE AS tiene_definitivo,
              FALSE AS tiene_borrador
       FROM asignaciones asig
       WHERE asig.ars_unidad_id = $1
         ${definitivoAgenteWhere}
     ),
     periodos_borrador AS (
       SELECT DISTINCT b.anio, b.mes,
              FALSE AS tiene_definitivo,
              TRUE AS tiene_borrador
       FROM asignaciones_borradores b
       WHERE b.ars_unidad_id = $1
         ${borradoresVisibilityWhere}
         AND EXISTS (
           SELECT 1
           FROM asignaciones_borrador ab
           WHERE ab.borrador_id = b.id
             AND ab.ars_unidad_id = b.ars_unidad_id
             ${borradorAgenteWhere}
         )
     )
     SELECT anio,
            mes,
            BOOL_OR(tiene_definitivo) AS tiene_definitivo,
            BOOL_OR(tiene_borrador) AS tiene_borrador
     FROM (
       SELECT * FROM periodos_definitivo
       UNION ALL
       SELECT * FROM periodos_borrador
     ) src
     GROUP BY anio, mes
     ORDER BY anio DESC, mes DESC`,
    params
  );

  let mapped = rows.map((r) => ({
    anio: Number(r.anio),
    mes: Number(r.mes),
    tiene_definitivo: Boolean(r.tiene_definitivo),
    tiene_borrador: Boolean(r.tiene_borrador),
  }));

  if (source === 'definitivo') {
    mapped = mapped.filter((r) => r.tiene_definitivo);
  } else if (source === 'borrador') {
    mapped = mapped.filter((r) => r.tiene_borrador);
  }

  debugBorradoresVisibility('getPeriodosDisponibles', {
    arsId,
    userId: Number(user && user.id),
    role: String((user && user.role) || ''),
    roleId: Number((user && user.role_id) || 0),
    permisosCount: Array.isArray(user && user.permisos) ? user.permisos.length : 0,
    source,
    agenteId: hasAgenteFilter ? agenteId : null,
    canViewAll,
    totalRows: mapped.length,
  });

  return mapped;
};

// ── Crear borrador ───────────────────────────────────────────

exports.createBorrador = (data, user, arsUnidadId) =>
  withRetry(
    () =>
      withTransaction(async (client) => {
        const arsId = requireArsId(arsUnidadId);
        const anio = Number(data && data.anio);
        const mes = Number(data && data.mes);

        await lockBorradorPeriodo(client, { anio, mes, arsUnidadId: arsId });

        await assertNoCanonicoBorradorEnPeriodo(client, {
          anio,
          mes,
          arsUnidadId: arsId,
        });

        return createBorradorTx(client, data, user, arsId);
      }),
    { maxRetries: 3, baseDelay: 100 }
  );

// ── Actualizar observaciones de borrador ────────────────────

exports.updateBorradorObservaciones = async (
  borrador_id,
  observaciones,
  // @ts-ignore
  user,
  arsUnidadId
) => {
  const arsId = requireArsId(arsUnidadId);
  const {
    rows: [borrador],
  } = await db.query(
    `UPDATE asignaciones_borradores
     SET observaciones = $1, updated_at = now()
     WHERE id = $2 AND ars_unidad_id = $3
     RETURNING *`,
    [observaciones || null, borrador_id, arsId]
  );
  if (!borrador) throw new Error('Borrador no encontrado');
  return borrador;
};

exports.deleteBorradorCompletamente = (data, user, arsUnidadId) =>
  withTransaction(async (client) => {
    const arsId = requireArsId(arsUnidadId);
    const { borrador_id } = data;

    const borrador = await getBorradorById(client, Number(borrador_id), arsId);
    if (!borrador) {
      throw new Error('El borrador seleccionado no existe');
    }

    const {
      rows: [{ total: totalAsignaciones }],
    } = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM asignaciones_borrador
       WHERE borrador_id = $1 AND ars_unidad_id = $2`,
      [borrador.id, arsId]
    );

    if (Number(totalAsignaciones) > 0) {
      throw new Error(
        'No se puede eliminar el borrador: tiene celdas ocupadas. Vacíelo primero.'
      );
    }

    // asignaciones_borrador_servicios tiene ON DELETE CASCADE → se elimina automáticamente
    await client.query(
      'DELETE FROM asignaciones_borrador WHERE borrador_id = $1 AND ars_unidad_id = $2',
      [borrador.id, arsId]
    );

    await client.query(
      'DELETE FROM asignaciones_borradores WHERE id = $1 AND ars_unidad_id = $2',
      [borrador.id, arsId]
    );

    // @ts-ignore
    await logAccion(client, {
      ars_unidad_id: arsId,
      anio: borrador.anio,
      mes: borrador.mes,
      borrador_id: borrador.id,
      accion: 'BORRADOR_ELIMINADO',
      detalle: `Borrador completamente eliminado: ${borrador.nombre} v${borrador.version}`,
      usuario_id: user.id,
      usuario_nombre: user.nombre || user.username,
    });

    return { deleted: true, borrador_id: borrador.id };
  });

// ── Obtener cuadrante (borrador + definitivo) ────────────────

exports.getCuadrante = (
  anio,
  mes,
  borradorId,
  user,
  arsUnidadId,
  options = {}
) =>
  withClient(async (client) => {
    const arsId = requireArsId(arsUnidadId);
    const source =
      options && options.source ? String(options.source).toLowerCase() : null;
    const forceDefinitivo = source === 'definitivo';
    const borrador = forceDefinitivo
      ? null
      : // @ts-ignore
        await resolveBorrador(client, {
          anio,
          mes,
          borrador_id: borradorId,
          user,
          autoCreate: false,
          arsUnidadId: arsId,
        });

    let control = { estado: 'sin_borrador', borrador_id: null };
    if (borrador) {
      const latestBorradorRes = await client.query(
        `SELECT id, nombre, version, estado, revision, created_at, updated_at
         FROM asignaciones_borradores
         WHERE id = $1 AND ars_unidad_id = $2`,
        [borrador.id, arsId]
      );
      const latestBorrador = latestBorradorRes.rows[0] || borrador;
      control = {
        estado: latestBorrador.estado || 'borrador',
        borrador_id: latestBorrador.id,
        nombre: latestBorrador.nombre,
        version: latestBorrador.version,
        revision: latestBorrador.revision,
        created_at: latestBorrador.created_at,
        updated_at: latestBorrador.updated_at,
      };
    }

    // ── Borrador rows ──
    let borradorRows = [];
    let borradorServicios = [];

    if (borrador) {
      const { rows } = await client.query(
        `SELECT
            ab.id, ab.borrador_id, ab.anio, ab.mes, ab.dia,
            ab.fecha::text AS fecha, ab.agente_id, ab.turno_id,
            ab.observaciones, ab.propietario_id, ab.revision,
            ab.created_at, ab.updated_at,
            ${SQL_TURNO_COLS},
            ${SQL_AGENTE_COLS},
            ${SQL_CATALOGO_COLS}
         FROM asignaciones_borrador ab
         JOIN agentes ag ON ag.id = ab.agente_id
         JOIN turnos  t  ON t.id_turno = ab.turno_id
         ${SQL_CATALOGO_JOINS}
         WHERE ab.borrador_id = $1
         AND ab.dia = 1
         AND ab.ars_unidad_id = $2
         AND ag.fecha_baja IS NULL
         ORDER BY ag.escalafon, ag.apellido_1, ag.apellido_2, ag.nombre, ab.fecha`,
        [borrador.id, arsId]
      );
      borradorRows = rows;

      if (borradorRows.length) {
        const svc = await client.query(SQL_SERVICIOS_BORRADOR, [
          borradorRows.map((r) => r.id),
        ]);
        borradorServicios = svc.rows;
      }
    }

    // ── Devengo en grid: saldo inicial + delta de ventana del cuadrante ──
    // 1) Saldo inicial acumulado hasta el día anterior al inicio de ventana.
    // 2) Delta del propio cuadrante en ventana (considera cálculo de borrador/validación y ajustes manuales).
    const saldosDevengoInicial = {};
    const saldosDevengoDeltaVentana = {};
    const corteFecha = normalizeFechaCorte(
      options && options.fecha_corte,
      anio,
      mes
    );
    const finVentana = normalizeFechaCorte(
      options && options.fecha_fin,
      anio,
      mes
    );

    const saldosRes = await client.query(
      `SELECT agente_id, COALESCE(SUM(signo * cantidad_dias),0)::numeric(12,2) AS saldo_devengo
           FROM asignaciones_ledger_movimientos
          WHERE ars_unidad_id = $1
            AND fecha <= $2::date
          GROUP BY agente_id`,
      [arsId, corteFecha]
    );
    for (const row of saldosRes.rows) {
      saldosDevengoInicial[row.agente_id] = Number(row.saldo_devengo);
    }

    let deltaSql = `SELECT agente_id, COALESCE(SUM(signo * cantidad_dias),0)::numeric(12,2) AS saldo_devengo
         FROM asignaciones_ledger_movimientos
        WHERE ars_unidad_id = $1
          AND fecha > $2::date
          AND fecha <= $3::date`;
    const deltaParams = [arsId, corteFecha, finVentana];

    if (borrador && borrador.id) {
      deltaSql += ` AND ((origen = 'borrador' AND borrador_id = $4) OR origen = 'manual')`;
      deltaParams.push(borrador.id);
    } else {
      deltaSql += ` AND (origen = 'validacion' OR origen = 'manual')`;
    }
    deltaSql += ' GROUP BY agente_id';

    const saldosDeltaRes = await client.query(deltaSql, deltaParams);
    for (const row of saldosDeltaRes.rows) {
      saldosDevengoDeltaVentana[row.agente_id] = Number(row.saldo_devengo);
    }

    const saldosDevengo = mergeSaldos(
      saldosDevengoInicial,
      saldosDevengoDeltaVentana
    );

    // ── Definitivo rows ──
    const defRes = await client.query(
      `SELECT
            asig.id, asig.anio, asig.mes, asig.dia,
            asig.fecha::text AS fecha, asig.agente_id, asig.turno_id,
            asig.observaciones, asig.propietario_id,
            asig.validado_por, asig.validado_at, asig.created_at,
            ${SQL_TURNO_COLS},
            ag.nombre AS agente_nombre, ag.apellido_1 AS agente_apellido1,
            ag.apellido_2 AS agente_apellido2, ag.tip AS agente_tip,
            ag.empleo_id, ag.peloton_id, ag.situacion_id
         FROM asignaciones asig
         JOIN turnos  t  ON t.id_turno = asig.turno_id
         JOIN agentes ag ON ag.id = asig.agente_id
         WHERE asig.anio = $1 AND asig.mes = $2 AND asig.dia = 1 AND asig.ars_unidad_id = $3
           AND ag.fecha_baja IS NULL
         ORDER BY ag.escalafon, ag.apellido_1, ag.apellido_2, ag.nombre, asig.fecha`,
      [anio, mes, arsId]
    );

    let definitivoServicios = [];
    if (defRes.rows.length) {
      const svc = await client.query(SQL_SERVICIOS_DEFINITIVO, [
        defRes.rows.map((r) => r.id),
      ]);
      definitivoServicios = svc.rows;
    }

    const requisitosByAgente = await getRequisitosResumenByAgente(client, arsId);

    return {
      control,
      borrador: borradorRows,
      selectedBorrador: borrador,
      borradorServicios,
      definitivo: defRes.rows,
      definitivoServicios,
      saldosDevengo,
      saldosDevengoInicial,
      saldosDevengoDeltaVentana,
      requisitosByAgente,
    };
  });

// ── Upsert individual ────────────────────────────────────────
// ★ REFACTOR: Devuelve la fila enriquecida con turno + servicios
//   para que el frontend pueda actualizar solo la celda sin recargar

exports.upsert = (data, user, arsUnidadId) => {
  const {
    anio,
    mes,
    borrador_id,
    agente_id,
    fecha: fechaRaw,
    turno_id,
    actividad_ids,
    observaciones,
    revision: expected_revision,
  } = data;
  const requestedAnio = Number(anio);
  const requestedMes = Number(mes);
  const periodoDia = 1;

  return withTransaction(async (client) => {
    const arsId = requireArsId(arsUnidadId);
    // @ts-ignore
    const borrador = await resolveBorrador(client, {
      anio: requestedAnio,
      mes: requestedMes,
      borrador_id,
      user,
      autoCreate: true,
      arsUnidadId: arsId,
    });

    if (!borrador?.id) {
      throw new Error('No se pudo crear o recuperar el borrador');
    }

    const periodoAnio = Number(borrador.anio);
    const periodoMes = Number(borrador.mes);
    const fecha = normalizeFecha(fechaRaw, periodoAnio, periodoMes);

    // Dato anterior para log — filtrar por fecha exacta, no por dia (que es siempre 1)
    const {
      rows: [prev = null],
    } = await client.query(
      `SELECT ab.*, array_remove(array_agg(bs.actividad_id), NULL) AS prev_actividades
       FROM asignaciones_borrador ab
       LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
       WHERE ab.borrador_id=$1 AND ab.agente_id=$2 AND ab.fecha=$3::date AND ab.ars_unidad_id = $4
       GROUP BY ab.id`,
      [borrador.id, agente_id, fecha, arsId]
    );

    const row = await upsertBorradorRow(client, {
      borrador_id: borrador.id,
      anio: periodoAnio,
      mes: periodoMes,
      dia: periodoDia,
      fecha,
      agente_id,
      turno_id,
      observaciones,
      propietario_id: user.id,
      ars_unidad_id: arsId,
      expected_revision:
        expected_revision != null ? Number(expected_revision) : null,
    });

    await syncServicios(client, row.id, actividad_ids, arsId);
    await touchBorrador(client, borrador.id, arsId);
    const esEdicion = !!prev;
    await logAccion(client, {
      ars_unidad_id: arsId,
      anio: periodoAnio,
      mes: periodoMes,
      borrador_id: borrador.id,
      accion: esEdicion ? 'BORRADOR_EDITAR' : 'BORRADOR_CREAR',
      agente_id,
      dia: periodoDia,
      fecha,
      turno_id,
      observaciones,
      datos_anteriores: esEdicion
        ? {
            fecha,
            turno_id: prev.turno_id,
            observaciones: prev.observaciones,
            actividad_ids: prev.prev_actividades,
          }
        : null,
      datos_nuevos: { fecha, turno_id, observaciones, actividad_ids },
      detalle: `${esEdicion ? 'Edición de asignación en borrador' : 'Nueva asignación en borrador'} [${borrador.nombre || ''} v${borrador.version || ''}]`,
      usuario_id: user.id,
      usuario_nombre: user.nombre || user.username,
    });

    // ★ REFACTOR: Enriquecer la respuesta con datos de turno
    const {
      rows: [enriched],
    } = await client.query(
      `SELECT ab.id, ab.borrador_id, ab.anio, ab.mes, ab.dia,
              ab.fecha::text AS fecha, ab.agente_id, ab.turno_id,
              ab.observaciones, ab.revision,
              t.codigo  AS turno_codigo,
              t.color   AS turno_color,
              t.nombre  AS turno_nombre
       FROM asignaciones_borrador ab
       JOIN turnos t ON t.id_turno = ab.turno_id
       WHERE ab.id = $1`,
      [row.id]
    );

    // ★ REFACTOR: Enriquecer con servicios
    const { rows: serviciosRows } = await client.query(
      `SELECT bs.actividad_id,
              a.actividad AS actividad_codigo,
              a.nombre    AS actividad_nombre
       FROM asignaciones_borrador_servicios bs
       JOIN actividades a ON a.id_actividad = bs.actividad_id
       WHERE bs.asignacion_borrador_id = $1`,
      [row.id]
    );

    await markDevengosPendientes(client, borrador.id, arsId);

    return {
      ...enriched,
      servicios: serviciosRows,
      devengos: { pending: true },
    };
  });
};

// ── Bulk (varios agentes × varios días) ──────────────────────
// Estrategia: 3 queries SQL fijas en vez de N×M loops
//   1) INSERT ... unnest() con ON CONFLICT → upsert todas las celdas
//   2) DELETE servicios viejos de las celdas afectadas
//   3) INSERT servicios nuevos con unnest() cruzado
// Rendimiento: ~50ms para 50 agentes × 28 días = 1400 celdas

exports.bulk = (data, user, arsUnidadId) => {
  const {
    anio,
    mes,
    borrador_id,
    agente_ids,
    dias,
    turno_id,
    actividad_ids,
    observaciones,
  } = data;

  return withRetry(
    () =>
      withTransaction(async (client) => {
        const arsId = requireArsId(arsUnidadId);
        if (!Number.isInteger(Number(borrador_id)) || Number(borrador_id) <= 0) {
          throw new Error('Debe seleccionar un borrador para la asignación masiva');
        }
        // @ts-ignore
        const borrador = await resolveBorrador(client, {
          anio,
          mes,
          borrador_id,
          user,
          autoCreate: false,
          arsUnidadId: arsId,
        });
        const periodoAnio = Number(borrador.anio);
        const periodoMes = Number(borrador.mes);

        const fechasObjetivo = dias.map((fecha) => {
          const raw = String(fecha || '').slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
          const dayNum = Number(fecha);
          return buildFecha(periodoAnio, periodoMes, dayNum);
        });

        const prevRes = await client.query(
          `SELECT ab.id, ab.agente_id, ab.fecha::text AS fecha, ab.turno_id, ab.observaciones,
              array_remove(array_agg(bs.actividad_id), NULL) AS actividad_ids
       FROM asignaciones_borrador ab
       LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
       WHERE ab.borrador_id = $1
         AND ab.agente_id = ANY($2::int[])
         AND ab.fecha = ANY($3::date[])
         AND ab.ars_unidad_id = $4
       GROUP BY ab.id`,
          [borrador.id, agente_ids, fechasObjetivo, arsId]
        );

        const prevMap = new Map();
        prevRes.rows.forEach((row) => {
          prevMap.set(
            `${Number(row.agente_id)}|${String(row.fecha).slice(0, 10)}`,
            {
              turno_id: row.turno_id,
              observaciones: row.observaciones,
              actividad_ids: row.actividad_ids || [],
            }
          );
        });

        // Construir arrays paralelos para unnest
        const fechas = []; // fecha ISO por cada combinación
        const agentes = []; // agente_id por cada combinación
        const borradorIds = []; // borrador_id repetido
        const anios = []; // anio repetido
        const meses = []; // mes repetido
        const diasArr = []; // dia fijo = 1
        const turnoIds = []; // turno_id repetido
        const obsArr = []; // observaciones repetido
        const propIds = []; // propietario_id repetido
        const arsIds = []; // ars_unidad_id repetido

        for (const agente_id of agente_ids) {
          for (const fecha of fechasObjetivo) {
            fechas.push(String(fecha).slice(0, 10));
            agentes.push(agente_id);
            borradorIds.push(borrador.id);
            anios.push(periodoAnio);
            meses.push(periodoMes);
            diasArr.push(1);
            turnoIds.push(turno_id);
            obsArr.push(observaciones || null);
            propIds.push(user.id);
            arsIds.push(arsId);
          }
        }

        // ── Query 1: Upsert masivo de celdas ──
        const { rows: upserted } = await client.query(
          `INSERT INTO asignaciones_borrador
          (borrador_id, anio, mes, dia, fecha, agente_id, turno_id,
           observaciones, propietario_id, ars_unidad_id, created_at, updated_at)
       SELECT unnest($1::int[]), unnest($2::int[]), unnest($3::int[]),
              unnest($4::int[]), unnest($5::date[]), unnest($6::int[]),
          unnest($7::int[]), unnest($8::text[]), unnest($9::int[]), unnest($10::text[]),
              now(), now()
       ON CONFLICT (borrador_id, agente_id, fecha)
       DO UPDATE SET turno_id      = EXCLUDED.turno_id,
              observaciones = EXCLUDED.observaciones,
              revision      = asignaciones_borrador.revision + 1,
              updated_at    = now()
      RETURNING id, revision`,
          [
            borradorIds,
            anios,
            meses,
            diasArr,
            fechas,
            agentes,
            turnoIds,
            obsArr,
            propIds,
            arsIds,
          ]
        );

        const upsertedIds = upserted.map((r) => r.id);

        if (upsertedIds.length && actividad_ids?.length) {
          // ── Query 2: Borrar servicios viejos de las celdas afectadas ──
          await client.query(
            `DELETE FROM asignaciones_borrador_servicios
         WHERE asignacion_borrador_id = ANY($1)`,
            [upsertedIds]
          );

          // ── Query 3: Insertar servicios nuevos (cruce celdas × actividades) ──
          await client.query(
            `INSERT INTO asignaciones_borrador_servicios
           (ars_unidad_id, asignacion_borrador_id, actividad_id)
         SELECT $2, u.id, a.aid
         FROM unnest($1::int[]) AS u(id)
         CROSS JOIN unnest($3::int[]) AS a(aid)
         ON CONFLICT (asignacion_borrador_id, actividad_id) DO NOTHING`,
            [upsertedIds, arsId, actividad_ids]
          );
        }

        const count = upsertedIds.length;

        const nextRes = await client.query(
          `SELECT ab.id, ab.agente_id, ab.fecha::text AS fecha, ab.turno_id, ab.observaciones,
              array_remove(array_agg(bs.actividad_id), NULL) AS actividad_ids
       FROM asignaciones_borrador ab
       LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
       WHERE ab.id = ANY($1::int[])
       GROUP BY ab.id`,
          [upsertedIds]
        );

        if (upsertedIds.length) await touchBorrador(client, borrador.id, arsId);

        // ── Log explícito por agente con todas las fechas en JSON ──
        const nextByAgent = new Map();
        nextRes.rows.forEach((row) => {
          const agenteId = Number(row.agente_id);
          if (!nextByAgent.has(agenteId)) nextByAgent.set(agenteId, {});
          nextByAgent.get(agenteId)[String(row.fecha).slice(0, 10)] = {
            turno_id: row.turno_id,
            observaciones: row.observaciones,
            actividad_ids: row.actividad_ids || [],
          };
        });

        const prevByAgent = new Map();
        prevRes.rows.forEach((row) => {
          const agenteId = Number(row.agente_id);
          if (!prevByAgent.has(agenteId)) prevByAgent.set(agenteId, {});
          prevByAgent.get(agenteId)[String(row.fecha).slice(0, 10)] = {
            turno_id: row.turno_id,
            observaciones: row.observaciones,
            actividad_ids: row.actividad_ids || [],
          };
        });

        // ── 1 registro por agente (todas las fechas como mapa JSONB) ──────────
        // datos_anteriores.fechas es simétrico a datos_nuevos.fechas:
        //   - fecha con datos previos  → valor anterior
        //   - fecha nueva (sin datos)  → null  (así no hay ambigüedad entre fechas)
        // Si TODAS las fechas son nuevas → datos_anteriores = null (nada que comparar).
        const affectedAgents = Array.from(
          new Set(agente_ids.map((id) => Number(id)).filter(Boolean))
        );
        for (const agenteId of affectedAgents) {
          const prevFechas = prevByAgent.get(agenteId) || {};
          const nextFechas = nextByAgent.get(agenteId) || {};
          if (!Object.keys(nextFechas).length) continue;

          const nextFechasData = {};
          const prevFechasData = {};
          let hasEdits = false;

          for (const fecha of Object.keys(nextFechas)) {
            nextFechasData[fecha] = nextFechas[fecha];
            if (prevFechas[fecha]) {
              prevFechasData[fecha] = prevFechas[fecha];
              hasEdits = true;
            } else {
              // Las fechas nuevas aparecen explícitamente como null en el mapa anterior
              // para que sea inequívoco que no existían antes.
              prevFechasData[fecha] = null;
            }
          }

          await logAccion(client, {
            ars_unidad_id: arsId,
            anio: periodoAnio,
            mes: periodoMes,
            borrador_id: borrador.id,
            accion: hasEdits
              ? 'BORRADOR_EDITAR_MASIVO'
              : 'BORRADOR_CREAR_MASIVO',
            agente_id: agenteId,
            dia: 1,
            fecha: null,
            turno_id: turno_id || null,
            observaciones: observaciones || null,
            // Solo se graba datos_anteriores si hubo al menos una edición real;
            // para altas puras (todo es nuevo) queda null.
            datos_anteriores: hasEdits ? { fechas: prevFechasData } : null,
            datos_nuevos: { fechas: nextFechasData },
            detalle: `${hasEdits ? 'Edición masiva' : 'Alta masiva'} en borrador [${borrador.nombre || ''} v${borrador.version || ''}]`,
            usuario_id: user.id,
            usuario_nombre: user.nombre || user.username,
          });
        }

        await markDevengosPendientes(client, borrador.id, arsId);

        return { count, devengos: { pending: true } };
      }),
    { maxRetries: 3, baseDelay: 100 }
  );
};
// ── Eliminar del borrador ────────────────────────────────────

exports.deleteBorrador = (data, user, arsUnidadId) => {
  const { anio, mes, borrador_id, agente_ids, dias, fechas } = data;

  return withRetry(
    () =>
      withTransaction(async (client) => {
        const arsId = requireArsId(arsUnidadId);
        // @ts-ignore
        const borrador = await resolveBorrador(client, {
          anio,
          mes,
          borrador_id,
          user,
          autoCreate: false,
          arsUnidadId: arsId,
        });
        if (!borrador) throw new Error('No hay borrador seleccionado');
        const periodoAnio = Number(borrador.anio);
        const periodoMes = Number(borrador.mes);

        const fechasObjetivo =
          Array.isArray(fechas) && fechas.length
            ? [...new Set(fechas.map((f) => String(f).slice(0, 10)))]
            : null;

        const usaFechas = !!fechasObjetivo?.length;

        const prevRes = usaFechas
          ? await client.query(
              `SELECT ab.id, ab.borrador_id, ab.anio, ab.mes, ab.dia,
                ab.fecha::text AS fecha, ab.agente_id, ab.turno_id,
                ab.observaciones, ab.propietario_id, ab.created_at, ab.updated_at,
                array_agg(bs.actividad_id) AS prev_actividades
         FROM asignaciones_borrador ab
         LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
         WHERE ab.borrador_id = $1
           AND ab.agente_id = ANY($2::int[])
           AND ab.fecha = ANY($3::date[])
           AND ab.ars_unidad_id = $4
         GROUP BY ab.id`,
              [borrador.id, agente_ids, fechasObjetivo, arsId]
            )
          : await client.query(
              `SELECT ab.id, ab.borrador_id, ab.anio, ab.mes, ab.dia,
                ab.fecha::text AS fecha, ab.agente_id, ab.turno_id,
                ab.observaciones, ab.propietario_id, ab.created_at, ab.updated_at,
                array_agg(bs.actividad_id) AS prev_actividades
         FROM asignaciones_borrador ab
         LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
         WHERE ab.borrador_id = $1
           AND ab.agente_id = ANY($2::int[])
           AND ab.anio = $3
           AND ab.mes = $4
           AND ab.dia = ANY($5::int[])
           AND ab.ars_unidad_id = $6
         GROUP BY ab.id`,
              [borrador.id, agente_ids, periodoAnio, periodoMes, dias, arsId]
            );

        const result = usaFechas
          ? await client.query(
              `DELETE FROM asignaciones_borrador
         WHERE borrador_id = $1
           AND agente_id = ANY($2::int[])
           AND fecha = ANY($3::date[])
           AND ars_unidad_id = $4
         RETURNING id`,
              [borrador.id, agente_ids, fechasObjetivo, arsId]
            )
          : await client.query(
              `DELETE FROM asignaciones_borrador
         WHERE borrador_id = $1
           AND agente_id = ANY($2::int[])
           AND anio = $3
           AND mes = $4
           AND dia = ANY($5::int[])
           AND ars_unidad_id = $6
         RETURNING id`,
              [borrador.id, agente_ids, periodoAnio, periodoMes, dias, arsId]
            );

        // @ts-ignore
        await logAccion(client, {
          ars_unidad_id: arsId,
          anio: periodoAnio,
          mes: periodoMes,
          borrador_id: borrador.id,
          accion: 'BORRADOR_ELIMINAR',
          datos_anteriores: {
            eliminados: prevRes.rows.map((r) => ({
              agente_id: r.agente_id,
              fecha: String(r.fecha).slice(0, 10),
              turno_id: r.turno_id,
              observaciones: r.observaciones,
              actividad_ids: r.prev_actividades || [],
            })),
          },
          detalle: `Eliminados ${result.rowCount} registros del borrador ${borrador.nombre} v${borrador.version}`,
          usuario_id: user.id,
          usuario_nombre: user.nombre || user.username,
        });

        if (result.rowCount > 0) {
          await touchBorrador(client, borrador.id, arsId);
          await markDevengosPendientes(client, borrador.id, arsId);
        }
        return { deleted: result.rowCount };
      }),
    { maxRetries: 3, baseDelay: 100 }
  );
};

// ── Nomenclatura de borrador (misma lógica que el frontend) ─
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

function generarNombreBorrador(anio, mes, arsUnidadId) {
  const ahora = new Date();
  const mesLit = MONTHS_ES[Number(mes) - 1] || String(mes);
  const fecha =
    String(ahora.getDate()).padStart(2, '0') +
    '_' +
    String(ahora.getMonth() + 1).padStart(2, '0') +
    '_' +
    ahora.getFullYear();
  const hora =
    String(ahora.getHours()).padStart(2, '0') +
    '_' +
    String(ahora.getMinutes()).padStart(2, '0');
  return ensureBorradorNameWithArs(
    `${anio}_${mesLit}_${fecha}_${hora}`,
    arsUnidadId
  );
}

// ── Copiar mes ───────────────────────────────────────────────

exports.copiarMes = (data, user, arsUnidadId) => {
  const {
    origen_anio,
    origen_mes,
    origen_borrador_id,
    destino_anio,
    destino_mes,
    destino_borrador_id,
    agente_ids,
    pares,
  } = data;

  return withRetry(
    () =>
      withTransaction(async (client) => {
        const arsId = requireArsId(arsUnidadId);
        // Si se indica un borrador destino explícito → usarlo (con permisos)
        // Si no → siempre crear uno NUEVO con max(version)+1 del periodo destino
        let destinoBorrador;
        if (destino_borrador_id) {
          // @ts-ignore
          destinoBorrador = await resolveBorrador(client, {
            anio: destino_anio,
            mes: destino_mes,
            borrador_id: destino_borrador_id,
            user,
            autoCreate: false,
            arsUnidadId: arsId,
          });
          if (!destinoBorrador)
            throw new Error('El borrador destino seleccionado no existe');
        } else {
          await lockBorradorPeriodo(client, {
            anio: destino_anio,
            mes: destino_mes,
            arsUnidadId: arsId,
          });
          await assertNoCanonicoBorradorEnPeriodo(client, {
            anio: destino_anio,
            mes: destino_mes,
            arsUnidadId: arsId,
          });
          const {
            rows: [{ next_version }],
          } = await client.query(
            `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM asignaciones_borradores
         WHERE anio = $1 AND mes = $2 AND ars_unidad_id = $3`,
            [destino_anio, destino_mes, arsId]
          );
          const destinoNombre = generarNombreBorrador(
            destino_anio,
            destino_mes,
            arsId
          );
          const {
            rows: [borrador],
          } = await client.query(
            `INSERT INTO asignaciones_borradores
           (ars_unidad_id, anio, mes, nombre, version, estado, observaciones, propietario_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'borrador',NULL,$6, now(), now())
         RETURNING *`,
            [
              arsId,
              destino_anio,
              destino_mes,
              destinoNombre,
              Number(next_version || 1),
              user.id,
            ]
          );
          destinoBorrador = borrador;
        }

        const periodoDestinoAnio = Number(destinoBorrador.anio);
        const periodoDestinoMes = Number(destinoBorrador.mes);

        const maxDia = new Date(
          periodoDestinoAnio,
          periodoDestinoMes,
          0
        ).getDate();

        // Construir mapa origen_fecha → destino_fecha a partir de los pares posicionales
        const pareMap = {};
        const originFechas = [];
        (pares || []).forEach((p) => {
          pareMap[String(p.from)] = String(p.to);
          originFechas.push(String(p.from));
        });

        const filas = await obtenerFilasOrigen(client, {
          origen_anio,
          origen_mes,
          origen_borrador_id,
          agente_ids,
          fechas: originFechas,
          user,
          arsUnidadId: arsId,
        });

        // Guardrail final: nunca copiar agentes en baja aunque lleguen en origen.
        const agenteIdsOrigen = Array.from(
          new Set(
            (filas || [])
              .map((f) => Number(f.agente_id))
              .filter((id) => Number.isInteger(id) && id > 0)
          )
        );
        let agentesActivosSet = new Set();
        if (agenteIdsOrigen.length) {
          const activosRes = await client.query(
            `SELECT id
               FROM agentes
              WHERE id = ANY($1::int[])
                AND ars_unidad_id = $2
                AND fecha_baja IS NULL`,
            [agenteIdsOrigen, arsId]
          );
          agentesActivosSet = new Set(
            (activosRes.rows || []).map((r) => Number(r.id))
          );
        }
        console.log('[copiarMes] originFechas:', originFechas);
        console.log(
          '[copiarMes] filas encontradas:',
          filas.length,
          filas
            .slice(0, 2)
            .map((f) => ({ fecha: f.fecha, agente_id: f.agente_id }))
        );

        // ── Construir arrays paralelos para upsert bulk con unnest ──
        const bBorradorIds = [];
        const bAnios = [];
        const bMeses = [];
        const bDias = [];
        const bFechas = [];
        const bAgenteIds = [];
        const bTurnoIds = [];
        const bObsArr = [];
        const bPropIds = [];
        const bArsIds = [];
        const actividadesPorFila = []; // actividad_ids por cada fila válida

        for (const fila of filas) {
          if (!agentesActivosSet.has(Number(fila.agente_id))) continue;
          const destFecha = pareMap[String(fila.fecha)];
          if (!destFecha) continue;
          const diaReal = parseInt(destFecha.slice(8, 10), 10);
          if (!diaReal || diaReal > maxDia) continue;

          bBorradorIds.push(destinoBorrador.id);
          bAnios.push(periodoDestinoAnio);
          bMeses.push(periodoDestinoMes);
          bDias.push(1);
          bFechas.push(destFecha);
          bAgenteIds.push(fila.agente_id);
          bTurnoIds.push(fila.turno_id);
          bObsArr.push(fila.observaciones || null);
          bPropIds.push(user.id);
          bArsIds.push(arsId);
          actividadesPorFila.push(fila.actividad_ids || []);
        }

        let count = bFechas.length;
        let upsertedIds = [];

        if (count > 0) {
          // ── Query 1: Upsert masivo de celdas ──
          const { rows: upserted } = await client.query(
            `WITH payload AS (

            SELECT *
            FROM unnest(
                $1::int[],
                $2::int[],
                $3::int[],
                $4::int[],
                $5::date[],
                $6::int[],
                $7::int[],
                $8::text[],
                $9::int[],
                $10::text[]
            ) WITH ORDINALITY AS p(
                borrador_id,
                anio,
                mes,
                dia,
                fecha,
                agente_id,
                turno_id,
                observaciones,
                propietario_id,
                ars_unidad_id,
                ord
            )
        
        ),
        
        upsert AS (
        
            INSERT INTO asignaciones_borrador (
        
                borrador_id,
                anio,
                mes,
                dia,
                fecha,
                agente_id,
                turno_id,
                observaciones,
                propietario_id,
                ars_unidad_id,
                revision,
                created_at,
                updated_at
        
            )
        
            SELECT
        
                p.borrador_id,
                p.anio,
                p.mes,
                p.dia,
                p.fecha,
                p.agente_id,
                p.turno_id,
                p.observaciones,
                p.propietario_id,
                p.ars_unidad_id,
        
                0 AS revision,
                now() AS created_at,
                now() AS updated_at
        
            FROM payload p
        
            ON CONFLICT (
                borrador_id,
                agente_id,
                fecha,
                ars_unidad_id
            )
        
            DO UPDATE
            SET
                turno_id = EXCLUDED.turno_id,
        
                observaciones = EXCLUDED.observaciones,
        
                revision = asignaciones_borrador.revision + 1,
        
                updated_at = now()
        
            WHERE
                asignaciones_borrador.turno_id
                    IS DISTINCT FROM EXCLUDED.turno_id
        
                OR
        
                asignaciones_borrador.observaciones
                    IS DISTINCT FROM EXCLUDED.observaciones
        
            RETURNING
                id,
                borrador_id,
                agente_id,
                fecha,
                ars_unidad_id
        
        )
        
        SELECT
            u.id
        
        FROM payload p
        
        JOIN upsert u
            ON u.borrador_id   = p.borrador_id
           AND u.agente_id     = p.agente_id
           AND u.fecha         = p.fecha
           AND u.ars_unidad_id = p.ars_unidad_id
        
        ORDER BY p.ord;`,
            [
              bBorradorIds,
              bAnios,
              bMeses,
              bDias,
              bFechas,
              bAgenteIds,
              bTurnoIds,
              bObsArr,
              bPropIds,
              bArsIds,
            ]
          );
          upsertedIds = upserted.map((r) => r.id);

          // ── Query 2: Borrar servicios anteriores de las celdas afectadas ──
          const idsConActividades = [];
          const todasActividades = [];
          upsertedIds.forEach((rowId, idx) => {
            const acts = actividadesPorFila[idx];
            if (acts && acts.length) {
              for (const actId of acts) {
                idsConActividades.push(rowId);
                todasActividades.push(actId);
              }
            }
          });

          if (idsConActividades.length > 0) {
            const idsUnicos = [...new Set(idsConActividades)];
            await client.query(
              `DELETE FROM asignaciones_borrador_servicios
           WHERE asignacion_borrador_id = ANY($1::int[]) AND ars_unidad_id = $2::varchar`,
              [idsUnicos, arsId]
            );

            // ── Query 3: Insertar servicios nuevos en bulk ──
            await client.query(
              `INSERT INTO asignaciones_borrador_servicios (ars_unidad_id, asignacion_borrador_id, actividad_id)
           SELECT $1::varchar, unnest($2::int[]), unnest($3::int[])
           EXCEPT
           SELECT ars_unidad_id, asignacion_borrador_id, actividad_id
           FROM asignaciones_borrador_servicios
           WHERE ars_unidad_id = $1::varchar`,
              [arsId, idsConActividades, todasActividades]
            );
          }
        }

        if (count > 0) {
          await touchBorrador(client, destinoBorrador.id, arsId);
          await markDevengosPendientes(client, destinoBorrador.id, arsId);
        }

        // @ts-ignore
        await logAccion(client, {
          ars_unidad_id: arsId,
          anio: periodoDestinoAnio,
          mes: periodoDestinoMes,
          borrador_id: destinoBorrador.id,
          accion: 'BORRADOR_COPIAR_MES',
          datos_nuevos: {
            origen_anio,
            origen_mes,
            destino_anio: periodoDestinoAnio,
            destino_mes: periodoDestinoMes,
            agente_ids,
            pares,
          },
          detalle: `Copiadas ${count} asignaciones a ${destinoBorrador.nombre} v${destinoBorrador.version} desde ${origen_anio}/${origen_mes}`,
          usuario_id: user.id,
          usuario_nombre: user.nombre || user.username,
        });

        return { count, destino_borrador_id: destinoBorrador.id };
      }),
    { maxRetries: 3, baseDelay: 100 }
  );
};

// ── Devengos automáticos desde borrador ─────────────────────

/**
 * Recalcula los movimientos de devengo/disfrute para un borrador completo.
 * Borra todos los movimientos origen='borrador' previos del borrador y
 * reinserta uno por cada (agente, fecha, actividad) que tenga regla aplicable.
 * Debe llamarse dentro de una transacción existente (recibe `client`).
 * Actualiza también los saldos mensuales para mantener consistencia.
 */
async function procesarDevengosParaBorrador(
  client,
  borradorId,
  arsId,
  userId,
  options = {}
) {
  // El período contable del movimiento debe ser siempre el del borrador.
  const {
    rows: [borrador],
  } = await client.query(
    `SELECT anio, mes
       FROM asignaciones_borradores
      WHERE id = $1
        AND ars_unidad_id::text = $2::text`,
    [borradorId, arsId]
  );
  if (!borrador) {
    throw new Error('Borrador no encontrado para calcular devengos');
  }

  const motor = require('./reglas-motor.service');
  return motor.procesarBorradorCompleto(
    client,
    borradorId,
    arsId,
    userId,
    Number(borrador.anio),
    Number(borrador.mes),
    options
  );
}



/**
 * Consolida devengos para un borrador ya bloqueado (FOR UPDATE) dentro de una
 * transacción existente. Este helper centraliza el flujo para hacerlo
 * reutilizable desde distintos disparadores (manual, worker, ledger, etc.).
 */
async function consolidarDevengosBorradorConClient(
  client,
  { borrador, arsId, userId, accion, detalle, usuarioNombre }
) {
  const insertados = await procesarDevengosParaBorrador(
    client,
    borrador.id,
    arsId,
    userId
  );

  await markDevengosConsolidados(client, borrador.id, arsId);
  // @ts-ignore
  await logAccion(client, {
    ars_unidad_id: arsId,
    anio: Number(borrador.anio),
    mes: Number(borrador.mes),
    borrador_id: borrador.id,
    accion,
    datos_nuevos: { insertados },
    detalle,
    usuario_id: userId || null,
    usuario_nombre: usuarioNombre || null,
  });

  return { ok: true, borrador_id: borrador.id, insertados };
}

/**
 * API reutilizable para consolidar devengos de un borrador concreto.
 * Pensada para reutilizarla desde controladores actuales y futuros (p.ej. ledger).
 */
exports.consolidarDevengosBorrador = ({ borradorId, arsUnidadId, user }) => {
  return withRetry(
    () =>
      withTransaction(async (client) => {
        const arsId = requireArsId(arsUnidadId);
        const {
          rows: [borrador],
        } = await client.query(
          `SELECT * FROM asignaciones_borradores WHERE id = $1 AND ars_unidad_id = $2 FOR UPDATE`,
          [Number(borradorId), arsId]
        );
        if (!borrador) throw new Error('El borrador seleccionado no existe');

        return consolidarDevengosBorradorConClient(client, {
          borrador,
          arsId,
          userId: user?.id || null,
          accion: 'DEVENGOS_CONSOLIDAR',
          detalle: `Devengos consolidados manualmente para ${borrador.nombre} v${borrador.version}`,
          usuarioNombre: user?.nombre || user?.username || 'sistema',
        });
      }),
    { maxRetries: 3, baseDelay: 100 }
  );
};

exports.consolidarDevengos = (data, user, arsUnidadId) => {
  const { borrador_id } = data;
  return exports.consolidarDevengosBorrador({
    borradorId: borrador_id,
    arsUnidadId: arsUnidadId,
    user,
  });
};

function consolidarDevengosPendientesUnaVez(arsUnidadId = null) {
  const arsIdFiltro = arsUnidadId ? requireArsId(arsUnidadId) : null;
  return withRetry(
    () =>
      withTransaction(async (client) => {
        const whereArs = arsIdFiltro
          ? ' AND ars_unidad_id::text = $1::text'
          : ' AND 1=1';
        const params = arsIdFiltro ? [arsIdFiltro] : [];
        const {
          rows: [borrador],
        } = await client.query(
          `SELECT *
            FROM asignaciones_borradores
            WHERE devengos_pendientes = true
            ${whereArs}
            ORDER BY updated_at ASC NULLS LAST, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1`,
          params
        );

        if (!borrador) {
          return {
            ok: true,
            has_pending: false,
            message:
              'No hay borradores con devengos pendientes para consolidar',
          };
        }

        const arsId = requireArsId(borrador.ars_unidad_id);
        const result = await consolidarDevengosBorradorConClient(client, {
          borrador,
          arsId,
          userId: -1,
          accion: 'DEVENGOS_AUTO_CONSOLIDAR',
          detalle: `Devengos consolidados automáticamente para ${borrador.nombre} v${borrador.version}`,
          usuarioNombre: 'devengos-worker',
        });

        return {
          ok: true,
          has_pending: true,
          borrador_id: result.borrador_id,
          ars_unidad_id: arsId,
          insertados: result.insertados,
        };
      }),
    { maxRetries: 3, baseDelay: 100 }
  );
}

exports.consolidarDevengosPendientes = (arsUnidadId) =>
  consolidarDevengosPendientesUnaVez(requireArsId(arsUnidadId));

exports.consolidarDevengosPendientesGlobal = () =>
  consolidarDevengosPendientesUnaVez(null);

exports.consolidarDevengosPendientesMasivo = async (arsUnidadId) => {
  const arsId = requireArsId(arsUnidadId);
  const procesados = [];
  let totalInsertados = 0;
  let hasPending = true;

  while (hasPending) {
    const result = await exports.consolidarDevengosPendientes(arsId);
    hasPending = !!result && result.has_pending !== false;
    if (!hasPending) break;
    procesados.push(result);
    totalInsertados += Number(result.insertados || 0);
  }

  return {
    total_borradores: procesados.length,
    total_insertados: totalInsertados,
    resultados: procesados,
  };
};

exports.getDevengosPendientesResumen = async (arsUnidadId) => {
  const arsId = requireArsId(arsUnidadId);
  const {
    rows: [row],
  } = await db.query(
    `SELECT COUNT(*)::int AS total_borradores_pendientes
       FROM asignaciones_borradores
      WHERE ars_unidad_id::text = $1::text
        AND devengos_pendientes = true`,
    [arsId]
  );
  return {
    total_borradores_pendientes: Number(row?.total_borradores_pendientes || 0),
  };
};

async function resolveCuadranteVigenteParaPeriodo(client, { arsId, anio, mes }) {
  const {
    rows: [cuadrante],
  } = await client.query(
    `SELECT id,
            nombre,
            fecha_inicio::text AS fecha_inicio,
            fecha_fin::text AS fecha_fin,
            anio_referencia,
            mes_referencia,
            estado,
            updated_at
       FROM cuadrantes_planificacion
      WHERE ars_unidad_id = $1
        AND anio_referencia = $2
        AND mes_referencia = $3
        AND estado <> 'archivado'
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [arsId, anio, mes]
  );

  if (!cuadrante) {
    throw new Error(
      'No existe cuadrante_planificacion activo para el periodo del borrador seleccionado'
    );
  }

  return cuadrante;
}

async function listReglasEspecialesCandidatasConClient(
  client,
  { arsId, fechaInicio, fechaFin }
) {
  const { rows } = await client.query(
    `SELECT r.id,
            r.ars_unidad_id,
            r.actividad_id,
            a.actividad AS actividad_codigo,
            a.nombre AS actividad_nombre,
            r.grupo_id,
            ga.nombre AS grupo_nombre,
            r.empleo_id::text AS empleo_id,
            e.descripcion AS empleo_nombre,
            r.tipo_movimiento,
            r.unidad,
            r.valor,
            r.tipo_dia,
            r.condicion_dias,
            r.condicion_tipo,
            r.condicion_alcance,
            r.excluir_festivos,
            r.vigencia_desde::text AS vigencia_desde,
            r.vigencia_hasta::text AS vigencia_hasta,
            r.prioridad,
            r.activo,
            r.categoria_regla,
            r.descripcion
       FROM asignaciones_reglas r
  LEFT JOIN actividades a ON a.id_actividad = r.actividad_id
  LEFT JOIN grupos_actividad ga ON ga.id_grupo = r.grupo_id
  LEFT JOIN agentes_empleo e ON e.id_empleo::text = r.empleo_id::text
      WHERE r.ars_unidad_id::text = $1::text
        AND r.activo = true
        AND r.categoria_regla = 'Regla_Especial'
        AND r.vigencia_desde <= $2::date
        AND (r.vigencia_hasta IS NULL OR r.vigencia_hasta >= $3::date)
      ORDER BY r.prioridad ASC, r.id DESC`,
    [arsId, fechaFin, fechaInicio]
  );
  return rows;
}

exports.previewReglasEspecialesValidacion = (data, _user, arsUnidadId) => {
  const anio = Number(data.anio);
  const mes = Number(data.mes);

  return withRetry(() =>
    withTransaction(async (client) => {
      const arsId = requireArsId(arsUnidadId);

      const cuadrante = await resolveCuadranteVigenteParaPeriodo(client, {
        arsId,
        anio,
        mes,
      });

      const reglas = await listReglasEspecialesCandidatasConClient(client, {
        arsId,
        fechaInicio: cuadrante.fecha_inicio,
        fechaFin: cuadrante.fecha_fin,
      });

      return {
        cuadrante: {
          id: cuadrante.id,
          nombre: cuadrante.nombre,
          fecha_inicio: cuadrante.fecha_inicio,
          fecha_fin: cuadrante.fecha_fin,
          anio: Number(cuadrante.anio_referencia),
          mes: Number(cuadrante.mes_referencia),
          estado: cuadrante.estado,
        },
        reglas_candidatas: reglas,
      };
    })
  );
};

// ── Validar borrador (pasar a definitivo) ────────────────────

exports.validar = (data, user, arsUnidadId) => {
  const { borrador_id } = data;

  return withRetry(
    () =>
      withTransaction(async (client) => {
        const arsId = requireArsId(arsUnidadId);
        // ★ Lock the borrador row to prevent concurrent validation
        const {
          rows: [borrador],
        } = await client.query(
          `SELECT * FROM asignaciones_borradores WHERE id = $1 AND ars_unidad_id = $2 FOR UPDATE`,
          [Number(borrador_id), arsId]
        );
        if (!borrador) throw new Error('El borrador seleccionado no existe');
        if (borrador.estado === 'archivado')
          throw new Error('Este borrador está archivado y no se puede validar');

        const anio = Number(borrador.anio);
        const mes = Number(borrador.mes);
        const cuadrante = await resolveCuadranteVigenteParaPeriodo(client, {
          arsId,
          anio,
          mes,
        });
        const reglasEspecialesCandidatas =
          await listReglasEspecialesCandidatasConClient(client, {
            arsId,
            fechaInicio: cuadrante.fecha_inicio,
            fechaFin: cuadrante.fecha_fin,
          });
        const reglasEspecialesIds = Array.isArray(data.reglas_especiales_ids)
          ? Array.from(
              new Set(
                data.reglas_especiales_ids
                  .map((value) => Number(value))
                  .filter((value) => Number.isInteger(value) && value > 0)
              )
            )
          : [];
        const reglasEspecialesSeleccionadas = reglasEspecialesIds.length
          ? reglasEspecialesCandidatas.filter((regla) =>
              reglasEspecialesIds.includes(Number(regla.id))
            )
          : [];
        if (
          reglasEspecialesIds.length &&
          reglasEspecialesSeleccionadas.length !== reglasEspecialesIds.length
        ) {
          throw new Error(
            'Alguna de las reglas especiales seleccionadas no es válida para el cuadrante vigente'
          );
        }

        const {
          rows: [{ total }],
        } = await client.query(
          'SELECT COUNT(*)::int AS total FROM asignaciones_borrador WHERE borrador_id=$1',
          [borrador.id]
        );
        if (total === 0)
          throw new Error('No hay asignaciones en borrador para este período');

        const {
          rows: [{ total: prevTotal }],
        } = await client.query(
          'SELECT COUNT(*)::int AS total FROM asignaciones WHERE anio=$1 AND mes=$2 AND ars_unidad_id = $3',
          [anio, mes, arsId]
        );
        const hadPrevious = prevTotal > 0;

        // ★ Archive all OTHER borradores for this period
        await client.query(
          `UPDATE asignaciones_borradores
       SET estado = 'archivado', updated_at = now()
       WHERE anio = $1 AND mes = $2 AND id <> $3
         AND ars_unidad_id = $4
         AND estado NOT IN ('archivado')`,
          [anio, mes, borrador.id, arsId]
        );

        // ── Upsert: insertar o actualizar asignaciones desde el borrador ──
        const { rows: upserted, rowCount } = await client.query(
          `INSERT INTO asignaciones
          (ars_unidad_id, anio, mes, dia, fecha, agente_id, turno_id, observaciones,
           propietario_id, validado_por, validado_at, created_at)
      SELECT $1::varchar, anio, mes, 1, fecha, agente_id, turno_id, observaciones,
        propietario_id, $2::int, now(), now()
       FROM asignaciones_borrador
      WHERE borrador_id = $3::int
        AND dia = 1
        AND ars_unidad_id = $4::varchar
      ON CONFLICT (ars_unidad_id, agente_id, fecha)
       DO UPDATE SET turno_id      = EXCLUDED.turno_id,
                     observaciones = EXCLUDED.observaciones,
                     validado_por  = EXCLUDED.validado_por,
                     validado_at   = now()
       RETURNING id, agente_id, fecha`,
          [arsId, user.id, borrador.id, arsId]
        );

        // ── Purge: eliminar asignaciones que ya no existen en el borrador ──
        await client.query(
          `DELETE FROM asignaciones a
       WHERE a.anio = $1 AND a.mes = $2 AND a.ars_unidad_id = $3
         AND NOT EXISTS (
           SELECT 1 FROM asignaciones_borrador ab
           WHERE ab.borrador_id = $4
             AND ab.agente_id   = a.agente_id
             AND ab.fecha       = a.fecha
             AND ab.ars_unidad_id = $3
         )`,
          [anio, mes, arsId, borrador.id]
        );

        // ── Sync servicios de las filas upserted ──
        const inserted = upserted;
        if (inserted.length) {
          const upsertedIds = inserted.map((r) => r.id);

          // Borrar servicios anteriores de las filas afectadas
          await client.query(
            `DELETE FROM asignaciones_servicios
         WHERE asignacion_id = ANY($1::int[]) AND ars_unidad_id = $2`,
            [upsertedIds, arsId]
          );

          // Insertar servicios nuevos desde el borrador
          await client.query(
            `INSERT INTO asignaciones_servicios (ars_unidad_id, asignacion_id, actividad_id)
         SELECT $2, def.id, bs.actividad_id
         FROM asignaciones def
         JOIN asignaciones_borrador ab
           ON ab.borrador_id = $1
          AND ab.dia         = 1
          AND ab.ars_unidad_id = $2
          AND ab.agente_id   = def.agente_id
          AND ab.fecha       = def.fecha
         JOIN asignaciones_borrador_servicios bs
           ON bs.asignacion_borrador_id = ab.id
         WHERE def.id = ANY($3::int[])
         ON CONFLICT (ars_unidad_id, asignacion_id, actividad_id) DO NOTHING`,
            [borrador.id, arsId, upsertedIds]
          );
        }

        // ★ Mark as validated + increment revision
        await client.query(
          `UPDATE asignaciones_borradores
       SET estado = 'validado', validado_por = $2, validado_at = now(),
           revision = revision + 1, updated_at = now()
       WHERE id = $1 AND ars_unidad_id = $3`,
          [borrador.id, user.id, arsId]
        );

        // ── Confirmar movimientos de devengo: borrador → validacion ──
        // Regla de negocio: solo por reglas especiales seleccionadas en el modal.
        // En validación de copia no se calcula ni confirma nada en ledger.
        const reglasEspecialesSeleccionadasIds = reglasEspecialesSeleccionadas.map(
          (regla) => Number(regla.id)
        );
        if (reglasEspecialesSeleccionadasIds.length > 0) {
          await procesarDevengosParaBorrador(client, borrador.id, arsId, user.id, {
            reglaIdsIncluir: reglasEspecialesSeleccionadasIds,
          });
          await client.query(
            `INSERT INTO asignaciones_ledger_movimientos
                (ars_unidad_id, agente_id, empleo_id, actividad_id, regla_id,
                 borrador_id, anio, mes, fecha, origen, tipo_movimiento,
                 signo, cantidad_dias, saldo_antes, saldo_despues,
                 source_kind, source_key, metadata, usuario_id)
             SELECT m.ars_unidad_id,
                    m.agente_id,
                    m.empleo_id,
                    m.actividad_id,
                    m.regla_id,
                    m.borrador_id,
                    m.anio,
                    m.mes,
                    m.fecha,
                    'validacion' AS origen,
                    m.tipo_movimiento,
                    m.signo,
                    m.cantidad_dias,
                    m.saldo_antes,
                    m.saldo_despues,
                    m.source_kind,
                    CONCAT(COALESCE(m.source_key, 'sin_source'), ':validacion:', EXTRACT(EPOCH FROM now())::bigint::text, ':', m.id::text) AS source_key,
                    m.metadata,
                    $3
               FROM asignaciones_ledger_movimientos m
              WHERE m.ars_unidad_id::text = $1::text
                AND m.borrador_id = $2
                AND m.origen = 'borrador'
                AND m.regla_id = ANY($4::int[])`,
            [arsId, borrador.id, user.id, reglasEspecialesSeleccionadasIds]
          );
        }

        // @ts-ignore
        await logAccion(client, {
          ars_unidad_id: arsId,
          anio,
          mes,
          borrador_id: borrador.id,
          accion: hadPrevious ? 'REVALIDAR' : 'VALIDAR',
          datos_nuevos: {
            total_asignaciones: rowCount,
            cuadrante_id: cuadrante.id,
            reglas_especiales_ids: reglasEspecialesSeleccionadas.map((regla) =>
              Number(regla.id)
            ),
          },
          detalle: hadPrevious
            ? `Revalidación con ${borrador.nombre} v${borrador.version}: reemplazadas asignaciones anteriores. ${rowCount} asignaciones validadas.`
            : `Validación inicial con ${borrador.nombre} v${borrador.version}: ${rowCount} asignaciones validadas.`,
          usuario_id: user.id,
          usuario_nombre: user.nombre || user.username,
        });

        return {
          validated: rowCount,
          cuadrante_id: Number(cuadrante.id),
          reglas_especiales_aplicadas: reglasEspecialesSeleccionadas.map(
            (regla) => ({
              id: Number(regla.id),
              descripcion: regla.descripcion || null,
              categoria_regla: regla.categoria_regla,
              prioridad: Number(regla.prioridad || 0),
            })
          ),
        };
      }),
    { maxRetries: 3, baseDelay: 100 }
  );
};

// ── Historial ────────────────────────────────────────────────

function normalizeHistorialDayKey(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}

function extractHistorialDays(entry) {
  const days = new Set();
  const add = (v) => {
    const d = normalizeHistorialDayKey(v);
    if (d) days.add(d);
  };

  add(entry.fecha);

  const before = entry && entry.datos_anteriores;
  const after = entry && entry.datos_nuevos;

  if (before && typeof before === 'object' && before.fechas && typeof before.fechas === 'object') {
    Object.keys(before.fechas).forEach(add);
  }
  if (after && typeof after === 'object' && after.fechas && typeof after.fechas === 'object') {
    Object.keys(after.fechas).forEach(add);
  }

  return Array.from(days);
}

function pickHistorialDayData(datos, dayKey, fallbackFecha) {
  if (!datos || typeof datos !== 'object') return null;

  if (datos.fechas && typeof datos.fechas === 'object') {
    if (!(dayKey in datos.fechas)) return null;
    return datos.fechas[dayKey] || null;
  }

  const ownDay = normalizeHistorialDayKey(datos.fecha || fallbackFecha);
  if (ownDay !== dayKey) return null;
  return {
    turno_id: datos.turno_id,
    observaciones: datos.observaciones,
    actividad_ids: datos.actividad_ids,
  };
}

function explodeHistorialByAgentDay(logs) {
  const exploded = [];

  (logs || []).forEach((entry) => {
    const days = extractHistorialDays(entry);

    if (!days.length) {
      exploded.push({
        ...entry,
        fecha: null,
        historial_day_key: '__SIN_FECHA_MASIVO__',
      });
      return;
    }

    days.forEach((dayKey) => {
      exploded.push({
        ...entry,
        fecha: dayKey,
        historial_day_key: dayKey,
        datos_anteriores: pickHistorialDayData(
          entry.datos_anteriores,
          dayKey,
          entry.fecha
        ),
        datos_nuevos: pickHistorialDayData(entry.datos_nuevos, dayKey, entry.fecha),
      });
    });
  });

  return exploded;
}

function keepLatestPerAgentDay(logs) {
  const byKey = new Map();

  (logs || []).forEach((entry) => {
    const dayKey = entry.historial_day_key || '__SIN_FECHA_MASIVO__';
    const key = `${entry.agente_id || ''}|${dayKey}`;
    const prev = byKey.get(key);

    if (!prev) {
      byKey.set(key, entry);
      return;
    }

    const tPrev = new Date(prev.created_at || 0).getTime();
    const tCurr = new Date(entry.created_at || 0).getTime();

    if (tCurr > tPrev || (tCurr === tPrev && Number(entry.id || 0) > Number(prev.id || 0))) {
      byKey.set(key, entry);
    }
  });

  return Array.from(byKey.values());
}

exports.getHistorial = async (query, arsUnidadId) => {
  const arsId = requireArsId(arsUnidadId);
  const {
    anio,
    mes,
    borrador_id,
    agente_id,
    agente_ids,
    accion,
    acciones,
    usuario_id,
    fecha_cambio,
    fechas_cambio,
    fechas_cuadrante,
    repetir_comunicados,
    page,
    limit,
  } = query;
  const offset = (page - 1) * limit;
  const agenteIds = parseNumericCsv(agente_ids);
  if (!agenteIds.length && agente_id) agenteIds.push(Number(agente_id));

  // Admite filtro multi-acción (acciones=CSV) y también el antiguo accion=string
  const accionList = (() => {
    if (acciones)
      return String(acciones)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (accion) return [String(accion).trim()];
    return [];
  })();
  const accionListExpanded = (() => {
    if (!accionList.length) return [];
    const set = new Set(accionList);
    // Compatibilidad: los cambios masivos resumen se guardan como BORRADOR_BULK
    if (set.has('BORRADOR_CREAR_MASIVO') || set.has('BORRADOR_EDITAR_MASIVO')) {
      set.add('BORRADOR_BULK');
    }
    return Array.from(set);
  })();

  const fechaCambioList = (() => {
    if (!fechas_cambio) return [];
    return Array.from(
      new Set(
        String(fechas_cambio)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
      )
    );
  })();

  const fechasCuadranteList = (() => {
    if (!fechas_cuadrante) return [];
    return Array.from(
      new Set(
        String(fechas_cuadrante)
          .split(',')
          .map((s) => s.trim())
          .filter(
            (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) || s === '__SIN_FECHA_MASIVO__'
          )
      )
    );
  })();

  let where = 'WHERE l.anio = $1 AND l.mes = $2 AND l.ars_unidad_id = $3';
  const params = [anio, mes, arsId];

  if (repetir_comunicados) {
    where += ' AND l.comunicado_at IS NOT NULL';
  } else {
    where += ' AND l.comunicado_at IS NULL';
  }

  if (borrador_id) {
    params.push(Number(borrador_id));
    where += ` AND l.borrador_id = $${params.length}`;
  }
  if (agenteIds.length) {
    params.push(agenteIds);
    where += ` AND (l.agente_id = ANY($${params.length}) OR l.agente_id IS NULL)`;
  }
  if (accionListExpanded.length) {
    params.push(accionListExpanded);
    where += ` AND l.accion = ANY($${params.length})`;
  }
  if (usuario_id) {
    params.push(Number(usuario_id));
    where += ` AND l.usuario_id = $${params.length}`;
  }
  if (fechaCambioList.length) {
    params.push(fechaCambioList);
    where += ` AND l.created_at::date = ANY($${params.length}::date[])`;
  } else if (fecha_cambio) {
    params.push(String(fecha_cambio));
    where += ` AND l.created_at::date = $${params.length}::date`;
  }
  const { rows: rawLogs } = await db.query(
    `SELECT l.*,
            l.fecha::text        AS fecha,
            ag.tip               AS agente_tip,
            ag.telefono          AS agente_telefono,
            ag.nombre            AS agente_nombre,
            ag.apellido_1        AS agente_apellido1,
            ag.apellido_2        AS agente_apellido2,
            e.descripcion        AS empleo_nombre,
            uc.nombre AS comunicado_nombre
     FROM asignaciones_log l
     LEFT JOIN agentes ag ON ag.id = l.agente_id
     LEFT JOIN agentes_empleo e ON e.id_empleo = ag.empleo_id
     LEFT JOIN usuarios uc ON uc.id = l.comunicado_por
     ${where}
     ORDER BY l.id DESC
     LIMIT 5000`,
    params
  );

  // Todos los IDs no comunicados (antes de reducir a uno por agente+día)
  // Se usan para marcar TODOS los cambios del período, no sólo el último visible.
  const allNonComunicadoIds = rawLogs.map((r) => r.id);

  let logs = keepLatestPerAgentDay(explodeHistorialByAgentDay(rawLogs));

  if (fechasCuadranteList.length) {
    const includeNullCuadrante = fechasCuadranteList.includes(
      '__SIN_FECHA_MASIVO__'
    );
    const fechasCuadranteDates = new Set(
      fechasCuadranteList.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
    );

    logs = logs.filter((entry) => {
      const dayKey = entry.historial_day_key || '__SIN_FECHA_MASIVO__';
      if (dayKey === '__SIN_FECHA_MASIVO__') return includeNullCuadrante;
      return fechasCuadranteDates.has(dayKey);
    });
  }

  logs.sort((a, b) => {
    const nameA = [a.agente_apellido1, a.agente_apellido2, a.agente_nombre]
      .filter(Boolean)
      .join(' ');
    const nameB = [b.agente_apellido1, b.agente_apellido2, b.agente_nombre]
      .filter(Boolean)
      .join(' ');
    const cmpName = nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
    if (cmpName !== 0) return cmpName;
    const tA = new Date(a.created_at || 0).getTime();
    const tB = new Date(b.created_at || 0).getTime();
    if (tB !== tA) return tB - tA;
    return Number(b.id || 0) - Number(a.id || 0);
  });

  const total = logs.length;
  const paged = logs.slice(offset, offset + limit);

  return { logs: paged, total, page, limit, allNonComunicadoIds };
};

exports.marcarHistorialComoComunicado = async (
  logIds,
  userId,
  arsUnidadId
) => {
  const arsId = requireArsId(arsUnidadId);
  const ids = Array.isArray(logIds)
    ? Array.from(
        new Set(
          logIds
            .map((v) => Number(v))
            .filter((v) => Number.isInteger(v) && v > 0)
        )
      )
    : [];

  if (!ids.length) {
    return { updated: 0, lote: null };
  }

  // Envuelto en transacción: BEGIN → UPDATE → COMMIT
  return withTransaction(async (client) => {
    const lote =
      Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    const comunicadoPor = Number.isInteger(Number(userId)) ? Number(userId) : null;

    const { rowCount } = await client.query(
      `UPDATE asignaciones_log
          SET comunicado_at = now(),
              comunicado_por = $1,
              comunicado_lote = $2
        WHERE id = ANY($3::int[])
          AND ars_unidad_id = $4
          AND comunicado_at IS NULL`,
      [comunicadoPor, lote, ids, arsId]
    );

    return { updated: Number(rowCount || 0), lote };
  });
};

// ── Stats: agentes por actividad en un periodo ───────────────

exports.getActividadesStats = async (anio, mes, borrador_id, arsUnidadId) => {
  const arsId = requireArsId(arsUnidadId);
  if (borrador_id) {
    const { rows } = await db.query(
      `SELECT
          a.id_actividad,
          a.actividad   AS actividad_codigo,
          a.nombre      AS actividad_nombre,
          COUNT(DISTINCT ab.agente_id)::int AS count
       FROM asignaciones_borrador ab
       JOIN asignaciones_borrador_servicios abs ON abs.asignacion_borrador_id = ab.id
       JOIN actividades a ON a.id_actividad = abs.actividad_id
       WHERE ab.borrador_id = $1 AND ab.ars_unidad_id = $2
       GROUP BY a.id_actividad, a.actividad, a.nombre
       ORDER BY count DESC`,
      [borrador_id, arsId]
    );
    return rows;
  }

  const { rows } = await db.query(
    `SELECT
        a.id_actividad,
        a.actividad   AS actividad_codigo,
        a.nombre      AS actividad_nombre,
        COUNT(DISTINCT asig.agente_id)::int AS count
     FROM asignaciones asig
     JOIN asignaciones_servicios s ON s.asignacion_id = asig.id
     JOIN actividades a            ON a.id_actividad  = s.actividad_id
     WHERE asig.anio = $1 AND asig.mes = $2 AND asig.ars_unidad_id = $3
     GROUP BY a.id_actividad, a.actividad, a.nombre
     ORDER BY count DESC`,
    [anio, mes, arsId]
  );
  return rows;
};

// ── Metadatos ────────────────────────────────────────────────

exports.getMeta = async (arsUnidadId) => {
  const arsId = requireArsId(arsUnidadId);
  const gruposColsRes = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'grupos_actividad'`
  );
  const gruposCols = new Set(
    (gruposColsRes.rows || []).map((row) => String(row.column_name || ''))
  );

  const grupoNivelCol = gruposCols.has('nivel_id')
    ? 'nivel_id'
    : gruposCols.has('nivel')
      ? 'nivel'
      : null;
  const grupoColorCol = gruposCols.has('color') ? 'color' : null;

  const nivelesTableRes = await db.query(
    `SELECT to_regclass('public.niveles_grupo')::text AS table_name`
  );

  const nivelesTableName =
    (nivelesTableRes.rows &&
      nivelesTableRes.rows[0] &&
      nivelesTableRes.rows[0].table_name) ||
    null;

  let nivelesJoinSql = '';
  let nivelNombreSql = "'Sin nivel'";
  let nivelOrdenSql = 'NULL::int';
  let nivelColorSql = 'NULL::text';

  if (grupoNivelCol) {
    nivelOrdenSql = `ga.${grupoNivelCol}::int`;
    nivelNombreSql = `('Nivel ' || COALESCE(ga.${grupoNivelCol}::text, '?'))`;
  }

  if (nivelesTableName && grupoNivelCol) {
    const nivelesTableOnly = String(nivelesTableName).split('.').pop();
    const nivelesColsRes = await db.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1`,
      [nivelesTableOnly]
    );
    const nivelesCols = new Set(
      (nivelesColsRes.rows || []).map((row) => String(row.column_name || ''))
    );
    const nivelIdCol = nivelesCols.has('id_nivel')
      ? 'id_nivel'
      : nivelesCols.has('id')
        ? 'id'
        : null;
    const nivelDescCol = nivelesCols.has('descripcion')
      ? 'descripcion'
      : nivelesCols.has('nombre')
        ? 'nombre'
        : null;
    const nivelColorCol = nivelesCols.has('color')
      ? 'color'
      : nivelesCols.has('color_hex')
        ? 'color_hex'
        : null;

    if (nivelIdCol) {
      nivelesJoinSql = `LEFT JOIN ${nivelesTableName} ng ON ng.${nivelIdCol} = ga.${grupoNivelCol}`;
      if (nivelDescCol) {
        nivelNombreSql = `COALESCE(NULLIF(TRIM(ng.${nivelDescCol}::text), ''), ('Nivel ' || COALESCE(ga.${grupoNivelCol}::text, '?')))`;
      }
      if (nivelColorCol) {
        nivelColorSql = `NULLIF(TRIM(ng.${nivelColorCol}::text), '')`;
      }
    }
  }

  const actividadesSql = `WITH RECURSIVE grupos_path AS (
            SELECT g.id_grupo AS source_grupo_id,
                   g.id_grupo,
                   g.parent_id_grupo,
                   g.nombre,
                   ${grupoColorCol ? `NULLIF(TRIM(g.${grupoColorCol}::text), '')` : 'NULL::text'} AS color,
                   g.${grupoNivelCol}::int AS nivel_id,
                   0 AS profundidad
              FROM grupos_actividad g
            UNION ALL
            SELECT gp.source_grupo_id,
                   parent.id_grupo,
                   parent.parent_id_grupo,
                   parent.nombre,
                   ${grupoColorCol ? `NULLIF(TRIM(parent.${grupoColorCol}::text), '')` : 'NULL::text'} AS color,
                   parent.${grupoNivelCol}::int AS nivel_id,
                   gp.profundidad + 1 AS profundidad
              FROM grupos_path gp
              JOIN grupos_actividad parent ON parent.id_grupo = gp.parent_id_grupo
          ), grupo_nivel3 AS (
            SELECT DISTINCT ON (source_grupo_id)
                   source_grupo_id,
                   id_grupo AS grupo_nivel3_id,
                   nombre AS grupo_nivel3_nombre,
                   color AS grupo_nivel3_color
              FROM grupos_path
             WHERE nivel_id = 3
             ORDER BY source_grupo_id, profundidad ASC
          )
          SELECT a.id_actividad,
            a.actividad AS codigo,
            a.nombre,
            NULLIF(TRIM(a.color::text), '') AS actividad_color,
            a.grupo_id,
            ga.nombre AS grupo_nombre,
            NULLIF(TRIM(ga.color::text), '') AS grupo_color,
            ${nivelOrdenSql} AS nivel_grupo_orden,
            ${nivelNombreSql} AS nivel_grupo_nombre,
            ${nivelColorSql} AS nivel_grupo_color,
            gn3.grupo_nivel3_id,
            gn3.grupo_nivel3_nombre,
            gn3.grupo_nivel3_color
          FROM actividades a
          LEFT JOIN grupos_actividad ga ON ga.id_grupo = a.grupo_id
          LEFT JOIN grupo_nivel3 gn3 ON gn3.source_grupo_id = a.grupo_id
          ${nivelesJoinSql}
          ORDER BY
            COALESCE(${nivelOrdenSql}, 9999),
            ga.nombre NULLS LAST,
            a.nombre`;

  const [
    turnosRes,
    actividadesRes,
    agentesRes,
    empleosRes,
    pelotonesRes,
    situacionesRes,
  ] = await Promise.all([
    db.query(
      `SELECT id_turno, codigo, nombre, color
         FROM turnos WHERE baja_at IS NULL ORDER BY nombre`
    ),
    db.query(actividadesSql),
    db.query(
      `SELECT ag.id AS id_agente,
                ${SQL_AGENTE_COLS},
                ag.fecha_baja,
                ag.empleo_id, ag.peloton_id, ag.situacion_id,
                ${SQL_CATALOGO_COLS}
         FROM agentes ag
         ${SQL_CATALOGO_JOINS}
         WHERE ag.ars_unidad_id = $1
           AND ag.fecha_baja IS NULL
         ORDER BY ag.escalafon, ag.apellido_1, ag.apellido_2, ag.nombre`,
      [arsId]
    ),
    db.query(
      `SELECT id_empleo, descripcion AS nombre
         FROM agentes_empleo ORDER BY descripcion`
    ),
    db.query(
      `SELECT id_peloton, descripcion AS nombre
         FROM agentes_peloton ORDER BY descripcion`
    ),
    db.query(
      `SELECT id_situacion, descripcion AS nombre
         FROM agentes_situacion ORDER BY descripcion`
    ),
  ]);

  return {
    turnos: turnosRes.rows,
    actividades: actividadesRes.rows,
    agentes: agentesRes.rows,
    empleos: empleosRes.rows,
    pelotones: pelotonesRes.rows,
    situaciones: situacionesRes.rows,
  };
};
