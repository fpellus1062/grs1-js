const router = require('express').Router();
const controller = require('../controllers/usuarios.controller');
const validate = require('../middlewares/validate.middleware');
const auth = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');

const {
  createUserSchema,
  updateUserSchema,
  idParamSchema,
  setUsuarioArsSchema,
} = require('../validators/usuarios.validator');

router.use(auth);

router.get('/', authorize('usuarios:leer', 'admin'), controller.getAll);

router.get(
  '/:id/ars',
  authorize('usuarios:editar', 'admin'),
  validate(idParamSchema, 'params'),
  controller.getArs
);

router.put(
  '/:id/ars',
  authorize('usuarios:editar', 'admin'),
  validate(idParamSchema, 'params'),
  validate(setUsuarioArsSchema),
  controller.setArs
);

router.get(
  '/:id',
  authorize('usuarios:leer', 'admin'),
  validate(idParamSchema, 'params'),
  controller.getById
);

router.post(
  '/',
  authorize('usuarios:crear', 'admin'),
  validate(createUserSchema),
  controller.create
);

router.put(
  '/:id',
  authorize('usuarios:editar', 'admin'),
  validate(idParamSchema, 'params'),
  validate(updateUserSchema),
  controller.update
);

router.delete(
  '/:id',
  authorize('usuarios:eliminar', 'admin'),
  validate(idParamSchema, 'params'),
  controller.remove
);

router.put(
  '/:id/reactivar',
  authorize('usuarios:editar', 'admin'),
  validate(idParamSchema, 'params'),
  controller.reactivar
);

router.put(
  '/:id/desbloquear',
  authorize('usuarios:editar', 'admin'),
  validate(idParamSchema, 'params'),
  controller.desbloquear
);

module.exports = router;
