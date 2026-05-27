const svc = require('../services/cuadrantes.service');
const ApiError = require('../utils/ApiError');

function handler(fn) {
  return async (req, res, next) => {
    try {
      const result = await fn(req);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err instanceof ApiError ? err : new ApiError(400, err.message));
    }
  };
}

exports.getAll = handler(async (req) => ({
  data: await svc.getAll(req.arsId),
}));
exports.getById = handler(async (req) => ({
  data: await svc.getById(req.params.id, req.arsId),
}));
exports.preview = handler(async (req) => {
  const {
    anio,
    mes,
    num_semanas,
    fecha_inicio,
    fecha_fin,
    anio_referencia,
    mes_referencia,
  } = req.query;
  return {
    data: await svc.preview(
      Number(anio),
      Number(mes),
      Number(num_semanas) || null,
      fecha_inicio || null,
      fecha_fin || null,
      anio_referencia || null,
      mes_referencia || null,
      req.arsId
    ),
  };
});
exports.create = handler(async (req) => ({
  data: await svc.create(req.body, req.user, req.arsId),
}));
exports.update = handler(async (req) => ({
  data: await svc.update(req.params.id, req.body, req.arsId),
}));
exports.remove = handler(async (req) => {
  await svc.remove(req.params.id, req.arsId);
  return {};
});
exports.importar = handler(async (req) => {
  if (!req.file) throw new ApiError(400, 'Fichero no proporcionado');
  const formato = req.body.formato || detectFormat(req.file.originalname);
  return {
    data: await svc.importar(
      req.params.id,
      req.file.buffer,
      formato,
      req.file.originalname,
      req.user,
      req.arsId
    ),
  };
});

function detectFormat(filename) {
  if (filename.endsWith('.csv')) return 'csv';
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) return 'xlsx';
  if (filename.endsWith('.json')) return 'json';
  return 'csv';
}
