/**
 * dashboard-planificacion-api.js
 * Cliente API para Planificacion V2.
 */
(function () {
  'use strict';

  var app = window.GRS1Dashboard;
  if (!app) return;

  function headers() {
    return app.getHeaders
      ? app.getHeaders(false)
      : { Authorization: 'Bearer ' + app.globalState.token };
  }

  async function request(url, opts) {
    var res = await fetch(
      url,
      Object.assign({ headers: headers() }, opts || {})
    );
    var json;
    try {
      json = await res.json();
    } catch (_) {
      json = {};
    }
    if (!res.ok)
      throw new Error((json && json.message) || 'HTTP ' + res.status);
    return json;
  }

  async function json(url, method, body) {
    return request(url, {
      method: method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  function monthRefISO(anio, mes) {
    var y = Number(anio);
    var m = Number(mes);
    if (!y || !m) return '';
    var mm = m < 10 ? '0' + m : String(m);
    return y + '-' + mm + '-01';
  }

  app.planificacionApi = {
    request: request,
    json: json,

    listPlanes: function (anio, mes) {
      var fechaRef = monthRefISO(anio, mes);
      if (fechaRef) {
        return request(
          '/api/planificacion/planes?fecha_ref=' +
            encodeURIComponent(fechaRef)
        );
      }
      return request('/api/planificacion/planes');
    },

    listPlanesGlobal: function () {
      return request('/api/planificacion/planes');
    },

    listPlanesForNavigation: function (limit) {
      var l = Number(limit || 200);
      if (!Number.isFinite(l) || l < 1) l = 200;
      return request('/api/planificacion/planes?limit=' + encodeURIComponent(String(l)));
    },

    getPlanById: function (planId) {
      return request('/api/planificacion/planes/' + encodeURIComponent(String(planId)));
    },

    listCalendariosByArs: function (arsId) {
      return request('/api/calendarios?ars_id=' + encodeURIComponent(arsId));
    },

    listFestivos: function (calendarioId) {
      return request('/api/calendarios/' + calendarioId + '/festivos');
    },

    listAgentes: function () {
      return request('/api/agentes?activos=true');
    },

    getAgentesMeta: function () {
      return request('/api/agentes/meta');
    },

    listBorradores: function (planId) {
      return request('/api/planificacion/planes/' + planId + '/borradores');
    },

    listAsignaciones: function (versionId) {
      return request('/api/planificacion/versiones/' + versionId + '/asignaciones');
    },

    bulkAsignaciones: function (versionId, items) {
      return json(
        '/api/planificacion/versiones/' + versionId + '/asignaciones/bulk',
        'PUT',
        { items: items }
      );
    },

    createBorrador: function (planId, payload) {
      return json('/api/planificacion/planes/' + planId + '/borradores', 'POST', payload);
    },

    createPlan: function (payload) {
      return json('/api/planificacion/planes', 'POST', payload);
    },

    copyDesdePlan: function (planId, payload) {
      return json('/api/planificacion/planes/' + planId + '/copiar-desde-plan', 'POST', payload);
    },

    aprobarVersion: function (versionId, comentario) {
      return json('/api/planificacion/versiones/' + versionId + '/aprobar', 'POST', {
        comentario: comentario || '',
      });
    },

    aprobarVersionPrepare: function (versionId) {
      return json('/api/planificacion/versiones/' + versionId + '/aprobar', 'POST', {
        modo: 'prepare',
      });
    },

    aprobarVersionChunk: function (versionId, offset, limit) {
      return json('/api/planificacion/versiones/' + versionId + '/aprobar', 'POST', {
        modo: 'chunk',
        offset: Number(offset) || 0,
        limit: Number(limit) || 500,
      });
    },

    aprobarVersionFinalize: function (versionId, comentario) {
      return json('/api/planificacion/versiones/' + versionId + '/aprobar', 'POST', {
        modo: 'finalize',
        comentario: comentario || '',
      });
    },

    traspasarCuadrantePrepare: function (versionId, cuadranteId) {
      return json('/api/planificacion/versiones/' + versionId + '/traspasar-cuadrante', 'POST', {
        modo: 'prepare',
        cuadrante_id: Number(cuadranteId),
      });
    },

    traspasarCuadranteChunk: function (versionId, cuadranteId, offset, limit) {
      return json('/api/planificacion/versiones/' + versionId + '/traspasar-cuadrante', 'POST', {
        modo: 'chunk',
        cuadrante_id: Number(cuadranteId),
        offset: Number(offset) || 0,
        limit: Number(limit) || 1000,
      });
    },

    descartarBorrador: function (borradorId) {
      return json('/api/planificacion/borradores/' + borradorId + '/descartar', 'POST', {});
    },

    deleteVersion: function (versionId) {
      return request('/api/planificacion/versiones/' + versionId, { method: 'DELETE' });
    },

    deleteBorrador: function (borradorId) {
      return request('/api/planificacion/borradores/' + borradorId, { method: 'DELETE' });
    },

    deletePlan: function (planId) {
      return request('/api/planificacion/planes/' + planId, { method: 'DELETE' });
    },
  };
})();
