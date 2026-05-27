const service = require('../services/turnos.service');
const ApiError = require('../utils/ApiError');

/**
 * Crear un nuevo turno
 */
exports.create = async (req, res, next) => {
  try {
    const turno = await service.create(req.body, req.user.id, req.ip);
    res.status(201).json({
      ok: true,
      message: 'Turno guardado correctamente',
      turnos: turno,
    });
  } catch (error) {
    next(
      new ApiError(
        400,
        error.message || 'Error al crear turno',
        error.detail || error
      )
    );
  }
};

/**
 * Obtener todos los turnos
 */
exports.getAll = async (req, res, next) => {
  try {
    const turnos = await service.getAll();
    res.json({
      ok: true,
      turnos,
      total: turnos.length,
    });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener turnos',
        error.detail || error
      )
    );
  }
};

/**
 * Metadatos para formularios
 */
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
        error.message || 'Error al obtener metadatos de turnos',
        error.detail || error
      )
    );
  }
};

/**
 * Obtener turno por ID
 */
exports.getById = async (req, res, next) => {
  try {
    const turno = await service.getById(req.params.id);
    res.json({
      ok: true,
      turnos: turno,
    });
  } catch (error) {
    const statusCode = error.message === 'Turno no encontrado' ? 404 : 500;
    next(
      new ApiError(
        statusCode,
        error.message || 'Error al obtener turno',
        error.detail || error
      )
    );
  }
};

/**
 * Actualizar turno
 */
exports.update = async (req, res, next) => {
  try {
    const turno = await service.update(
      req.params.id,
      req.body,
      req.user.id,
      req.ip
    );
    res.json({
      ok: true,
      message: 'Turno actualizado correctamente',
      turnos: turno,
    });
  } catch (error) {
    const statusCode = error.message === 'Turno no encontrado' ? 404 : 400;
    next(
      new ApiError(
        statusCode,
        error.message || 'Error al actualizar turno',
        error.detail || error
      )
    );
  }
};

/**
 * Eliminar turno
 */
exports.delete = async (req, res, next) => {
  try {
    const result = await service.delete(req.params.id, req.user.id, req.ip);
    res.json({
      ok: true,
      message: 'Turno eliminado correctamente',
      turnos: result,
    });
  } catch (error) {
    const statusCode =
      error.message === 'Turno no encontrado o ya fue eliminado' ? 404 : 400;
    next(
      new ApiError(
        statusCode,
        error.message || 'Error al eliminar turno',
        error.detail || error
      )
    );
  }
};

/**
 * Obtener historial de cambios de un turno
 */
exports.getHistorial = async (req, res, next) => {
  try {
    const historial = await service.getHistorialByTurno(req.params.id);
    res.json({
      ok: true,
      historial,
      total: historial.length,
    });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener historial',
        error.detail || error
      )
    );
  }
};
