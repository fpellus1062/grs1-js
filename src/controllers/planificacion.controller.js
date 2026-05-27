'use strict';

const service = require('../services/planificacion.service');
const ApiError = require('../utils/ApiError');

function toPlanPublic(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  const clean = { ...plan };
  delete clean.anio;
  delete clean.mes;
  if (clean.num_meses == null || clean.num_meses === '') {
    clean.num_meses = 1;
  }
  return clean;
}

// ─────────────────────────────────────────────
// GET /api/planificacion/planes
// ─────────────────────────────────────────────
exports.listarPlanes = async (req, res, next) => {
  try {
    const { anio, mes, fecha_ref, limit } = req.query;
    const planes = await service.listarPlanes({
      anio,
      mes,
      fecha_ref,
      limit,
      arsId: req.arsId,
    });
    res.json({
      ok: true,
      planes: Array.isArray(planes) ? planes.map(toPlanPublic) : [],
      total: Array.isArray(planes) ? planes.length : 0,
    });
  } catch (err) {
    next(new ApiError(500, err.message || 'Error al listar planes', err));
  }
};

// ─────────────────────────────────────────────
// GET /api/planificacion/planes/:planId
// ─────────────────────────────────────────────
exports.obtenerPlanPorId = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const plan = await service.obtenerPlanPorId({
      planId: Number(planId),
      arsId: req.arsId,
    });
    if (!plan) {
      return next(new ApiError(404, 'Plan no encontrado'));
    }
    res.json({ ok: true, plan: toPlanPublic(plan) });
  } catch (err) {
    next(new ApiError(500, err.message || 'Error al obtener plan', err));
  }
};

// ─────────────────────────────────────────────
// POST /api/planificacion/planes
// ─────────────────────────────────────────────
exports.crearPlan = async (req, res, next) => {
  try {
    const plan = await service.crearPlan({
      ...req.body,
      arsId: req.arsId,
      userId: req.user.id,
    });
    res.status(201).json({ ok: true, plan: toPlanPublic(plan) });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al crear plan', err));
  }
};

// ─────────────────────────────────────────────
// POST /api/planificacion/planes/:planId/copiar-desde-plan
// ─────────────────────────────────────────────
exports.copiarDesdePlan = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { from_plan_id, draft_nombre, version_descripcion } = req.body;
    if (!from_plan_id) return next(new ApiError(400, 'from_plan_id requerido'));
    const result = await service.copiarDesdePlan({
      planId: Number(planId),
      fromPlanId: Number(from_plan_id),
      draftNombre: draft_nombre,
      versionDesc: version_descripcion,
      userId: req.user.id,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al copiar plan', err));
  }
};

// ─────────────────────────────────────────────
// GET /api/planificacion/versiones/:versionId/asignaciones
// ─────────────────────────────────────────────
exports.listarAsignaciones = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const asignaciones = await service.listarAsignaciones(Number(versionId));
    res.json({ ok: true, asignaciones, total: asignaciones.length });
  } catch (err) {
    next(new ApiError(500, err.message || 'Error al listar asignaciones', err));
  }
};

// ─────────────────────────────────────────────
// PUT /api/planificacion/versiones/:versionId/asignaciones/bulk
// ─────────────────────────────────────────────
exports.guardarBulk = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const { items } = req.body;
    const result = await service.guardarBulk({
      versionId: Number(versionId),
      items,
      userId: req.user.id,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(
      new ApiError(400, err.message || 'Error al guardar asignaciones', err)
    );
  }
};

// ─────────────────────────────────────────────
// POST /api/planificacion/versiones/:versionId/aprobar
// ─────────────────────────────────────────────
exports.aprobar = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const { comentario } = req.body || {};
    const result = await service.aprobarConComentario({
      versionId: Number(versionId),
      userId: req.user.id,
      comentario,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al aprobar versión', err));
  }
};

// ─────────────────────────────────────────────
// POST /api/planificacion/borradores/:borradorId/descartar
// ─────────────────────────────────────────────
exports.descartarBorrador = async (req, res, next) => {
  try {
    const { borradorId } = req.params;
    const result = await service.descartarBorrador({
      borradorId: Number(borradorId),
      userId: req.user.id,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al descartar borrador', err));
  }
};

// ─────────────────────────────────────────────
// GET /api/planificacion/planes/:planId/borradores
// ─────────────────────────────────────────────
exports.listarBorradores = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const borradores = await service.listarBorradores(Number(planId));
    res.json({ ok: true, borradores, total: borradores.length });
  } catch (err) {
    next(new ApiError(500, err.message || 'Error al listar borradores', err));
  }
};

// ─────────────────────────────────────────────
// POST /api/planificacion/planes/:planId/borradores
// ─────────────────────────────────────────────
exports.crearBorrador = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const { nombre, descripcion } = req.body || {};
    const result = await service.crearBorrador({
      planId: Number(planId),
      nombre,
      descripcion,
      userId: req.user.id,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al crear borrador', err));
  }
};

// ─────────────────────────────────────────────
// DELETE /api/planificacion/versiones/:versionId
// ─────────────────────────────────────────────
exports.borrarVersion = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const result = await service.borrarVersion({
      versionId: Number(versionId),
      userId: req.user.id,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al borrar versión', err));
  }
};

// ─────────────────────────────────────────────
// DELETE /api/planificacion/borradores/:borradordId
// ─────────────────────────────────────────────
exports.borrarBorrador = async (req, res, next) => {
  try {
    const { borradordId } = req.params;
    const result = await service.borrarBorrador({
      borradordId: Number(borradordId),
      userId: req.user.id,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al borrar borrador', err));
  }
};

// ─────────────────────────────────────────────
// DELETE /api/planificacion/planes/:planId
// ─────────────────────────────────────────────
exports.borrarPlan = async (req, res, next) => {
  try {
    const { planId } = req.params;
    const result = await service.borrarPlan({
      planId: Number(planId),
      arsId: req.arsId,
      userId: req.user.id,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al borrar plan', err));
  }
};
