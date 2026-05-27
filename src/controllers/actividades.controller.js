const service = require('../services/actividades.service');
const ApiError = require('../utils/ApiError');

exports.create = async (req, res, next) => {
  try {
    const actividad = await service.create(req.body, req.user.id);
    res.status(201).json({
      ok: true,
      message: 'Actividad guardada correctamente',
      actividades: actividad,
    });
  } catch (error) {
    next(
      new ApiError(
        400,
        error.message || 'Error al crear actividad',
        error.detail || error
      )
    );
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const actividades = await service.getAll();
    // Evita datos stale tras baja/reactivación en la grilla.
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      actividades,
      total: actividades.length,
    });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener actividades',
        error.detail || error
      )
    );
  }
};

exports.getMeta = async (req, res, next) => {
  try {
    const meta = await service.getMeta();
    res.json({
      ok: true,
      ...meta,
    });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener metadatos de actividades',
        error.detail || error
      )
    );
  }
};

exports.getById = async (req, res, next) => {
  try {
    const actividad = await service.getById(req.params.id);
    res.json({
      ok: true,
      actividades: actividad,
    });
  } catch (error) {
    next(
      new ApiError(
        error.message === 'Actividad no encontrada' ? 404 : 500,
        error.message || 'Error al obtener actividad',
        error.detail || error
      )
    );
  }
};

exports.update = async (req, res, next) => {
  try {
    const actividad = await service.update(req.params.id, req.body);
    res.json({
      ok: true,
      message: 'Actividad actualizada correctamente',
      actividades: actividad,
    });
  } catch (error) {
    const statusCode = error.message === 'Actividad no encontrada' ? 404 : 400;
    next(
      new ApiError(
        statusCode,
        error.message || 'Error al actualizar actividad',
        error.detail || error
      )
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const result = await service.delete(req.params.id);
    res.json({
      ok: true,
      message:
        result.message || 'Estado de actividad actualizado correctamente',
      actividades: result,
    });
  } catch (error) {
    const statusCode = error.message === 'Actividad no encontrada' ? 404 : 400;
    next(
      new ApiError(
        statusCode,
        error.message || 'Error al cambiar estado de actividad',
        error.detail || error
      )
    );
  }
};
