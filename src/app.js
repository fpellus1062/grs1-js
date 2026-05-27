const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const errorMiddleware = require('./middlewares/error.middleware');
const auth = require('./middlewares/auth.middleware');
const compression = require('compression');
const app = express();
const path = require('path');

// Grandes volumnes de datos.
const BODY_LIMIT = process.env.BODY_LIMIT || '25mb';
const URLENCODED_PARAMETER_LIMIT = Number(
  process.env.URLENCODED_PARAMETER_LIMIT || 50000
);

// --- Seguridad: cabeceras HTTP ---
app.use(
  helmet({
    contentSecurityPolicy: false, // desactivar CSP para no romper assets inline
  })
);
app.set('trust proxy', 1); // confiar en el proxy para la IP real y rate-limiting

// --- Seguridad: rate-limit global (1000 req/min por IP) ---
// Alto por los cuadrantes de ~1000 empleados con muchas transacciones
// y operaciones bulk (preview masivo + grabación en una sola transacción)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.includes('/bulk'),
    message: {
      ok: false,
      message: 'Demasiadas peticiones, intenta de nuevo en 1 minuto',
    },
  })
);

// -- Rate Limit solo para API auth (20 req/min por IP) ---
const apiAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Demasiadas peticiones, intenta de nuevo en 15 minutos',
  },
});
app.use('/api/auth', apiAuthLimiter);

// Comnpresssion para JS pesados (e.g. cuadrantes con muchos empleados)
app.use(compression()); // ⚠️ Cuidado: puede interferir con algunos proxies o configuraciones de hosting

app.use(express.static(path.join(__dirname, '../public')));
app.use(
  '/vendor/echarts',
  express.static(path.join(__dirname, '../node_modules/echarts/dist'))
);
app.use(
  '/vendor/luxon.min.js',
  express.static(
    path.join(__dirname, '../node_modules/luxon/build/global/luxon.min.js')
  )
);
app.use(
  '/vendor/editorjs/editorjs',
  express.static(
    path.join(__dirname, '../node_modules/@editorjs/editorjs/dist')
  )
);
app.use(
  '/vendor/editorjs/header',
  express.static(path.join(__dirname, '../node_modules/@editorjs/header/dist'))
);
app.use(
  '/vendor/editorjs/list',
  express.static(path.join(__dirname, '../node_modules/@editorjs/list/dist'))
);
app.use(
  '/vendor/editorjs/checklist',
  express.static(
    path.join(__dirname, '../node_modules/@editorjs/checklist/dist')
  )
);
app.use(
  '/vendor/editorjs/code',
  express.static(path.join(__dirname, '../node_modules/@editorjs/code/dist'))
);
app.use(
  '/vendor/editorjs/image',
  express.static(path.join(__dirname, '../node_modules/@editorjs/image/dist'))
);
app.use(
  '/vendor/editorjs/raw',
  express.static(path.join(__dirname, '../node_modules/@editorjs/raw/dist'))
);
app.use(express.json({ limit: BODY_LIMIT }));
app.use(
  express.urlencoded({
    extended: true,
    limit: BODY_LIMIT,
    parameterLimit: URLENCODED_PARAMETER_LIMIT,
  })
);
app.use(cors());

// rutas públicas
app.use('/api/auth', require('./routes/auth.routes'));

// 🔒 TODO lo demás protegido
app.use('/api', auth, require('./routes'));
// Este es el final
app.use(errorMiddleware);
module.exports = app;
