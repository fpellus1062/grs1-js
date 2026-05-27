const router = require('express').Router();
const controller = require('../controllers/asignaciones-reglas.controller');
const validate = require('../middlewares/validate.middleware');
const auth = require('../middlewares/auth.middleware');
const tenant = require('../middlewares/tenant.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  listReglasQuerySchema,
  createReglaSchema,
  updateReglaSchema,
  idParamSchema,
  previewSchema,
  persistirMovimientoManualSchema,
  persistirMovimientoManualBulkSchema,
  saldosQuerySchema,
  ledgerAgentesQuerySchema,
  ledgerSaldosMensualesQuerySchema,
  ledgerMovimientosQuerySchema,
} = require('../validators/asignaciones-reglas.validator');

router.use(auth);
router.use(tenant);

router.get(
  '/reglas',
  authorize('asignaciones-reglas:leer'),
  validate(listReglasQuerySchema, 'query'),
  controller.listReglas
);

router.post(
  '/reglas',
  authorize('asignaciones-reglas:crear'),
  validate(createReglaSchema),
  controller.createRegla
);

router.put(
  '/reglas/:id',
  authorize('asignaciones-reglas:editar'),
  validate(idParamSchema, 'params'),
  validate(updateReglaSchema),
  controller.updateRegla
);

router.delete(
  '/reglas/:id',
  authorize('asignaciones-reglas:eliminar'),
  validate(idParamSchema, 'params'),
  controller.deleteRegla
);

router.post(
  '/preview',
  authorize('asignaciones-reglas:leer'),
  validate(previewSchema),
  controller.previewImpacto
);

router.post(
  '/movimientos-manuales',
  authorize('asignaciones-reglas:editar'),
  validate(persistirMovimientoManualSchema),
  controller.persistirMovimientoManual
);

router.post(
  '/movimientos-manuales/bulk',
  authorize('asignaciones-reglas:editar'),
  validate(persistirMovimientoManualBulkSchema),
  controller.persistirMovimientoManualBulk
);

router.get(
  '/saldos',
  authorize('asignaciones-reglas:leer'),
  validate(saldosQuerySchema, 'query'),
  controller.getSaldosPeriodo
);

router.get(
  '/ledger-agentes',
  authorize('asignaciones-reglas:leer'),
  validate(ledgerAgentesQuerySchema, 'query'),
  controller.getLedgerAgentes
);

router.get(
  '/ledger-saldos-mensuales',
  authorize('asignaciones-reglas:leer'),
  validate(ledgerSaldosMensualesQuerySchema, 'query'),
  controller.getLedgerSaldosMensuales
);

router.get(
  '/ledger-saldos-mensuales/export',
  authorize('asignaciones-reglas:leer'),
  validate(ledgerSaldosMensualesQuerySchema, 'query'),
  controller.exportLedgerSaldosExcel
);

router.get(
  '/ledger-movimientos',
  authorize('asignaciones-reglas:leer'),
  validate(ledgerMovimientosQuerySchema, 'query'),
  controller.getLedgerMovimientos
);

router.get(
  '/ledger-movimientos/export',
  authorize('asignaciones-reglas:leer'),
  validate(ledgerMovimientosQuerySchema, 'query'),
  controller.exportLedgerMovimientosExcel
);

module.exports = router;
