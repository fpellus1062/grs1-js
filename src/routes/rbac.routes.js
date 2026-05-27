const router = require('express').Router();
const ctrl = require('../controllers/rbac.controller');
const auth = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');

router.use(auth);

// Lectura → roles:leer
router.get('/roles', authorize('roles:leer'), ctrl.getAllRoles);
router.get('/permisos', authorize('roles:leer'), ctrl.getAllPermisos);
router.get('/matriz', authorize('roles:leer'), ctrl.getMatriz);

// Escritura → roles:editar
router.post('/roles', authorize('roles:editar'), ctrl.createRol);
router.put('/roles/:id', authorize('roles:editar'), ctrl.updateRol);
router.delete('/roles/:id', authorize('roles:editar'), ctrl.deleteRol);

router.post('/permisos', authorize('roles:editar'), ctrl.createPermiso);
router.put('/permisos/:id', authorize('roles:editar'), ctrl.updatePermiso);
router.delete('/permisos/:id', authorize('roles:editar'), ctrl.deletePermiso);

router.post('/matriz/toggle', authorize('roles:editar'), ctrl.togglePermiso);

module.exports = router;
