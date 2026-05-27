const db = require('../config/db');
const permisosService = require('./permisos.service');

function normalizePermisoParts(recursoInput, accionInput) {
  const recurso = String(recursoInput || '')
    .trim()
    .toLowerCase();
  let accion = String(accionInput || '')
    .trim()
    .toLowerCase();

  if (!recurso) throw new Error('El recurso es obligatorio');
  if (!accion) throw new Error('La acción es obligatoria');

  // Si llega como "recurso:accion" o con prefijo repetido, conservar solo la acción final.
  while (accion.startsWith(recurso + ':')) {
    accion = accion.slice(recurso.length + 1);
  }
  if (accion.includes(':')) {
    accion = accion.split(':').pop();
  }
  accion = String(accion || '').trim();
  if (!accion) throw new Error('La acción es obligatoria');

  return {
    recurso,
    accion,
    clave: recurso + ':' + accion,
  };
}

// ═══════════════════════════════════════════════════════
//  ROLES – CRUD
// ═══════════════════════════════════════════════════════

exports.getAllRoles = async () => {
  const r = await db.query(
    'SELECT id, nombre, descripcion, es_sistema, activo, created_at FROM roles ORDER BY id'
  );
  return r.rows;
};

exports.createRol = async ({
  nombre,
  descripcion = null,
  es_sistema = false,
  activo = true,
}) => {
  const r = await db.query(
    `INSERT INTO roles (nombre, descripcion, es_sistema, activo)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nombre, descripcion, es_sistema, activo, created_at`,
    [nombre, descripcion, es_sistema, activo]
  );
  return r.rows[0];
};

exports.updateRol = async (id, { nombre, descripcion, activo }) => {
  const check = await db.query('SELECT es_sistema FROM roles WHERE id = $1', [
    id,
  ]);
  if (!check.rows.length) throw new Error('Rol no encontrado');
  if (check.rows[0].es_sistema && activo === false) {
    throw new Error('No se puede desactivar un rol de sistema');
  }
  const r = await db.query(
    `UPDATE roles SET nombre = $1, descripcion = $2, activo = $3
     WHERE id = $4
     RETURNING id, nombre, descripcion, es_sistema, activo, created_at`,
    [nombre, descripcion, activo, id]
  );
  if (!r.rows.length) throw new Error('Rol no encontrado');
  permisosService.invalidarCache();
  return r.rows[0];
};

exports.deleteRol = async (id) => {
  const check = await db.query('SELECT es_sistema FROM roles WHERE id = $1', [
    id,
  ]);
  if (!check.rows.length) throw new Error('Rol no encontrado');
  if (check.rows[0].es_sistema)
    throw new Error('No se puede eliminar un rol de sistema');
  const r = await db.query('DELETE FROM roles WHERE id = $1 RETURNING id', [
    id,
  ]);
  if (!r.rows.length) throw new Error('Rol no encontrado');
  permisosService.invalidarCache();
};

// ═══════════════════════════════════════════════════════
//  PERMISOS – CRUD
// ═══════════════════════════════════════════════════════

exports.getAllPermisos = async () => {
  const r = await db.query(
    'SELECT id, recurso, accion, clave, descripcion, created_at FROM permisos ORDER BY recurso, accion'
  );

  // Auto-corrección defensiva de claves/acciones mal formadas históricas.
  let changed = false;
  for (const row of r.rows) {
    const normalized = normalizePermisoParts(row.recurso, row.accion);
    if (
      row.recurso !== normalized.recurso ||
      row.accion !== normalized.accion ||
      row.clave !== normalized.clave
    ) {
      await db.query(
        `UPDATE permisos
         SET recurso = $1, accion = $2, clave = $3
         WHERE id = $4`,
        [normalized.recurso, normalized.accion, normalized.clave, row.id]
      );
      row.recurso = normalized.recurso;
      row.accion = normalized.accion;
      row.clave = normalized.clave;
      changed = true;
    }
  }
  if (changed) {
    permisosService.invalidarCache();
  }

  return r.rows;
};

exports.createPermiso = async ({ recurso, accion, descripcion = null }) => {
  const normalized = normalizePermisoParts(recurso, accion);
  const r = await db.query(
    `INSERT INTO permisos (recurso, accion, clave, descripcion)
     VALUES ($1, $2, $3, $4)
     RETURNING id, recurso, accion, clave, descripcion, created_at`,
    [normalized.recurso, normalized.accion, normalized.clave, descripcion]
  );
  permisosService.invalidarCache();
  return r.rows[0];
};

exports.updatePermiso = async (id, { recurso, accion, descripcion }) => {
  const normalized = normalizePermisoParts(recurso, accion);
  const r = await db.query(
    `UPDATE permisos SET recurso = $1, accion = $2, clave = $3, descripcion = $4
     WHERE id = $5
     RETURNING id, recurso, accion, clave, descripcion, created_at`,
    [normalized.recurso, normalized.accion, normalized.clave, descripcion, id]
  );
  if (!r.rows.length) throw new Error('Permiso no encontrado');
  permisosService.invalidarCache();
  return r.rows[0];
};

exports.deletePermiso = async (id) => {
  const r = await db.query('DELETE FROM permisos WHERE id = $1 RETURNING id', [
    id,
  ]);
  if (!r.rows.length) throw new Error('Permiso no encontrado');
  permisosService.invalidarCache();
};

// ═══════════════════════════════════════════════════════
//  MATRIZ – delegada a permisos.service.js
// ═══════════════════════════════════════════════════════

exports.getMatriz = () => permisosService.getMatrizCompleta();

exports.togglePermiso = (rolId, permisoId, activo) =>
  permisosService.togglePermiso(rolId, permisoId, activo);
