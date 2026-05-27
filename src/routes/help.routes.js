const router = require('express').Router();
const ctrl = require('../controllers/help.controller');
const authorize = require('../middlewares/authorize.middleware');

router.get('/', authorize('help:leer'), ctrl.getAllHelp);
router.get('/context/:context', authorize('help:leer'), ctrl.getHelpByContext);

router.post('/', authorize('help:editar'), ctrl.createHelp);
router.put('/:id', authorize('help:editar'), ctrl.updateHelp);
router.delete('/:id', authorize('help:editar'), ctrl.deleteHelp);

module.exports = router;
