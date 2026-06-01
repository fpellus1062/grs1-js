const db = require('../config/db');
const { DateTime } = require('luxon');

function normalizePeriodicidad(value) {
  const p = String(value || '').trim().toLowerCase();
  if (!['anual', 'semestral', 'mensual'].includes(p)) {
    throw new Error('Periodicidad no válida. Use anual, semestral o mensual.');
  }
  return p;
}

function getPeriodoBounds(periodicidad, fechaReferenciaIso) {
  const ref = DateTime.fromISO(String(fechaReferenciaIso || ''), { zone: 'utc' });
  if (!ref.isValid) {
    throw new Error('Fecha de referencia inválida.');
  }

  if (periodicidad === 'anual') {
    return {
      inicio: ref.startOf('year').toISODate(),
      fin: ref.endOf('year').toISODate(),
    };
  }

  if (periodicidad === 'mensual') {
    return {
      inicio: ref.startOf('month').toISODate(),
      fin: ref.endOf('month').toISODate(),
    };
  }

  const half = ref.month <= 6 ? 1 : 2;
  const inicio = half === 1 ? ref.set({ month: 1, day: 1 }) : ref.set({ month: 7, day: 1 });
  const fin = half === 1 ? ref.set({ month: 6, day: 30 }) : ref.set({ month: 12, day: 31 });
  return {
    inicio: inicio.toISODate(),
    fin: fin.toISODate(),
  };
}

function normalizeManualBounds(fechaInicioManual, fechaFinManual) {
  const inicioRaw = fechaInicioManual == null ? '' : String(fechaInicioManual).trim();
  const finRaw = fechaFinManual == null ? '' : String(fechaFinManual).trim();

  if (!inicioRaw && !finRaw) {
    return { inicio: null, fin: null };
  }
  if (!inicioRaw || !finRaw) {
    throw new Error('Debe informar ambas fechas manuales (inicio y fin) o ninguna.');
  }

  const inicio = DateTime.fromISO(inicioRaw, { zone: 'utc' }).startOf('day');
  const fin = DateTime.fromISO(finRaw, { zone: 'utc' }).startOf('day');
  if (!inicio.isValid || !fin.isValid) {
    throw new Error('Rango manual inválido para la plantilla.');
  }
  if (fin < inicio) {
    throw new Error('La fecha fin manual no puede ser anterior a la fecha inicio manual.');
  }

  return {
    inicio: inicio.toISODate(),
    fin: fin.toISODate(),
  };
}

function buildEstado(periodoFin, vencimiento, completado, objetivo, sancionado, cumpleSubtipos) {
  if (sancionado) return 'sancionado';
  if (Number(completado) >= Number(objetivo) && cumpleSubtipos) return 'cumplido';
  const now = DateTime.utc();
  const deadlineIso = vencimiento || periodoFin;
  const fin = DateTime.fromISO(String(deadlineIso), { zone: 'utc' }).endOf('day');
  if (fin.isValid && now > fin) return 'vencido';
  return 'en_progreso';
}

function normalizeIsoDateStrict(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('La fecha de servicio debe tener formato YYYY-MM-DD.');
  }
  const dt = DateTime.fromISO(raw, { zone: 'utc' });
  if (!dt.isValid || dt.toISODate() !== raw) {
    throw new Error('La fecha de servicio es inválida.');
  }
  return raw;
}

async function getServiciosAsignadosPorAgente(arsId, fechaServicioIso, agenteIds) {
  const uniqueAgenteIds = Array.from(
    new Set((agenteIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))
  );
  if (!fechaServicioIso || !uniqueAgenteIds.length) {
    return new Map();
  }

  const result = await db.query(
    `WITH asignacion_top AS (
       SELECT ranked.id,
              ranked.agente_id
         FROM (
           SELECT ab.id,
                  ab.agente_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY ab.agente_id
                    ORDER BY
                      CASE WHEN b.estado IN ('canonico_validado', 'canonico_modificado') THEN 0 ELSE 1 END,
                      COALESCE(b.updated_at, b.created_at) DESC,
                      COALESCE(ab.updated_at, ab.created_at) DESC,
                      ab.id DESC
                  ) AS rn
             FROM asignaciones_borrador ab
             JOIN asignaciones_borradores b
               ON b.id = ab.borrador_id
              AND b.ars_unidad_id = ab.ars_unidad_id
            WHERE ab.ars_unidad_id = $1
              AND ab.fecha = $2::date
              AND ab.agente_id = ANY($3::int[])
         ) ranked
        WHERE ranked.rn = 1
     )
     SELECT t.agente_id,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', a.id_actividad,
                  'codigo', a.actividad,
                  'nombre', a.nombre,
                  'color', NULLIF(TRIM(a.color::text), '')
                )
                ORDER BY a.actividad, a.nombre
              ) FILTER (WHERE a.id_actividad IS NOT NULL),
              '[]'::json
            ) AS servicios
       FROM asignacion_top t
       LEFT JOIN asignaciones_borrador_servicios abs
         ON abs.asignacion_borrador_id = t.id
        AND abs.ars_unidad_id = $1
       LEFT JOIN actividades a
         ON a.id_actividad = abs.actividad_id
      GROUP BY t.agente_id`,
    [arsId, fechaServicioIso, uniqueAgenteIds]
  );

  const byAgente = new Map();
  result.rows.forEach((row) => {
    byAgente.set(Number(row.agente_id), Array.isArray(row.servicios) ? row.servicios : []);
  });
  return byAgente;
}

async function computeSubtypeProgress(client, plantillaId, periodoId) {
  const objetivosRes = await client.query(
    `SELECT subtipo, objetivo, orden
       FROM agentes_requisitos_plantilla_objetivos
      WHERE plantilla_id = $1
      ORDER BY orden, subtipo`,
    [plantillaId]
  );

  const aprobadosRes = await client.query(
    `SELECT subtipo, COALESCE(SUM(cantidad), 0)::int AS completado
       FROM agentes_requisitos_ejecuciones
      WHERE periodo_id = $1
        AND resultado = 'aprobado'
      GROUP BY subtipo`,
    [periodoId]
  );

  const bySubtype = new Map();
  aprobadosRes.rows.forEach((row) => {
    bySubtype.set(String(row.subtipo || ''), Number(row.completado || 0));
  });

  const items = objetivosRes.rows.map((row) => {
    const subtipo = String(row.subtipo || '');
    const objetivo = Number(row.objetivo || 0);
    const completado = Number(bySubtype.get(subtipo) || 0);
    return {
      subtipo,
      objetivo,
      completado,
      cumple: completado >= objetivo,
    };
  });

  return {
    items,
    cumpleSubtipos: items.every((it) => it.cumple),
  };
}

async function refreshPeriodoStatus(client, periodoId, arsId, userId) {
  const result = await client.query(
    `SELECT p.id, p.plantilla_id, p.periodo_fin, p.vencimiento, p.objetivo_total, p.sancionado,
            COALESCE(SUM(CASE WHEN e.resultado = 'aprobado' THEN e.cantidad ELSE 0 END), 0) AS completado
       FROM agentes_requisitos_periodos p
       LEFT JOIN agentes_requisitos_ejecuciones e
         ON e.periodo_id = p.id AND e.ars_unidad_id = p.ars_unidad_id
      WHERE p.id = $1 AND p.ars_unidad_id = $2
      GROUP BY p.id, p.plantilla_id`,
    [periodoId, arsId]
  );

  if (!result.rows.length) {
    throw new Error('Período no encontrado.');
  }

  const row = result.rows[0];
  const completado = Number(row.completado) || 0;
  const objetivo = Number(row.objetivo_total) || 0;
  const subtype = await computeSubtypeProgress(
    client,
    Number(row.plantilla_id),
    Number(periodoId)
  );
  const estado = buildEstado(
    row.periodo_fin,
    row.vencimiento,
    completado,
    objetivo,
    row.sancionado === true,
    subtype.cumpleSubtipos
  );

  const updated = await client.query(
    `UPDATE agentes_requisitos_periodos
        SET completado_total = $1,
            estado = $2,
            fecha_cumplido = CASE
              WHEN $6 = 'cumplido' AND fecha_cumplido IS NULL THEN now()
              WHEN $6 <> 'cumplido' THEN NULL
              ELSE fecha_cumplido
            END,
            updated_by = $3,
            updated_at = now(),
            revision = revision + 1
      WHERE id = $4 AND ars_unidad_id = $5
      RETURNING *`,
    [completado, estado, userId, periodoId, arsId, estado]
  );

  return updated.rows[0];
}

exports.getMeta = async (arsId) => {
  const [agentesRes, plantillasRes, empleosRes, pelotonesRes] = await Promise.all([
    db.query(
      `SELECT a.id,
              a.tip,
              a.nombre,
              a.apellido_1,
              a.apellido_2,
              a.escalafon,
              a.empleo_id,
              ae.descripcion AS empleo_nombre,
              a.peloton_id,
              ap.descripcion AS peloton_nombre
         FROM agentes a
         LEFT JOIN agentes_empleo ae ON ae.id_empleo::text = a.empleo_id::text
         LEFT JOIN agentes_peloton ap ON ap.id_peloton::text = a.peloton_id::text
        WHERE a.ars_unidad_id = $1 AND a.fecha_baja IS NULL
        ORDER BY a.escalafon, a.apellido_1, a.apellido_2, a.nombre`,
      [arsId]
    ),
    db.query(
      `SELECT id, nombre, periodicidad, tipo_requisito, objetivo_total, requiere_aprobacion, plazo_dias, fecha_inicio_manual, fecha_fin_manual, activo
         FROM agentes_requisitos_plantillas
        WHERE ars_unidad_id = $1 AND activo = true
        ORDER BY nombre`,
      [arsId]
    ),
    db.query(
      `SELECT DISTINCT ae.id_empleo, ae.descripcion, ae.color
         FROM agentes_empleo ae
         JOIN agentes a ON a.empleo_id::text = ae.id_empleo::text
        WHERE a.ars_unidad_id = $1
          AND a.fecha_baja IS NULL
        ORDER BY ae.descripcion`,
      [arsId]
    ),
    db.query(
      `SELECT DISTINCT ap.id_peloton, ap.descripcion, ap.color
         FROM agentes_peloton ap
         JOIN agentes a ON a.peloton_id::text = ap.id_peloton::text
        WHERE a.ars_unidad_id = $1
          AND a.fecha_baja IS NULL
        ORDER BY ap.descripcion`,
      [arsId]
    ),
  ]);

  return {
    periodicidades: ['anual', 'semestral', 'mensual'],
    resultados: ['aprobado', 'rechazado', 'pendiente'],
    agentes: agentesRes.rows,
    plantillas: plantillasRes.rows,
    empleos: empleosRes.rows,
    pelotones: pelotonesRes.rows,
  };
};

exports.listPeriodos = async (arsId, filters) => {
  const where = ['p.ars_unidad_id = $1'];
  const params = [arsId];
  const fechaServicio = normalizeIsoDateStrict(filters && filters.fecha_servicio);

  if (filters && filters.estado) {
    params.push(String(filters.estado).trim().toLowerCase());
    where.push(`p.estado = $${params.length}`);
  }
  if (filters && Number(filters.agente_id) > 0) {
    params.push(Number(filters.agente_id));
    where.push(`p.agente_id = $${params.length}`);
  }

  const result = await db.query(
        `SELECT
        p.id,
        p.agente_id,
        p.plantilla_id,
        p.periodo_inicio,
        p.periodo_fin,
        p.vencimiento,
        p.estado,
        p.objetivo_total,
        p.completado_total,
        p.sancionado,
        p.sancion_notas,

        -- AGENTE
        a.tip,
        a.nombre,
        a.apellido_1,
        a.apellido_2,
        a.escalafon,
        a.empleo_id,
        ae.descripcion AS empleo_nombre,
        ae.color AS color_empleo,

        a.peloton_id,
        ap.descripcion AS peloton_nombre,
        ap.color AS color_peloton,

        -- PLANTILLA
        t.nombre AS plantilla_nombre,
        t.tipo_requisito,
        t.periodicidad,
        t.requiere_aprobacion,
        t.plazo_dias,

        -- JSON
        COALESCE(obj.objetivos, '[]'::jsonb)   AS objetivos,
        COALESCE(ej.ejecuciones, '[]'::jsonb)  AS ejecuciones

    FROM agentes_requisitos_periodos p

    INNER JOIN agentes a
        ON a.id = p.agente_id
      AND a.ars_unidad_id = p.ars_unidad_id

    INNER JOIN agentes_requisitos_plantillas t
        ON t.id = p.plantilla_id
      AND t.ars_unidad_id = p.ars_unidad_id

    LEFT JOIN agentes_empleo ae
        ON ae.id_empleo = a.empleo_id

    LEFT JOIN agentes_peloton ap
        ON ap.id_peloton = a.peloton_id

    -- OBJETIVOS
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(
            jsonb_build_object(
                'subtipo',  po.subtipo,
                'objetivo', po.objetivo,
                'orden',    po.orden
            )
            ORDER BY po.orden, po.subtipo
        ) AS objetivos

        FROM agentes_requisitos_plantilla_objetivos po

        WHERE po.plantilla_id = t.id

    ) obj ON TRUE

    -- EJECUCIONES
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id',             e.id,
                'subtipo',        e.subtipo,
                'cantidad',       e.cantidad,
                'resultado',      e.resultado,
                'fecha_prueba',   e.fecha_prueba,
                'observaciones',  e.observaciones
            )
            ORDER BY e.fecha_prueba DESC, e.id DESC
        ) AS ejecuciones

        FROM agentes_requisitos_ejecuciones e

        WHERE e.periodo_id = p.id
          AND e.ars_unidad_id = p.ars_unidad_id

    ) ej ON TRUE

    WHERE ${where.join(' AND ')}
          ORDER BY a.escalafon, a.apellido_1, a.apellido_2, a.nombre, p.periodo_fin DESC, p.id DESC`,
        params
      );

  const baseRows = result.rows.map((row) => {
    const objetivo = Number(row.objetivo_total) || 0;
    const completado = Number(row.completado_total) || 0;
    const progressPct = objetivo > 0 ? Math.min(100, Math.round((completado * 100) / objetivo)) : 0;

    const objetivos = Array.isArray(row.objetivos) ? row.objetivos : [];
    const ejecuciones = Array.isArray(row.ejecuciones) ? row.ejecuciones : [];
    const completadoPorSubtipo = new Map();

    ejecuciones.forEach((e) => {
      if (String(e && e.resultado || '').toLowerCase() !== 'aprobado') return;
      const subtipo = String((e && e.subtipo) || '').trim();
      if (!subtipo) return;
      const actual = Number(completadoPorSubtipo.get(subtipo) || 0);
      completadoPorSubtipo.set(subtipo, actual + Number((e && e.cantidad) || 0));
    });

    const subtiposEstado = objetivos.map((o) => {
      const subtipo = String((o && o.subtipo) || '').trim();
      const obj = Number((o && o.objetivo) || 0);
      const done = Number(completadoPorSubtipo.get(subtipo) || 0);
      return {
        subtipo,
        objetivo: obj,
        completado: done,
        cumple: done >= obj,
      };
    });

    return {
      ...row,
      progress_pct: String(progressPct)+'%',
      subtipos_estado: subtiposEstado,
      cumple_subtipos: subtiposEstado.every((s) => s.cumple),
    };
  });

  if (!fechaServicio) {
    return baseRows.map((row) => ({
      ...row,
      servicio_fecha: null,
      servicio_asignaciones: [],
      servicio_labels: '',
    }));
  }

  const agenteIds = baseRows.map((row) => Number(row.agente_id || 0));
  const serviciosByAgente = await getServiciosAsignadosPorAgente(arsId, fechaServicio, agenteIds);

  return baseRows.map((row) => {
    const agenteId = Number(row.agente_id || 0);
    const servicios = serviciosByAgente.get(agenteId) || [];
    const servicioLabels = servicios
      .map((s) => {
        const codigo = String((s && s.codigo) || '').trim();
        const nombre = String((s && s.nombre) || '').trim();
        return codigo || nombre;
      })
      .filter(Boolean)
      .join(' | ');

    return {
      ...row,
      servicio_fecha: fechaServicio,
      servicio_asignaciones: servicios,
      servicio_labels: servicioLabels,
    };
  });
};

exports.listPlantillas = async (arsId, options) => {
  const includeInactive = !!(options && options.include_inactive);
  const where = ['p.ars_unidad_id = $1'];
  const params = [arsId];

  if (!includeInactive) {
    where.push('p.activo = true');
  }

  const result = await db.query(
    `SELECT p.*,
            COALESCE(obj.objetivos, '[]'::json) AS objetivos
       FROM agentes_requisitos_plantillas p
       LEFT JOIN LATERAL (
         SELECT json_agg(
                  json_build_object(
                    'subtipo', po.subtipo,
                    'objetivo', po.objetivo,
                    'orden', po.orden
                  )
                  ORDER BY po.orden, po.subtipo
                ) AS objetivos
           FROM agentes_requisitos_plantilla_objetivos po
          WHERE po.plantilla_id = p.id
       ) obj ON TRUE
      WHERE ${where.join(' AND ')}
      ORDER BY p.activo DESC, p.nombre`,
    params
  );

  return result.rows;
};

exports.createPlantilla = async (arsId, payload, userId) => {
  const periodicidad = normalizePeriodicidad(payload.periodicidad);
  const manualBounds = normalizeManualBounds(payload.fecha_inicio_manual, payload.fecha_fin_manual);
  const objetivos = Array.isArray(payload.objetivos) ? payload.objetivos : [];

  const sumObjetivos = objetivos.reduce((acc, it) => acc + (Number(it.objetivo) || 0), 0);
  if (sumObjetivos !== Number(payload.objetivo_total)) {
    throw new Error('La suma de objetivos por subtipo debe coincidir con el objetivo total.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");

    const inserted = await client.query(
      `INSERT INTO agentes_requisitos_plantillas
        (ars_unidad_id, nombre, descripcion, periodicidad, tipo_requisito, objetivo_total, requiere_aprobacion, plazo_dias, fecha_inicio_manual, fecha_fin_manual, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *`,
      [
        arsId,
        String(payload.nombre || '').trim(),
        payload.descripcion == null ? null : String(payload.descripcion).trim(),
        periodicidad,
        String(payload.tipo_requisito || '').trim(),
        Number(payload.objetivo_total),
        payload.requiere_aprobacion === true,
        payload.plazo_dias == null ? null : Number(payload.plazo_dias),
        manualBounds.inicio,
        manualBounds.fin,
        userId,
      ]
    );

    const plantilla = inserted.rows[0];

    for (let i = 0; i < objetivos.length; i += 1) {
      const item = objetivos[i];
      await client.query(
        `INSERT INTO agentes_requisitos_plantilla_objetivos
          (plantilla_id, subtipo, objetivo, orden)
         VALUES ($1,$2,$3,$4)`,
        [
          plantilla.id,
          String(item.subtipo || '').trim(),
          Number(item.objetivo),
          Number(item.orden || i),
        ]
      );
    }

    await client.query('COMMIT');
    return plantilla;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && error.code === '23505') {
      throw new Error('Ya existe una plantilla con ese nombre en la ARS activa.');
    }
    throw error;
  } finally {
    client.release();
  }
};

exports.updatePlantilla = async (arsId, plantillaId, payload, userId) => {
  const periodicidad = normalizePeriodicidad(payload.periodicidad);
  const manualBounds = normalizeManualBounds(payload.fecha_inicio_manual, payload.fecha_fin_manual);
  const objetivos = Array.isArray(payload.objetivos) ? payload.objetivos : [];

  const sumObjetivos = objetivos.reduce((acc, it) => acc + (Number(it.objetivo) || 0), 0);
  if (sumObjetivos !== Number(payload.objetivo_total)) {
    throw new Error('La suma de objetivos por subtipo debe coincidir con el objetivo total.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");

    const updated = await client.query(
      `UPDATE agentes_requisitos_plantillas
          SET nombre = $1,
              descripcion = $2,
              periodicidad = $3,
              tipo_requisito = $4,
              objetivo_total = $5,
              requiere_aprobacion = $6,
              plazo_dias = $7,
              fecha_inicio_manual = $8,
              fecha_fin_manual = $9,
              activo = $10,
              updated_by = $11,
              updated_at = now(),
              revision = revision + 1
        WHERE id = $12 AND ars_unidad_id = $13
        RETURNING *`,
      [
        String(payload.nombre || '').trim(),
        payload.descripcion == null ? null : String(payload.descripcion).trim(),
        periodicidad,
        String(payload.tipo_requisito || '').trim(),
        Number(payload.objetivo_total),
        payload.requiere_aprobacion === true,
        payload.plazo_dias == null ? null : Number(payload.plazo_dias),
        manualBounds.inicio,
        manualBounds.fin,
        payload.activo !== false,
        userId,
        plantillaId,
        arsId,
      ]
    );

    if (!updated.rows.length) {
      throw new Error('Plantilla no encontrada.');
    }

    await client.query(
      `DELETE FROM agentes_requisitos_plantilla_objetivos
        WHERE plantilla_id = $1`,
      [plantillaId]
    );

    for (let i = 0; i < objetivos.length; i += 1) {
      const item = objetivos[i];
      await client.query(
        `INSERT INTO agentes_requisitos_plantilla_objetivos
          (plantilla_id, subtipo, objetivo, orden)
         VALUES ($1,$2,$3,$4)`,
        [
          plantillaId,
          String(item.subtipo || '').trim(),
          Number(item.objetivo),
          Number(item.orden || i),
        ]
      );
    }

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && error.code === '23505') {
      throw new Error('Ya existe una plantilla con ese nombre en la ARS activa.');
    }
    throw error;
  } finally {
    client.release();
  }
};

exports.deletePlantilla = async (arsId, plantillaId, userId) => {
  const result = await db.query(
    `UPDATE agentes_requisitos_plantillas
        SET activo = false,
            updated_by = $1,
            updated_at = now(),
            revision = revision + 1
      WHERE id = $2 AND ars_unidad_id = $3
      RETURNING *`,
    [userId, plantillaId, arsId]
  );

  if (!result.rows.length) {
    throw new Error('Plantilla no encontrada para eliminar.');
  }

  return result.rows[0];
};

async function registerEjecucionForPeriodo(client, arsId, periodoId, payload, userId) {
  const periodoRes = await client.query(
    `SELECT p.*, t.id AS plantilla_id
       FROM agentes_requisitos_periodos p
       JOIN agentes_requisitos_plantillas t
         ON t.id = p.plantilla_id
        AND t.ars_unidad_id = p.ars_unidad_id
      WHERE p.id = $1 AND p.ars_unidad_id = $2`,
    [periodoId, arsId]
  );
  if (!periodoRes.rows.length) {
    throw new Error('Período no encontrado.');
  }

  const periodo = periodoRes.rows[0];
  const subtipo = String(payload.subtipo || '').trim();
  const cantidad = Number(payload.cantidad || 1);

  const objetivoRes = await client.query(
    `SELECT objetivo
       FROM agentes_requisitos_plantilla_objetivos
      WHERE plantilla_id = $1 AND subtipo = $2`,
    [Number(periodo.plantilla_id), subtipo]
  );
  if (!objetivoRes.rows.length) {
    throw new Error('Subtipo no válido para la plantilla del período.');
  }

  const objetivoSubtipo = Number(objetivoRes.rows[0].objetivo || 0);
  const completadoRes = await client.query(
    `SELECT COALESCE(SUM(cantidad), 0)::int AS completado
       FROM agentes_requisitos_ejecuciones
      WHERE periodo_id = $1
        AND ars_unidad_id = $2
        AND subtipo = $3
        AND resultado = 'aprobado'`,
    [Number(periodoId), arsId, subtipo]
  );
  const completadoSubtipo = Number(completadoRes.rows[0] && completadoRes.rows[0].completado || 0);
  const pendienteSubtipo = Math.max(0, objetivoSubtipo - completadoSubtipo);

  if (cantidad > pendienteSubtipo) {
    throw new Error(
      'La cantidad para el subtipo "' +
        subtipo +
        '" no puede superar el pendiente (' +
        String(pendienteSubtipo) +
        ').'
    );
  }

  const fechaPrueba = payload.fecha_prueba
    ? DateTime.fromISO(String(payload.fecha_prueba), { zone: 'utc' }).toISO()
    : DateTime.utc().toISO();

  await client.query(
    `INSERT INTO agentes_requisitos_ejecuciones
      (ars_unidad_id, periodo_id, agente_id, subtipo, cantidad, fecha_prueba, resultado, evidencia_url, observaciones, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      arsId,
      Number(periodoId),
      Number(periodo.agente_id),
      subtipo,
      cantidad,
      fechaPrueba,
      String(payload.resultado || 'aprobado').toLowerCase(),
      payload.evidencia_url == null ? null : String(payload.evidencia_url).trim(),
      payload.observaciones == null ? null : String(payload.observaciones).trim(),
      userId,
    ]
  );

  return refreshPeriodoStatus(client, Number(periodoId), arsId, userId);
}

exports.assignPlantilla = async (arsId, payload, userId) => {
  const plantillaId = Number(payload.plantilla_id);
  const agenteIds = Array.from(new Set((payload.agente_ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)));
  if (!agenteIds.length) {
    throw new Error('Debe indicar al menos un agente.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");

    const plantillaRes = await client.query(
      `SELECT *
         FROM agentes_requisitos_plantillas
        WHERE id = $1 AND ars_unidad_id = $2 AND activo = true`,
      [plantillaId, arsId]
    );
    if (!plantillaRes.rows.length) {
      throw new Error('Plantilla no encontrada o inactiva.');
    }

    const plantilla = plantillaRes.rows[0];
    const manualInicio = plantilla.fecha_inicio_manual == null ? '' : String(plantilla.fecha_inicio_manual).trim();
    const manualFin = plantilla.fecha_fin_manual == null ? '' : String(plantilla.fecha_fin_manual).trim();
    const hasManualBounds = !!manualInicio && !!manualFin;
    const bounds = hasManualBounds
      ? { inicio: manualInicio, fin: manualFin }
      : getPeriodoBounds(plantilla.periodicidad, payload.fecha_referencia);
    const vencimiento = plantilla.plazo_dias
      ? DateTime.fromISO(bounds.inicio, { zone: 'utc' }).plus({ days: Number(plantilla.plazo_dias) }).endOf('day').toISO()
      : null;

    let created = 0;
    let skipped = 0;

    for (let i = 0; i < agenteIds.length; i += 1) {
      const agenteId = agenteIds[i];

      const agenteRes = await client.query(
        `SELECT id
           FROM agentes
          WHERE id = $1 AND ars_unidad_id = $2 AND fecha_baja IS NULL`,
        [agenteId, arsId]
      );
      if (!agenteRes.rows.length) {
        skipped += 1;
        continue;
      }

      const ins = await client.query(
        `INSERT INTO agentes_requisitos_periodos
          (ars_unidad_id, plantilla_id, agente_id, periodo_inicio, periodo_fin, objetivo_total, vencimiento, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
         ON CONFLICT (ars_unidad_id, plantilla_id, agente_id, periodo_inicio, periodo_fin)
         DO NOTHING
         RETURNING id`,
        [
          arsId,
          plantillaId,
          agenteId,
          bounds.inicio,
          bounds.fin,
          Number(plantilla.objetivo_total),
          vencimiento,
          userId,
        ]
      );

      if (ins.rows.length) created += 1;
      else skipped += 1;
    }

    await client.query('COMMIT');
    return {
      total: agenteIds.length,
      created,
      skipped,
      periodo_inicio: bounds.inicio,
      periodo_fin: bounds.fin,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

exports.registerEjecucion = async (arsId, payload, userId) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");

    const updatedPeriodo = await registerEjecucionForPeriodo(
      client,
      arsId,
      Number(payload.periodo_id),
      payload,
      userId
    );

    await client.query('COMMIT');
    return updatedPeriodo;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

exports.registerEjecucionBulk = async (arsId, payload, userId) => {
  const periodoIds = Array.from(
    new Set((payload.periodo_ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (!periodoIds.length) {
    throw new Error('Debe indicar al menos un período.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < periodoIds.length; i += 1) {
      const periodoId = periodoIds[i];
      try {
        await registerEjecucionForPeriodo(client, arsId, periodoId, payload, userId);
        created += 1;
      } catch (error) {
        skipped += 1;
        errors.push({ periodo_id: periodoId, error: error.message || 'Error no controlado' });
      }
    }

    await client.query('COMMIT');
    return {
      total: periodoIds.length,
      created,
      skipped,
      errors,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

exports.registerEjecucionMulti = async (arsId, payload, userId) => {
  const periodoIds = Array.from(
    new Set((payload.periodo_ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  const items = Array.isArray(payload.items)
    ? payload.items
      .map((it) => ({
        subtipo: String((it && it.subtipo) || '').trim(),
        cantidad: Number((it && it.cantidad) || 0),
      }))
      .filter((it) => it.subtipo && Number.isFinite(it.cantidad) && it.cantidad > 0)
    : [];

  if (!periodoIds.length) {
    throw new Error('Debe indicar al menos un período.');
  }
  if (!items.length) {
    throw new Error('Debe indicar al menos un subobjetivo con cantidad mayor que 0.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < periodoIds.length; i += 1) {
      const periodoId = periodoIds[i];
      for (let j = 0; j < items.length; j += 1) {
        const item = items[j];
        try {
          await registerEjecucionForPeriodo(
            client,
            arsId,
            periodoId,
            {
              subtipo: item.subtipo,
              cantidad: item.cantidad,
              fecha_prueba: payload.fecha_prueba,
              resultado: payload.resultado,
              evidencia_url: payload.evidencia_url,
              observaciones: payload.observaciones,
            },
            userId
          );
          created += 1;
        } catch (error) {
          skipped += 1;
          errors.push({
            periodo_id: periodoId,
            subtipo: item.subtipo,
            error: error.message || 'Error no controlado',
          });
        }
      }
    }

    await client.query('COMMIT');
    return {
      total_periodos: periodoIds.length,
      total_items: items.length,
      total_intentos: periodoIds.length * items.length,
      created,
      skipped,
      errors,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

exports.sancionarPeriodo = async (arsId, payload, userId) => {
  const periodoId = Number(payload.periodo_id);
  const notas = String(payload.sancion_notas || '').trim();

  const result = await db.query(
    `UPDATE agentes_requisitos_periodos
        SET sancionado = true,
            sancion_notas = $1,
            estado = 'sancionado',
            updated_by = $2,
            updated_at = now(),
            revision = revision + 1
      WHERE id = $3 AND ars_unidad_id = $4
      RETURNING *`,
    [notas, userId, periodoId, arsId]
  );

  if (!result.rows.length) {
    throw new Error('Período no encontrado para sancionar.');
  }

  return result.rows[0];
};
