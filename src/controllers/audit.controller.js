const auditService = require('../services/audit.service');

exports.getLoginLog = async (req, res, next) => {
  try {
    const { usuario_id, resultado, desde, hasta, ip, limit, offset } =
      req.query;
    const result = await auditService.getLoginLog({
      usuario_id: usuario_id ? parseInt(usuario_id, 10) : undefined,
      resultado,
      desde,
      hasta,
      ip,
      limit: limit ? Math.min(parseInt(limit, 10), 500) : 200,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
