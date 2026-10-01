const router = require('express').Router();
const ctrl = require('../controllers/backup.controller');
const auth = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');

router.use(auth);

// Lectura → config:leer
router.get('/catalogo', authorize('config:leer'), ctrl.getCatalogo);
router.get('/listar', authorize('config:leer'), ctrl.listar);
router.post('/preview', authorize('config:leer'), ctrl.preview);

// Escritura / destructivo → config:editar
router.post('/exportar', authorize('config:editar'), ctrl.exportar);
router.post('/eliminar', authorize('config:editar'), ctrl.eliminar);
router.post('/importar', authorize('config:editar'), ctrl.importar);

module.exports = router;
