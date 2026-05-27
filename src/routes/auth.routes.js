const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const controller = require('../controllers/auth.controller');
const validate = require('../middlewares/validate.middleware');
const auth = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  loginSchema,
  registerSchema,
  updateProfileSchema,
  changePasswordSchema,
} = require('../validators/auth.validator');

// Rate-limit para login: 5 intentos / 15 min en producción, 1 min en desarrollo
const LOGIN_WINDOW_MS =
  process.env.NODE_ENV === 'production' ? 15 * 60 * 1000 : 1 * 60 * 1000;
const LOGIN_WINDOW_LABEL =
  process.env.NODE_ENV === 'production' ? '15 minutos' : '1 minuto';
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,

  skipSuccessfulRequests: true,

  keyGenerator: (req) => {
    const email = req.body?.email || '';
    const hash = crypto.createHash('sha256').update(email).digest('hex');

    return `${ipKeyGenerator(req)}-${hash}`;
  },

  message: {
    ok: false,
    message: `Demasiados intentos de login. Intenta de nuevo en ${LOGIN_WINDOW_LABEL}`,
  },
});

router.post('/login', loginLimiter, validate(loginSchema), controller.login);

// Registro protegido: solo admin con permiso usuarios:crear
router.post(
  '/register',
  auth,
  authorize('usuarios:crear'),
  validate(registerSchema),
  controller.register
);

// Perfil de usuario autenticado
router.get('/me', auth, controller.getProfile);
router.put(
  '/profile',
  auth,
  validate(updateProfileSchema),
  controller.updateProfile
);
router.put(
  '/change-password',
  auth,
  validate(changePasswordSchema),
  controller.changePassword
);

module.exports = router;
