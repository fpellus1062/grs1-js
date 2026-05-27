const { DateTime } = require('luxon');
const db = require('../config/db');
const { generarCuadrante } = require('../utils/cuadranteGenerator');
const { withRetry } = require('../utils/retry');

// ── Helpers ──────────────────────────────────────────────────

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

function withRetryTx(fn, opts) {
  return withRetry(() => withTransaction(fn), opts);
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

function parseYmd(value, fieldName) {
  if (
    !value ||
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new Error(`${fieldName} inválida (formato esperado YYYY-MM-DD)`);
  }
  const dt = DateTime.fromISO(value, { zone: 'UTC' });
  if (!dt.isValid)
    throw new Error(`${fieldName} inválida: ${dt.invalidReason}`);
  return dt;
}

function parseReferencePeriod(anioReferenciaValue, mesReferenciaValue) {
  const anioReferencia = Number(anioReferenciaValue);
  const mesReferencia = Number(mesReferenciaValue);

  if (
    !Number.isInteger(anioReferencia) ||
    anioReferencia < 2000 ||
    anioReferencia > 2100
  ) {
    throw new Error('anio_referencia inválido');
  }
  if (
    !Number.isInteger(mesReferencia) ||
    mesReferencia < 1 ||
    mesReferencia > 12
  ) {
    throw new Error('mes_referencia inválido');
  }

  return { anioReferencia, mesReferencia };
}

function buildCuadranteFromRange(
  fechaInicioStr,
  fechaFinStr,
  anioReferenciaValue,
  mesReferenciaValue
) {
  const inicio = parseYmd(fechaInicioStr, 'fecha_inicio');
  const fin = parseYmd(fechaFinStr, 'fecha_fin');
  const { anioReferencia, mesReferencia } = parseReferencePeriod(
    anioReferenciaValue,
    mesReferenciaValue
  );

  if (inicio > fin)
    throw new Error('fecha_inicio no puede ser mayor que fecha_fin');
  // weekday: 1=lunes, 7=domingo (Luxon ISO weekday)
  if (inicio.weekday !== 1) throw new Error('fecha_inicio debe ser lunes');
  if (fin.weekday !== 7) throw new Error('fecha_fin debe ser domingo');

  // diff en días exactos, sin DST (zona UTC fija)
  const totalDias = fin.diff(inicio, 'days').days + 1;
  if (totalDias % 7 !== 0)
    throw new Error('El rango debe contener semanas completas');

  const numSemanas = totalDias / 7;
  if (numSemanas < 3 || numSemanas > 7) {
    throw new Error('El cuadrante debe tener entre 3 y 7 semanas');
  }

  const dias = [];
  let cur = inicio;
  let contieneMesReferencia = false;
  for (let sem = 1; sem <= numSemanas; sem++) {
    for (let dow = 1; dow <= 7; dow++) {
      const esDelMesRef =
        cur.month === mesReferencia && cur.year === anioReferencia;
      if (esDelMesRef) contieneMesReferencia = true;
      dias.push({
        fecha: cur.toISODate(),
        num_semana: sem,
        dia_semana: dow,
        es_del_mes_ref: esDelMesRef,
      });
      cur = cur.plus({ days: 1 });
    }
  }

  if (!contieneMesReferencia) {
    throw new Error(
      'El rango debe contener al menos un día del mes y año de referencia seleccionados'
    );
  }

  return {
    nombre: `${MESES_ES[mesReferencia - 1]} ${anioReferencia}`,
    fecha_inicio: inicio.toISODate(),
    fecha_fin: fin.toISODate(),
    num_semanas: numSemanas,
    mes_referencia: mesReferencia,
    anio_referencia: anioReferencia,
    dias,
  };
}

async function applyFestivosToCuadrante(cuadrante, arsUnidadId) {
  if (
    !cuadrante ||
    !Array.isArray(cuadrante.dias) ||
    !cuadrante.dias.length ||
    !arsUnidadId
  ) {
    return cuadrante;
  }

  function toIsoDate(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      const dtFromIso = DateTime.fromISO(value, { zone: 'UTC' });
      return dtFromIso.isValid ? dtFromIso.toISODate() : null;
    }
    if (value instanceof Date) {
      const dtFromJs = DateTime.fromJSDate(value, { zone: 'UTC' });
      return dtFromJs.isValid ? dtFromJs.toISODate() : null;
    }
    return null;
  }

  const fechaInicio = cuadrante.fecha_inicio;
  const fechaFin = cuadrante.fecha_fin;

  const { rows: festivos } = await db.query(
    `SELECT f.nombre, f.fecha::date AS fecha, f.es_recurrente, c.color
     FROM festivos f
     JOIN calendarios c ON c.id = f.calendario_id
     WHERE c.ars_unidad_id = $1
       AND c.activo = true
       AND (
         (NOT f.es_recurrente AND f.fecha BETWEEN $2::date AND $3::date)
         OR f.es_recurrente
       )`,
    [arsUnidadId, fechaInicio, fechaFin]
  );

  const exactByDate = new Map();
  const recurrentByMd = new Map();

  festivos.forEach((f) => {
    const fechaIso = toIsoDate(f.fecha);
    if (!fechaIso) return;

    if (f.es_recurrente) {
      const dt = DateTime.fromISO(fechaIso, { zone: 'UTC' });
      if (!dt.isValid) return;
      recurrentByMd.set(`${dt.month}-${dt.day}`, {
        nombre: f.nombre,
        color: f.color,
      });
      return;
    }

    exactByDate.set(fechaIso, { nombre: f.nombre, color: f.color });
  });

  cuadrante.dias = cuadrante.dias.map((d) => {
    const dt = DateTime.fromISO(d.fecha, { zone: 'UTC' });
    const mdKey = dt.isValid ? `${dt.month}-${dt.day}` : null;
    const festivoData =
      exactByDate.get(d.fecha) ||
      (mdKey ? recurrentByMd.get(mdKey) : null) ||
      null;
    const nombreFestivo = festivoData ? festivoData.nombre : null;
    const colorFestivo = festivoData ? festivoData.color : null;

    return {
      ...d,
      es_festivo: Boolean(nombreFestivo),
      nombre_festivo: nombreFestivo,
      color_festivo: colorFestivo,
    };
  });

  return cuadrante;
}

// ── Listar cuadrantes ────────────────────────────────────────

exports.getAll = async (arsUnidadId) => {
  const { rows } = await db.query(
    `SELECT cp.*, a.color AS ars_color
     FROM cuadrantes_planificacion cp
     LEFT JOIN ars a ON a.id_unidad = cp.ars_unidad_id
     WHERE cp.ars_unidad_id = $1
     ORDER BY cp.anio_referencia DESC, cp.mes_referencia DESC`,
    [arsUnidadId]
  );
  return rows;
};

// ── Obtener cuadrante con sus días ────────────────��──────────

exports.getById = async (id, arsUnidadId) => {
  const {
    rows: [cuadrante],
  } = await db.query(
    `SELECT * FROM cuadrantes_planificacion
     WHERE id = $1 AND ars_unidad_id = $2`,
    [id, arsUnidadId]
  );
  if (!cuadrante) throw new Error('Cuadrante no encontrado');

  const { rows: dias } = await db.query(
    `SELECT fecha, num_semana, dia_semana, es_del_mes_ref, es_festivo, nombre_festivo, color_festivo
     FROM cuadrantes_planificacion_dias
     WHERE cuadrante_id = $1
     ORDER BY fecha`,
    [id]
  );

  return { ...cuadrante, dias };
};

// ── Generar cuadrante (preview sin guardar) ──────────────────

exports.preview = async (
  anio,
  mes,
  numSemanas,
  fechaInicio,
  fechaFin,
  anioReferencia,
  mesReferencia,
  arsUnidadId
) => {
  let cuadrante;
  if (fechaInicio && fechaFin) {
    cuadrante = buildCuadranteFromRange(
      fechaInicio,
      fechaFin,
      anioReferencia,
      mesReferencia
    );
  } else {
    cuadrante = generarCuadrante(anio, mes, { numSemanas: numSemanas || null });
  }

  return applyFestivosToCuadrante(cuadrante, arsUnidadId);
};

// ── Crear cuadrante ──────────────────────────────────────────

exports.create = (data, user, arsUnidadId) => {
  const {
    anio,
    mes,
    num_semanas,
    fecha_inicio,
    fecha_fin,
    anio_referencia,
    mes_referencia,
    nombre,
    descripcion,
  } = data;

  return withRetryTx(async (client) => {
    // Generar estructura (por año/mes o por rango manual editable)
    let cuadrante;
    if (fecha_inicio || fecha_fin) {
      if (!fecha_inicio || !fecha_fin) {
        throw new Error('Debe indicar fecha_inicio y fecha_fin');
      }
      cuadrante = buildCuadranteFromRange(
        fecha_inicio,
        fecha_fin,
        anio_referencia,
        mes_referencia
      );
    } else {
      if (!anio || !mes) {
        throw new Error('anio y mes son obligatorios');
      }
      cuadrante = generarCuadrante(anio, mes, {
        numSemanas: num_semanas || null,
      });
    }

    const nombreFinal = nombre || cuadrante.nombre;

    // Insertar cabecera
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO cuadrantes_planificacion
         (ars_unidad_id, nombre, descripcion,
          fecha_inicio, fecha_fin, num_semanas,
          mes_referencia, anio_referencia, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        arsUnidadId,
        nombreFinal,
        descripcion || null,
        cuadrante.fecha_inicio,
        cuadrante.fecha_fin,
        cuadrante.num_semanas,
        cuadrante.mes_referencia,
        cuadrante.anio_referencia,
        user.id,
      ]
    );

    // Insertar días con unnest (1 query, no loop)
    if (cuadrante.dias.length) {
      await client.query(
        `INSERT INTO cuadrantes_planificacion_dias
           (cuadrante_id, fecha, num_semana, dia_semana, es_del_mes_ref)
         SELECT $1, unnest($2::date[]), unnest($3::smallint[]),
                unnest($4::smallint[]), unnest($5::boolean[])`,
        [
          row.id,
          cuadrante.dias.map((d) => d.fecha),
          cuadrante.dias.map((d) => d.num_semana),
          cuadrante.dias.map((d) => d.dia_semana),
          cuadrante.dias.map((d) => d.es_del_mes_ref),
        ]
      );
    }

    // Aplicar festivos del calendario de la ARS
    await client.query(
      `UPDATE cuadrantes_planificacion_dias d
       SET es_festivo = true, nombre_festivo = f.nombre, color_festivo = c.color
       FROM festivos f
       JOIN calendarios c ON c.id = f.calendario_id
       WHERE d.cuadrante_id = $1
         AND c.ars_unidad_id = $2
         AND c.activo = true
         AND (
           d.fecha = f.fecha
           OR (f.es_recurrente AND EXTRACT(MONTH FROM d.fecha) = EXTRACT(MONTH FROM f.fecha)
               AND EXTRACT(DAY FROM d.fecha) = EXTRACT(DAY FROM f.fecha))
         )`,
      [row.id, arsUnidadId]
    );

    // Leer el cuadrante recién insertado usando el mismo client (dentro del tx)
    const {
      rows: [cabecera],
    } = await client.query(
      `SELECT * FROM cuadrantes_planificacion WHERE id = $1`,
      [row.id]
    );
    const { rows: dias } = await client.query(
      `SELECT fecha, num_semana, dia_semana, es_del_mes_ref, es_festivo, nombre_festivo, color_festivo
       FROM cuadrantes_planificacion_dias
       WHERE cuadrante_id = $1
       ORDER BY fecha`,
      [row.id]
    );

    return { ...cabecera, dias };
  });
};

// ── Actualizar cuadrante ─────────────────────────────────────

exports.update = (id, data, arsUnidadId) => {
  const {
    nombre,
    descripcion,
    estado,
    fecha_inicio,
    fecha_fin,
    num_semanas,
    anio_referencia,
    mes_referencia,
  } = data;

  const wantsStructureUpdate = [
    fecha_inicio,
    fecha_fin,
    num_semanas,
    anio_referencia,
    mes_referencia,
  ].some((value) => value !== undefined && value !== null && value !== '');

  return withRetryTx(async (client) => {
    const {
      rows: [actual],
    } = await client.query(
      `SELECT *
       FROM cuadrantes_planificacion
       WHERE id = $1 AND ars_unidad_id = $2
       FOR UPDATE`,
      [id, arsUnidadId]
    );

    if (!actual) throw new Error('Cuadrante no encontrado');

    if (wantsStructureUpdate && actual.estado !== 'borrador') {
      throw new Error(
        'Solo se puede editar estructura en cuadrantes en estado borrador'
      );
    }

    let estructura = null;
    if (wantsStructureUpdate) {
      const inicioDt = parseYmd(
        fecha_inicio || actual.fecha_inicio,
        'fecha_inicio'
      );

      const semanasValue = Number(num_semanas);
      const semanas =
        Number.isInteger(semanasValue) && semanasValue >= 3 && semanasValue <= 7
          ? semanasValue
          : null;

      const finCalculado = semanas
        ? inicioDt.plus({ days: semanas * 7 - 1 }).toISODate()
        : null;

      const finValue = fecha_fin || finCalculado || actual.fecha_fin;

      estructura = buildCuadranteFromRange(
        inicioDt.toISODate(),
        finValue,
        anio_referencia || actual.anio_referencia,
        mes_referencia || actual.mes_referencia
      );
    }

    const nombreUpdate = nombre !== undefined ? nombre : null;
    const descripcionUpdate = descripcion !== undefined ? descripcion : null;

    const {
      rows: [row],
    } = await client.query(
      `UPDATE cuadrantes_planificacion
       SET nombre = COALESCE($1, nombre),
           descripcion = COALESCE($2, descripcion),
           estado = COALESCE($3, estado),
           fecha_inicio = COALESCE($4, fecha_inicio),
           fecha_fin = COALESCE($5, fecha_fin),
           num_semanas = COALESCE($6, num_semanas),
           mes_referencia = COALESCE($7, mes_referencia),
           anio_referencia = COALESCE($8, anio_referencia),
           updated_at = now()
       WHERE id = $9 AND ars_unidad_id = $10
       RETURNING *`,
      [
        nombreUpdate,
        descripcionUpdate,
        estado || null,
        estructura ? estructura.fecha_inicio : null,
        estructura ? estructura.fecha_fin : null,
        estructura ? estructura.num_semanas : null,
        estructura ? estructura.mes_referencia : null,
        estructura ? estructura.anio_referencia : null,
        id,
        arsUnidadId,
      ]
    );

    if (estructura) {
      await client.query(
        `DELETE FROM cuadrantes_planificacion_dias
         WHERE cuadrante_id = $1`,
        [id]
      );

      if (estructura.dias.length) {
        await client.query(
          `INSERT INTO cuadrantes_planificacion_dias
             (cuadrante_id, fecha, num_semana, dia_semana, es_del_mes_ref)
           SELECT $1, unnest($2::date[]), unnest($3::smallint[]),
                  unnest($4::smallint[]), unnest($5::boolean[])`,
          [
            id,
            estructura.dias.map((d) => d.fecha),
            estructura.dias.map((d) => d.num_semana),
            estructura.dias.map((d) => d.dia_semana),
            estructura.dias.map((d) => d.es_del_mes_ref),
          ]
        );
      }

      await client.query(
        `UPDATE cuadrantes_planificacion_dias d
         SET es_festivo = true, nombre_festivo = f.nombre, color_festivo = c.color
         FROM festivos f
         JOIN calendarios c ON c.id = f.calendario_id
         WHERE d.cuadrante_id = $1
           AND c.ars_unidad_id = $2
           AND c.activo = true
           AND (
             d.fecha = f.fecha
             OR (f.es_recurrente AND EXTRACT(MONTH FROM d.fecha) = EXTRACT(MONTH FROM f.fecha)
                 AND EXTRACT(DAY FROM d.fecha) = EXTRACT(DAY FROM f.fecha))
           )`,
        [id, arsUnidadId]
      );
    }

    const { rows: dias } = await client.query(
      `SELECT fecha, num_semana, dia_semana, es_del_mes_ref, es_festivo, nombre_festivo, color_festivo
       FROM cuadrantes_planificacion_dias
       WHERE cuadrante_id = $1
       ORDER BY fecha`,
      [id]
    );

    return { ...row, dias };
  });
};

// ── Eliminar cuadrante ───────────────────────────────────────

exports.remove = (id, arsUnidadId) =>
  withTransaction(async (client) => {
    const {
      rows: [cuadrante],
    } = await client.query(
      `SELECT id, anio_referencia, mes_referencia, estado
       FROM cuadrantes_planificacion
       WHERE id = $1 AND ars_unidad_id = $2
       FOR UPDATE`,
      [id, arsUnidadId]
    );

    if (!cuadrante) {
      throw new Error('Cuadrante no encontrado');
    }

    const {
      rows: [ocupacionBorrador],
    } = await client.query(
      `SELECT COUNT(ab.id)::int AS total
       FROM asignaciones_borradores b
       JOIN asignaciones_borrador ab
         ON ab.borrador_id = b.id
        AND ab.ars_unidad_id = b.ars_unidad_id
       WHERE b.anio = $1
         AND b.mes = $2
         AND b.ars_unidad_id = $3
         AND b.estado <> 'archivado'`,
      [cuadrante.anio_referencia, cuadrante.mes_referencia, arsUnidadId]
    );

    const {
      rows: [ocupacionDefinitiva],
    } = await client.query(
      `SELECT COUNT(a.id)::int AS total
       FROM asignaciones a
       WHERE a.anio = $1
         AND a.mes = $2
         AND a.ars_unidad_id = $3`,
      [cuadrante.anio_referencia, cuadrante.mes_referencia, arsUnidadId]
    );

    const totalOcupacion =
      Number((ocupacionBorrador && ocupacionBorrador.total) || 0) +
      Number((ocupacionDefinitiva && ocupacionDefinitiva.total) || 0);

    if (totalOcupacion > 0) {
      if (cuadrante.estado === 'activo') {
        throw new Error('Cuadrante Activo, no se puede borrar');
      }
      throw new Error(
        'No se puede eliminar el cuadrante: tiene servicios asociados o borradores del periodo con celdas ocupadas.'
      );
    }

    await client.query(
      `DELETE FROM asignaciones_borradores
       WHERE anio = $1
         AND mes = $2
         AND ars_unidad_id = $3`,
      [cuadrante.anio_referencia, cuadrante.mes_referencia, arsUnidadId]
    );

    await client.query(
      `DELETE FROM cuadrantes_planificacion
       WHERE id = $1 AND ars_unidad_id = $2`,
      [id, arsUnidadId]
    );
  });

// ── Importar desde fichero ───────────────────────────────────

exports.importar = (
  cuadranteId,
  fileBuffer,
  formato,
  nombreFichero,
  user,
  arsUnidadId
) => {
  return withRetryTx(async (client) => {
    // Verificar que el cuadrante existe y pertenece a la ARS
    const {
      rows: [cuadrante],
    } = await client.query(
      `SELECT * FROM cuadrantes_planificacion
       WHERE id = $1 AND ars_unidad_id = $2 FOR UPDATE`,
      [cuadranteId, arsUnidadId]
    );
    if (!cuadrante) throw new Error('Cuadrante no encontrado');

    // Parsear fichero según formato
    let filas;
    if (formato === 'csv') {
      filas = parseCSV(fileBuffer);
    } else if (formato === 'xlsx') {
      filas = parseXLSX(fileBuffer);
    } else if (formato === 'json') {
      filas = JSON.parse(fileBuffer.toString('utf8'));
    } else {
      throw new Error(`Formato no soportado: ${formato}`);
    }

    // Formato esperado por fila: { fecha, agente_id, turno_id, actividad_ids[], observaciones }
    let filasOk = 0;
    let filasError = 0;
    const errores = [];

    // Obtener fechas válidas del cuadrante
    const { rows: diasValidos } = await client.query(
      `SELECT fecha::text AS fecha FROM cuadrantes_planificacion_dias
       WHERE cuadrante_id = $1`,
      [cuadranteId]
    );
    const fechasSet = new Set(diasValidos.map((d) => d.fecha));

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      try {
        if (!fechasSet.has(String(fila.fecha).slice(0, 10))) {
          throw new Error(`Fecha ${fila.fecha} no pertenece al cuadrante`);
        }
        if (!fila.agente_id || !fila.turno_id) {
          throw new Error('agente_id y turno_id son obligatorios');
        }
        // Aquí se podría hacer upsert en asignaciones_borrador
        // reutilizando la lógica existente del módulo de asignaciones
        filasOk++;
      } catch (err) {
        filasError++;
        errores.push({ fila: i + 1, error: err.message, datos: fila });
      }
    }

    // Registrar importación
    await client.query(
      `INSERT INTO cuadrantes_planificacion_importaciones
         (cuadrante_id, nombre_fichero, formato, filas_total, filas_ok, filas_error, errores, importado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        cuadranteId,
        nombreFichero,
        formato,
        filas.length,
        filasOk,
        filasError,
        errores.length ? JSON.stringify(errores) : null,
        user.id,
      ]
    );

    return {
      filas_total: filas.length,
      filas_ok: filasOk,
      filas_error: filasError,
      errores,
    };
  });
};

// ── Parsers básicos ──────────────────────────────────────────

function parseCSV(buffer) {
  const lines = buffer
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(';');
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (vals[i] || '').trim();
    });
    if (obj.actividad_ids) {
      obj.actividad_ids = obj.actividad_ids
        .split(',')
        .map(Number)
        .filter(Boolean);
    }
    if (obj.agente_id) obj.agente_id = Number(obj.agente_id);
    if (obj.turno_id) obj.turno_id = Number(obj.turno_id);
    return obj;
  });
}

function parseXLSX(buffer) {
  // Requiere: npm install xlsx
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  return rows.map((r) => ({
    fecha: r.fecha || r.Fecha,
    agente_id: Number(r.agente_id || r.Agente || 0),
    turno_id: Number(r.turno_id || r.Turno || 0),
    actividad_ids: r.actividad_ids
      ? String(r.actividad_ids).split(',').map(Number).filter(Boolean)
      : [],
    observaciones: r.observaciones || r.Observaciones || null,
  }));
}
