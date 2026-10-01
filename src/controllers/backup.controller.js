const svc = require('../services/backup.service');
const ApiError = require('../utils/ApiError');

function handler(fn) {
  return async (req, res, next) => {
    try {
      const result = await fn(req, res);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(new ApiError(400, error.message));
    }
  };
}

exports.getCatalogo = handler(async () => ({ data: svc.getCatalog() }));

exports.listar = handler(async () => ({ data: await svc.listarBackups() }));

exports.preview = handler(async (req) => ({ data: await svc.preview(req.body) }));

exports.exportar = handler(async (req) => ({ data: await svc.exportar(req.body) }));

exports.eliminar = handler(async (req) => ({
  data: await svc.eliminarExportado(req.body),
}));

exports.importar = handler(async (req) => ({ data: await svc.importar(req.body) }));
