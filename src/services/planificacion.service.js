/**
 * planificacion.service.js
 * Servicio para planes, borradores, versiones, asignaciones y aprobación.
 * Auditoría modo B (solo si hay cambio real) registrada aquí, no en triggers de BD.
 * Fechas con Luxon.
 */
'use strict';

const db = require('../config/db');
const { DateTime } = require('luxon');

// ─────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────

function parseFechaRef({ fecha_ref, anio, mes }) {
  if (fecha_ref) {
    var dtFechaRef = DateTime.fromISO(String(fecha_ref).slice(0, 10));
    if (!dtFechaRef.isValid) {
      throw new Error('fecha_ref inválida (YYYY-MM-DD)');
    }
    return dtFechaRef.startOf('day');
  }

  if (anio && mes) {
    var dtPeriodo = DateTime.fromObject({
      year: Number(anio),
      month: Number(mes),
      day: 1,
    });
    if (!dtPeriodo.isValid) {
      throw new Error('anio/mes inválidos');
    }
    return dtPeriodo.startOf('day');
  }

  return null;
}

/**
 * Registra un evento en plan_audit_log (modo B: solo llamar si hay cambio real).
 */
async function auditLog(
  client,
  tableName,
  rowId,
  accion,
  oldData,
  newData,
  userId
) {
  function normalizeAuditData(data) {
    if (!data || typeof data !== 'object') return null;
    var keys = Object.keys(data);
    if (!keys.length) return null;
    var hasAnyValue = keys.some(function (k) {
      return data[k] !== null && data[k] !== undefined;
    });
    return hasAnyValue ? data : null;
  }

  const oldDataNorm = normalizeAuditData(oldData);
  const newDataNorm = normalizeAuditData(newData);

  await client.query(
    `INSERT INTO plan_audit_log (table_name, row_id, accion, changed_by, old_data, new_data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      tableName,
      rowId,
      accion,
      userId || null,
      oldDataNorm ? JSON.stringify(oldDataNorm) : null,
      newDataNorm ? JSON.stringify(newDataNorm) : null,
    ]
  );
}

function buildAuditPayload({
  plan_id = null,
  borrador_id = null,
  fecha = null,
  agente_id = null,
  actividad_id = null,
} = {}) {
  return {
    plan_id,
    borrador_id,
    fecha: fecha ? String(fecha).slice(0, 10) : null,
    agente_id,
    actividad_id: actividad_id == null ? null : actividad_id,
  };
}

function normalizePlanDates(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  const out = { ...plan };

  const dtInicio = DateTime.fromISO(String(out.fecha_inicio || '').slice(0, 10));
  if (!dtInicio.isValid) return out;

  let dtFin = DateTime.fromISO(String(out.fecha_fin || '').slice(0, 10));
  if (!dtFin.isValid || dtFin < dtInicio) {
    const meses = Math.max(1, Number(out.num_meses || 1));
    dtFin = dtInicio
      .plus({ months: meses })
      .minus({ days: 1 })
      .startOf('day');
  }

  out.fecha_inicio = dtInicio.toISODate();
  out.fecha_fin = dtFin.toISODate();
  if (out.num_meses != null && out.num_meses !== '') {
    out.num_meses = Math.max(1, Number(out.num_meses) || 1);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// 1. Listar planes
// ─────────────────────────────────────────────────────────────
exports.listarPlanes = async (params = {}) => {
  const { anio, mes, fecha_ref, limit = 24, arsId } = params;
  const safeLimit = Math.max(1, Number(limit) || 24);
  const fetchLimit = Math.max(safeLimit * 20, 240);

  const dtRef = parseFechaRef({ fecha_ref, anio, mes });

  const { rows } = await db.query(
    `SELECT p.*
     FROM plan p
     WHERE p.ars_unidad_id = $1
     ORDER BY p.fecha_inicio DESC, p.id_plan DESC
     LIMIT $2`,
    [arsId, fetchLimit]
  );

  const normalized = rows.map(normalizePlanDates);

  if (!dtRef) {
    return normalized.slice(0, safeLimit);
  }

  const startOfMonth = dtRef.startOf('month');
  const endOfMonth = dtRef.endOf('month');
  return normalized
    .filter((p) => {
      const dtInicio = DateTime.fromISO(String(p.fecha_inicio || '').slice(0, 10));
      const dtFin = DateTime.fromISO(String(p.fecha_fin || '').slice(0, 10));
      if (!dtInicio.isValid || !dtFin.isValid) return false;
      return dtInicio <= endOfMonth && dtFin >= startOfMonth;
    })
    .slice(0, safeLimit);
};

exports.obtenerPlanPorId = async ({ planId, arsId }) => {
  if (!planId) throw new Error('planId requerido');
  if (!arsId) throw new Error('ars_unidad_id requerido');

  const { rows } = await db.query(
    `SELECT p.*
     FROM plan p
     WHERE p.id_plan = $1
       AND p.ars_unidad_id = $2
     LIMIT 1`,
    [planId, arsId]
  );

  if (!rows.length) return null;
  return normalizePlanDates(rows[0]);
};

// ─────────────────────────────────────────────────────────────
// 2. Crear plan
// ─────────────────────────────────────────────────────────────
exports.crearPlan = async ({
  anio,
  mes,
  fecha_inicio,
  fecha_fin,
  num_meses,
  descripcion,
  arsId,
  userId,
}) => {
  if (!arsId) throw new Error('ars_unidad_id requerido');

  let dtInicio = null;
  if (fecha_inicio) {
    dtInicio = DateTime.fromISO(String(fecha_inicio).slice(0, 10));
    if (!dtInicio.isValid) {
      throw new Error('fecha_inicio inválida (YYYY-MM-DD)');
    }
    dtInicio = dtInicio.startOf('day');
  } else {
    if (!anio) throw new Error('anio requerido');
    if (!mes || mes < 1 || mes > 12) throw new Error('mes inválido (1-12)');
    dtInicio = DateTime.fromObject({
      year: Number(anio),
      month: Number(mes),
      day: 1,
    });
    if (!dtInicio.isValid) {
      throw new Error('anio/mes inválidos');
    }
  }

  const fechaInicio = dtInicio.toISODate();
  let dtFin = null;
  if (fecha_fin) {
    dtFin = DateTime.fromISO(String(fecha_fin).slice(0, 10)).startOf('day');
    if (!dtFin.isValid) {
      throw new Error('fecha_fin inválida (YYYY-MM-DD)');
    }
  } else {
    const meses = Number(num_meses || 1);
    if (!Number.isInteger(meses) || meses < 1 || meses > 24) {
      throw new Error('num_meses inválido (1-24)');
    }
    dtFin = dtInicio.plus({ months: meses }).minus({ days: 1 }).startOf('day');
  }

  if (dtFin < dtInicio) {
    throw new Error('fecha_fin no puede ser menor que fecha_inicio');
  }

  const fechaFin = dtFin.toISODate();
  const anioPlan = dtInicio.year;
  const mesPlan = dtInicio.month;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO plan (ars_unidad_id, anio, mes, fecha_inicio, fecha_fin, descripcion, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        arsId,
        anioPlan,
        mesPlan,
        fechaInicio,
        fechaFin,
        descripcion || null,
        userId || null,
      ]
    );
    const plan = rows[0];

    await auditLog(
      client,
      'plan',
      plan.id_plan,
      'INSERT',
      buildAuditPayload(),
      buildAuditPayload({
        plan_id: plan.id_plan,
        fecha: fechaInicio,
      }),
      userId
    );

    await client.query('COMMIT');
    return normalizePlanDates(plan);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// 3. Copiar desde plan anterior (asignaciones finales → nuevo borrador)
// ─────────────────────────────────────────────────────────────
exports.copiarDesdePlan = async ({
  planId,
  fromPlanId,
  draftNombre,
  versionDesc,
  userId,
}) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Verificar planes
    const planDst = await client.query(
      'SELECT * FROM plan WHERE id_plan = $1',
      [planId]
    );
    const planSrc = await client.query(
      'SELECT * FROM plan WHERE id_plan = $1',
      [fromPlanId]
    );
    if (!planDst.rows.length) throw new Error('Plan destino no encontrado');
    if (!planSrc.rows.length) throw new Error('Plan origen no encontrado');

    const planSrcNorm = normalizePlanDates(planSrc.rows[0]);
    const planDstNorm = normalizePlanDates(planDst.rows[0]);

    const dtSrcInicio = DateTime.fromISO(
      String(planSrcNorm.fecha_inicio).slice(0, 10)
    ).startOf('day');
    const dtDstInicio = DateTime.fromISO(
      String(planDstNorm.fecha_inicio).slice(0, 10)
    ).startOf('day');
    const dtDstFin = DateTime.fromISO(
      String(planDstNorm.fecha_fin).slice(0, 10)
    ).endOf('day');

    if (!dtSrcInicio.isValid) {
      throw new Error('Plan origen inválido: fecha_inicio');
    }
    if (!dtDstInicio.isValid) {
      throw new Error('Plan destino inválido: fecha_inicio');
    }
    if (!dtDstFin.isValid) {
      throw new Error('Plan destino inválido: fecha_fin');
    }

    // 3.1 Crear borrador + versión en el plan destino
    const borrador = await client.query(
      `INSERT INTO plan_borrador (plan_id, nombre, owner_user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [planId, draftNombre || 'Copia', userId || null]
    );
    const borradorId = borrador.rows[0].id;

    await auditLog(
      client,
      'plan_borrador',
      borradorId,
      'INSERT',
      buildAuditPayload(),
      buildAuditPayload({
        plan_id: planId,
        borrador_id: borradorId,
      }),
      userId
    );

    const version = await client.query(
      `INSERT INTO plan_borrador_version (borrador_id, version_num, descripcion, created_by)
       VALUES ($1, 1, $2, $3)
       RETURNING *`,
      [borradorId, versionDesc || 'v1 copia', userId || null]
    );
    const versionId = version.rows[0].id;

    // 3.2 Copiar plan_final_asignacion del origen mapeando por día natural
    const srcAsignaciones = await client.query(
      `SELECT * FROM plan_final_asignacion
       WHERE plan_id = $1
       ORDER BY fecha, agente_id`,
      [fromPlanId]
    );

    for (const a of srcAsignaciones.rows) {
      // Mapear por desplazamiento desde el inicio del plan origen.
      const srcDate = DateTime.fromISO(String(a.fecha).slice(0, 10));
      if (!srcDate.isValid) continue;

      const offsetDays = Math.floor(srcDate.diff(dtSrcInicio, 'days').days);
      if (!Number.isFinite(offsetDays)) continue;

      const dstDate = dtDstInicio.plus({ days: offsetDays });
      if (!dstDate.isValid) continue;
      if (dstDate < dtDstInicio || dstDate > dtDstFin) continue;

      const newFecha = dstDate.toISODate();

      await client.query(
        `INSERT INTO plan_borrador_asignacion (version_id, fecha, agente_id, actividad_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (version_id, fecha, agente_id) DO NOTHING`,
        [versionId, newFecha, a.agente_id, a.actividad_id]
      );
    }

    await client.query('COMMIT');
    return { borrador_id: borradorId, version_id: versionId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// 4b. Crear borrador (nuevo borrador + primera versión vacía)
// ─────────────────────────────────────────────────────────────
exports.crearBorrador = async ({ planId, nombre, descripcion, userId }) => {
  if (!planId) throw new Error('planId requerido');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Verificar que el plan existe
    const planRes = await client.query(
      'SELECT id_plan FROM plan WHERE id_plan = $1',
      [planId]
    );
    if (!planRes.rows.length) throw new Error('Plan no encontrado');

    // Calcular número de borrador siguiente
    const countRes = await client.query(
      'SELECT COUNT(*) AS cnt FROM plan_borrador WHERE plan_id = $1',
      [planId]
    );
    const numBorrador = Number(countRes.rows[0].cnt) + 1;

    // Crear borrador
    const borradorRes = await client.query(
      `INSERT INTO plan_borrador (plan_id, nombre, owner_user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [planId, nombre || 'Borrador ' + numBorrador, userId || null]
    );
    const borrador = borradorRes.rows[0];

    await auditLog(
      client,
      'plan_borrador',
      borrador.id,
      'INSERT',
      buildAuditPayload(),
      buildAuditPayload({
        plan_id: planId,
        borrador_id: borrador.id,
      }),
      userId
    );

    // Crear primera versión vacía
    const versionRes = await client.query(
      `INSERT INTO plan_borrador_version (borrador_id, version_num, descripcion, created_by)
       VALUES ($1, 1, $2, $3)
       RETURNING *`,
      [borrador.id, descripcion || 'v1', userId || null]
    );
    const version = versionRes.rows[0];

    await client.query('COMMIT');
    return { borrador_id: borrador.id, version_id: version.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// 5. Listar asignaciones de una versión (para pintar el grid)
// ─────────────────────────────────────────────────────────────
exports.listarAsignaciones = async (versionId) => {
  const { rows } = await db.query(
    `SELECT pba.id, pba.fecha, pba.agente_id, pba.actividad_id,
            a.nombre AS agente_nombre, a.apellido_1, a.apellido_2, a.tip, a.aptitudes,
            p.id_peloton, p.descripcion AS peloton_desc,
            e.id_empleo, e.descripcion AS empleo_desc,
            s.id_situacion, s.descripcion AS situacion_desc,
            act.nombre AS actividad_nombre, act.actividad AS actividad_codigo, act.color AS actividad_color
            FROM agentes a
            JOIN plan_borrador_asignacion pba
                ON pba.agente_id = a.id
     LEFT JOIN agentes_peloton p ON a.peloton_id = p.id_peloton
     LEFT JOIN agentes_empleo e ON a.empleo_id = e.id_empleo
     LEFT JOIN agentes_situacion s ON a.situacion_id = s.id_situacion
     LEFT JOIN actividades act ON act.id_actividad = pba.actividad_id
     WHERE pba.version_id = $1
     ORDER BY a.apellido_1, a.apellido_2, a.nombre, pba.fecha`,
    [versionId]
  );
  return rows;
};

// ─────────────────────────────────────────────────────────────
// 6. Guardar asignaciones bulk puntuales (edición manual del grid)
// ─────────────────────────────────────────────────────────────
exports.guardarBulk = async ({ versionId, items, userId }) => {
  if (!Array.isArray(items) || items.length === 0)
    throw new Error('items vacío');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let afectados = 0;

    const versionCtx = await client.query(
      `SELECT pb.plan_id, pb.id AS borrador_id
         FROM plan_borrador_version pbv
         JOIN plan_borrador pb ON pb.id = pbv.borrador_id
        WHERE pbv.id = $1`,
      [versionId]
    );
    if (!versionCtx.rows.length) throw new Error('Versión no encontrada');
    const auditBase = {
      plan_id: versionCtx.rows[0].plan_id,
      borrador_id: versionCtx.rows[0].borrador_id,
    };

    for (const item of items) {
      const { fecha, agente_id, actividad_id } = item;

      const existing = await client.query(
        'SELECT id, actividad_id FROM plan_borrador_asignacion WHERE version_id = $1 AND fecha = $2 AND agente_id = $3',
        [versionId, fecha, agente_id]
      );

      if (existing.rows.length === 0) {
        const ins = await client.query(
          `INSERT INTO plan_borrador_asignacion (version_id, fecha, agente_id, actividad_id)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [versionId, fecha, agente_id, actividad_id]
        );
        await auditLog(
          client,
          'plan_borrador_asignacion',
          ins.rows[0].id,
          'INSERT',
          buildAuditPayload(),
          buildAuditPayload({
            plan_id: auditBase.plan_id,
            borrador_id: auditBase.borrador_id,
            fecha,
            agente_id,
            actividad_id,
          }),
          userId
        );
        afectados++;
      } else {
        const row = existing.rows[0];
        if (String(row.actividad_id) !== String(actividad_id)) {
          await client.query(
            `UPDATE plan_borrador_asignacion SET actividad_id = $1, updated_at = now() WHERE id = $2`,
            [actividad_id, row.id]
          );
          await auditLog(
            client,
            'plan_borrador_asignacion',
            row.id,
            'UPDATE',
            buildAuditPayload({
              plan_id: auditBase.plan_id,
              borrador_id: auditBase.borrador_id,
              fecha,
              agente_id,
              actividad_id: row.actividad_id,
            }),
            buildAuditPayload({
              plan_id: auditBase.plan_id,
              borrador_id: auditBase.borrador_id,
              fecha,
              agente_id,
              actividad_id,
            }),
            userId
          );
          afectados++;
        }
      }
    }

    await client.query('COMMIT');
    return { afectados };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// 7. Aprobar versión (legacy y chunked)
// ─────────────────────────────────────────────────────────────
async function getAprobacionContext(client, versionId) {
  const vRes = await client.query(
    `SELECT pbv.id, pbv.borrador_id, pb.plan_id
       FROM plan_borrador_version pbv
       JOIN plan_borrador pb ON pb.id = pbv.borrador_id
      WHERE pbv.id = $1`,
    [versionId]
  );
  if (!vRes.rows.length) throw new Error('Versión no encontrada');

  const totalRes = await client.query(
    'SELECT COUNT(*)::int AS total FROM plan_borrador_asignacion WHERE version_id = $1',
    [versionId]
  );

  return {
    planId: vRes.rows[0].plan_id,
    borradorId: vRes.rows[0].borrador_id,
    total: Number(totalRes.rows[0] && totalRes.rows[0].total) || 0,
  };
}

async function aplicarComentarioAprobacion(client, { versionId, userId, comentario }) {
  const text = String(comentario || '').trim();
  if (!text) return;

  const vRes = await client.query(
    `SELECT pbv.id, pbv.borrador_id, pb.plan_id, pb.observaciones,
            COALESCE(NULLIF(u.nombre, ''), NULLIF(u.email, ''), 'usuario') AS actor_username
       FROM plan_borrador_version pbv
       JOIN plan_borrador pb ON pb.id = pbv.borrador_id
       LEFT JOIN usuarios u ON u.id = $2
      WHERE pbv.id = $1`,
    [versionId, userId || null]
  );
  if (!vRes.rows.length) throw new Error('Versión no encontrada');

  const prevObs = String(vRes.rows[0].observaciones || '').trim();
  let mergedObs = prevObs;
  let delta = text;
  if (prevObs && text.indexOf(prevObs) === 0) {
    delta = String(text.slice(prevObs.length)).trim();
  }

  if (delta) {
    const stamp = DateTime.now().toFormat('dd/MM/yyyy HH:mm');
    const actor = vRes.rows[0].actor_username || 'usuario';
    const block = '[' + stamp + ' · ' + actor + ']\n' + delta;
    mergedObs = prevObs ? prevObs + '\n\n' + block : block;
  }

  if (mergedObs === prevObs) return;

  const updObs = await client.query(
    'UPDATE plan_borrador SET observaciones = $1 WHERE id = $2 RETURNING *',
    [mergedObs || null, vRes.rows[0].borrador_id]
  );

  await auditLog(
    client,
    'plan_borrador',
    vRes.rows[0].borrador_id,
    'UPDATE',
    buildAuditPayload({
      plan_id: vRes.rows[0].plan_id,
      borrador_id: vRes.rows[0].borrador_id,
    }),
    buildAuditPayload({
      plan_id:
        (updObs.rows[0] && updObs.rows[0].plan_id) || vRes.rows[0].plan_id,
      borrador_id: vRes.rows[0].borrador_id,
    }),
    userId
  );
}

async function procesarAprobacionChunk(client, {
  versionId,
  planId,
  borradorId,
  userId,
  offset,
  limit,
}) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500));

  const asignaciones = await client.query(
    `SELECT *
       FROM plan_borrador_asignacion
      WHERE version_id = $1
      ORDER BY id ASC
      OFFSET $2
      LIMIT $3`,
    [versionId, safeOffset, safeLimit]
  );

  let aprobados = 0;
  let auditados = 0;

  for (const a of asignaciones.rows) {
    const snapRes = await client.query(
      'SELECT to_jsonb(ag.*) AS snap FROM agentes ag WHERE ag.id = $1',
      [a.agente_id]
    );
    const agenteSnapshot = snapRes.rows[0] ? snapRes.rows[0].snap : null;

    const existing = await client.query(
      `SELECT id, fecha, agente_id, actividad_id, agente_snapshot
         FROM plan_final_asignacion
        WHERE plan_id = $1
          AND fecha = $2
          AND agente_id = $3`,
      [planId, a.fecha, a.agente_id]
    );

    if (!existing.rows.length) {
      const ins = await client.query(
        `INSERT INTO plan_final_asignacion
           (plan_id, fecha, agente_id, actividad_id, agente_snapshot, approved_by_user_id, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING id`,
        [
          planId,
          a.fecha,
          a.agente_id,
          a.actividad_id,
          agenteSnapshot,
          userId || null,
        ]
      );

      await auditLog(
        client,
        'plan_final_asignacion',
        ins.rows[0].id,
        'INSERT',
        buildAuditPayload(),
        buildAuditPayload({
          plan_id: planId,
          borrador_id: borradorId,
          fecha: a.fecha,
          agente_id: a.agente_id,
          actividad_id: a.actividad_id,
        }),
        userId
      );
      aprobados++;
      auditados++;
      continue;
    }

    const row = existing.rows[0];
    const actividadCambio = String(row.actividad_id) !== String(a.actividad_id);
    const snapCambio =
      JSON.stringify(row.agente_snapshot) !== JSON.stringify(agenteSnapshot);

    if (!actividadCambio && !snapCambio) continue;

    await client.query(
      `UPDATE plan_final_asignacion
          SET actividad_id = $1,
              agente_snapshot = $2,
              approved_by_user_id = $3,
              approved_at = now()
        WHERE id = $4`,
      [a.actividad_id, agenteSnapshot, userId || null, row.id]
    );

    await auditLog(
      client,
      'plan_final_asignacion',
      row.id,
      'UPDATE',
      buildAuditPayload({
        plan_id: planId,
        borrador_id: borradorId,
        fecha: row.fecha,
        agente_id: row.agente_id,
        actividad_id: row.actividad_id,
      }),
      buildAuditPayload({
        plan_id: planId,
        borrador_id: borradorId,
        fecha: a.fecha,
        agente_id: a.agente_id,
        actividad_id: a.actividad_id,
      }),
      userId
    );
    aprobados++;
    auditados++;
  }

  return {
    procesadas: asignaciones.rows.length,
    aprobados,
    auditados,
  };
}

async function marcarBorradorAprobado(client, { borradorId, planId, userId }) {
  const borradorPrevRes = await client.query(
    'SELECT * FROM plan_borrador WHERE id = $1',
    [borradorId]
  );
  const borradorPrev = borradorPrevRes.rows[0] || null;

  const borradorUpdRes = await client.query(
    `UPDATE plan_borrador
       SET aprobado = TRUE,
           aprobado_at = now(),
           aprobado_by = $2,
           estado = 'aprobado'
     WHERE id = $1
     RETURNING *`,
    [borradorId, userId || null]
  );

  await auditLog(
    client,
    'plan_borrador',
    borradorId,
    'UPDATE',
    buildAuditPayload({
      plan_id: borradorPrev ? borradorPrev.plan_id : planId,
      borrador_id: borradorId,
    }),
    buildAuditPayload({
      plan_id:
        (borradorUpdRes.rows[0] && borradorUpdRes.rows[0].plan_id) ||
        (borradorPrev ? borradorPrev.plan_id : planId),
      borrador_id: borradorId,
    }),
    userId
  );

  const bRes = await client.query(
    `SELECT pb.id, pb.nombre, pb.observaciones, pb.aprobado, pb.aprobado_at,
            pb.aprobado_by,
            COALESCE(NULLIF(u.nombre, ''), NULLIF(u.email, ''), 'usuario') AS aprobado_by_username
       FROM plan_borrador pb
       LEFT JOIN usuarios u ON u.id = pb.aprobado_by
      WHERE pb.id = $1`,
    [borradorId]
  );

  return bRes.rows[0] || null;
}

exports.aprobarChunkPrepare = async ({ versionId }) => {
  const client = await db.connect();
  try {
    const ctx = await getAprobacionContext(client, versionId);
    return {
      total: ctx.total,
      borrador_id: ctx.borradorId,
      plan_id: ctx.planId,
    };
  } finally {
    client.release();
  }
};

exports.aprobarChunk = async ({ versionId, userId, offset, limit }) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const ctx = await getAprobacionContext(client, versionId);
    const result = await procesarAprobacionChunk(client, {
      versionId,
      planId: ctx.planId,
      borradorId: ctx.borradorId,
      userId,
      offset,
      limit,
    });
    await client.query('COMMIT');
    return {
      total: ctx.total,
      offset: Math.max(0, Number(offset) || 0),
      ...result,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.aprobarChunkFinalize = async ({ versionId, userId, comentario }) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const ctx = await getAprobacionContext(client, versionId);
    await aplicarComentarioAprobacion(client, { versionId, userId, comentario });
    const borrador = await marcarBorradorAprobado(client, {
      borradorId: ctx.borradorId,
      planId: ctx.planId,
      userId,
    });
    await client.query('COMMIT');
    return {
      total: ctx.total,
      borrador,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.aprobar = async ({ versionId, userId }) => {
  const prep = await exports.aprobarChunkPrepare({ versionId });
  const chunkSize = 500;
  let aprobados = 0;
  let auditados = 0;

  for (let offset = 0; offset < prep.total; offset += chunkSize) {
    const partial = await exports.aprobarChunk({
      versionId,
      userId,
      offset,
      limit: chunkSize,
    });
    aprobados += Number(partial.aprobados || 0);
    auditados += Number(partial.auditados || 0);
  }

  const fin = await exports.aprobarChunkFinalize({ versionId, userId, comentario: '' });
  return {
    aprobados,
    auditados,
    borrador: fin.borrador || null,
  };
};

// ─────────────────────────────────────────────────────────────
// 7b. Aprobar versión con comentario (compatibilidad)
// ─────────────────────────────────────────────────────────────
exports.aprobarConComentario = async ({ versionId, userId, comentario }) => {
  const prep = await exports.aprobarChunkPrepare({ versionId });
  const chunkSize = 500;
  let aprobados = 0;
  let auditados = 0;

  for (let offset = 0; offset < prep.total; offset += chunkSize) {
    const partial = await exports.aprobarChunk({
      versionId,
      userId,
      offset,
      limit: chunkSize,
    });
    aprobados += Number(partial.aprobados || 0);
    auditados += Number(partial.auditados || 0);
  }

  const fin = await exports.aprobarChunkFinalize({ versionId, userId, comentario });
  return {
    aprobados,
    auditados,
    borrador: fin.borrador || null,
  };
};

// ─────────────────────────────────────────────────────────────
// 8. Listar borradores de un plan
// ─────────────────────────────────────────────────────────────
exports.listarBorradores = async (planId) => {
  const { rows } = await db.query(
    `SELECT pb.*,
            COALESCE(NULLIF(ub.nombre, ''), NULLIF(ub.email, ''), 'usuario') AS aprobado_by_username,
            json_agg(
       json_build_object('id', pbv.id, 'version_num', pbv.version_num, 'descripcion', pbv.descripcion, 'created_at', pbv.created_at)
       ORDER BY pbv.version_num DESC
     ) AS versiones
     FROM plan_borrador pb
     LEFT JOIN usuarios ub ON ub.id = pb.aprobado_by
     LEFT JOIN plan_borrador_version pbv ON pbv.borrador_id = pb.id
     WHERE pb.plan_id = $1
       AND COALESCE(pb.estado, 'activo') <> 'descartado'
     GROUP BY pb.id, ub.nombre, ub.email
     ORDER BY pb.created_at DESC`,
    [planId]
  );
  return rows;
};

// ─────────────────────────────────────────────────────────────
// 8b. Descartar borrador (oculto en selector)
// ─────────────────────────────────────────────────────────────
exports.descartarBorrador = async ({ borradorId, userId }) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM plan_borrador WHERE id = $1',
      [borradorId]
    );
    if (!rows.length) throw new Error('Borrador no encontrado');
    const oldRow = rows[0];
    if (oldRow.estado === 'descartado') {
      await client.query('COMMIT');
      return { discarded: true, borrador_id: borradorId };
    }

    const { rows: upd } = await client.query(
      `UPDATE plan_borrador
          SET estado = 'descartado'
        WHERE id = $1
      RETURNING *`,
      [borradorId]
    );

    await auditLog(
      client,
      'plan_borrador',
      borradorId,
      'UPDATE',
      buildAuditPayload({
        plan_id: oldRow.plan_id,
        borrador_id: borradorId,
      }),
      buildAuditPayload({
        plan_id: upd[0].plan_id,
        borrador_id: borradorId,
      }),
      userId
    );

    await client.query('COMMIT');
    return { discarded: true, borrador_id: borradorId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// 9. Borrar versión  (cascada → plan_borrador_asignacion)
// ─────────────────────────────────────────────────────────────
exports.borrarVersion = async ({ versionId, userId }) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT pbv.*, pb.plan_id, pb.id AS borrador_id
         FROM plan_borrador_version pbv
         JOIN plan_borrador pb ON pb.id = pbv.borrador_id
        WHERE pbv.id = $1`,
      [versionId]
    );
    if (!rows.length) throw new Error('Versión no encontrada');
    const version = rows[0];

    // Impedir borrar la única versión de un borrador desde aquí
    const { rows: countRows } = await client.query(
      'SELECT COUNT(*) AS cnt FROM plan_borrador_version WHERE borrador_id = $1',
      [version.borrador_id]
    );
    if (Number(countRows[0].cnt) <= 1) {
      throw new Error(
        'No se puede borrar la única versión del borrador. Borra el borrador directamente.'
      );
    }

    await auditLog(
      client,
      'plan_borrador_version',
      versionId,
      'DELETE',
      buildAuditPayload({
        plan_id: version.plan_id,
        borrador_id: version.borrador_id,
      }),
      buildAuditPayload(),
      userId
    );
    await client.query('DELETE FROM plan_borrador_version WHERE id = $1', [versionId]);
    await client.query('COMMIT');
    return { deleted: true, versionId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// 10. Borrar borrador  (cascada → versiones + asignaciones)
// ─────────────────────────────────────────────────────────────
exports.borrarBorrador = async ({ borradordId, userId }) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM plan_borrador WHERE id = $1',
      [borradordId]
    );
    if (!rows.length) throw new Error('Borrador no encontrado');
    const borrador = rows[0];

    await auditLog(
      client,
      'plan_borrador',
      borradordId,
      'DELETE',
      buildAuditPayload({
        plan_id: borrador.plan_id,
        borrador_id: borradordId,
      }),
      buildAuditPayload(),
      userId
    );
    await client.query('DELETE FROM plan_borrador WHERE id = $1', [borradordId]);
    await client.query('COMMIT');
    return { deleted: true, borradordId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// 11. Borrar plan  (cascada → borradores + versiones + asignaciones)
// ─────────────────────────────────────────────────────────────
exports.borrarPlan = async ({ planId, arsId, userId }) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM plan WHERE id_plan = $1 AND ars_unidad_id = $2',
      [planId, arsId]
    );
    if (!rows.length) throw new Error('Plan no encontrado');
    const plan = rows[0];

    await auditLog(
      client,
      'plan',
      planId,
      'DELETE',
      buildAuditPayload({
        plan_id: plan.id_plan,
        fecha: plan.fecha_inicio,
      }),
      buildAuditPayload(),
      userId
    );
    await client.query('DELETE FROM plan WHERE id_plan = $1', [planId]);
    await client.query('COMMIT');
    return { deleted: true, planId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
