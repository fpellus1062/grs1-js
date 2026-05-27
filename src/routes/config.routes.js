const router = require('express').Router();
const ctrl = require('../controllers/config.controller');
const auth = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');

router.use(auth);

// Lectura → config:leer
router.get('/empleos', authorize('config:leer'), ctrl.getAllEmpleos);
router.get(
  '/empleos/jerarquia-tree',
  authorize('config:leer'),
  ctrl.getEmpleosJerarquiaTree
);
router.get('/pelotones', authorize('config:leer'), ctrl.getAllPelotones);
router.get('/situaciones', authorize('config:leer'), ctrl.getAllSituaciones);
router.get('/grupos', authorize('config:leer'), ctrl.getAllGrupos);

// Escritura → config:editar
router.post('/empleos', authorize('config:editar'), ctrl.createEmpleo);
router.put('/empleos/:id', authorize('config:editar'), ctrl.updateEmpleo);
router.delete('/empleos/:id', authorize('config:editar'), ctrl.deleteEmpleo);

router.post('/pelotones', authorize('config:editar'), ctrl.createPeloton);
router.put('/pelotones/:id', authorize('config:editar'), ctrl.updatePeloton);
router.delete('/pelotones/:id', authorize('config:editar'), ctrl.deletePeloton);

router.post('/situaciones', authorize('config:editar'), ctrl.createSituacion);
router.put(
  '/situaciones/:id',
  authorize('config:editar'),
  ctrl.updateSituacion
);
router.delete(
  '/situaciones/:id',
  authorize('config:editar'),
  ctrl.deleteSituacion
);

router.post('/grupos', authorize('config:editar'), ctrl.createGrupo);
router.put('/grupos/:id', authorize('config:editar'), ctrl.updateGrupo);
router.delete('/grupos/:id', authorize('config:editar'), ctrl.deleteGrupo);

router.get('/ars', authorize('config:leer'), ctrl.getAllArs);
router.post('/ars', authorize('config:editar'), ctrl.createArs);
router.put('/ars/:id', authorize('config:editar'), ctrl.updateArs);
router.delete('/ars/:id', authorize('config:editar'), ctrl.deleteArs);

router.get('/provincias', authorize('config:leer'), ctrl.getAllProvincias);

module.exports = router;
