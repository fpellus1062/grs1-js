const svc = require('../services/calendarios.service');
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

// ─── Calendarios ────────────────────────────────────────────────────────────
exports.getAll = handler(async (req) => ({
  data: await svc.getAll({ arsId: req.query.ars_id || null }),
}));
exports.getById = handler(async (req) => ({
  data: await svc.getById(req.params.id),
}));
exports.create = handler(async (req) => ({
  data: await svc.create(req.body, req.user && req.user.id),
}));
exports.update = handler(async (req) => ({
  data: await svc.update(req.params.id, req.body),
}));
exports.remove = handler(async (req) => {
  await svc.remove(req.params.id);
  return {};
});

// ─── Festivos ───────────────────────────────────────────────────────────────
exports.getFestivos = handler(async (req) => ({
  data: await svc.getFestivos(req.params.calId),
}));
exports.createFestivo = handler(async (req) => ({
  data: await svc.createFestivo(req.params.calId, req.body),
}));
exports.updateFestivo = handler(async (req) => ({
  data: await svc.updateFestivo(req.params.id, req.body),
}));
exports.removeFestivo = handler(async (req) => {
  await svc.removeFestivo(req.params.id);
  return {};
});
