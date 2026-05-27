const service = require('../services/agentes.service');
const ApiError = require('../utils/ApiError');

/**
 * Crear un nuevo agente
 */
exports.create = async (req, res, next) => {
  try {
    const agente = await service.create(req.body, req.arsId);
    res.status(201).json({
      ok: true,
      message: 'Agente guardado correctamente',
      agentes: agente,
    });
  } catch (error) {
    next(
      new ApiError(
        400,
        error.message || 'Error al crear agente',
        error.detail || error
      )
    );
  }
};

/**
 * Subir avatar de agente por TIP
 */
exports.uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      throw new Error('Debe seleccionar una imagen de avatar');
    }
    const tip = String((req.body && req.body.tip) || '').trim().toUpperCase();
    if (!/^[A-Z][0-9]{5}[A-Z]$/.test(tip)) {
      throw new Error('El TIP debe tener formato A99999A');
    }

    const avatar = await service.uploadAvatarByTip({
      tip,
      arsUnidadId: req.arsId,
      fileBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    res.json({
      ok: true,
      message: 'Avatar actualizado correctamente',
      avatar,
    });
  } catch (error) {
    next(
      new ApiError(
        400,
        error.message || 'Error al subir avatar',
        error.detail || error
      )
    );
  }
};

/**
 * Obtener todos los agentes
 */
exports.getAll = async (req, res, next) => {
  try {
    const agentes = await service.getAll(req.arsId);
    res.json({
      ok: true,
      agentes: agentes,
      total: agentes.length,
    });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener agentes',
        error.detail || error
      )
    );
  }
};

/**
 * Obtener agente por ID
 */
exports.getById = async (req, res, next) => {
  try {
    const agente = await service.getById(req.params.id, req.arsId);
    res.json({
      ok: true,
      agentes: agente,
    });
  } catch (error) {
    next(
      new ApiError(
        error.message === 'Agente no encontrado' ? 404 : 500,
        error.message || 'Error al obtener agente',
        error.detail || error
      )
    );
  }
};

/**
 * Actualizar agente
 */
exports.update = async (req, res, next) => {
  try {
    const agente = await service.update(req.params.id, req.body, req.arsId);
    res.json({
      ok: true,
      message: 'Agente actualizado correctamente',
      agentes: agente,
    });
  } catch (error) {
    const statusCode = error.message === 'Agente no encontrado' ? 404 : 400;
    next(
      new ApiError(
        statusCode,
        error.message || 'Error al actualizar agente',
        error.detail || error
      )
    );
  }
};

/**
 * Metadatos para formularios (situaciones)
 */
exports.getMeta = async (req, res, next) => {
  try {
    const meta = await service.getMeta();
    res.json({ ok: true, ...meta });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener metadatos',
        error.detail || error
      )
    );
  }
};

/**
 * Dar de baja agente
 */
exports.delete = async (req, res, next) => {
  try {
    const result = await service.delete(req.params.id, req.arsId);
    res.json({
      ok: true,
      message: result.message || 'Estado del agente actualizado correctamente',
      agentes: result,
    });
  } catch (error) {
    const statusCode = error.message === 'Agente no encontrado' ? 404 : 400;
    next(
      new ApiError(
        statusCode,
        error.message || 'Error al cambiar estado del agente',
        error.detail || error
      )
    );
  }
};

exports.altasMasivas = async (req, res, next) => {
  try {
    const result = await service.altasMasivas(req.body.rows || [], req.arsId);
    res.json({
      ok: true,
      message: 'Altas masivas procesadas correctamente',
      result,
    });
  } catch (error) {
    next(
      new ApiError(
        400,
        error.message || 'Error en altas masivas de agentes',
        error.detail || error
      )
    );
  }
};

exports.bajasMasivas = async (req, res, next) => {
  try {
    const result = await service.bajasMasivas(req.body || {}, req.arsId);
    res.json({
      ok: true,
      message: 'Bajas masivas procesadas correctamente',
      result,
    });
  } catch (error) {
    next(
      new ApiError(
        400,
        error.message || 'Error en bajas masivas de agentes',
        error.detail || error
      )
    );
  }
};
