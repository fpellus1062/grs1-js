const db = require('../config/db');

// ── Helpers de normalización ─────────────────────────────────

function normalizeNullableString(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeRequiredString(value, fieldName) {
  const result = normalizeNullableString(value);
  if (!result) {
    throw new Error(`${fieldName} es requerido`);
  }
  return result;
}

function normalizeTime(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const trimmed = String(value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(trimmed)) {
    throw new Error(`${fieldName} debe tener formato HH:MM`);
  }
  return trimmed;
}

function normalizeColor(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const trimmed = String(value).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    throw new Error('El color debe tener formato hexadecimal (#RRGGBB)');
  }
  return trimmed;
}

// ── Auditoría ────────────────────────────────────────────────

function buildSnapshot(row) {
  return {
    id_turno: row.id_turno,
    codigo: row.codigo,
    nombre: row.nombre,
    hora_inicio: row.hora_inicio,
    hora_fin: row.hora_fin,
    color: row.color,
    observaciones: row.observaciones,
    baja_at: row.baja_at,
  };
}

async function registrarLog(
  client,
  idTurno,
  accion,
  anteriores,
  nuevos,
  userId,
  ip
) {
  await client.query(
    `INSERT INTO turnos_log
      (id_turno, accion, datos_anteriores, datos_nuevos, usuario_id, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      idTurno,
      accion,
      anteriores ? JSON.stringify(anteriores) : null,
      nuevos ? JSON.stringify(nuevos) : null,
      userId,
      ip || null,
    ]
  );
}

// ── Validaciones de negocio ──────────────────────────────────

async function ensureCodigoDisponible(codigo, excludeId = null) {
  if (!codigo) return;

  const params = excludeId ? [codigo, excludeId] : [codigo];
  const query = excludeId
    ? 'SELECT id_turno FROM turnos WHERE codigo = $1 AND id_turno <> $2'
    : 'SELECT id_turno FROM turnos WHERE codigo = $1';

  const result = await db.query(query, params);
  if (result.rows.length > 0) {
    throw new Error('Ya existe un turno con este código');
  }
}

// ── CRUD ─────────────────────────────────────────────────────

/**
 * Crear un nuevo turno
 */
exports.create = async (data, userId, ip) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const codigo = normalizeRequiredString(
      data.codigo,
      'El código'
    ).toUpperCase();
    const nombre = normalizeRequiredString(data.nombre, 'El nombre');
    const horaInicio = normalizeTime(data.hora_inicio, 'Hora inicio');
    const horaFin = normalizeTime(data.hora_fin, 'Hora fin');
    const color = normalizeColor(data.color);
    const observaciones = normalizeNullableString(data.observaciones);

    await ensureCodigoDisponible(codigo);

    const result = await client.query(
      `INSERT INTO turnos
        (codigo, nombre, hora_inicio, hora_fin, color, observaciones, create_user)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [codigo, nombre, horaInicio, horaFin, color, observaciones, userId]
    );

    const turno = result.rows[0];

    await registrarLog(
      client,
      turno.id_turno,
      'INSERT',
      null,
      buildSnapshot(turno),
      userId,
      ip
    );

    await client.query('COMMIT');
    return turno;
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      throw new Error('Ya existe un turno con este código');
    }
    if (error.code === '23503') {
      throw new Error('Uno o más datos referenciados no existen en el sistema');
    }
    console.error('Error en TurnosService.create:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Obtener todos los turnos
 */
exports.getAll = async () => {
  try {
    const result = await db.query(
      'SELECT * FROM turnos ORDER BY codigo, id_turno'
    );
    return result.rows;
  } catch (error) {
    throw new Error(`Error al obtener los turnos: ${error.message}`);
  }
};

/**
 * Metadatos para formularios
 */
exports.getMeta = async () => {
  try {
    const result = await db.query(
      'SELECT id_turno, codigo, nombre, color FROM turnos WHERE baja_at IS NULL ORDER BY codigo'
    );
    return { turnos: result.rows };
  } catch (error) {
    throw new Error(`Error al obtener metadatos de turnos: ${error.message}`);
  }
};

/**
 * Obtener turno por ID
 */
exports.getById = async (id) => {
  if (!id || Number.isNaN(Number(id))) {
    throw new Error('ID de turno inválido');
  }

  const result = await db.query('SELECT * FROM turnos WHERE id_turno = $1', [
    id,
  ]);

  if (!result.rows.length) {
    throw new Error('Turno no encontrado');
  }

  return result.rows[0];
};

/**
 * Actualizar turno (el código es inmutable)
 */
exports.update = async (id, data, userId, ip) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (!id || Number.isNaN(Number(id))) {
      throw new Error('ID de turno inválido');
    }

    const existingResult = await client.query(
      'SELECT * FROM turnos WHERE id_turno = $1',
      [id]
    );
    if (!existingResult.rows.length) {
      throw new Error('Turno no encontrado');
    }
    const existing = existingResult.rows[0];
    const datosAnteriores = buildSnapshot(existing);

    // El código es INMUTABLE
    // @ts-ignore
    if (Object.hasOwn(data, 'codigo') && data.codigo !== existing.codigo) {
      throw new Error('El código del turno no se puede modificar');
    }

    // @ts-ignore
    const hasNombre = Object.hasOwn(data, 'nombre');
    // @ts-ignore
    const hasHoraInicio = Object.hasOwn(data, 'hora_inicio');
    // @ts-ignore
    const hasHoraFin = Object.hasOwn(data, 'hora_fin');
    // @ts-ignore
    const hasColor = Object.hasOwn(data, 'color');
    // @ts-ignore
    const hasObservaciones = Object.hasOwn(data, 'observaciones');
    // @ts-ignore
    const hasBajaAt = Object.hasOwn(data, 'baja_at');

    const nombre = hasNombre
      ? normalizeRequiredString(data.nombre, 'El nombre')
      : existing.nombre;
    const horaInicio = hasHoraInicio
      ? normalizeTime(data.hora_inicio, 'Hora inicio')
      : existing.hora_inicio;
    const horaFin = hasHoraFin
      ? normalizeTime(data.hora_fin, 'Hora fin')
      : existing.hora_fin;
    const color = hasColor ? normalizeColor(data.color) : existing.color;
    const observaciones = hasObservaciones
      ? normalizeNullableString(data.observaciones)
      : existing.observaciones;
    const bajaAt = hasBajaAt
      ? data.baja_at
        ? new Date(data.baja_at)
        : null
      : existing.baja_at;

    const result = await client.query(
      `UPDATE turnos
      SET nombre = $1,
          hora_inicio = $2,
          hora_fin = $3,
          color = $4,
          observaciones = $5,
          baja_at = $6,
          update_user = $7,
          update_at = CURRENT_TIMESTAMP
      WHERE id_turno = $8
      RETURNING *`,
      [nombre, horaInicio, horaFin, color, observaciones, bajaAt, userId, id]
    );

    if (!result.rows.length) {
      throw new Error('No se pudo actualizar el turno');
    }

    const turno = result.rows[0];
    const datosNuevos = buildSnapshot(turno);

    await registrarLog(
      client,
      turno.id_turno,
      'UPDATE',
      datosAnteriores,
      datosNuevos,
      userId,
      ip
    );

    await client.query('COMMIT');
    return turno;
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      throw new Error('Ya existe un turno con este código');
    }
    if (error.code === '23503') {
      throw new Error('Uno o más datos referenciados no existen en el sistema');
    }
    console.error('Error en TurnosService.update:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Eliminar turno
 */
exports.delete = async (id, userId, ip) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (!id || Number.isNaN(Number(id))) {
      throw new Error('ID de turno inválido');
    }

    const existingResult = await client.query(
      'SELECT * FROM turnos WHERE id_turno = $1',
      [id]
    );
    if (!existingResult.rows.length) {
      throw new Error('Turno no encontrado o ya fue eliminado');
    }

    const datosAnteriores = buildSnapshot(existingResult.rows[0]);

    await client.query('DELETE FROM turnos WHERE id_turno = $1', [id]);

    await registrarLog(client, id, 'DELETE', datosAnteriores, null, userId, ip);

    await client.query('COMMIT');
    return { id_turno: Number(id), message: 'Turno eliminado exitosamente' };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error en TurnosService.delete:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Obtener historial de cambios de un turno
 */
exports.getHistorial = async (id) => {
  if (!id || Number.isNaN(Number(id))) {
    throw new Error('ID de turno inválido');
  }

  const result = await db.query(
    `SELECT tl.*, u.nombre AS usuario_nombre
    FROM turnos_log tl
    LEFT JOIN usuarios u ON u.id = tl.usuario_id
    ORDER BY tl.created_at DESC`,
    []
  );

  return result.rows;
};

/**
 * Obtener historial de un turno específico
 */
exports.getHistorialByTurno = async (id) => {
  if (!id || Number.isNaN(Number(id))) {
    throw new Error('ID de turno inválido');
  }

  const result = await db.query(
    `SELECT tl.*, u.nombre AS usuario_nombre
    FROM turnos_log tl
    LEFT JOIN usuarios u ON u.id = tl.usuario_id
    WHERE tl.id_turno = $1
    ORDER BY tl.created_at DESC`,
    [id]
  );

  return result.rows;
};
