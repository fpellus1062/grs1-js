const router = require('express').Router();
const controller = require('../controllers/asignaciones.controller');
const validate = require('../middlewares/validate.middleware');
const auth = require('../middlewares/auth.middleware');
const tenant = require('../middlewares/tenant.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  periodoParamsSchema,
  upsertSchema,
  bulkSchema,
  deleteSchema,
  copiarMesSchema,
  validarSchema,
  previewReglasEspecialesSchema,
  consolidarDevengosSchema,
  historialQuerySchema,
  borradoresParamsSchema,
  crearBorradorSchema,
  deleteBorradorSchema,
  updateBorradorObservacionesSchema,
  exportarCuadranteSchema,
} = require('../validators/asignaciones.validator');

router.use(auth);
router.use(tenant);

// Lectura
router.get('/meta', authorize('asignaciones:leer'), controller.getMeta);
router.get(
  '/periodos-disponibles',
  authorize('asignaciones:leer'),
  controller.getPeriodosDisponibles
);
router.get(
  '/stats/actividades',
  authorize('asignaciones:leer'),
  controller.getActividadesStats
);
router.get(
  '/cuadrante/:anio/:mes',
  authorize('asignaciones:leer'),
  validate(periodoParamsSchema, 'params'),
  controller.getCuadrante
);
router.get(
  '/borradores/:anio/:mes',
  authorize('asignaciones:leer'),
  validate(borradoresParamsSchema, 'params'),
  controller.getBorradores
);
router.get(
  '/historial',
  authorize('asignaciones:historial'),
  validate(historialQuerySchema, 'query'),
  controller.getHistorial
);
router.get(
  '/historial/pdf',
  authorize('asignaciones:historial'),
  validate(historialQuerySchema, 'query'),
  controller.exportarHistorialPdf
);
router.get(
  '/historial/excel',
  authorize('asignaciones:historial'),
  validate(historialQuerySchema, 'query'),
  controller.exportarHistorialExcel
);
router.get(
  '/historial/csv',
  authorize('asignaciones:historial'),
  validate(historialQuerySchema, 'query'),
  controller.exportarHistorialCsv
);
router.post(
  '/historial/marcar',
  authorize('asignaciones:historial'),
  validate(historialQuerySchema, 'query'),
  controller.marcarHistorialComunicados
);
router.get(
  '/exportar',
  authorize('asignaciones:leer'),
  validate(exportarCuadranteSchema, 'query'),
  controller.exportarCuadrante
);
router.get(
  '/resumen-actividades',
  authorize('asignaciones:leer'),
  controller.obtenerResumenActividades
);
router.get(
  '/resumen-actividades/excel',
  authorize('asignaciones:leer'),
  controller.exportarResumenActividades
);

// Escritura
router.post(
  '/borradores',
  authorize('asignaciones:crear'),
  validate(crearBorradorSchema),
  controller.createBorrador
);
router.patch(
  '/borradores/:id/observaciones',
  authorize('asignaciones:crear'),
  validate(updateBorradorObservacionesSchema),
  controller.updateBorradorObservaciones
);
router.delete(
  '/borradores/:id',
  authorize('asignaciones:eliminar'),
  validate(deleteBorradorSchema, 'params'),
  controller.deleteBorradorCompletamente
);
router.post(
  '/upsert',
  authorize('asignaciones:crear'),
  validate(upsertSchema),
  controller.upsert
);
router.post(
  '/bulk',
  authorize('asignaciones:crear'),
  validate(bulkSchema),
  controller.bulk
);
router.post(
  '/copiar-mes',
  authorize('asignaciones:copiar'),
  validate(copiarMesSchema),
  controller.copiarMes
);
router.delete(
  '/borrador',
  authorize('asignaciones:eliminar'),
  validate(deleteSchema),
  controller.deleteBorrador
);

// Validaci?n (solo supervisor/admin)
router.post(
  '/validar/preview-reglas-especiales',
  authorize('asignaciones:validar'),
  validate(previewReglasEspecialesSchema),
  controller.previewReglasEspecialesValidacion
);
router.post(
  '/validar',
  authorize('asignaciones:validar'),
  validate(validarSchema),
  controller.validar
);

router.post(
  '/devengos/consolidar',
  authorize('asignaciones:crear'),
  validate(consolidarDevengosSchema),
  controller.consolidarDevengos
);

router.post(
  '/devengos/consolidar-pendientes',
  authorize('asignaciones:crear'),
  controller.consolidarDevengosPendientes
);

// Alias GET de compatibilidad para clientes antiguos que no envían POST.
router.get(
  '/devengos/consolidar-pendientes',
  authorize('asignaciones:crear'),
  controller.consolidarDevengosPendientes
);

router.get(
  '/devengos/pendientes-resumen',
  authorize('asignaciones:leer'),
  controller.getDevengosPendientesResumen
);

// Devengo inicial por agente (saldo acumulado hasta inicio de mes)
router.get(
  '/devengo-inicial',
  authorize('asignaciones:leer'),
  async (req, res, next) => {
    try {
      const anio = Number(req.query.anio);
      const mes = Number(req.query.mes);
      const agenteId = req.query.agente_id ? Number(req.query.agente_id) : null;

      if (!anio || !mes) {
        return res
          .status(400)
          .json({ ok: false, error: 'anio y mes requeridos' });
      }

      const saldos =
        await require('../services/asignaciones.service').getSaldosDevengoInicial(
          anio,
          mes,
          req.arsId,
          agenteId
        );

      res.json({ ok: true, saldos });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
