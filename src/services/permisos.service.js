const db = require('../config/db');

// ═══════════════════════════════════════════════════════
//  CACHÉ EN MEMORIA
//  Estructura: { rolId: Set(['agentes:leer', 'turnos:crear', ...]) }
// ═══════════════════════════════════════════════════════
let _cache = {};
let _cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function normalizePermisoClave(claveInput) {
  const clave = String(claveInput || '')
    .trim()
    .toLowerCase();
  if (!clave) return '';
  const parts = clave
    .split(':')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return clave;
  return parts[0] + ':' + parts[parts.length - 1];
}

/**
 * Cargar toda la matriz de permisos en caché
 */
async function loadCache() {
  const now = Date.now();
  if (
    _cacheTimestamp &&
    now - _cacheTimestamp < CACHE_TTL &&
    Object.keys(_cache).length > 0
  ) {
    return;
  }

  const result = await db.query(
    `SELECT rp.rol_id, p.clave
     FROM roles_permisos rp
     JOIN permisos p ON p.id = rp.permiso_id
     JOIN roles r ON r.id = rp.rol_id
     WHERE r.activo = true`
  );

  const newCache = {};
  for (const row of result.rows) {
    if (!newCache[row.rol_id]) newCache[row.rol_id] = new Set();
    const raw = String(row.clave || '')
      .trim()
      .toLowerCase();
    const normalized = normalizePermisoClave(raw);
    if (raw) newCache[row.rol_id].add(raw);
    if (normalized) newCache[row.rol_id].add(normalized);
  }

  _cache = newCache;
  _cacheTimestamp = now;
  console.log(
    `[RBAC] Caché cargada: ${result.rows.length} permisos para ${Object.keys(newCache).length} roles`
  );
}

/**
 * Verificar si un rol tiene un permiso exacto
 * @param {number} roleId
 * @param {string} permisoClave - Ej: 'agentes:crear'
 * @returns {boolean}
 */
async function tienePermiso(roleId, permisoClave) {
  await loadCache();
  const permisos = _cache[roleId];
  if (!permisos) return false;
  return permisos.has(permisoClave);
}

/**
 * Verificar si un rol tiene AL MENOS UNO de varios permisos
 * @param {number} roleId
 * @param {string[]} permisosClaves
 * @returns {boolean}
 */
async function tieneAlgunPermiso(roleId, permisosClaves) {
  await loadCache();
  const permisos = _cache[roleId];
  if (!permisos) return false;
  return permisosClaves.some((clave) => permisos.has(clave));
}

/**
 * Obtener todos los permisos de un rol (para enviar al frontend en el login)
 * @param {number} roleId
 * @returns {string[]}
 */
async function getPermisosByRol(roleId) {
  await loadCache();
  const permisos = _cache[roleId];
  return permisos
    ? [
        ...new Set(
          [...permisos].map((p) => normalizePermisoClave(p)).filter(Boolean)
        ),
      ]
    : [];
}

/**
 * Invalidar caché (llamar tras modificar la matriz desde la API)
 */
function invalidarCache() {
  _cache = {};
  _cacheTimestamp = 0;
  console.log('[RBAC] Caché invalidada');
}

/**
 * Obtener la matriz completa (para futuro panel de gestión)
 */
async function getMatrizCompleta() {
  const [roles, permisos, asignaciones] = await Promise.all([
    db.query('SELECT * FROM roles WHERE activo = true ORDER BY id'),
    db.query('SELECT * FROM permisos ORDER BY recurso, accion'),
    db.query(
      `SELECT rp.rol_id, rp.permiso_id, p.clave
       FROM roles_permisos rp
       JOIN permisos p ON p.id = rp.permiso_id`
    ),
  ]);

  const matrizMap = {};
  asignaciones.rows.forEach((a) => {
    matrizMap[`${a.rol_id}_${a.permiso_id}`] = true;
  });

  return {
    roles: roles.rows,
    permisos: permisos.rows,
    matriz: matrizMap,
  };
}

/**
 * Toggle de un permiso individual para un rol
 */
async function togglePermiso(rolId, permisoId, activo) {
  if (activo) {
    await db.query(
      'INSERT INTO roles_permisos (rol_id, permiso_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [rolId, permisoId]
    );
  } else {
    await db.query(
      'DELETE FROM roles_permisos WHERE rol_id = $1 AND permiso_id = $2',
      [rolId, permisoId]
    );
  }
  invalidarCache();
}

/**
 * Actualización masiva de permisos para un rol
 */
async function actualizarMatrizRol(rolId, permisosIds) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM roles_permisos WHERE rol_id = $1', [rolId]);
    for (const permisoId of permisosIds) {
      await client.query(
        'INSERT INTO roles_permisos (rol_id, permiso_id) VALUES ($1, $2)',
        [rolId, permisoId]
      );
    }
    await client.query('COMMIT');
    invalidarCache();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Obtener todos los roles (para selects en formularios)
 */
async function getAllRoles() {
  const result = await db.query(
    'SELECT id, nombre, descripcion, es_sistema, activo FROM roles ORDER BY id'
  );
  return result.rows;
}

module.exports = {
  tienePermiso,
  tieneAlgunPermiso,
  getPermisosByRol,
  invalidarCache,
  getMatrizCompleta,
  togglePermiso,
  actualizarMatrizRol,
  getAllRoles,
};
