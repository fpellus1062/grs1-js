const db = require('../config/db');

// ─── Calendarios (cabecera) ─────────────────────────────────────────────────

exports.getAll = async ({ arsId } = {}) => {
  const params = [];
  const where = arsId ? ` WHERE c.ars_unidad_id = $${params.push(arsId)}` : '';
  const r = await db.query(
    `SELECT c.id, c.nombre, c.descripcion, c.ambito, c.activo,
            c.ars_unidad_id, a.id_unidad AS ars_nombre, a.color AS ars_color,
            c.created_at, c.updated_at
     FROM calendarios c
     LEFT JOIN ars a ON a.id_unidad = c.ars_unidad_id${where}
     ORDER BY c.nombre`,
    params
  );
  return r.rows;
};

exports.getById = async (id) => {
  const r = await db.query(
    `SELECT c.id, c.nombre, c.descripcion, c.ambito, c.activo,
            c.ars_unidad_id, a.id_unidad AS ars_nombre,
            c.created_at, c.updated_at
     FROM calendarios c
     LEFT JOIN ars a ON a.id_unidad = c.ars_unidad_id
     WHERE c.id = $1`,
    [id]
  );
  if (!r.rows.length) throw new Error('Calendario no encontrado');
  return r.rows[0];
};

exports.create = async (
  { nombre, descripcion, ambito, activo, ars_unidad_id },
  userId
) => {
  if (!nombre || !nombre.trim()) throw new Error('El nombre es obligatorio');
  if (!ambito) throw new Error('El ámbito es obligatorio');
  const r = await db.query(
    `INSERT INTO calendarios (nombre, descripcion, ambito, activo, ars_unidad_id, created_user)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, nombre, descripcion, ambito, activo, ars_unidad_id, created_at, updated_at`,
    [
      nombre.trim(),
      descripcion || null,
      ambito,
      activo !== false,
      ars_unidad_id || null,
      userId || 1,
    ]
  );
  return r.rows[0];
};

exports.update = async (
  id,
  { nombre, descripcion, ambito, activo, ars_unidad_id }
) => {
  if (nombre !== undefined && !nombre.trim())
    throw new Error('El nombre es obligatorio');
  const r = await db.query(
    `UPDATE calendarios
     SET nombre        = COALESCE($1, nombre),
         descripcion   = COALESCE($2, descripcion),
         ambito        = COALESCE($3, ambito),
         activo        = COALESCE($4, activo),
         ars_unidad_id = $5,
         updated_at    = CURRENT_TIMESTAMP
     WHERE id = $6
     RETURNING id, nombre, descripcion, ambito, activo, ars_unidad_id, created_at, updated_at`,
    [
      nombre || null,
      descripcion !== undefined ? descripcion : null,
      ambito || null,
      activo,
      ars_unidad_id !== undefined ? ars_unidad_id || null : null,
      id,
    ]
  );
  if (!r.rows.length) throw new Error('Calendario no encontrado');
  return r.rows[0];
};

exports.remove = async (id) => {
  const r = await db.query(
    'DELETE FROM calendarios WHERE id = $1 RETURNING id',
    [id]
  );
  if (!r.rows.length) throw new Error('Calendario no encontrado');
};

// ─── Festivos (líneas de un calendario) ─────────────────────────────────────

exports.getFestivos = async (calendarioId) => {
  const r = await db.query(
    `SELECT id, calendario_id, fecha, nombre, descripcion, es_recurrente, created_at, updated_at
     FROM festivos
     WHERE calendario_id = $1
     ORDER BY fecha`,
    [calendarioId]
  );
  return r.rows;
};

exports.createFestivo = async (
  calendarioId,
  { fecha, nombre, descripcion, es_recurrente }
) => {
  if (!fecha) throw new Error('La fecha es obligatoria');
  if (!nombre || !nombre.trim())
    throw new Error('El nombre del festivo es obligatorio');
  const r = await db.query(
    `INSERT INTO festivos (calendario_id, fecha, nombre, descripcion, es_recurrente)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, calendario_id, fecha, nombre, descripcion, es_recurrente, created_at, updated_at`,
    [
      calendarioId,
      fecha,
      nombre.trim(),
      descripcion || null,
      es_recurrente === true,
    ]
  );
  return r.rows[0];
};

exports.updateFestivo = async (
  id,
  { fecha, nombre, descripcion, es_recurrente }
) => {
  if (nombre !== undefined && !nombre.trim())
    throw new Error('El nombre del festivo es obligatorio');
  const r = await db.query(
    `UPDATE festivos
     SET fecha         = COALESCE($1, fecha),
         nombre        = COALESCE($2, nombre),
         descripcion   = COALESCE($3, descripcion),
         es_recurrente = COALESCE($4, es_recurrente),
         updated_at    = CURRENT_TIMESTAMP
     WHERE id = $5
     RETURNING id, calendario_id, fecha, nombre, descripcion, es_recurrente, created_at, updated_at`,
    [
      fecha || null,
      nombre || null,
      descripcion !== undefined ? descripcion : null,
      es_recurrente,
      id,
    ]
  );
  if (!r.rows.length) throw new Error('Festivo no encontrado');
  return r.rows[0];
};

exports.removeFestivo = async (id) => {
  const r = await db.query('DELETE FROM festivos WHERE id = $1 RETURNING id', [
    id,
  ]);
  if (!r.rows.length) throw new Error('Festivo no encontrado');
};
