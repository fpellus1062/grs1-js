/**
 * dashboard-planificacion-store.js
 * Store local para Planificacion V2.
 */
(function () {
  'use strict';

  var app = window.GRS1Dashboard;
  if (!app) return;

  app.createPlanificacionStore = function createPlanificacionStore() {
    return {
      initialized: false,
      perfEnabled: false,
      activeAnio: null,
      activeMes: null,
      viewMonths: 1,
      activePlan: null,
      activePlanId: null,
      versiones: [],
      activeVersionId: null,
      agentes: [],
      agentesFiltered: [],
      actividades: [],
      selectedActividadIds: new Set(),
      asignaciones: [],
      festivosSet: new Set(),
      gridFilterAgentes: null,
    };
  };

  app.resetPlanificacionStoreState = function resetPlanificacionStoreState(state) {
    if (!state) return;
    state.agentes = [];
    state.agentesFiltered = [];
    state.actividades = [];
    state.selectedActividadIds = new Set();
    state.asignaciones = [];
    state.festivosSet = new Set();
    state.activePlan = null;
    state.activePlanId = null;
    state.versiones = [];
    state.activeVersionId = null;
    state.gridFilterAgentes = null;
  };
})();
