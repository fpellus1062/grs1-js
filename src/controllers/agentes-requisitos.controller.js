const service = require('../services/agentes-requisitos.service');
const ApiError = require('../utils/ApiError');

exports.getMeta = async (req, res, next) => {
  try {
    const meta = await service.getMeta(req.arsId);
    res.json({ ok: true, ...meta });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al obtener metadatos de requisitos', error.detail || error));
  }
};

exports.list = async (req, res, next) => {
  try {
    const rows = await service.listPeriodos(req.arsId, req.query || {});
    res.json({ ok: true, requisitos: rows, total: rows.length });
  } catch (error) {
    const msg = String((error && error.message) || '');
    const status = msg.toLowerCase().includes('fecha de servicio') ? 400 : 500;
    next(new ApiError(status, msg || 'Error al obtener requisitos periódicos', error.detail || error));
  }
};

exports.listPlantillas = async (req, res, next) => {
  try {
    const includeInactive = String((req.query && req.query.include_inactive) || '').toLowerCase() === '1'
      || String((req.query && req.query.include_inactive) || '').toLowerCase() === 'true';
    const rows = await service.listPlantillas(req.arsId, { include_inactive: includeInactive });
    res.json({ ok: true, plantillas: rows, total: rows.length });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al obtener plantillas', error.detail || error));
  }
};

exports.createPlantilla = async (req, res, next) => {
  try {
    const userId = Number(req.user && req.user.id) || null;
    const result = await service.createPlantilla(req.arsId, req.body, userId);
    res.status(201).json({ ok: true, message: 'Plantilla creada correctamente', plantilla: result });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al crear plantilla', error.detail || error));
  }
};

exports.updatePlantilla = async (req, res, next) => {
  try {
    const userId = Number(req.user && req.user.id) || null;
    const result = await service.updatePlantilla(req.arsId, Number(req.params.id), req.body, userId);
    res.json({ ok: true, message: 'Plantilla actualizada correctamente', plantilla: result });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al actualizar plantilla', error.detail || error));
  }
};

exports.deletePlantilla = async (req, res, next) => {
  try {
    const userId = Number(req.user && req.user.id) || null;
    const result = await service.deletePlantilla(req.arsId, Number(req.params.id), userId);
    res.json({ ok: true, message: 'Plantilla desactivada correctamente', plantilla: result });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al eliminar plantilla', error.detail || error));
  }
};

exports.assignPlantilla = async (req, res, next) => {
  try {
    const userId = Number(req.user && req.user.id) || null;
    const result = await service.assignPlantilla(req.arsId, req.body, userId);
    res.json({ ok: true, message: 'Plantilla asignada correctamente', result: result });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al asignar plantilla', error.detail || error));
  }
};

exports.registerEjecucion = async (req, res, next) => {
  try {
    const userId = Number(req.user && req.user.id) || null;
    const result = await service.registerEjecucion(req.arsId, req.body, userId);
    res.json({ ok: true, message: 'Prueba registrada correctamente', result: result });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al registrar prueba', error.detail || error));
  }
};

exports.registerEjecucionBulk = async (req, res, next) => {
  try {
    const userId = Number(req.user && req.user.id) || null;
    const result = await service.registerEjecucionBulk(req.arsId, req.body, userId);
    res.json({ ok: true, message: 'Registro masivo de pruebas procesado', result: result });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al registrar pruebas masivas', error.detail || error));
  }
};

exports.registerEjecucionMulti = async (req, res, next) => {
  try {
    const userId = Number(req.user && req.user.id) || null;
    const result = await service.registerEjecucionMulti(req.arsId, req.body, userId);
    res.json({ ok: true, message: 'Registro múltiple de aprobaciones procesado', result: result });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al registrar aprobaciones múltiples', error.detail || error));
  }
};

exports.sancionarPeriodo = async (req, res, next) => {
  try {
    const userId = Number(req.user && req.user.id) || null;
    const result = await service.sancionarPeriodo(req.arsId, req.body, userId);
    res.json({ ok: true, message: 'Sanción registrada correctamente', result: result });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al sancionar período', error.detail || error));
  }
};

exports.exportHistoricoEjecucionesExcel = async (req, res, next) => {
  try {
    const agenteIds = String((req.query && req.query.agente_ids) || '')
      .split(',')
      .map((x) => Number(String(x).trim()))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (!agenteIds.length) {
      throw new ApiError(400, 'Debe indicar al menos un agente para exportar histórico.');
    }

    const { buffer, filename } = await service.buildHistoricoEjecucionesExcel(req.arsId, agenteIds);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const contentLength = Buffer.from(buffer).byteLength;
    res.setHeader('Content-Length', String(contentLength));
    res.status(200).send(buffer);
  } catch (error) {
    if (error instanceof ApiError) {
      next(error);
      return;
    }
    next(new ApiError(400, error.message || 'Error al exportar histórico de requisitos', error.detail || error));
  }
};
