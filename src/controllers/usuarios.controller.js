const service = require('../services/usuarios.service');
const ApiError = require('../utils/ApiError');

exports.getAll = async (req, res, next) => {
  try {
    const incluirInactivos = req.query.incluirInactivos === 'true';
    const usuarios = await service.getAll({ incluirInactivos });
    res.json({ ok: true, usuarios });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

exports.getById = async (req, res, next) => {
  try {
    const usuarios = await service.getById(req.params.id);
    if (!usuarios) throw new Error('Usuario no encontrado');
    res.json({ ok: true, usuarios });
  } catch (err) {
    next(new ApiError(404, err.message));
  }
};

exports.create = async (req, res, next) => {
  try {
    const usuarios = await service.create(req.body);
    res.status(201).json({ ok: true, usuarios });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};

exports.update = async (req, res, next) => {
  try {
    const usuarios = await service.update(req.params.id, req.body);
    res.json({ ok: true, usuarios });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};

exports.remove = async (req, res, next) => {
  try {
    await service.remove(req.params.id);
    res.json({ ok: true, message: 'Usuario desactivado' });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};

exports.reactivar = async (req, res, next) => {
  try {
    const usuarios = await service.reactivar(req.params.id);
    res.json({ ok: true, usuarios });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};

exports.desbloquear = async (req, res, next) => {
  try {
    const usuarios = await service.desbloquear(req.params.id);
    res.json({ ok: true, usuarios });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};

exports.getArs = async (req, res, next) => {
  try {
    const ars = await service.getArsByUsuario(req.params.id);
    res.json({ ok: true, ars });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};

exports.setArs = async (req, res, next) => {
  try {
    const arsUnidadIds = req.body?.ars_unidad_ids || [];
    const ars = await service.setArsByUsuario(req.params.id, arsUnidadIds);
    res.json({ ok: true, ars });
  } catch (err) {
    next(new ApiError(400, err.message));
  }
};
