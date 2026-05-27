const router = require('express').Router();
const controller = require('../controllers/audit.controller');
const authorize = require('../middlewares/authorize.middleware');

// Solo admin y usuarios con permiso usuarios:leer pueden ver auditoría
router.get(
  '/login',
  authorize('usuarios:leer', 'admin'),
  controller.getLoginLog
);

module.exports = router;
