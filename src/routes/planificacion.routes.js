'use strict';

const router = require('express').Router();
const controller = require('../controllers/planificacion.controller');
const auth = require('../middlewares/auth.middleware');
const tenant = require('../middlewares/tenant.middleware');
const authorize = require('../middlewares/authorize.middleware');

router.use(auth);
router.use(tenant);

// ── Planes ────────────────────────────────────────────────────
router.get('/planes', authorize('planificacion:leer'), controller.listarPlanes);
router.get('/planes/:planId', authorize('planificacion:leer'), controller.obtenerPlanPorId);
router.post('/planes', authorize('planificacion:editar'), controller.crearPlan);

// ── Borradores de un plan ─────────────────────────────────────
router.get(
  '/planes/:planId/borradores',
  authorize('planificacion:leer'),
  controller.listarBorradores
);
router.post(
  '/planes/:planId/borradores',
  authorize('planificacion:editar'),
  controller.crearBorrador
);

// ── Copiar desde plan anterior ─────────────────────────────────
router.post(
  '/planes/:planId/copiar-desde-plan',
  authorize('planificacion:copiar'),
  controller.copiarDesdePlan
);

// ── Asignaciones (por versión) ────────────────────────────────
router.get(
  '/versiones/:versionId/asignaciones',
  authorize('planificacion:leer'),
  controller.listarAsignaciones
);
router.put(
  '/versiones/:versionId/asignaciones/bulk',
  authorize('planificacion:editar'),
  controller.guardarBulk
);

// ── Exportar agentes a Excel ──────────────────────────────────
router.post(
  '/versiones/:versionId/agentes/excel',
  authorize('planificacion:leer'),
  controller.exportarAgentesExcel
);

// ── Aprobar versión ───────────────────────────────────────────
router.post(
  '/versiones/:versionId/aprobar',
  authorize('planificacion:aprobar'),
  controller.aprobar
);

router.post(
  '/borradores/:borradorId/descartar',
  authorize('planificacion:editar'),
  controller.descartarBorrador
);

// ── Borrado ordenado ──────────────────────────────────────────
router.delete(
  '/versiones/:versionId',
  authorize('planificacion:editar'),
  controller.borrarVersion
);
router.delete(
  '/borradores/:borradordId',
  authorize('planificacion:editar'),
  controller.borrarBorrador
);
router.delete(
  '/planes/:planId',
  authorize('planificacion:editar'),
  controller.borrarPlan
);

module.exports = router;
