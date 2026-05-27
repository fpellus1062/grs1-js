// ═══════════════════════════════════════════════════════
//  GRS1 — Helper de permisos RBAC para el frontend
// ═══════════════════════════════════════════════════════

/**
 * Verificar si el usuario actual tiene un permiso
 * @param {string} permiso - Ej: 'agentes:crear'
 * @returns {boolean}
 */
function tienePermiso(permiso) {
  try {
    const permisos = JSON.parse(localStorage.getItem('userPermisos') || '[]');
    if (!Array.isArray(permisos)) return false;

    const normalize = (value) =>
      String(value || '')
        .trim()
        .toLowerCase();

    const requestedAny = normalize(permiso)
      .split(/[|,]/)
      .map((p) => normalize(p))
      .filter(Boolean);
    if (!requestedAny.length) return true;

    const granted = permisos
      .map((p) => {
        if (typeof p === 'string') return normalize(p);
        if (p && typeof p === 'object') {
          return normalize(p.clave || p.key || p.permiso || p.nombre);
        }
        return '';
      })
      .filter(Boolean);

    return requestedAny.some((p) => granted.includes(p));
  } catch {
    return false;
  }
}

/**
 * Verificar si tiene al menos uno de varios permisos
 * @param  {...string} permisos
 * @returns {boolean}
 */
function tieneAlgunPermiso(...permisos) {
  try {
    const userPermisos = JSON.parse(
      localStorage.getItem('userPermisos') || '[]'
    );
    return permisos.some((p) => userPermisos.includes(p));
  } catch {
    return false;
  }
}

/**
 * Verificar si tiene TODOS los permisos indicados
 * @param  {...string} permisos
 * @returns {boolean}
 */
function tieneTodosPermisos(...permisos) {
  try {
    const userPermisos = JSON.parse(
      localStorage.getItem('userPermisos') || '[]'
    );
    return permisos.every((p) => userPermisos.includes(p));
  } catch {
    return false;
  }
}

/**
 * Aplicar permisos al DOM: ocultar elementos sin permiso
 *
 * Uso en HTML:
 *   <button data-permiso="agentes:crear">Nuevo Agente</button>
 *   <button data-permiso="agentes:eliminar" data-permiso-accion="disable">Eliminar</button>
 *
 * data-permiso-accion:
 *   "hide"    → display:none (por defecto)
 *   "disable" → disabled + opacity
 *   "remove"  → elimina el nodo del DOM
 */
function aplicarPermisos() {
  document.querySelectorAll('[data-permiso]').forEach((el) => {
    const permiso = el.dataset.permiso;
    const accion = el.dataset.permisoAccion || 'hide';

    if (!tienePermiso(permiso)) {
      switch (accion) {
        case 'disable':
          el.disabled = true;
          el.style.opacity = '0.4';
          el.style.pointerEvents = 'none';
          el.title = 'No tiene permiso para esta acción';
          break;
        case 'remove':
          el.remove();
          break;
        case 'hide':
        default:
          el.style.display = 'none';
          break;
      }
    }
  });
}

/**
 * Guardar permisos tras login exitoso
 * Llamar después de recibir la respuesta del login:
 *
 *   const data = await response.json();
 *   guardarDatosSesion(data);
 */
function guardarDatosSesion(loginResponse) {
  localStorage.setItem('token', loginResponse.token);
  localStorage.setItem('userRole', loginResponse.role || 'user');
  localStorage.setItem('userRoleId', loginResponse.role_id || '');
  localStorage.setItem('userNombre', loginResponse.nombre || '');
  localStorage.setItem('userTip', loginResponse.tip || '');
  localStorage.setItem(
    'userPermisos',
    JSON.stringify(loginResponse.permisos || [])
  );
}

/**
 * Limpiar datos de sesión (logout)
 */
function limpiarSesion() {
  localStorage.removeItem('token');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userRoleId');
  localStorage.removeItem('userNombre');
  localStorage.removeItem('userTip');
  localStorage.removeItem('userPermisos');
}

/**
 * Obtener datos de sesión actuales
 */
function getSesion() {
  return {
    token: localStorage.getItem('token'),
    role: localStorage.getItem('userRole') || 'user',
    roleId: localStorage.getItem('userRoleId'),
    nombre: localStorage.getItem('userNombre'),
    tip: localStorage.getItem('userTip') || '',
    permisos: JSON.parse(localStorage.getItem('userPermisos') || '[]'),
  };
}

// Aplicar permisos automáticamente al cargar cada página
document.addEventListener('DOMContentLoaded', aplicarPermisos);

// Exponer helpers para que otros scripts/HTML puedan usarlos
/** @type {any} */ (window).GRS1AuthPermisos = {
  tienePermiso,
  tieneAlgunPermiso,
  tieneTodosPermisos,
  guardarDatosSesion,
  limpiarSesion,
  getSesion,
  aplicarPermisos,
};
