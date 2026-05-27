module.exports = (req, res, next) => {
  const arsIds = Array.isArray(req.user?.ars_ids) ? req.user.ars_ids : [];
  // Normalizar a strings para comparación segura (BD devuelve numbers, headers llegan como strings)
  const arsIdsStr = arsIds.map(String);

  if (arsIdsStr.length === 0) {
    return res.status(403).json({
      ok: false,
      message: 'Token sin agrupaciones. Cierra sesion y vuelve a entrar',
    });
  }

  const arsIdFromQuery = req.query?.ars_unidad_id;
  const arsIdFromBody = req.body?.ars_unidad_id;
  const arsIdFromHeader = req.headers['x-ars-id'];
  const requestedArsId = arsIdFromQuery || arsIdFromBody || arsIdFromHeader;

  if (!requestedArsId) {
    if (arsIdsStr.length === 1) {
      req.arsId = arsIdsStr[0];
      return next();
    }

    return res.status(400).json({
      ok: false,
      message: 'Debes indicar la agrupacion activa (ars_unidad_id o X-Ars-Id)',
    });
  }

  const requestedArsIdStr = String(requestedArsId);
  if (!arsIdsStr.includes(requestedArsIdStr)) {
    return res.status(403).json({
      ok: false,
      message: 'No tienes acceso a la agrupacion indicada',
    });
  }

  req.arsId = requestedArsIdStr;
  next();
};
