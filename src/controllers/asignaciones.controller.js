const service = require('../services/asignaciones.service');
const exportService = require('../services/cuadranteExport.service');
const cuadrantePdfService = require('../services/cuadrantePdf.service');
const historialPdfService = require('../services/asignacionesHistorialPdf.service');
const historialExcelService = require('../services/asignacionesHistorialExcel.service');
const resumenActividadesExcelService = require('../services/resumenActividadesExcel.service');
const ApiError = require('../utils/ApiError');

function sanitizeFilePart(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function buildFileTimestamp(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function resolveRequestedTimestamp(query) {
  const raw = String((query && query.export_ts) || '').trim();
  if (/^\d{8}_\d{6}$/.test(raw)) return raw;
  return buildFileTimestamp();
}

function buildHistorialExportBase({ user, nombreBorrador, timestamp }) {
  const userNamePart = sanitizeFilePart(
    user && (user.username || user.nombre || user.email),
    'usuario'
  );
  const borradorPart = sanitizeFilePart(nombreBorrador || 'sin_borrador', 'sin_borrador');
  return `Cambios_Servicio_${userNamePart}_${borradorPart}_${timestamp}`;
}

// Creamos un CSV con TIPs unicos y telefono opcional para no perder filas cuando
// el telefono no esta informado en algun agente.
function pickFirstNonEmpty(values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function buildTipTelefonoRow(logRow) {
  const row = logRow && typeof logRow === 'object' ? logRow : {};
  const datosNuevos =
    row.datos_nuevos && typeof row.datos_nuevos === 'object'
      ? row.datos_nuevos
      : {};
  const datosAnteriores =
    row.datos_anteriores && typeof row.datos_anteriores === 'object'
      ? row.datos_anteriores
      : {};

  let tip = pickFirstNonEmpty([
    row.agente_tip,
    row.tip,
    datosNuevos.agente_tip,
    datosNuevos.tip,
    datosAnteriores.agente_tip,
    datosAnteriores.tip,
  ]);

  const telefono = pickFirstNonEmpty([
    row.agente_telefono,
    row.telefono,
    datosNuevos.agente_telefono,
    datosNuevos.telefono,
    datosAnteriores.agente_telefono,
    datosAnteriores.telefono,
  ]);

  if (!tip && row.agente_id) {
    // Fallback para logs historicos/comunicados donde el join de agente ya no aporta TIP.
    tip = `ID_${row.agente_id}`;
  }

  if (!tip && !telefono) return '';
  return `${tip};${telefono}`;
}

async function buildHistorialTipsCsv({ user, nombreBorrador, logs, timestamp }) {
  console.log('[buildHistorialTipsCsv] Construyendo CSV de TIPs únicos a partir de logs:', { logs: Array.isArray(logs) ? logs.length : logs });
  // Extraemos registros unicos con formato "TIP;Telefono".
  // Si falta telefono, dejamos la segunda columna vacia.
  const tips = Array.from(
    new Set(
      (Array.isArray(logs) ? logs : [])
        .map((row) => buildTipTelefonoRow(row))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  const timestampPart = String(timestamp || buildFileTimestamp());
  const baseName = buildHistorialExportBase({ user, nombreBorrador, timestamp: timestampPart });
  const fileName = `${baseName}.csv`;
  const csvContent = tips.join('\r\n') + '\r\n';

  return { baseName, fileName, content: csvContent, count: tips.length };
}

function resolveArsUnidadId(req) {
  return (
    req.arsId ||
    (req.headers && req.headers['x-ars-id']) ||
    (req.body && req.body.ars_unidad_id) ||
    (req.query && req.query.ars_unidad_id) ||
    null
  );
}

function shouldMarcarComunicados(query) {
  return (
    query.marcar_comunicados === undefined ||
    String(query.marcar_comunicados) === '1' ||
    String(query.marcar_comunicados).toLowerCase() === 'true'
  );
}

async function marcarComunicadosSiCorresponde({ req, result, enabled }) {
  if (!enabled) return { updated: 0, lote: null };

  const idsAMarcar =
    Array.isArray(result && result.allNonComunicadoIds) && result.allNonComunicadoIds.length
      ? result.allNonComunicadoIds
      : Array.isArray(result && result.logs)
        ? result.logs.map((row) => row.id)
        : [];

  if (!idsAMarcar.length) return { updated: 0, lote: null };

  return service.marcarHistorialComoComunicado(
    idsAMarcar,
    req.user && req.user.id ? req.user.id : null,
    req.arsId
  );
}

exports.getCuadrante = async (req, res, next) => {
  try {
    const { anio, mes } = req.params;
    const borradorId =
      req.query && req.query.borrador_id ? Number(req.query.borrador_id) : null;
    const source =
      req.query && req.query.source
        ? String(req.query.source).toLowerCase()
        : null;
    const fechaCorte =
      req.query && req.query.fecha_corte ? String(req.query.fecha_corte) : null;
    const fechaFin =
      req.query && req.query.fecha_fin ? String(req.query.fecha_fin) : null;
    const data = await service.getCuadrante(
      Number(anio),
      Number(mes),
      borradorId,
      req.user,
      req.arsId,
      { source: source, fecha_corte: fechaCorte, fecha_fin: fechaFin }
    );
    res.json({ ok: true, ...data });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al obtener cuadrante'));
  }
};

exports.getBorradores = async (req, res, next) => {
  try {
    const { anio, mes } = req.params;
    const borradores = await service.getBorradores(
      Number(anio),
      Number(mes),
      req.user,
      req.arsId
    );
    res.json({ ok: true, borradores });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al obtener borradores'));
  }
};

exports.createBorrador = async (req, res, next) => {
  try {
    const borrador = await service.createBorrador(
      req.body,
      req.user,
      req.arsId
    );
    res.json({ ok: true, message: 'Borrador creado', borrador });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al crear borrador'));
  }
};

exports.deleteBorradorCompletamente = async (req, res, next) => {
  try {
    const result = await service.deleteBorradorCompletamente(
      { borrador_id: Number(req.params.id) },
      req.user,
      req.arsId
    );
    res.json({
      ok: true,
      message: 'Borrador eliminado completamente',
      ...result,
    });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al eliminar borrador'));
  }
};

exports.getActividadesStats = async (req, res, next) => {
  try {
    const now = new Date();
    const anio = Number(req.query.anio) || now.getFullYear();
    const mes = Number(req.query.mes) || now.getMonth() + 1;
    const borrador_id = req.query.borrador_id
      ? Number(req.query.borrador_id)
      : null;
    const data = await service.getActividadesStats(
      anio,
      mes,
      borrador_id,
      req.arsId
    );
    res.json({ ok: true, anio, mes, borrador_id, actividades: data });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener stats de actividades'
      )
    );
  }
};

exports.getMeta = async (req, res, next) => {
  try {
    const meta = await service.getMeta(req.arsId);

    res.json({ ok: true, ...meta });
  } catch (error) {
    // ★ REFACTOR: Corregido bug — antes hacía console.log('Error en getMeta:', meta)
    //   pero 'meta' no existe en el catch. Cambiado a error.message
    console.log('Error en getMeta:', error.message);
    next(new ApiError(500, error.message || 'Error al obtener metadatos'));
  }
};

exports.upsert = async (req, res, next) => {
  try {
    const result = await service.upsert(req.body, req.user, req.arsId);
    // ★ REFACTOR: La respuesta ahora incluye turno + servicios enriquecidos
    res.json({ ok: true, message: 'Asignación guardada', asignacion: result });
  } catch (error) {
    const status = error.statusCode || 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al guardar asignación',
        error.details || null
      )
    );
  }
};

exports.bulk = async (req, res, next) => {
  try {
    const result = await service.bulk(req.body, req.user, req.arsId);
    res.json({
      ok: true,
      message: `${result.count} asignaciones guardadas`,
      ...result,
    });
  } catch (error) {
    const status = error.statusCode || 400;
    next(
      new ApiError(
        status,
        error.message || 'Error en asignación bulk',
        error.details || null
      )
    );
  }
};

exports.deleteBorrador = async (req, res, next) => {
  try {
    const result = await service.deleteBorrador(req.body, req.user, req.arsId);
    res.json({
      ok: true,
      message: `${result.deleted} asignaciones eliminadas`,
      ...result,
    });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al eliminar del borrador'));
  }
};

exports.copiarMes = async (req, res, next) => {
  try {
    console.log('[copiarMes] body pares:', JSON.stringify(req.body.pares));
    console.log('[copiarMes] agente_ids:', JSON.stringify(req.body.agente_ids));
    const result = await service.copiarMes(req.body, req.user, req.arsId);
    console.log('[copiarMes] resultado count:', result.count);
    res.json({
      ok: true,
      message: `${result.count} asignaciones copiadas`,
      ...result,
    });
  } catch (error) {
    console.error('[copiarMes] ERROR:', error.message);
    next(new ApiError(400, error.message || 'Error al copiar mes'));
  }
};

exports.updateBorradorObservaciones = async (req, res, next) => {
  try {
    const borrador = await service.updateBorradorObservaciones(
      Number(req.params.id),
      req.body.observaciones,
      req.user,
      req.arsId
    );
    res.json({ ok: true, message: 'Observaciones guardadas', borrador });
  } catch (error) {
    next(new ApiError(400, error.message || 'Error al guardar observaciones'));
  }
};

exports.validar = async (req, res, next) => {
  try {
    const result = await service.validar(req.body, req.user, req.arsId);
    res.json({
      ok: true,
      message: `${result.validated} asignaciones validadas`,
      ...result,
    });
  } catch (error) {
    console.error('[asignaciones.validar] Error', {
      message: error && error.message,
      sqlState: error && (error.code || error.sqlState || null),
      detail: error && (error.detail || null),
      hint: error && (error.hint || null),
      where: error && (error.where || null),
    });
    const status = error.statusCode || 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al validar',
        error.details || null
      )
    );
  }
};

exports.previewReglasEspecialesValidacion = async (req, res, next) => {
  try {
    const result = await service.previewReglasEspecialesValidacion(
      req.body,
      req.user,
      req.arsId
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    next(
      new ApiError(
        error.statusCode || 400,
        error.message || 'Error al obtener reglas especiales candidatas',
        error.details || null
      )
    );
  }
};

exports.consolidarDevengos = async (req, res, next) => {
  try {
    const result = await service.consolidarDevengos(
      req.body,
      req.user,
      req.arsId
    );
    res.json({
      ok: true,
      message: 'Devengos consolidados',
      ...result,
    });
  } catch (error) {
    const status = error.statusCode || 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al consolidar devengos',
        error.details || null
      )
    );
  }
};

exports.consolidarDevengosPendientes = async (req, res, next) => {
  try {
    const arsUnidadId = resolveArsUnidadId(req);
    const result =
      await service.consolidarDevengosPendientesMasivo(arsUnidadId);
    res.json({
      ok: true,
      message:
        result.total_borradores > 0
          ? `Devengos pendientes consolidados: ${result.total_borradores} borrador(es), ${result.total_insertados} movimiento(s)`
          : 'No hay borradores con devengos pendientes para consolidar',
      ...result,
    });
  } catch (error) {
    const status = error.statusCode || 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al consolidar devengos pendientes',
        error.details || null
      )
    );
  }
};

exports.getDevengosPendientesResumen = async (req, res, next) => {
  try {
    const result = await service.getDevengosPendientesResumen(
      resolveArsUnidadId(req)
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    const status = error.statusCode || 400;
    next(
      new ApiError(
        status,
        error.message || 'Error al obtener resumen de devengos pendientes',
        error.details || null
      )
    );
  }
};

exports.getHistorial = async (req, res, next) => {
  try {
    const result = await service.getHistorial(req.query, req.arsId);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al obtener historial'));
  }
};

exports.getHistorialCelda = async (req, res, next) => {
  try {
    const result = await service.getHistorialCelda(req.query, req.arsId);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al obtener historial de celda'));
  }
};

exports.getHistorialCeldas = async (req, res, next) => {
  try {
    const result = await service.getHistorialCeldas(req.query, req.arsId);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al obtener historial de celdas'));
  }
};

exports.exportarHistorialPdf = async (req, res, next) => {
  try {
    const [result, meta] = await Promise.all([
      service.getHistorial(req.query, req.arsId),
      service.getMeta(req.arsId),
    ]);

    const incluirComunicados =
      String(req.query.repetir_comunicados) === '1' ||
      String(req.query.repetir_comunicados).toLowerCase() === 'true';

    const pdfPayload = {
      anio: Number(req.query.anio),
      mes: Number(req.query.mes),
      nombreBorrador: req.query.nombre_borrador || null,
      logs: result.logs || [],
      total: result.total || 0,
      turnos: meta.turnos || [],
      actividades: meta.actividades || [],
      usuarioNombre: req.user
        ? req.user.nombre || req.user.username || null
        : null,
      ars_unidad_id: req.arsId,
      esCopiaComunciados: incluirComunicados,
      fileBaseName: null,
      csvFileName: null,
      csvFilePath: null,
    };

    const timestampPart = resolveRequestedTimestamp(req.query);
    
    // 1. Generar CSV en memoria (sin escribir aún)
    const csvInfo = await buildHistorialTipsCsv({
      user: req.user,
      nombreBorrador: req.query.nombre_borrador || null,
      logs: result.logs || [],
      timestamp: timestampPart,
    });

    pdfPayload.fileBaseName = csvInfo.baseName;
    pdfPayload.csvFileName = csvInfo.fileName;
    pdfPayload.csvFilePath = csvInfo.fileName;
    pdfPayload.exportTimestamp = timestampPart;

    // 2. Generar PDF en memoria (sin escribir aún)
    const { buffer: pdfBuffer, fileName: pdfFileName } =
      await historialPdfService.buildHistorialPdf(pdfPayload);

    // 3. Responder con PDF (descarga directa en navegador)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFileName}"`);
    res.end(pdfBuffer);
  } catch (error) {
    console.error('[asignaciones.exportarHistorialPdf] Error', {
      message: error && error.message,
      stack: error && error.stack,
      arsId: req.arsId,
      userId: req.user && req.user.id,
      anio: req.query && req.query.anio,
      mes: req.query && req.query.mes,
      borrador_id: req.query && req.query.borrador_id,
    });
    next(
      new ApiError(500, error.message || 'Error al exportar el historial a PDF')
    );
  }
};

exports.exportarHistorialCsv = async (req, res, next) => {
  try {
    const result = await service.getHistorial(req.query, req.arsId);
    const timestampPart = resolveRequestedTimestamp(req.query);
    const csvInfo = await buildHistorialTipsCsv({
      user: req.user,
      nombreBorrador: req.query.nombre_borrador || null,
      logs: result.logs || [],
      timestamp: timestampPart,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvInfo.fileName}"`);
    res.send(`\uFEFF${csvInfo.content}`);
  } catch (error) {
    next(
      new ApiError(500, error.message || 'Error al exportar el historial a CSV')
    );
  }
};

exports.marcarHistorialComunicados = async (req, res, next) => {
  try {
    const result = await service.getHistorial(req.query, req.arsId);
    const markResult = await marcarComunicadosSiCorresponde({
      req,
      result,
      enabled: shouldMarcarComunicados(req.query),
    });

    res.json({ ok: true, ...markResult });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al marcar comunicados'));
  }
};

exports.exportarHistorialExcel = async (req, res, next) => {
  try {
    const WEEKDAY_SHORT = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];
    const planningDays = req.query.fechas
      ? String(req.query.fechas)
          .split(',')
          .filter(Boolean)
          .map((key) => {
            const dt = new Date(`${key}T00:00:00`);
            const weekday = WEEKDAY_SHORT[dt.getDay()] || '';
            return {
              key,
              label: `${weekday} ${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`,
            };
          })
      : [];

    const [result, meta] = await Promise.all([
      service.getHistorial(req.query, req.arsId),
      service.getMeta(req.arsId),
    ]);

    await historialExcelService.buildHistorialExcel(res, {
      logs: result.logs || [],
      anio: Number(req.query.anio),
      mes: Number(req.query.mes),
      nombreBorrador: req.query.nombre_borrador || null,
      planningDays,
      actividades: meta.actividades || [],
    });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al exportar el historial a Excel'));
  }
};

exports.obtenerResumenActividades = async (req, res, next) => {
  try {
    const anio = Number(req.query.anio);
    const mes  = Number(req.query.mes);
    if (!anio || !mes) {
      return next(new ApiError(400, 'Parámetros anio y mes son obligatorios'));
    }
    const borradorId = req.query.borrador_id ? Number(req.query.borrador_id) : null;
    const source     = req.query.source ? String(req.query.source).toLowerCase() : null;
    const fechasFiltro = req.query.fechas
      ? String(req.query.fechas).split(',').filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.trim()))
      : [];

    const [cuadranteData, metaData] = await Promise.all([
      service.getCuadrante(anio, mes, borradorId, req.user, req.arsId, { source }),
      service.getMeta(req.arsId),
    ]);

    const resumenRows = resumenActividadesExcelService.buildResumenData(
      cuadranteData,
      metaData,
      fechasFiltro
    );

    res.json({
      success: true,
      data: resumenRows,
      total: resumenRows.length,
    });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al obtener resumen de actividades'));
  }
};

exports.exportarResumenActividades = async (req, res, next) => {
  try {
    const anio = Number(req.query.anio);
    const mes  = Number(req.query.mes);
    if (!anio || !mes) {
      return next(new ApiError(400, 'Parámetros anio y mes son obligatorios'));
    }
    const borradorId = req.query.borrador_id ? Number(req.query.borrador_id) : null;
    const source     = req.query.source ? String(req.query.source).toLowerCase() : null;
    const fechasFiltro = req.query.fechas
      ? String(req.query.fechas).split(',').filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.trim()))
      : [];

    const [cuadranteData, metaData] = await Promise.all([
      service.getCuadrante(anio, mes, borradorId, req.user, req.arsId, { source }),
      service.getMeta(req.arsId),
    ]);

    const resumenRows = resumenActividadesExcelService.buildResumenData(
      cuadranteData,
      metaData,
      fechasFiltro
    );

    const isBorrador = !!(
      cuadranteData.control &&
      cuadranteData.control.borrador_id &&
      cuadranteData.control.estado !== 'sin_borrador'
    );
    const sourceRows = isBorrador
      ? (Array.isArray(cuadranteData.borrador) ? cuadranteData.borrador : [])
      : (Array.isArray(cuadranteData.definitivo) ? cuadranteData.definitivo : []);

    const fechasDisponibles = Array.from(
      new Set(
        sourceRows
          .map((r) => String((r && r.fecha) || '').slice(0, 10))
          .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
      )
    ).sort((a, b) => a.localeCompare(b));

    const fechasUsadas = (Array.isArray(fechasFiltro) && fechasFiltro.length
      ? Array.from(new Set(fechasFiltro)).sort((a, b) => a.localeCompare(b))
      : fechasDisponibles);

    const fechaDesde = fechasUsadas.length ? fechasUsadas[0] : null;
    const fechaHasta = fechasUsadas.length
      ? fechasUsadas[fechasUsadas.length - 1]
      : null;

    await resumenActividadesExcelService.exportarResumenExcel(res, resumenRows, {
      anio,
      mes,
      fechaDesde,
      fechaHasta,
      fechaImpresion: new Date().toISOString(),
    });
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al exportar resumen de actividades'));
  }
};

exports.exportarCuadrante = async (req, res, next) => {
  try {
    const { anio, mes, borrador_id, nombre_borrador, modo, fechas, formato } =
      req.query;
    const payload = {
      anio: Number(anio),
      mes: Number(mes),
      borrador_id: borrador_id ? Number(borrador_id) : null,
      nombreBorrador: nombre_borrador || null,
      modo: modo || 'normal',
      fechas: fechas ? String(fechas).split(',').filter(Boolean) : [],
      user: req.user,
      ars_unidad_id: req.arsId,
    };

    if (String(formato || 'xlsx').toLowerCase() === 'pdf') {
      await cuadrantePdfService.exportarPdf(res, payload);
      return;
    }

    await exportService.exportarXlsx(res, payload);
  } catch (error) {
    next(new ApiError(500, error.message || 'Error al exportar cuadrante'));
  }
};

exports.getPeriodosDisponibles = async (req, res, next) => {
  try {
    const agenteId =
      req.query && req.query.agente_id ? Number(req.query.agente_id) : null;
    const source =
      req.query && req.query.source
        ? String(req.query.source).toLowerCase()
        : null;
    const periodos = await service.getPeriodosDisponibles(req.user, req.arsId, {
      agente_id: agenteId,
      source: source,
    });
    res.json({ ok: true, periodos });
  } catch (error) {
    next(
      new ApiError(
        500,
        error.message || 'Error al obtener períodos disponibles'
      )
    );
  }
};
