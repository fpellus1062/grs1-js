const db = require('../config/db');
const bcrypt = require('bcrypt');

const USER_COLS =
  'id, nombre, email, tip, role, role_id, activo, login_intentos, ultimo_login, bloqueado_hasta, password_changed_at, created_at, updated_at';

async function ensureEmailIsAvailable(email, excludedId = null) {
  const params = excludedId === null ? [email] : [email, excludedId];
  const query =
    excludedId === null
      ? 'SELECT id FROM usuarios WHERE email = $1'
      : 'SELECT id FROM usuarios WHERE email = $1 AND id <> $2';

  const result = await db.query(query, params);
  if (result.rows.length > 0) {
    throw new Error('Ya existe un usuario con este email');
  }
}

exports.getAll = async ({ incluirInactivos = false } = {}) => {
  const where = incluirInactivos ? '' : 'WHERE u.activo = true';
  const result = await db.query(`
    SELECT ${USER_COLS.split(',')
      .map((c) => 'u.' + c.trim())
      .join(', ')},
           COALESCE(
             (SELECT array_agg(ua.ars_unidad_id ORDER BY ua.ars_unidad_id)
              FROM usuarios_ars ua WHERE ua.usuario_id = u.id),
             '{}'
           ) AS ars_unidad_ids
    FROM usuarios u
    ${where}
    ORDER BY u.id
  `);
  return result.rows;
};

exports.getById = async (id) => {
  const result = await db.query(
    `SELECT ${USER_COLS} FROM usuarios WHERE id=$1`,
    [id]
  );
  return result.rows[0];
};

exports.create = async ({
  nombre,
  email,
  password,
  role = 'user',
  tip = null,
}) => {
  await ensureEmailIsAvailable(email);

  const rolRow = await db.query('SELECT id FROM roles WHERE nombre = $1', [
    role,
  ]);
  const roleId = rolRow.rows.length ? rolRow.rows[0].id : null;

  const hash = await bcrypt.hash(password, 10);
  const result = await db.query(
    `INSERT INTO usuarios(nombre, email, password, role, role_id, tip) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${USER_COLS}`,
    [nombre, email, hash, role, roleId, tip || null]
  );
  return result.rows[0];
};

exports.update = async (
  id,
  {
    nombre,
    email,
    password,
    role,
    tip,
    activo,
    bloqueado_hasta,
    login_intentos,
  }
) => {
  const existingResult = await db.query(
    'SELECT id, nombre, email, role, tip, password, activo, bloqueado_hasta, login_intentos FROM usuarios WHERE id=$1',
    [id]
  );

  if (existingResult.rows.length === 0) {
    throw new Error('Usuario no encontrado');
  }

  const existing = existingResult.rows[0];
  const nextNombre = nombre ?? existing.nombre;
  const nextEmail = email ?? existing.email;
  const nextRole = role ?? existing.role ?? 'user';
  const nextTip = tip !== undefined ? tip || null : existing.tip || null;
  const nextActivo = activo !== undefined ? activo : existing.activo;
  const nextBloqueadoHasta =
    bloqueado_hasta !== undefined ? bloqueado_hasta : existing.bloqueado_hasta;
  const nextLoginIntentos =
    login_intentos !== undefined ? login_intentos : existing.login_intentos;
  const nextPassword = password
    ? await bcrypt.hash(password, 10)
    : existing.password;

  if (nextEmail !== existing.email) {
    await ensureEmailIsAvailable(nextEmail, id);
  }

  const rolRow = await db.query('SELECT id FROM roles WHERE nombre = $1', [
    nextRole,
  ]);
  const nextRoleId = rolRow.rows.length ? rolRow.rows[0].id : null;

  const passwordChanged = password ? ', password_changed_at = NOW()' : '';

  const result = await db.query(
    `UPDATE usuarios SET nombre=$1, email=$2, role=$3, password=$4, role_id=$5, activo=$6, bloqueado_hasta=$7, login_intentos=$8, tip=$9, updated_at=NOW()${passwordChanged} WHERE id=$10 RETURNING ${USER_COLS}`,
    [
      nextNombre,
      nextEmail,
      nextRole,
      nextPassword,
      nextRoleId,
      nextActivo,
      nextBloqueadoHasta,
      nextLoginIntentos,
      nextTip,
      id,
    ]
  );
  return result.rows[0];
};

// Soft delete: desactiva el usuario en vez de borrarlo
exports.remove = async (id) => {
  const result = await db.query(
    `UPDATE usuarios SET activo = false, updated_at = NOW() WHERE id = $1 RETURNING ${USER_COLS}`,
    [id]
  );
  if (result.rows.length === 0) throw new Error('Usuario no encontrado');
  return result.rows[0];
};

// Reactivar usuario previamente desactivado
exports.reactivar = async (id) => {
  const result = await db.query(
    `UPDATE usuarios SET activo = true, login_intentos = 0, bloqueado_hasta = NULL, updated_at = NOW() WHERE id = $1 RETURNING ${USER_COLS}`,
    [id]
  );
  if (result.rows.length === 0) throw new Error('Usuario no encontrado');
  return result.rows[0];
};

// Desbloquear usuario (reset intentos y bloqueo)
exports.desbloquear = async (id) => {
  const result = await db.query(
    `UPDATE usuarios SET login_intentos = 0, bloqueado_hasta = NULL, updated_at = NOW() WHERE id = $1 RETURNING ${USER_COLS}`,
    [id]
  );
  if (result.rows.length === 0) throw new Error('Usuario no encontrado');
  return result.rows[0];
};

exports.getArsByUsuario = async (usuarioId) => {
  const result = await db.query(
    `SELECT ua.ars_unidad_id, ua.rol_ars, ua.created_at,
            a.color, a.domicilio, a.poblacion, a.provincia
     FROM usuarios_ars ua
     LEFT JOIN ars a ON a.id_unidad = ua.ars_unidad_id
     WHERE ua.usuario_id = $1
     ORDER BY ua.ars_unidad_id`,
    [usuarioId]
  );
  return result.rows;
};

exports.setArsByUsuario = async (usuarioId, arsUnidadIds = []) => {
  const cleanArsIds = [...new Set(arsUnidadIds.filter(Boolean))];
  if (cleanArsIds.length === 0) {
    throw new Error('Debes asignar al menos una agrupacion al usuario');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");

    const arsCheck = await client.query(
      'SELECT id_unidad FROM ars WHERE id_unidad = ANY($1::text[])',
      [cleanArsIds]
    );
    const existentes = new Set(arsCheck.rows.map((r) => r.id_unidad));
    const faltantes = cleanArsIds.filter((id) => !existentes.has(id));
    if (faltantes.length > 0) {
      throw new Error(`Agrupaciones no validas: ${faltantes.join(', ')}`);
    }

    await client.query('DELETE FROM usuarios_ars WHERE usuario_id = $1', [
      usuarioId,
    ]);
    await client.query(
      `INSERT INTO usuarios_ars (usuario_id, ars_unidad_id)
       SELECT $1, unnest($2::text[])`,
      [usuarioId, cleanArsIds]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return exports.getArsByUsuario(usuarioId);
};

exports.addArsToUsuario = async (
  usuarioId,
  arsUnidadId,
  rolArs = 'miembro'
) => {
  const arsCheck = await db.query(
    'SELECT id_unidad FROM ars WHERE id_unidad = $1',
    [arsUnidadId]
  );
  if (arsCheck.rows.length === 0) {
    throw new Error('La agrupacion indicada no existe');
  }

  await db.query(
    `INSERT INTO usuarios_ars (usuario_id, ars_unidad_id, rol_ars)
     VALUES ($1, $2, $3)
     ON CONFLICT (usuario_id, ars_unidad_id)
     DO UPDATE SET rol_ars = EXCLUDED.rol_ars`,
    [usuarioId, arsUnidadId, rolArs]
  );

  return exports.getArsByUsuario(usuarioId);
};

exports.removeArsFromUsuario = async (usuarioId, arsUnidadId) => {
  const totalResult = await db.query(
    'SELECT COUNT(*)::int AS total FROM usuarios_ars WHERE usuario_id = $1',
    [usuarioId]
  );
  const total = totalResult.rows[0]?.total || 0;
  if (total <= 1) {
    throw new Error('El usuario debe conservar al menos una agrupacion');
  }

  const result = await db.query(
    'DELETE FROM usuarios_ars WHERE usuario_id = $1 AND ars_unidad_id = $2 RETURNING id',
    [usuarioId, arsUnidadId]
  );
  if (result.rows.length === 0) {
    throw new Error('No existe esa agrupacion asignada al usuario');
  }

  return exports.getArsByUsuario(usuarioId);
};
