const router = require('express').Router();
const controller = require('../controllers/jerarquiagrupos.controller');
const validate = require('../middlewares/validate.middleware');
const auth = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  createGrupoSchema,
  updateGrupoSchema,
  createActividadJerSchema,
  updateActividadJerSchema,
  idParamSchema,
} = require('../validators/jerarquiagrupos.validator');

router.use(auth);

router.get('/meta', authorize('jerarquiagrupos:leer'), controller.getMeta);

router.get('/grupos', authorize('jerarquiagrupos:leer'), controller.getGrupos);

router.post(
  '/grupos',
  authorize('jerarquiagrupos:crear'),
  validate(createGrupoSchema),
  controller.createGrupo
);

router.put(
  '/grupos/:id',
  authorize('jerarquiagrupos:editar'),
  validate(idParamSchema, 'params'),
  validate(updateGrupoSchema),
  controller.updateGrupo
);

router.delete(
  '/grupos/:id',
  authorize('jerarquiagrupos:eliminar'),
  validate(idParamSchema, 'params'),
  controller.deleteGrupo
);

router.get(
  '/grupos/:id/actividades',
  authorize('jerarquiagrupos:leer'),
  validate(idParamSchema, 'params'),
  controller.getActividadesByGrupo
);

router.post(
  '/actividades',
  authorize('jerarquiagrupos:crear'),
  validate(createActividadJerSchema),
  controller.createActividad
);

router.put(
  '/actividades/:id',
  authorize('jerarquiagrupos:editar'),
  validate(idParamSchema, 'params'),
  validate(updateActividadJerSchema),
  controller.updateActividad
);

router.delete(
  '/actividades/:id',
  authorize('jerarquiagrupos:eliminar'),
  validate(idParamSchema, 'params'),
  controller.deleteActividad
);

router.patch(
  '/actividades/:id/baja',
  authorize('jerarquiagrupos:editar'),
  validate(idParamSchema, 'params'),
  controller.toggleActividadBaja
);

module.exports = router;
