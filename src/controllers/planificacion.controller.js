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
    const body = req.body || {};
    const comentario = body.comentario;
    const modo = String(body.modo || '').trim().toLowerCase();

    let result;
    if (modo === 'prepare') {
      result = await service.aprobarChunkPrepare({
        versionId: Number(versionId),
      });
    } else if (modo === 'chunk') {
      result = await service.aprobarChunk({
        versionId: Number(versionId),
        userId: req.user.id,
        offset: body.offset,
        limit: body.limit,
      });
    } else if (modo === 'finalize') {
      result = await service.aprobarChunkFinalize({
        versionId: Number(versionId),
        userId: req.user.id,
        comentario,
      });
    } else {
      result = await service.aprobarConComentario({
        versionId: Number(versionId),
        userId: req.user.id,
        comentario,
      });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al aprobar versión', err));
  }
};

// ─────────────────────────────────────────────
// POST /api/planificacion/versiones/:versionId/traspasar-cuadrante
// ─────────────────────────────────────────────
exports.traspasarCuadrante = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const body = req.body || {};
    const modo = String(body.modo || '').trim().toLowerCase() || 'prepare';
    const cuadranteId = Number(body.cuadrante_id);

    if (!Number.isInteger(cuadranteId) || cuadranteId <= 0) {
      return next(new ApiError(400, 'cuadrante_id inválido'));
    }

    let result;
    if (modo === 'prepare') {
      result = await service.traspasarCuadrantePrepare({
        versionId: Number(versionId),
        cuadranteId,
        arsId: req.arsId,
      });
    } else if (modo === 'chunk') {
      result = await service.traspasarCuadranteChunk({
        versionId: Number(versionId),
        cuadranteId,
        arsId: req.arsId,
        userId: req.user.id,
        offset: body.offset,
        limit: body.limit,
      });
    } else {
      return next(new ApiError(400, 'modo inválido'));
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    next(new ApiError(400, err.message || 'Error al traspasar a cuadrante', err));
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

// ─────────────────────────────────────────────
// POST /api/planificacion/versiones/:versionId/agentes/excel
// ─────────────────────────────────────────────
exports.exportarAgentesExcel = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const { agenteIds = [], fechaInicio, fechaFin } = req.body;

    if (!Array.isArray(agenteIds) || !agenteIds.length) {
      return next(new ApiError(400, 'No hay agentes para exportar'));
    }

    if (!fechaInicio || !fechaFin) {
      return next(new ApiError(400, 'Fechas inválidas para el rango de exportación'));
    }

    // Obtener todas las asignaciones para esta versión (con datos de agentes y actividades)
    const allAsignaciones = await service.listarAsignaciones(Number(versionId));

    // Filtrar por agentes seleccionados y rango de fechas
    const agenteIdSet = new Set(agenteIds.map(id => Number(id)));
    const startISO = String(fechaInicio).slice(0, 10);
    const endISO = String(fechaFin).slice(0, 10);

    const agentesMap = new Map();
    const asignacionesFiltered = [];

    // Construir mapa de agentes únicos con todos sus datos
    allAsignaciones.forEach(a => {
      if (agenteIdSet.has(Number(a.agente_id))) {
        const agenteKey = String(a.agente_id);
        if (!agentesMap.has(agenteKey)) {
          agentesMap.set(agenteKey, {
            agente_id: a.agente_id,
            tip: a.tip || '',
            nombre: `${a.apellido_1 || ''} ${a.apellido_2 || ''} ${a.agente_nombre || ''}`.trim(),
            peloton_desc: a.peloton_desc || '',
            empleo_desc: a.empleo_desc || '',
            empleo_id: a.empleo_id || '',
            aptitudes: a.aptitudes || '',
            situacion_id: a.situacion_id || '',
            situacion_desc: a.situacion_desc || '',
          });
        }

        // Filtrar asignación por rango de fechas
        const fechaISO = String(a.fecha).slice(0, 10);
        if (fechaISO >= startISO && fechaISO <= endISO) {
          asignacionesFiltered.push(a);
        }
      }
    });

    const agentes = Array.from(agentesMap.values());

    // Generar fechas del rango para el Excel
    const start = new Date(fechaInicio);
    const end = new Date(fechaFin);
    const fechas = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      fechas.push(d.toISOString().split('T')[0]);
    }

    // Extraer actividades únicas usadas
    const activitiesMap = new Map();
    asignacionesFiltered.forEach(a => {
      if (a.actividad_id) {
        const key = String(a.actividad_id);
        if (!activitiesMap.has(key)) {
          activitiesMap.set(key, {
            id: a.actividad_id,
            id_actividad: a.actividad_id,
            nombre: a.actividad_nombre || '',
            codigo: a.actividad_codigo || a.actividad || '',
            color: a.actividad_color || '#e8f5e9',
          });
        }
      }
    });

    const actividades = Array.from(activitiesMap.values());

    const excelService = require('../services/planificacionAgentesExcel.service');
    await excelService.buildPlanificacionAgentesExcel(res, {
      agentes,
      asignaciones: asignacionesFiltered,
      fechas,
      actividades,
      fechaHoy: new Date(),
    });
  } catch (err) {
    next(new ApiError(500, err.message || 'Error al exportar agentes a Excel', err));
  }
};
