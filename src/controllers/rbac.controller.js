const svc = require('../services/rbac.service');
const ApiError = require('../utils/ApiError');

function handler(getFn) {
  return async (req, res, next) => {
    try {
      const result = await getFn(req, res);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(
        new ApiError(
          error.message.includes('no encontrad') ? 404 : 400,
          error.message
        )
      );
    }
  };
}

// ─── Roles ──────────────────────────────────────────────────────────────────
exports.getAllRoles = handler(async () => ({ data: await svc.getAllRoles() }));
exports.createRol = handler(async (req) => ({
  data: await svc.createRol(req.body),
}));
exports.updateRol = handler(async (req) => ({
  data: await svc.updateRol(req.params.id, req.body),
}));
exports.deleteRol = handler(async (req) => {
  await svc.deleteRol(req.params.id);
  return {};
});

// ─── Permisos ───────────────────────────────────────────────────────────────
exports.getAllPermisos = handler(async () => ({
  data: await svc.getAllPermisos(),
}));
exports.createPermiso = handler(async (req) => ({
  data: await svc.createPermiso(req.body),
}));
exports.updatePermiso = handler(async (req) => ({
  data: await svc.updatePermiso(req.params.id, req.body),
}));
exports.deletePermiso = handler(async (req) => {
  await svc.deletePermiso(req.params.id);
  return {};
});

// ─── Matriz roles ↔ permisos ────────────────────────────────────────────────
exports.getMatriz = handler(async () => ({ data: await svc.getMatriz() }));
exports.togglePermiso = handler(async (req) => {
  const { rol_id, permiso_id, activo } = req.body;
  await svc.togglePermiso(rol_id, permiso_id, activo);
  return {};
});
