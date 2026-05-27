const service = require('../services/auth.service');
const ApiError = require('../utils/ApiError');

exports.register = async (req, res, next) => {
  try {
    const user = await service.register(req.body);
    res.status(201).json({ ok: true, user });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};

exports.login = async (req, res, next) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress;
    const user_agent = req.get('User-Agent') || '';
    const result = await service.login(req.body, { ip, user_agent });
    res.json({
      ok: true,
      token: result.token,
      role: result.role,
      role_id: result.role_id,
      nombre: result.nombre,
      tip: result.tip || null,
      permisos: result.permisos || [],
      ars_ids: result.ars_ids || [],
      ars_catalog: result.ars_catalog || [],
    });
  } catch (error) {
    next(new ApiError(401, error.message));
  }
};

exports.getProfile = async (req, res, next) => {
  try {
    const profile = await service.getProfile(req.user.id);
    res.json({ ok: true, profile });
  } catch (err) {
    next(new ApiError(404, err.message));
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const profile = await service.updateProfile(req.user.id, req.body);
    res.json({ ok: true, profile });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    await service.changePassword(req.user.id, req.body);
    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};
