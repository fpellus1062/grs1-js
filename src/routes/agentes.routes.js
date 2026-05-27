const router = require('express').Router();
const controller = require('../controllers/agentes.controller');
const validate = require('../middlewares/validate.middleware');
const auth = require('../middlewares/auth.middleware');
const tenant = require('../middlewares/tenant.middleware');
const authorize = require('../middlewares/authorize.middleware');
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
const {
  createAgenteSchema,
  updateAgenteSchema,
  idParamSchema,
  altasMasivasSchema,
  bajasMasivasSchema,
} = require('../validators/agentes.validator');
const requisitosController = require('../controllers/agentes-requisitos.controller');
const {
  createPlantillaSchema,
  updatePlantillaSchema,
  plantillaIdParamSchema,
  assignPlantillaSchema,
  registerEjecucionSchema,
  registerEjecucionBulkSchema,
  registerEjecucionMultiSchema,
  sancionarPeriodoSchema,
} = require('../validators/agentes-requisitos.validator');

router.use(auth);
router.use(tenant);

// Lectura → agentes:leer
router.get('/', authorize('agentes:leer'), controller.getAll);
router.get('/meta', authorize('agentes:leer'), controller.getMeta);

// Crear → agentes:crear
router.post(
  '/',
  authorize('agentes:crear'),
  validate(createAgenteSchema),
  controller.create
);

router.post(
  '/avatar',
  authorize('agentes:editar'),
  upload.single('avatar'),
  controller.uploadAvatar
);

router.post(
  '/altas-masivas',
  authorize('agentes:editar'),
  validate(altasMasivasSchema),
  controller.altasMasivas
);

router.post(
  '/bajas-masivas',
  authorize('agentes:editar'),
  validate(bajasMasivasSchema),
  controller.bajasMasivas
);

router.get('/requisitos/meta', authorize('agentes-requisitos:leer'), requisitosController.getMeta);
router.get('/requisitos', authorize('agentes-requisitos:leer'), requisitosController.list);
router.get('/requisitos/plantillas', authorize('agentes-requisitos:leer'), requisitosController.listPlantillas);
router.post(
  '/requisitos/plantillas',
  authorize('agentes-requisitos:editar'),
  validate(createPlantillaSchema),
  requisitosController.createPlantilla
);
router.put(
  '/requisitos/plantillas/:id',
  authorize('agentes-requisitos:editar'),
  validate(plantillaIdParamSchema, 'params'),
  validate(updatePlantillaSchema),
  requisitosController.updatePlantilla
);
router.delete(
  '/requisitos/plantillas/:id',
  authorize('agentes-requisitos:editar'),
  validate(plantillaIdParamSchema, 'params'),
  requisitosController.deletePlantilla
);
router.post(
  '/requisitos/asignaciones',
  authorize('agentes-requisitos:editar'),
  validate(assignPlantillaSchema),
  requisitosController.assignPlantilla
);
router.post(
  '/requisitos/ejecuciones',
  authorize('agentes-requisitos:editar'),
  validate(registerEjecucionSchema),
  requisitosController.registerEjecucion
);
router.post(
  '/requisitos/ejecuciones/bulk',
  authorize('agentes-requisitos:editar'),
  validate(registerEjecucionBulkSchema),
  requisitosController.registerEjecucionBulk
);
router.post(
  '/requisitos/ejecuciones/multi',
  authorize('agentes-requisitos:editar'),
  validate(registerEjecucionMultiSchema),
  requisitosController.registerEjecucionMulti
);
router.post(
  '/requisitos/sanciones',
  authorize('agentes-requisitos:editar'),
  validate(sancionarPeriodoSchema),
  requisitosController.sancionarPeriodo
);

// Leer por ID → agentes:leer
router.get(
  '/:id',
  authorize('agentes:leer'),
  validate(idParamSchema, 'params'),
  controller.getById
);

// Editar → agentes:editar
router.put(
  '/:id',
  authorize('agentes:editar'),
  validate(idParamSchema, 'params'),
  validate(updateAgenteSchema),
  controller.update
);

// Eliminar → agentes:eliminar
router.delete(
  '/:id',
  authorize('agentes:eliminar'),
  validate(idParamSchema, 'params'),
  controller.delete
);

module.exports = router;
