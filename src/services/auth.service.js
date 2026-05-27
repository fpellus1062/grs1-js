const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getPermisosByRol } = require('./permisos.service');
const audit = require('./audit.service');

exports.register = async ({ nombre, email, password }) => {
  // Asignar rol 'consulta' por defecto a nuevos usuarios
  const rolDefault = await db.query(
    "SELECT id FROM roles WHERE nombre = 'consulta' LIMIT 1"
  );
  const roleId = rolDefault.rows.length ? rolDefault.rows[0].id : null;

  const hash = await bcrypt.hash(password, 10);

  const result = await db.query(
    'INSERT INTO usuarios(nombre, email, password, role, role_id) VALUES($1,$2,$3,$4,$5) RETURNING id, email, role, role_id',
    [nombre, email, hash, 'user', roleId]
  );

  return result.rows[0];
};

exports.login = async ({ email, usuario, password }, meta = {}) => {
  const loginId = email || usuario;
  const { ip, user_agent } = meta;

  const result = await db.query(
    `SELECT u.*, r.nombre AS role_nombre
     FROM usuarios u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1 OR u.nombre = $1
     LIMIT 1`,
    [loginId]
  );

  if (result.rows.length === 0) {
    // Fire-and-forget
    audit.logLogin({
      usuario_id: null,
      email: loginId,
      ip,
      user_agent,
      resultado: 'USUARIO_NO_EXISTE',
      detalle: null,
    });
    throw new Error('Credenciales incorrectas');
  }

  const user = result.rows[0];

  // Verificar que el usuario esté activo
  if (user.activo === false) {
    audit.logLogin({
      usuario_id: user.id,
      email: loginId,
      ip,
      user_agent,
      resultado: 'INACTIVO',
      detalle: null,
    });
    throw new Error('Usuario desactivado. Contacta con un administrador');
  }

  // Verificar si está bloqueado temporalmente
  if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
    audit.logLogin({
      usuario_id: user.id,
      email: loginId,
      ip,
      user_agent,
      resultado: 'BLOQUEADO',
      detalle: null,
    });
    throw new Error(
      'Cuenta bloqueada temporalmente. Intenta de nuevo en unos minutos'
    );
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    // Incrementar intentos fallidos
    const intentos = (user.login_intentos || 0) + 1;
    const updates = { login_intentos: intentos };

    // Bloquear 15 min en producción, 1 min en desarrollo, tras 5 intentos fallidos
    const lockMs =
      process.env.NODE_ENV === 'production' ? 15 * 60 * 1000 : 1 * 60 * 1000;
    if (intentos >= 5) {
      updates.bloqueado_hasta = new Date(Date.now() + lockMs).toISOString();
    }

    await db.query(
      'UPDATE usuarios SET login_intentos = $1, bloqueado_hasta = $2 WHERE id = $3',
      [updates.login_intentos, updates.bloqueado_hasta || null, user.id]
    );

    audit.logLogin({
      usuario_id: user.id,
      email: loginId,
      ip,
      user_agent,
      resultado: 'PASSWORD_FAIL',
      detalle: `Intento ${intentos}/5`,
    });

    throw new Error('Credenciales incorrectas');
  }

  // Login exitoso: resetear intentos y registrar último login
  await db.query(
    'UPDATE usuarios SET login_intentos = 0, bloqueado_hasta = NULL, ultimo_login = NOW() WHERE id = $1',
    [user.id]
  );

  audit.logLogin({
    usuario_id: user.id,
    email: loginId,
    ip,
    user_agent,
    resultado: 'OK',
    detalle: null,
  });

  // Obtener permisos del rol desde la caché RBAC
  const permisos = user.role_id ? await getPermisosByRol(user.role_id) : [];

  // Membresías de agrupación (ARS) del usuario
  const arsMembership = await db.query(
    'SELECT ars_unidad_id FROM usuarios_ars WHERE usuario_id = $1 ORDER BY ars_unidad_id',
    [user.id]
  );
  const ars_ids = arsMembership.rows.map((row) => row.ars_unidad_id);

  if (ars_ids.length === 0) {
    throw new Error(
      'Usuario sin agrupaciones asignadas. Contacta con un administrador'
    );
  }

  const arsCatalogResult = await db.query(
    `SELECT id_unidad, poblacion, color
       FROM ars
      WHERE id_unidad = ANY($1::varchar[])
      ORDER BY id_unidad`,
    [ars_ids]
  );
  const ars_catalog = Array.isArray(arsCatalogResult.rows)
    ? arsCatalogResult.rows
    : [];

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      nombre: user.nombre || user.email,
      role: user.role_nombre || user.role || 'user', // texto para compatibilidad
      role_id: user.role_id, // ID numérico para RBAC
      ars_ids, // agrupaciones habilitadas para el usuario
      permisos, // permisos RBAC en sesión para decisiones backend/frontend
    },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );

  return {
    token,
    role: user.role_nombre || user.role || 'user',
    role_id: user.role_id,
    nombre: user.nombre,
    tip: user.tip || null,
    ars_ids,
    ars_catalog,
    permisos, // lista para el frontend
  };
};

// ── Perfil de usuario autenticado ─────────────────────────
exports.getProfile = async (userId) => {
  const result = await db.query(
    `SELECT u.id, u.nombre, u.email, u.tip, u.role, r.nombre AS role_nombre, u.ultimo_login, u.created_at
     FROM usuarios u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId]
  );

  if (result.rows.length === 0) throw new Error('Usuario no encontrado');

  const arsMembership = await db.query(
    'SELECT ars_unidad_id FROM usuarios_ars WHERE usuario_id = $1 ORDER BY ars_unidad_id',
    [userId]
  );
  const ars_ids = arsMembership.rows.map((row) => row.ars_unidad_id);
  
  let ars_catalog = [];
  if (ars_ids.length) {
    const arsCatalogResult = await db.query(
      `SELECT id_unidad, poblacion, color
         FROM ars
        WHERE id_unidad = ANY($1::varchar[])
        ORDER BY id_unidad`,
      [ars_ids]
    );
    ars_catalog = Array.isArray(arsCatalogResult.rows)
      ? arsCatalogResult.rows
      : [];
  }

  const user = result.rows[0];
  return {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    tip: user.tip || null,
    role: user.role_nombre || user.role,
    ultimo_login: user.ultimo_login,
    created_at: user.created_at,
    ars_ids,
    ars_catalog,
  };
};

exports.updateProfile = async (userId, { nombre }) => {
  const result = await db.query(
    'UPDATE usuarios SET nombre = $1, updated_at = NOW() WHERE id = $2 RETURNING id, nombre, email',
    [nombre, userId]
  );
  if (result.rows.length === 0) throw new Error('Usuario no encontrado');
  return result.rows[0];
};

exports.changePassword = async (userId, { currentPassword, newPassword }) => {
  const result = await db.query('SELECT password FROM usuarios WHERE id = $1', [
    userId,
  ]);
  if (result.rows.length === 0) throw new Error('Usuario no encontrado');

  const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
  if (!valid) throw new Error('La contraseña actual es incorrecta');

  const hash = await bcrypt.hash(newPassword, 10);
  await db.query(
    'UPDATE usuarios SET password = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2',
    [hash, userId]
  );
};
