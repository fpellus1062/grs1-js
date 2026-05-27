const router = require('express').Router();
const controller = require('../controllers/cuadrantes.controller');
const tenant = require('../middlewares/tenant.middleware');
const authorize = require('../middlewares/authorize.middleware');
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(tenant);

// Lectura
router.get('/', authorize('cuadrantes:leer'), controller.getAll);
router.get('/preview', authorize('cuadrantes:leer'), controller.preview);
router.get('/:id', authorize('cuadrantes:leer'), controller.getById);

// Escritura
router.post('/', authorize('cuadrantes:crear'), controller.create);
router.put('/:id', authorize('cuadrantes:editar'), controller.update);
router.delete('/:id', authorize('cuadrantes:eliminar'), controller.remove);

// Importación de fichero
router.post(
  '/:id/importar',
  authorize('cuadrantes:importar'),
  upload.single('fichero'),
  controller.importar
);

module.exports = router;
