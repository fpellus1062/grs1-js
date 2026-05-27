const db = require('../config/db');

// ── Helpers ──────────────────────────────────────────────────

function buildFecha(anio, mes, dia) {
  const m = String(mes).padStart(2, '0');
  const d = String(dia).padStart(2, '0');
  return `${anio}-${m}-${d}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function logAccion(client, { anio, mes, accion, agente_id, dia, fecha, turno_id, observaciones, datos_anteriores, datos_nuevos, detalle, usuario_id, usuario_nombre }) {
  await client.query(
    `INSERT INTO asignaciones_log
       (anio, mes, accion, agente_id, dia, fecha, turno_id, observaciones, datos_anteriores, datos_nuevos, detalle, usuario_id, usuario_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [anio, mes, accion, agente_id || null, dia || null, fecha || null, turno_id || null,
     observaciones || null,
     datos_anteriores ? JSON.stringify(datos_anteriores) : null,
     datos_nuevos ? JSON.stringify(datos_nuevos) : null,
     detalle || null, usuario_id, usuario_nombre || null]
  );
}

async function upsertBorradorRow(client, { borrador_id, anio, mes, dia, fecha, agente_id, turno_id, observaciones, propietario_id }) {

    // Intentar UPDATE primero
    const updateRes = await client.query(
      `UPDATE asignaciones_borrador
       SET turno_id = $1, observaciones = $2, updated_at = now()
       WHERE borrador_id = $3 AND anio = $4 AND mes = $5 AND dia = $6 AND fecha = $7 AND agente_id = $8
       RETURNING id, borrador_id, anio, mes, dia, fecha::text AS fecha, agente_id, turno_id, observaciones, propietario_id, created_at, updated_at`,
      [turno_id, observaciones || null, borrador_id, anio, mes, dia, fecha, agente_id]
    );
    if (updateRes.rows.length > 0) {
      return updateRes.rows[0];
    }
    // Si no existe, hacer INSERT
    const insertRes = await client.query(
      `INSERT INTO asignaciones_borrador
         (borrador_id, anio, mes, dia, fecha, agente_id, turno_id, observaciones, propietario_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())
       RETURNING id,
                 borrador_id,
                 anio,
                 mes,
                 dia,
                 fecha::text AS fecha,
                 agente_id,
                 turno_id,
                 observaciones,
                 propietario_id,
                 created_at,
                 updated_at`,
      [borrador_id, anio, mes, dia, fecha, agente_id, turno_id, observaciones || null, propietario_id]
    );
    return insertRes.rows[0];
}

async function syncServicios(client, borradorId, actividad_ids) {
  await client.query(
    'DELETE FROM asignaciones_borrador_servicios WHERE asignacion_borrador_id = $1',
    [borradorId]
  );
  for (const actId of actividad_ids) {
    await client.query(
      `INSERT INTO asignaciones_borrador_servicios (asignacion_borrador_id, actividad_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [borradorId, actId]
    );
  }
}

async function getBorradorById(client, borradorId) {
  if (!borradorId) return null;
  const res = await client.query(
    'SELECT * FROM asignaciones_borradores WHERE id = $1',
    [borradorId]
  );
  return res.rows[0] || null;
}

async function getDefaultBorrador(client, anio, mes, propietarioId) {
  const res = await client.query(
    `SELECT *
     FROM asignaciones_borradores
     WHERE anio = $1 AND mes = $2 AND propietario_id = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [anio, mes, propietarioId]
  );

  return res.rows[0] || null;
}

async function resolveBorrador(client, { anio, mes, borrador_id, user, autoCreate }) {
  if (borrador_id) {
    const byId = await getBorradorById(client, Number(borrador_id));
    if (!byId) throw new Error('El borrador seleccionado no existe');
    return byId;
  }

  const existing = await getDefaultBorrador(client, anio, mes, user.id);
  if (existing) return existing;

  if (!autoCreate) return null;
  const created = await createBorradorTx(client, { anio, mes, nombre: 'Borrador' }, user);
  return created;
}

async function createBorradorTx(client, data, user) {
  const { anio, mes, nombre, copia_de_id } = data;
  const versionRes = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM asignaciones_borradores
     WHERE anio = $1 AND mes = $2 AND lower(nombre) = lower($3)`,
    [anio, mes, nombre]
  );
  const version = Number(versionRes.rows[0].next_version || 1);

  const ins = await client.query(
    `INSERT INTO asignaciones_borradores
       (anio, mes, nombre, version, estado, propietario_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'borrador',$5,now(),now())
     RETURNING *`,
    [anio, mes, nombre, version, user.id]
  );
  const borrador = ins.rows[0];

  // Copiar filas del borrador origen si se indicó
  if (copia_de_id) {
    await client.query(
      `INSERT INTO asignaciones_borrador
         (borrador_id, agente_id, anio, mes, dia, fecha,
          turno_id, observaciones, propietario_id, created_at, updated_at)
       SELECT $1, agente_id, $2, $3, dia, fecha,
              turno_id, observaciones, $4, now(), now()
       FROM asignaciones_borrador
       WHERE borrador_id = $5`,
      [borrador.id, anio, mes, user.id, copia_de_id]
    );

    await client.query(
      `INSERT INTO asignaciones_borrador_servicios (asignacion_borrador_id, actividad_id)
       SELECT dest.id, srcs.actividad_id
       FROM asignaciones_borrador src
       JOIN asignaciones_borrador dest
         ON dest.borrador_id = $1
        AND dest.anio = $2
        AND dest.mes = $3
        AND dest.agente_id = src.agente_id
        AND dest.dia = src.dia
       JOIN asignaciones_borrador_servicios srcs
         ON srcs.asignacion_borrador_id = src.id
       WHERE src.borrador_id = $4
       ON CONFLICT DO NOTHING`,
      [borrador.id, anio, mes, copia_de_id]
    );
  }

  return borrador;
}

exports.getBorradores = async (anio, mes, user) => {
  const res = await db.query(
    `SELECT b.*,
            COALESCE(
              NULLIF(to_jsonb(u)->>'username', ''),
              NULLIF(to_jsonb(u)->>'usuario', ''),
              NULLIF(to_jsonb(u)->>'nombre', ''),
              NULLIF(to_jsonb(u)->>'email', ''),
              ('#' || b.propietario_id::text)
            ) AS propietario_username
     FROM asignaciones_borradores b
     LEFT JOIN usuarios u ON u.id = b.propietario_id
     WHERE b.anio = $1 AND b.mes = $2 AND (b.propietario_id = $3 OR b.estado = 'validado')
     ORDER BY b.updated_at DESC, b.id DESC`,
    [anio, mes, user.id]
  );
  return res.rows;
};

exports.createBorrador = async (data, user) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const borrador = await createBorradorTx(client, data, user);
    await client.query('COMMIT');
    return borrador;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Obtener cuadrante del mes (borrador + definitivo) ────────

exports.getCuadrante = async (anio, mes, borradorId, user) => {
  const client = await db.connect();
  try {
    const borrador = await resolveBorrador(client, {
      anio,
      mes,
      borrador_id: borradorId,
      user,
      autoCreate: false
    });
    const control = borrador
      ? { estado: borrador.estado || 'borrador', borrador_id: borrador.id, nombre: borrador.nombre, version: borrador.version }
      : { estado: 'sin_borrador', borrador_id: null };

    // Borrador: filtrar por periodo de asignación (anio, mes, dia=1)
    let borradorRows = [];
    if (borrador) {
      const borradorRes = await client.query(
                `SELECT 
            ab.id,
            ab.borrador_id,
            ab.anio,
            ab.mes,
            ab.dia,
            ab.fecha::text AS fecha,
            ab.agente_id,
            ab.turno_id,
            ab.observaciones,
            ab.propietario_id,
            ab.created_at,
            ab.updated_at,

            t.codigo AS turno_codigo,
            t.color AS turno_color,
            t.nombre AS turno_nombre,

            ag.nombre AS agente_nombre,
            ag.apellido_1 AS agente_apellido1,
            ag.apellido_2 AS agente_apellido2,
            ag.tip AS agente_tip,
            ag.orden_gc,
            ag.pei,
            ag.paef,
            ag.aptitudes,
            ag.comentarios,

            e.descripcion AS empleo_nombre,
            p.id_peloton AS peloton_codigo,
            p.descripcion AS peloton_nombre,
            p.color AS peloton_color,
            s.descripcion AS situacion_nombre,
            e.color AS color_empleo,
            p.color AS color_peloton,
            s.color AS color_situacion

        FROM asignaciones_borrador ab

        JOIN agentes ag 
            ON ag.id = ab.agente_id

        JOIN turnos t 
            ON t.id_turno = ab.turno_id

        LEFT JOIN agentes_empleo e 
            ON e.id_empleo = ag.empleo_id

        LEFT JOIN agentes_peloton p 
            ON p.id_peloton = ag.peloton_id

        LEFT JOIN agentes_situacion s 
            ON s.id_situacion = ag.situacion_id
          WHERE ab.borrador_id = $1 AND ab.anio = $2 AND ab.mes = $3 AND ab.dia = 1
        ORDER BY 
            ag.apellido_1,
            ag.apellido_2,
            ag.nombre,
            ab.fecha;`,
        [borrador.id, anio, mes],
      );
      borradorRows = borradorRes.rows;
    }
 
  const borradorIds = borradorRows.map(r => r.id);
  let borradorServicios = [];
  if (borradorIds.length > 0) {
    const servRes = await client.query(
      `SELECT bs.asignacion_borrador_id, bs.actividad_id, a.actividad AS actividad_codigo, a.nombre AS actividad_nombre
       FROM asignaciones_borrador_servicios bs
       JOIN actividades a ON a.id_actividad = bs.actividad_id
       WHERE bs.asignacion_borrador_id = ANY($1)`,
      [borradorIds]
    );
    borradorServicios = servRes.rows;
  }

  // Definitivo: filtrar por periodo de asignación (anio, mes, dia=1)
  const definitivoRes = await client.query(
      `SELECT asig.id,
        asig.anio,
        asig.mes,
        asig.dia,
        asig.fecha::text AS fecha,
        asig.agente_id,
        asig.turno_id,
        asig.observaciones,
        asig.propietario_id,
        asig.validado_por,
        asig.validado_at,
        asig.created_at,
        t.codigo AS turno_codigo, t.color AS turno_color, t.nombre AS turno_nombre,
            ag.nombre AS agente_nombre, ag.apellido_1 AS agente_apellido1, ag.apellido_2 AS agente_apellido2,
            ag.tip AS agente_tip, ag.empleo_id, ag.peloton_id, ag.situacion_id
     FROM asignaciones asig
     JOIN turnos t ON t.id_turno = asig.turno_id
     JOIN agentes ag ON (
       NULLIF(to_jsonb(ag)->>'id_agente', '')::int = asig.agente_id
       OR NULLIF(to_jsonb(ag)->>'id', '')::int = asig.agente_id
     )
     WHERE asig.anio = $1 AND asig.mes = $2 AND asig.dia = 1
     ORDER BY ag.apellido_1, ag.apellido_2, ag.nombre, asig.fecha`,
    [anio, mes]
  );

  const definitivoIds = definitivoRes.rows.map(r => r.id);
  let definitivoServicios = [];
  if (definitivoIds.length > 0) {
    const servRes = await client.query(
      `SELECT s.asignacion_id, s.actividad_id, a.actividad AS actividad_codigo, a.nombre AS actividad_nombre
       FROM asignaciones_servicios s
       JOIN actividades a ON a.id_actividad = s.actividad_id
       WHERE s.asignacion_id = ANY($1)`,
      [definitivoIds]
    );
    definitivoServicios = servRes.rows;
  }

    return {
      control,
      borrador: borradorRows,
      selectedBorrador: borrador,
      borradorServicios,
      definitivo: definitivoRes.rows,
      definitivoServicios
    };
  } finally {
    client.release();
  }
};

// ── Upsert individual ────────────────────────────────────────

exports.upsert = async (data, user) => {
  const { anio, mes, borrador_id, agente_id, dia, fecha: fechaRaw, turno_id, actividad_ids, observaciones } = data;
  // Siempre usar el periodo de cabecera recibido (anio, mes, dia=1) y la fecha real en la columna fecha
  const periodoAnio = Number(anio);
  const periodoMes = Number(mes);
  const periodoDia = 1; // Siempre 1 para el periodo
  const fecha = fechaRaw
    ? (fechaRaw instanceof Date ? fechaRaw.toISOString().slice(0, 10) : String(fechaRaw).slice(0, 10))
    : buildFecha(periodoAnio, periodoMes, periodoDia);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Siempre autoCreate: true para crear el borrador si no existe
    const borrador = await resolveBorrador(client, {
      anio: periodoAnio,
      mes: periodoMes,
      borrador_id,
      user,
      autoCreate: true
    });

    // Si no hay borrador, lanzar error explícito
    if (!borrador || !borrador.id) {
      throw new Error('No se pudo crear o recuperar el borrador');
    }

    // Obtener dato anterior para log
    let prev = null;
    if (borrador && borrador.id) {
      const prevRes = await client.query(
        `SELECT ab.*, array_agg(bs.actividad_id) AS prev_actividades
         FROM asignaciones_borrador ab
         LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
         WHERE ab.borrador_id=$1 AND ab.anio=$2 AND ab.mes=$3 AND ab.agente_id=$4 AND ab.dia=$5
         GROUP BY ab.id`,
        [borrador.id, periodoAnio, periodoMes, agente_id, periodoDia]
      );
      prev = prevRes.rows[0] || null;
    }

    const row = await upsertBorradorRow(client, {
      borrador_id: borrador.id,
      anio: periodoAnio,
      mes: periodoMes,
      dia: periodoDia,
      fecha,
      agente_id,
      turno_id,
      observaciones,
      propietario_id: user.id
    });

    await syncServicios(client, row.id, actividad_ids);

    await logAccion(client, {
      anio: periodoAnio,
      mes: periodoMes,
      accion: prev ? 'BORRADOR_EDITAR' : 'BORRADOR_CREAR',
      agente_id,
      dia: periodoDia,
      fecha,
      turno_id,
      observaciones,
      datos_anteriores: prev ? { turno_id: prev.turno_id, observaciones: prev.observaciones, actividad_ids: prev.prev_actividades } : null,
      datos_nuevos: { turno_id, observaciones, actividad_ids },
      detalle: (prev ? 'Edición de asignación en borrador' : 'Nueva asignación en borrador') + ' [' + (borrador.nombre || '') + ' v' + (borrador.version || '') + ']',
      usuario_id: user.id,
      usuario_nombre: user.nombre || user.username
    });

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Bulk (varios agentes + varios días) ──────────────────────

exports.bulk = async (data, user) => {
  // Ahora se espera que 'dias' sea un array de fechas reales (YYYY-MM-DD)
  const { anio, mes, borrador_id, agente_ids, dias, turno_id, actividad_ids, observaciones } = data;
  const client = await db.connect();
  let count = 0;

  try {
    await client.query('BEGIN');
    const borrador = await resolveBorrador(client, {
      anio,
      mes,
      borrador_id,
      user,
      autoCreate: true
    });

    for (const agente_id of agente_ids) {
      for (const fecha of dias) {
        // anio, mes, dia=1 como periodo; fecha es la real
        const row = await upsertBorradorRow(client, {
          borrador_id: borrador.id,
          anio, mes, dia: 1, fecha, agente_id, turno_id, observaciones,
          propietario_id: user.id
        });

        await syncServicios(client, row.id, actividad_ids);
        count++;
      }
    }

    await logAccion(client, {
      anio, mes,
      accion: 'BORRADOR_BULK',
      datos_nuevos: { agente_ids, dias, turno_id, actividad_ids, observaciones },
      detalle: `Asignación bulk (${borrador.nombre} v${borrador.version}): ${agente_ids.length} agentes × ${dias.length} fechas = ${count} celdas`,
      usuario_id: user.id,
      usuario_nombre: user.nombre || user.username
    });

    await client.query('COMMIT');
    return { count };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Eliminar del borrador ────────────────────────────────────

exports.deleteBorrador = async (data, user) => {
  const { anio, mes, borrador_id, agente_ids, dias, fechas } = data;
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const borrador = await resolveBorrador(client, {
      anio,
      mes,
      borrador_id,
      user,
      autoCreate: false
    });
    if (!borrador) {
      throw new Error('No hay borrador seleccionado');
    }

    const fechasObjetivo = Array.isArray(fechas) && fechas.length
      ? Array.from(new Set(fechas.map(function (f) { return String(f).slice(0, 10); })))
      : null;

    // Obtener datos previos para log
    let prevRes;
    let result;

    if (fechasObjetivo && fechasObjetivo.length) {
      prevRes = await client.query(
        `SELECT ab.id,
                ab.borrador_id,
                ab.anio,
                ab.mes,
                ab.dia,
                ab.fecha::text AS fecha,
                ab.agente_id,
                ab.turno_id,
                ab.observaciones,
                ab.propietario_id,
                ab.created_at,
                ab.updated_at,
                array_agg(bs.actividad_id) AS prev_actividades
         FROM asignaciones_borrador ab
         LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
         WHERE ab.borrador_id=$1
           AND ab.agente_id = ANY($2)
           AND ab.fecha::text = ANY($3)
         GROUP BY ab.id`,
        [borrador.id, agente_ids, fechasObjetivo]
      );

      result = await client.query(
        `DELETE FROM asignaciones_borrador
         WHERE borrador_id=$1
           AND agente_id = ANY($2)
           AND fecha::text = ANY($3)
         RETURNING id`,
        [borrador.id, agente_ids, fechasObjetivo]
      );
    } else {
      prevRes = await client.query(
        `SELECT ab.id,
                ab.borrador_id,
                ab.anio,
                ab.mes,
                ab.dia,
                ab.fecha::text AS fecha,
                ab.agente_id,
                ab.turno_id,
                ab.observaciones,
                ab.propietario_id,
                ab.created_at,
                ab.updated_at,
                array_agg(bs.actividad_id) AS prev_actividades
         FROM asignaciones_borrador ab
         LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
         WHERE ab.borrador_id=$1 AND ab.anio=$2 AND ab.mes=$3 AND ab.agente_id = ANY($4) AND ab.dia = ANY($5)
         GROUP BY ab.id`,
        [borrador.id, anio, mes, agente_ids, dias]
      );

      result = await client.query(
        `DELETE FROM asignaciones_borrador
         WHERE borrador_id=$1 AND anio=$2 AND mes=$3 AND agente_id = ANY($4) AND dia = ANY($5)
         RETURNING id`,
        [borrador.id, anio, mes, agente_ids, dias]
      );
    }

    await logAccion(client, {
      anio, mes,
      accion: 'BORRADOR_ELIMINAR',
      datos_anteriores: prevRes.rows,
      detalle: `Eliminados ${result.rowCount} registros del borrador ${borrador.nombre} v${borrador.version}`,
      usuario_id: user.id,
      usuario_nombre: user.nombre || user.username
    });

    await client.query('COMMIT');
    return { deleted: result.rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Copiar mes ───────────────────────────────────────────────

exports.copiarMes = async (data, user) => {
  const { origen_anio, origen_mes, origen_borrador_id, destino_anio, destino_mes, destino_borrador_id, agente_ids, dias } = data;
  const client = await db.connect();
  let count = 0;

  try {
    await client.query('BEGIN');
    const destinoBorrador = await resolveBorrador(client, {
      anio: destino_anio,
      mes: destino_mes,
      borrador_id: destino_borrador_id,
      user,
      autoCreate: true
    });

    // Calcular días máximos del mes destino
    const maxDia = new Date(destino_anio, destino_mes, 0).getDate();

    // Obtener asignaciones origen (definitivas o borrador)
    let origenQuery = `
      SELECT asig.agente_id, asig.dia, asig.turno_id, asig.observaciones,
             array_agg(s.actividad_id) FILTER (WHERE s.actividad_id IS NOT NULL) AS actividad_ids
      FROM asignaciones asig
      LEFT JOIN asignaciones_servicios s ON s.asignacion_id = asig.id
      WHERE asig.anio = $1 AND asig.mes = $2`;
    const params = [origen_anio, origen_mes];

    if (agente_ids && agente_ids.length > 0) {
      params.push(agente_ids);
      origenQuery += ` AND asig.agente_id = ANY($${params.length})`;
    }
    if (dias && dias.length > 0) {
      params.push(dias);
      origenQuery += ` AND asig.dia = ANY($${params.length})`;
    }

    origenQuery += ' GROUP BY asig.agente_id, asig.dia, asig.turno_id, asig.observaciones';

    const origenRes = await client.query(origenQuery, params);

    // Si no hay definitivas, buscar en borrador (seleccionado o por defecto)
    let filas = origenRes.rows;
    if (filas.length === 0) {
      const origenBorrador = await resolveBorrador(client, {
        anio: origen_anio,
        mes: origen_mes,
        borrador_id: origen_borrador_id,
        user,
        autoCreate: false
      });
      if (!origenBorrador) {
        filas = [];
      } else {
      let borrQuery = `
        SELECT ab.agente_id, ab.dia, ab.turno_id, ab.observaciones,
               array_agg(bs.actividad_id) FILTER (WHERE bs.actividad_id IS NOT NULL) AS actividad_ids
        FROM asignaciones_borrador ab
        LEFT JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
        WHERE ab.borrador_id = $1 AND ab.anio = $2 AND ab.mes = $3`;
      const bParams = [origenBorrador.id, origen_anio, origen_mes];

      if (agente_ids && agente_ids.length > 0) {
        bParams.push(agente_ids);
        borrQuery += ` AND ab.agente_id = ANY($${bParams.length})`;
      }
      if (dias && dias.length > 0) {
        bParams.push(dias);
        borrQuery += ` AND ab.dia = ANY($${bParams.length})`;
      }

      borrQuery += ' GROUP BY ab.agente_id, ab.dia, ab.turno_id, ab.observaciones';
      const borrRes = await client.query(borrQuery, bParams);
      filas = borrRes.rows;
      }
    }

    for (const fila of filas) {
      if (fila.dia > maxDia) continue; // Día no existe en mes destino

      const fecha = buildFecha(destino_anio, destino_mes, fila.dia);

      const row = await upsertBorradorRow(client, {
        borrador_id: destinoBorrador.id,
        anio: destino_anio, mes: destino_mes, dia: fila.dia, fecha,
        agente_id: fila.agente_id, turno_id: fila.turno_id,
        observaciones: fila.observaciones,
        propietario_id: user.id
      });

      if (fila.actividad_ids && fila.actividad_ids.length > 0) {
        await syncServicios(client, row.id, fila.actividad_ids);
      }
      count++;
    }

    await logAccion(client, {
      anio: destino_anio, mes: destino_mes,
      accion: 'BORRADOR_COPIAR_MES',
      datos_nuevos: { origen_anio, origen_mes, destino_anio, destino_mes, agente_ids, dias },
      detalle: `Copiadas ${count} asignaciones a ${destinoBorrador.nombre} v${destinoBorrador.version} desde ${origen_anio}/${origen_mes}`,
      usuario_id: user.id,
      usuario_nombre: user.nombre || user.username
    });

    await client.query('COMMIT');
    return { count };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Validar borrador (pasar a definitivo) ────────────────────

exports.validar = async (data, user) => {
  const { borrador_id } = data;
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const borrador = await getBorradorById(client, Number(borrador_id));
    if (!borrador) throw new Error('El borrador seleccionado no existe');
    const anio = Number(borrador.anio);
    const mes = Number(borrador.mes);

    // Verificar que hay borrador
    const borradorCount = await client.query(
      'SELECT COUNT(*) AS total FROM asignaciones_borrador WHERE borrador_id=$1',
      [borrador.id]
    );
    if (parseInt(borradorCount.rows[0].total, 10) === 0) {
      throw new Error('No hay asignaciones en borrador para este período');
    }

    // Guardar definitivo anterior para log
    const prevDef = await client.query(
      'SELECT COUNT(*) AS total FROM asignaciones WHERE anio=$1 AND mes=$2',
      [anio, mes]
    );
    const hadPrevious = parseInt(prevDef.rows[0].total, 10) > 0;

    // Eliminar definitivo anterior + servicios (cascade)
    await client.query(
      'DELETE FROM asignaciones WHERE anio=$1 AND mes=$2',
      [anio, mes]
    );

    // Copiar borrador → definitivo (anio, mes, dia=1 como periodo, fecha como real)
    const insertRes = await client.query(
      `INSERT INTO asignaciones (anio, mes, dia, fecha, agente_id, turno_id, observaciones, propietario_id, validado_por, validado_at, created_at)
       SELECT anio, mes, 1, fecha, agente_id, turno_id, observaciones, propietario_id, $3, now(), now()
       FROM asignaciones_borrador
       WHERE borrador_id=$4 AND anio=$1 AND mes=$2 AND dia=1
       RETURNING id, agente_id, fecha`,
      [anio, mes, user.id, borrador.id]
    );

    // Copiar servicios borrador → definitivo
    for (const row of insertRes.rows) {
      await client.query(
        `INSERT INTO asignaciones_servicios (asignacion_id, actividad_id)
         SELECT $1, bs.actividad_id
         FROM asignaciones_borrador_servicios bs
         JOIN asignaciones_borrador ab ON ab.id = bs.asignacion_borrador_id
         WHERE ab.borrador_id=$2 AND ab.anio=$3 AND ab.mes=$4 AND ab.agente_id=$5 AND ab.dia=$6`,
        [row.id, borrador.id, anio, mes, row.agente_id, row.dia]
      );
    }

    await client.query(
      `UPDATE asignaciones_borradores
       SET estado='validado', validado_por=$2, validado_at=now(), updated_at=now()
       WHERE id=$1`,
      [borrador.id, user.id]
    );

    await logAccion(client, {
      anio, mes,
      accion: hadPrevious ? 'REVALIDAR' : 'VALIDAR',
      datos_nuevos: { total_asignaciones: insertRes.rowCount },
      detalle: hadPrevious
        ? `Revalidación con ${borrador.nombre} v${borrador.version}: reemplazadas asignaciones anteriores. ${insertRes.rowCount} asignaciones validadas.`
        : `Validación inicial con ${borrador.nombre} v${borrador.version}: ${insertRes.rowCount} asignaciones validadas.`,
      usuario_id: user.id,
      usuario_nombre: user.nombre || user.username
    });

    await client.query('COMMIT');
    return { validated: insertRes.rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Historial ────────────────────────────────────────────────

exports.getHistorial = async (query) => {
  const { anio, mes, agente_id, accion, page, limit } = query;
  const offset = (page - 1) * limit;

  let where = 'WHERE l.anio = $1 AND l.mes = $2';
  const params = [anio, mes];

  if (agente_id) {
    params.push(agente_id);
    where += ` AND l.agente_id = $${params.length}`;
  }
  if (accion) {
    params.push(accion);
    where += ` AND l.accion = $${params.length}`;
  }

  const countRes = await db.query(
    `SELECT COUNT(*) AS total FROM asignaciones_log l ${where}`,
    params
  );

  params.push(limit, offset);
  const dataRes = await db.query(
    `SELECT l.*, ag.nombre AS agente_nombre,
            ag.apellido_1 AS agente_apellido1,
            ag.apellido_2 AS agente_apellido2,
            ag.apellido_1 AS agente_apellido_1,
            ag.apellido_2 AS agente_apellido_2
     FROM asignaciones_log l
     LEFT JOIN agentes ag ON (
       NULLIF(to_jsonb(ag)->>'id_agente', '')::int = l.agente_id
       OR NULLIF(to_jsonb(ag)->>'id', '')::int = l.agente_id
     )
     ${where}
     ORDER BY l.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    logs: dataRes.rows,
    total: parseInt(countRes.rows[0].total, 10),
    page,
    limit
  };
};

// ── Metadatos para el formulario bulk ────────────────────────--primary-gc-color

exports.getMeta = async () => {
  const [turnosRes, actividadesRes, agentesRes, empleosRes, pelotonesRes, situacionesRes] = await Promise.all([
    db.query("SELECT id_turno, codigo, nombre, color FROM turnos WHERE baja_at IS NULL ORDER BY nombre"),
    db.query("SELECT id_actividad, actividad AS codigo, nombre FROM actividades ORDER BY nombre"),
        db.query(`SELECT ag.id AS id_agente, ag.nombre, ag.apellido_1, ag.apellido_2, ag.tip, 
          ag.empleo_id, ag.peloton_id, ag.situacion_id,
          ag.orden_gc, ag.pei, ag.paef, ag.aptitudes, ag.comentarios,
          e.descripcion AS empleo_nombre,
          p.id_peloton AS peloton_codigo, p.descripcion AS peloton_nombre, p.color AS peloton_color,
          s.descripcion AS situacion_nombre,
          e.color AS color_empleo,
          p.color AS color_peloton, s.color AS color_situacion
        FROM agentes ag
        LEFT JOIN agentes_empleo e ON e.id_empleo = ag.empleo_id
        LEFT JOIN agentes_peloton p ON p.id_peloton = ag.peloton_id
        LEFT JOIN agentes_situacion s ON s.id_situacion = ag.situacion_id
        ORDER BY ag.apellido_1, ag.apellido_2, ag.nombre`),
    db.query("SELECT id_empleo, descripcion AS nombre FROM agentes_empleo ORDER BY descripcion"),
    db.query("SELECT id_peloton, descripcion AS nombre FROM agentes_peloton ORDER BY descripcion"),
    db.query("SELECT id_situacion, descripcion AS nombre FROM agentes_situacion ORDER BY descripcion")
  ]);

  
  return {
    turnos: turnosRes.rows,
    actividades: actividadesRes.rows,
    agentes: agentesRes.rows,
    empleos: empleosRes.rows,
    pelotones: pelotonesRes.rows,
    situaciones: situacionesRes.rows
  };
};
