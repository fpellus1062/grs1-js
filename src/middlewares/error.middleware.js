module.exports = (err, req, res, next) => {
  void next;
  console.error(err); // luego sustituible por logger

  const status = err.statusCode || 500;

  // Para errores de BBDD, si existe un error anidado traemos su mensaje completo.
  const errorMessage =
    err.message ||
    (err.originalError && err.originalError.message) ||
    'Error interno';
  const errorDetails =
    err.details || (err.originalError && err.originalError.detail) || null;

  res.status(status).json({
    ok: false,
    message: errorMessage,
    details: errorDetails,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};
