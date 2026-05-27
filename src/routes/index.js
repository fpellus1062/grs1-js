const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/usuarios', require('./usuarios.routes'));
router.use('/agentes', require('./agentes.routes'));
router.use('/actividades', require('./actividades.routes'));
router.use('/jerarquiagrupos', require('./jerarquiagrupos.routes'));
router.use('/config', require('./config.routes'));
router.use('/rbac', require('./rbac.routes'));
router.use('/turnos', require('./turnos.router'));
router.use('/asignaciones', require('./asignaciones.routes')); // ← NUEVO
router.use('/asignaciones-reglas', require('./asignaciones-reglas.routes'));
router.use('/calendarios', require('./calendarios.routes'));
router.use('/audit', require('./audit.routes'));
router.use('/cuadrantes', require('./cuadrantes.routes'));
router.use('/help', require('./help.routes'));
router.use('/planificacion', require('./planificacion.routes'));
module.exports = router;
