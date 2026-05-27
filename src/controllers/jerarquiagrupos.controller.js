const service = require('../services/jerarquiagrupos.service');
const ApiError = require('../utils/ApiError');

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

exports.getGrupos = async (req, res, next) => {
  try {
    const grupos = await service.getGruposTree();
    res.json({ ok: true, grupos });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener grupos',
        error.detail || error
      )
    );
  }
};

exports.createGrupo = async (req, res, next) => {
  try {
    const grupo = await service.createGrupo(req.body);
    res
      .status(201)
      .json({ ok: true, message: 'Grupo creado correctamente', grupo });
  } catch (error) {
    next(
      new ApiError(
        400,
        error.message || 'Error al crear grupo',
        error.detail || error
      )
    );
  }
};

exports.updateGrupo = async (req, res, next) => {
  try {
    const grupo = await service.updateGrupo(req.params.id, req.body);
    res.json({ ok: true, message: 'Grupo actualizado correctamente', grupo });
  } catch (error) {
    const status = error.message === 'Grupo no encontrado' ? 404 : 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al actualizar grupo',
        error.detail || error
      )
    );
  }
};

exports.deleteGrupo = async (req, res, next) => {
  try {
    const result = await service.deleteGrupo(req.params.id);
    res.json({
      ok: true,
      message: 'Grupo eliminado correctamente',
      grupo: result,
    });
  } catch (error) {
    const status = (error.message || '').includes('no encontrado') ? 404 : 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al eliminar grupo',
        error.detail || error
      )
    );
  }
};

exports.getActividadesByGrupo = async (req, res, next) => {
  try {
    const actividades = await service.getActividadesByGrupo(req.params.id);
    res.json({ ok: true, actividades });
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

exports.createActividad = async (req, res, next) => {
  try {
    const actividad = await service.createActividad(req.body, req.user.id);
    res
      .status(201)
      .json({ ok: true, message: 'Actividad creada correctamente', actividad });
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

exports.updateActividad = async (req, res, next) => {
  try {
    const actividad = await service.updateActividad(req.params.id, req.body);
    res.json({
      ok: true,
      message: 'Actividad actualizada correctamente',
      actividad,
    });
  } catch (error) {
    const status = error.message === 'Actividad no encontrada' ? 404 : 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al actualizar actividad',
        error.detail || error
      )
    );
  }
};

exports.deleteActividad = async (req, res, next) => {
  try {
    const result = await service.deleteActividad(req.params.id);
    res.json({
      ok: true,
      message: result.message || 'Estado de actividad cambiado',
      actividad: result,
    });
  } catch (error) {
    const status = (error.message || '').includes('no encontrada') ? 404 : 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al cambiar estado de actividad',
        error.detail || error
      )
    );
  }
};

exports.toggleActividadBaja = async (req, res, next) => {
  try {
    const result = await service.toggleActividadBaja(req.params.id);
    res.json({
      ok: true,
      message: result.message,
      actividad: result,
    });
  } catch (error) {
    const status = (error.message || '').includes('no encontrada') ? 404 : 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al cambiar estado de actividad',
        error.detail || error
      )
    );
  }
};
