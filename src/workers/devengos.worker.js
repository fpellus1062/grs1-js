const asignacionesService = require('../services/asignaciones.service');

const DEFAULT_INTERVAL_MS = 300000; // 5 minutos
function getIntervalMs() {
  const configured = Number(process.env.DEVENGOS_WORKER_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    if (process.env.DEVENGOS_WORKER_INTERVAL_MS) {
      console.warn(
        `[devengos-worker] DEVENGOS_WORKER_INTERVAL_MS inválido (${process.env.DEVENGOS_WORKER_INTERVAL_MS}). Usando ${DEFAULT_INTERVAL_MS}ms`
      );
    }
    return DEFAULT_INTERVAL_MS;
  }
  return configured;
}

function startDevengosWorker() {
  const intervalMs = getIntervalMs();
  const intervalMinutes = Math.round(intervalMs / 60000);
  console.log(
    `[devengos-worker] configurado para ejecutarse cada ${intervalMinutes} minuto(s)`
  );
  let running = false;
  let timeoutId = null;
  let stopped = false;

  const scheduleNext = (delayMs) => {
    if (stopped) return;
    timeoutId = setTimeout(tick, delayMs);
    if (timeoutId && typeof timeoutId.unref === 'function') timeoutId.unref();
  };

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result =
        await asignacionesService.consolidarDevengosPendientesGlobal();
      if (result && result.has_pending) {
        console.log(
          `[devengos-worker] consolidado borrador=${result.borrador_id} ars=${result.ars_unidad_id} insertados=${result.insertados} a las ${new Date().toISOString()} `
        );
      }
    } catch (error) {
      console.error(
        '[devengos-worker] error al consolidar devengos:',
        error.message
      );
    } finally {
      running = false;
      scheduleNext(intervalMs);
    }
  };

  scheduleNext(0);

  console.log(
    `[devengos-worker] iniciado intervalo ${intervalMinutes} minuto(s) el ${new Date().toLocaleString()}`
  );

  return {
    stop: () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}

module.exports = { startDevengosWorker };
