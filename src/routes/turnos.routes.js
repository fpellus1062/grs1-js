const router = require('express').Router();
const controller = require('../controllers/turnos.controller');
const validate = require('../middlewares/validate.middleware');
const auth = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  upsertSchema,
  batchSchema,
  copiarSemanaSchema,
  historialQuerySchema,
  weekStartParamSchema,
} = require('../validators/turnos.validator');

router.use(auth);

// Lectura
router.get('/tipos', authorize('turnos:leer'), controller.getTipos);
router.get(
  '/semana/:weekStart',
  authorize('turnos:leer'),
  validate(weekStartParamSchema, 'params'),
  controller.getSemana
);
router.get(
  '/historial',
  authorize('turnos:historial'),
  validate(historialQuerySchema, 'query'),
  controller.getHistorial
);

// Escritura
router.put(
  '/asignar',
  authorize('turnos:crear'),
  validate(upsertSchema),
  controller.asignar
);
router.post(
  '/batch',
  authorize('turnos:crear'),
  validate(batchSchema),
  controller.batch
);
router.post(
  '/copiar-semana',
  authorize('turnos:copiar'),
  validate(copiarSemanaSchema),
  controller.copiarSemana
);

module.exports = router;
