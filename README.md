# grs1

## Worker de consolidación de devengos

Variables de entorno disponibles:

- `DEVENGOS_WORKER_ENABLED` (default `true`): habilita/deshabilita el worker automático.
- `DEVENGOS_WORKER_INTERVAL_MS` (default `30000`): intervalo de ejecución del worker en milisegundos.

El worker procesa borradores con `devengos_pendientes=true` de forma concurrente segura usando `FOR UPDATE SKIP LOCKED`.

## Prueba local con Docker (enfoque Linux/QNAP)

Para validar el despliegue antes de producción en una máquina QNAP (Linux), usar el flujo containerizado:

```powershell
docker compose build app
docker compose up -d postgres
docker compose run --rm migrate
docker compose up -d app
```

Guía completa: [docs/DOCKER_LOCAL_QNAP.md](docs/DOCKER_LOCAL_QNAP.md)
