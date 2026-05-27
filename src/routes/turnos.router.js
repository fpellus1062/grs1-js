const router = require('express').Router();
const controller = require('../controllers/turnos.controller');
const validate = require('../middlewares/validate.middleware');
const auth = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  createTurnoSchema,
  updateTurnoSchema,
  idParamSchema,
} = require('../validators/turnos.validator');

router.use(auth);

// Lectura → turnos:leer
router.get('/', authorize('turnos:leer'), controller.getAll);
router.get('/meta', authorize('turnos:leer'), controller.getMeta);

// Crear → turnos:crear
router.post(
  '/',
  authorize('turnos:crear'),
  validate(createTurnoSchema),
  controller.create
);

// Leer por ID → turnos:leer
router.get(
  '/:id',
  authorize('turnos:leer'),
  validate(idParamSchema, 'params'),
  controller.getById
);

// Editar → turnos:editar
router.put(
  '/:id',
  authorize('turnos:editar'),
  validate(idParamSchema, 'params'),
  validate(updateTurnoSchema),
  controller.update
);

// Eliminar → turnos:eliminar
router.delete(
  '/:id',
  authorize('turnos:eliminar'),
  validate(idParamSchema, 'params'),
  controller.delete
);

// Historial → turnos:historial
router.get(
  '/:id/historial',
  authorize('turnos:historial'),
  validate(idParamSchema, 'params'),
  controller.getHistorial
);

module.exports = router;
