const router = require('express').Router();
const controller = require('../controllers/actividades.controller');
const validate = require('../middlewares/validate.middleware');
const auth = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  createActividadSchema,
  updateActividadSchema,
  idParamSchema,
} = require('../validators/actividades.validator');

router.use(auth);

router.get('/', authorize('actividades:leer'), controller.getAll);
router.get('/meta', authorize('actividades:leer'), controller.getMeta);

router.post(
  '/',
  authorize('actividades:crear'),
  validate(createActividadSchema),
  controller.create
);

router.get(
  '/:id',
  authorize('actividades:leer'),
  validate(idParamSchema, 'params'),
  controller.getById
);

router.put(
  '/:id',
  authorize('actividades:editar'),
  validate(idParamSchema, 'params'),
  validate(updateActividadSchema),
  controller.update
);

router.delete(
  '/:id',
  authorize('actividades:eliminar'),
  validate(idParamSchema, 'params'),
  controller.delete
);

module.exports = router;
