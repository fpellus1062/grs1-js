const svc = require('../services/config.service');
const ApiError = require('../utils/ApiError');

function handler(getFn) {
  return async (req, res, next) => {
    try {
      const result = await getFn(req, res);
      res.json({ ok: true, ...result });
    } catch (error) {
      next(
        new ApiError(
          error.message.includes('no encontrad') ? 404 : 400,
          error.message
        )
      );
    }
  };
}

// ─── Empleos ────────────────────────────────────────────────────────────────
exports.getAllEmpleos = handler(async () => ({
  data: await svc.getAllEmpleos(),
}));
exports.getEmpleosJerarquiaTree = handler(async (req) => ({
  data: await svc.getEmpleosJerarquiaTree(
    req.query && req.query.root ? String(req.query.root) : null
  ),
}));
exports.createEmpleo = handler(async (req) => ({
  data: await svc.createEmpleo(req.body),
}));
exports.updateEmpleo = handler(async (req) => ({
  data: await svc.updateEmpleo(req.params.id, req.body),
}));
exports.deleteEmpleo = handler(async (req) => {
  await svc.deleteEmpleo(req.params.id);
  return {};
});

// ─── Pelotones ───────────────────────────────────────────────────────────────
exports.getAllPelotones = handler(async () => ({
  data: await svc.getAllPelotones(),
}));
exports.createPeloton = handler(async (req) => ({
  data: await svc.createPeloton(req.body),
}));
exports.updatePeloton = handler(async (req) => ({
  data: await svc.updatePeloton(req.params.id, req.body),
}));
exports.deletePeloton = handler(async (req) => {
  await svc.deletePeloton(req.params.id);
  return {};
});

// ─── Situaciones ─────────────────────────────────────────────────────────────
exports.getAllSituaciones = handler(async () => ({
  data: await svc.getAllSituaciones(),
}));
exports.createSituacion = handler(async (req) => ({
  data: await svc.createSituacion(req.body),
}));
exports.updateSituacion = handler(async (req) => ({
  data: await svc.updateSituacion(req.params.id, req.body),
}));
exports.deleteSituacion = handler(async (req) => {
  await svc.deleteSituacion(req.params.id);
  return {};
});

// ─── Grupos ──────────────────────────────────────────────────────────────────
exports.getAllGrupos = handler(async () => ({
  data: await svc.getAllGrupos(),
}));
exports.createGrupo = handler(async (req) => ({
  data: await svc.createGrupo(req.body),
}));
exports.updateGrupo = handler(async (req) => ({
  data: await svc.updateGrupo(req.params.id, req.body),
}));
exports.deleteGrupo = handler(async (req) => {
  await svc.deleteGrupo(req.params.id);
  return {};
});

// ─── ARS ─────────────────────────────────────────────────────────────────────
exports.getAllArs = handler(async () => ({ data: await svc.getAllArs() }));
exports.createArs = handler(async (req) => ({
  data: await svc.createArs(req.body, req.user.id),
}));
exports.updateArs = handler(async (req) => ({
  data: await svc.updateArs(req.params.id, req.body),
}));
exports.deleteArs = handler(async (req) => {
  await svc.deleteArs(req.params.id);
  return {};
});

// ─── Provincias ─────────────────────────────────────────────────────────────
exports.getAllProvincias = handler(async () => ({
  data: await svc.getAllProvincias(),
}));
