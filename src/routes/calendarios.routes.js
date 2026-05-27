const router = require('express').Router();
const ctrl = require('../controllers/calendarios.controller');
const authorize = require('../middlewares/authorize.middleware');

// Lectura → config:leer o planificacion:leer
router.get('/', authorize('config:leer', 'planificacion:leer'), ctrl.getAll);
router.get('/:id', authorize('config:leer', 'planificacion:leer'), ctrl.getById);
router.get(
  '/:calId/festivos',
  authorize('config:leer', 'planificacion:leer'),
  ctrl.getFestivos
);

// Escritura → config:editar
router.post('/', authorize('config:editar'), ctrl.create);
router.put('/:id', authorize('config:editar'), ctrl.update);
router.delete('/:id', authorize('config:editar'), ctrl.remove);

router.post('/:calId/festivos', authorize('config:editar'), ctrl.createFestivo);
router.put('/festivos/:id', authorize('config:editar'), ctrl.updateFestivo);
router.delete('/festivos/:id', authorize('config:editar'), ctrl.removeFestivo);

module.exports = router;
