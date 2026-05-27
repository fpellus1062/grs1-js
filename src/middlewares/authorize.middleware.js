const {
  tienePermiso,
  tieneAlgunPermiso,
} = require('../services/permisos.service');

/**
 * Middleware de autorización basado en permisos RBAC
 *
 * Uso en rutas:
 *   authorize('agentes:crear')                      → permiso exacto
 *   authorize('agentes:crear', 'agentes:editar')    → al menos uno
 *   authorize(['agentes:crear', 'agentes:editar'])  → al menos uno (array)
 *
 * Compatibilidad legacy (tokens sin role_id):
 *   authorize('admin')  → sigue funcionando para tokens antiguos
 */
module.exports = (...requiredPermisos) => {
  // Aplanar si pasaron un array como primer argumento
  const permisos =
    requiredPermisos.length === 1 && Array.isArray(requiredPermisos[0])
      ? requiredPermisos[0]
      : requiredPermisos;

  return async (req, res, next) => {
    try {
      const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

      // 1. Verificar que el usuario está autenticado
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          message: 'Usuario no autenticado',
        });
      }

      // 1.b Regla global: el rol consulta es solo lectura en todos los CRUD.
      const userRoleName = String(req.user.role || '').trim().toLowerCase();
      const isConsultaRole = userRoleName === 'consulta';
      if (isConsultaRole && WRITE_METHODS.has(String(req.method || '').toUpperCase())) {
        return res.status(403).json({
          ok: false,
          message: 'El rol consulta solo tiene permisos de lectura',
        });
      }

      const roleId = req.user.role_id;

      // 2. Si NO tiene role_id en el token → modo compatibilidad legacy
      if (!roleId) {
        const userRole = req.user.role || 'user';

        // Si el permiso solicitado es el string 'admin' y el usuario es admin → permitir
        // Esto cubre el caso de tokens generados antes de la migración RBAC
        if (permisos.includes('admin') && userRole === 'admin') {
          return next();
        }

        // Para cualquier otro permiso granular sin role_id → denegar
        return res.status(403).json({
          ok: false,
          message:
            'Sesión sin permisos RBAC. Por favor, vuelva a iniciar sesión.',
        });
      }

      // 3. Flujo RBAC: verificar contra la matriz en BBDD (caché)
      let autorizado = false;

      if (permisos.length === 1) {
        autorizado = await tienePermiso(roleId, permisos[0]);
      } else {
        autorizado = await tieneAlgunPermiso(roleId, permisos);
      }

      if (!autorizado) {
        return res.status(403).json({
          ok: false,
          message: `Acceso denegado. Permisos requeridos: ${permisos.join(' o ')}`,
        });
      }

      // 4. Autorizado → continuar
      next();
    } catch (error) {
      console.error('[RBAC] Error en autorización:', error.message);
      return res.status(500).json({
        ok: false,
        message: 'Error en verificación de autorización',
      });
    }
  };
};
