require('dotenv').config();
const app = require('./src/app');
const { startDevengosWorker } = require('./src/workers/devengos.worker');

const PORT = process.env.PORT || 3000;

const REQUEST_TIMEOUT_MS = Number(
  process.env.REQUEST_TIMEOUT_MS || 10 * 60 * 1000
);
const HEADERS_TIMEOUT_MS = Number(
  process.env.HEADERS_TIMEOUT_MS || 11 * 60 * 1000
);
const KEEP_ALIVE_TIMEOUT_MS = Number(
  process.env.KEEP_ALIVE_TIMEOUT_MS || 75 * 1000
);
const SOCKET_TIMEOUT_MS = Number(
  process.env.SOCKET_TIMEOUT_MS || 10 * 60 * 1000
);

const server = app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.setTimeout(SOCKET_TIMEOUT_MS);

const devengosWorkerEnabled =
  String(process.env.DEVENGOS_WORKER_ENABLED || 'true').toLowerCase() ===
  'true';

const devengosWorker = devengosWorkerEnabled ? startDevengosWorker() : null;
if (!devengosWorkerEnabled) {
  console.log('[devengos-worker] deshabilitado por DEVENGOS_WORKER_ENABLED');
}

const shutdown = () => {
  if (devengosWorker && typeof devengosWorker.stop === 'function') {
    devengosWorker.stop();
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
