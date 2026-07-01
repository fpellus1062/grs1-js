/**
 * dashboard-planificacion.js
 * Módulo de planificación V2 — navegación por meses naturales.
 * Integrado en GRS1Dashboard como app.initializePlanificacion.
 */
(function () {
  'use strict';

  var app = window.GRS1Dashboard;
  var DateTime = window.luxon && window.luxon.DateTime;
  // @ts-ignore
  var planifQbe = window.GRS1TabulatorQbe || null;
  // @ts-ignore
  var GRS1Utils = window.GRS1Utils || {};

  if (!app) return;

  var MESES = [
    '',
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];

  function createLocalState() {
    return {
      initialized: false,
      perfEnabled: false,
      activeAnio: null,
      activeMes: null,
      viewMonths: 1,
      leftPanelCollapsed: false,
      referenceISO: null,
      planesDisponibles: [],
      activePlanIndex: -1,
      activePlan: null, // objeto plan activo (o null)
      activePlanId: null,
      versiones: [],
      activeVersionId: null,
      agentes: [],
      agentesFiltered: [],
      actividades: [],
      selectedActividadIds: new Set(),
      asignaciones: [],
      festivosSet: new Set(), // Set<string ISO> de fechas festivas del calendario ARS
      gridFilterAgentes: null, // Set<string> de agente_id visibles en el grid, null = todos
    };
  }

  // ── Estado local ──────────────────────────────────────────
  var state = app.createPlanificacionStore
    ? app.createPlanificacionStore()
    : createLocalState();

  var PLANIF_TABULATOR_RENDER_HORIZONTAL = 'virtual';
  var _planifCollapseRedrawTimeout = 0;
  var _planifSelectedAgenteIds = new Set(); // Agentes seleccionados para exportar
  var _planifSelectedAgenteIds = new Set(); // Agentes seleccionados para exportar

  function resetPlanificacionStateData() {
    if (app.resetPlanificacionStoreState) {
      app.resetPlanificacionStoreState(state);
      return;
    }
    state.agentes = [];
    state.agentesFiltered = [];
    state.actividades = [];
    state.selectedActividadIds = new Set();
    state.asignaciones = [];
    state.festivosSet = new Set();
    _planifSelectedAgenteIds.clear();
    state.activePlan = null;
    state.activePlanId = null;
    state.activePlanIndex = -1;
    state.planesDisponibles = [];
    state.versiones = [];
    state.activeVersionId = null;
    state.gridFilterAgentes = null;
  }

  // ── Helpers ───────────────────────────────────────────────
  function getEl(id) {
    return document.getElementById(id);
  }

  function nowMs() {
    return typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }

  function isPerfEnabled() {
    try {
      return (
        localStorage.getItem('grs1.planif.perf') === '1' ||
        sessionStorage.getItem('grs1.planif.perf') === '1'
      );
    } catch (_) {
      return false;
    }
  }

  function logPerf(label, startMs, details) {
    if (!state.perfEnabled) return;
    var elapsed = (nowMs() - startMs).toFixed(1);
    var suffix = details ? ' | ' + details : '';
    console.info('[PlanifPerf] ' + label + ': ' + elapsed + 'ms' + suffix);
  }

  function headers() {
    return app.getHeaders
      ? app.getHeaders(false)
      : { Authorization: 'Bearer ' + app.globalState.token };
  }

  function isConsultaReadOnly() {
    return (
      GRS1Utils &&
      typeof GRS1Utils.isConsultaReadOnlyRole === 'function' &&
      GRS1Utils.isConsultaReadOnlyRole(app)
    );
  }

  function guardReadOnlyAction() {
    if (!isConsultaReadOnly()) return false;
    showAlert('Perfil consulta: solo lectura', 'warning');
    return true;
  }

  function applyConsultaReadOnlyUi() {
    if (!isConsultaReadOnly()) return;
    if (GRS1Utils && typeof GRS1Utils.disableElementsById === 'function') {
      GRS1Utils.disableElementsById([
        'planifBtnNuevo',
        'planifBtnNuevoGuardar',
        'planifBtnCopiar',
        'planifBtnCopiarGuardar',
        'planifBtnNuevaVersion',
        'planifBtnBorradorGuardar',
        'planifBtnAprobar',
        'planifAprobarConfirmBtn',
        'planifBtnBorrarMenu',
        'planifBtnDescartarBorrador',
        'planifDescartarConfirmBtn',
        'planifBtnBorrarVersion',
        'planifBtnBorrarPlan',
        'planifBorrarConfirmBtn',
      ]);
    }

    var btnNuevo = getEl('planifBtnNuevo');
    if (btnNuevo) {
      // Ocultar para evitar confusión en perfil solo lectura.
      btnNuevo.style.display = 'none';
    }

    var btnBorrarMenu = getEl('planifBtnBorrarMenu');
    if (btnBorrarMenu) {
      btnBorrarMenu.style.display = 'none';
    }
  }

  async function api(url, opts) {
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

  async function apiJson(url, method, body) {
    return api(url, {
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

  function normalizePlanifSearchText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function parsePlanifQbeExpression(rawValue) {
    if (planifQbe && typeof planifQbe.parseExpression === 'function') {
      return planifQbe.parseExpression(rawValue);
    }
    var input = String(rawValue || '').trim();
    if (!input) return null;

    var twoCharOp = input.slice(0, 2);
    var oneCharOp = input.slice(0, 1);

    if (twoCharOp === '>=' || twoCharOp === '<=' || twoCharOp === '!=') {
      return { op: twoCharOp, value: input.slice(2).trim() };
    }

    if (
      oneCharOp === '=' ||
      oneCharOp === '>' ||
      oneCharOp === '<' ||
      oneCharOp === '^' ||
      oneCharOp === '$' ||
      oneCharOp === '~' ||
      oneCharOp === '!'
    ) {
      return { op: oneCharOp, value: input.slice(1).trim() };
    }

    return { op: 'contains', value: input };
  }

  function matchesPlanifTextQbe(rowValue, expression) {
    if (planifQbe && typeof planifQbe.matchesText === 'function') {
      return planifQbe.matchesText(rowValue, expression, normalizePlanifSearchText);
    }
    if (!expression || !expression.value) return true;
    var left = normalizePlanifSearchText(String(rowValue == null ? '' : rowValue));
    var right = normalizePlanifSearchText(expression.value);
    if (!right) return true;

    if (expression.op === '=') return left === right;
    if (expression.op === '!=') return left !== right;
    if (expression.op === '^') return left.indexOf(right) === 0;
    if (expression.op === '$') {
      return left.lastIndexOf(right) === left.length - right.length;
    }
    if (expression.op === '!') return left.indexOf(right) === -1;
    return left.indexOf(right) !== -1;
  }

  function planifHeaderFilterQbe(headerValue, rowValue) {
    var expr = parsePlanifQbeExpression(headerValue);
    return matchesPlanifTextQbe(rowValue, expr);
  }

  function getPlanifApiClient() {
    if (app.planificacionApi) return app.planificacionApi;
    return {
      listPlanes: function (anio, mes) {
        var fechaRef = monthRefISO(anio, mes);
        if (fechaRef) {
          return api(
            '/api/planificacion/planes?fecha_ref=' +
              encodeURIComponent(fechaRef)
          );
        }
        return api('/api/planificacion/planes');
      },
      listPlanesGlobal: function () {
        return api('/api/planificacion/planes');
      },
      listPlanesForNavigation: function (limit) {
        var l = Number(limit || 200);
        if (!Number.isFinite(l) || l < 1) l = 200;
        return api('/api/planificacion/planes?limit=' + encodeURIComponent(String(l)));
      },
      getPlanById: function (planId) {
        return api('/api/planificacion/planes/' + encodeURIComponent(String(planId)));
      },
      listCalendariosByArs: function (arsId) {
        return api('/api/calendarios?ars_id=' + encodeURIComponent(arsId));
      },
      listFestivos: function (calendarioId) {
        return api('/api/calendarios/' + calendarioId + '/festivos');
      },
      listAgentes: function () {
        return api('/api/agentes');
      },
      getAgentesMeta: function () {
        return api('/api/agentes/meta');
      },
      listBorradores: function (planId) {
        return api('/api/planificacion/planes/' + planId + '/borradores');
      },
      listAsignaciones: function (versionId) {
        return api('/api/planificacion/versiones/' + versionId + '/asignaciones');
      },
      bulkAsignaciones: function (versionId, items) {
        return apiJson(
          '/api/planificacion/versiones/' + versionId + '/asignaciones/bulk',
          'PUT',
          { items: items }
        );
      },
      createBorrador: function (planId, payload) {
        return apiJson('/api/planificacion/planes/' + planId + '/borradores', 'POST', payload);
      },
      createPlan: function (payload) {
        return apiJson('/api/planificacion/planes', 'POST', payload);
      },
      copyDesdePlan: function (planId, payload) {
        return apiJson('/api/planificacion/planes/' + planId + '/copiar-desde-plan', 'POST', payload);
      },
      aprobarVersion: function (versionId, comentario) {
        return apiJson('/api/planificacion/versiones/' + versionId + '/aprobar', 'POST', {
          comentario: comentario || '',
        });
      },
      aprobarVersionPrepare: function (versionId) {
        return apiJson('/api/planificacion/versiones/' + versionId + '/aprobar', 'POST', {
          modo: 'prepare',
        });
      },
      aprobarVersionChunk: function (versionId, offset, limit) {
        return apiJson('/api/planificacion/versiones/' + versionId + '/aprobar', 'POST', {
          modo: 'chunk',
          offset: Number(offset) || 0,
          limit: Number(limit) || 500,
        });
      },
      aprobarVersionFinalize: function (versionId, comentario) {
        return apiJson('/api/planificacion/versiones/' + versionId + '/aprobar', 'POST', {
          modo: 'finalize',
          comentario: comentario || '',
        });
      },
      descartarBorrador: function (borradorId) {
        return apiJson('/api/planificacion/borradores/' + borradorId + '/descartar', 'POST', {});
      },
      deleteVersion: function (versionId) {
        return api('/api/planificacion/versiones/' + versionId, { method: 'DELETE' });
      },
      deleteBorrador: function (borradorId) {
        return api('/api/planificacion/borradores/' + borradorId, { method: 'DELETE' });
      },
      deletePlan: function (planId) {
        return api('/api/planificacion/planes/' + planId, { method: 'DELETE' });
      },
    };
  }

  function showAlert(msg, type, container) {
    var el = getEl(container || 'planifAlert');
    if (!el) return;
    if (!msg) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML =
      '<div class="alert alert-' +
      (type || 'danger') +
      ' alert-dismissible py-1 mb-0" style="font-size:.78rem; line-height:1.15">' +
      app.escapeHtml(msg) +
      '<button type="button" class="btn-close py-2" data-bs-dismiss="alert"></button></div>';
  }

  function fmtFecha(isoDate) {
    if (!isoDate || !DateTime) return String(isoDate || '');
    var dt = DateTime.fromISO(String(isoDate).slice(0, 10));
    return dt.isValid ? dt.toFormat('dd/MM/yy') : String(isoDate);
  }

  function inferPlanMonthsFromDates(dtInicio, dtFin) {
    if (!dtInicio || !dtFin || !dtInicio.isValid || !dtFin.isValid || dtFin < dtInicio) {
      return 1;
    }
    var months =
      (dtFin.year - dtInicio.year) * 12 +
      (dtFin.month - dtInicio.month);
    // Cuenta el mes final solo cuando alcanza (o supera) el día de inicio.
    if (dtFin.day >= dtInicio.day) {
      months += 1;
    }
    return months > 0 ? months : 1;
  }

  function fmtPlanRangeLabel(plan) {
    if (!plan) return '—';
    var fi = fmtFecha(plan.fecha_inicio);
    var ff = plan.fecha_fin ? fmtFecha(plan.fecha_fin) : '—';
    var mesesPlan = Number(plan.num_meses || 0);
    if (!mesesPlan && DateTime && plan.fecha_inicio && plan.fecha_fin) {
      var dtInicio = DateTime.fromISO(String(plan.fecha_inicio).slice(0, 10));
      var dtFin = DateTime.fromISO(String(plan.fecha_fin).slice(0, 10));
      mesesPlan = inferPlanMonthsFromDates(dtInicio, dtFin);
    }
  // Legacy: Ahora el plan infiere por fechas. No meses Plan.
    if (!mesesPlan || mesesPlan < 1) mesesPlan = 1;
    return fi + ' → ' + ff + ' (' + mesesPlan + ' mes' + (mesesPlan === 1 ? '' : 'es') + ')';
  }

  function getActivePlanBounds() {
    if (!DateTime) return null;
    if (state.activePlan && state.activePlan.fecha_inicio && state.activePlan.fecha_fin) {
      var planStart = DateTime.fromISO(String(state.activePlan.fecha_inicio).slice(0, 10)).startOf('day');
      var planEnd = DateTime.fromISO(String(state.activePlan.fecha_fin).slice(0, 10)).startOf('day');
      if (planStart.isValid && planEnd.isValid && planEnd >= planStart) {
        return { start: planStart, end: planEnd };
      }
    }
    if (!state.activeAnio || !state.activeMes) return null;
    var fallbackStart = DateTime.fromObject({ year: state.activeAnio, month: state.activeMes, day: 1 }).startOf('day');
    if (!fallbackStart.isValid) return null;
    var fallbackEnd = fallbackStart
      .plus({ months: Math.max(1, Number(state.viewMonths) || 1) - 1 })
      .endOf('month')
      .startOf('day');
    return { start: fallbackStart, end: fallbackEnd };
  }

  function syncVistaFechaControls() {
    var inStart = getEl('planifVistaFechaInicio');
    var inEnd = getEl('planifVistaFechaFin');
    if (!inStart || !inEnd || !DateTime) return;

    var bounds = getActivePlanBounds();
    if (!bounds) return;

    var minISO = bounds.start.toISODate();
    var maxISO = bounds.end.toISODate();

    // @ts-ignore
    inStart.min = minISO;
    // @ts-ignore
    inStart.max = maxISO;
    // @ts-ignore
    inEnd.min = minISO;
    // @ts-ignore
    inEnd.max = maxISO;

    // @ts-ignore
    var rawStart = String(inStart.value || '');
    // @ts-ignore
    var rawEnd = String(inEnd.value || '');

    var dtStart = DateTime.fromISO(rawStart, { zone: 'utc' }).startOf('day');
    var dtEnd = DateTime.fromISO(rawEnd, { zone: 'utc' }).startOf('day');

    if (!dtStart.isValid || dtStart < bounds.start || dtStart > bounds.end) {
      dtStart = bounds.start;
    }
    if (!dtEnd.isValid || dtEnd < bounds.start || dtEnd > bounds.end) {
      dtEnd = bounds.end;
    }
    if (dtStart > dtEnd) {
      dtEnd = dtStart;
    }

    // @ts-ignore
    inStart.value = dtStart.toISODate();
    // @ts-ignore
    inEnd.value = dtEnd.toISODate();
  }

  function actividadColor(actividadId) {
    var act = state.actividades.find(function (a) {
      return String(a.id_actividad || a.id) === String(actividadId);
    });
    return act && act.color ? act.color : '#dee2e6';
  }

  function actividadNombre(actividadId) {
    var act = state.actividades.find(function (a) {
      return String(a.id_actividad || a.id) === String(actividadId);
    });
    if (!act) return actividadId ? '#' + actividadId : '—';
    var actividad = String(act.actividad || act.codigo || '').trim();
    return actividad || ('#' + String(actividadId || '—'));
  }

  function applyLeftPanelCollapsed(collapsed, contextEl) {
    state.leftPanelCollapsed = !!collapsed;

    var left = document.getElementById('planifLeftPanel');
    var btn = document.getElementById('planifBtnToggleLeft');

    if (left) {
      if (state.leftPanelCollapsed) {
        left.setAttribute('style', 'display: none !important;');
      } else {
        left.removeAttribute('style');
      }
    }
    
    if (btn) {
      btn.title = state.leftPanelCollapsed ? 'Mostrar filtros' : 'Ocultar filtros';
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = state.leftPanelCollapsed
        ? '<i class="bi bi-layout-sidebar-inset"></i>'
        : '<i class="bi bi-layout-sidebar"></i>';
    }

    if (_planifTabulator && typeof _planifTabulator.redraw === 'function') {
      if (_planifCollapseRedrawTimeout) {
        clearTimeout(_planifCollapseRedrawTimeout);
      }
      _planifCollapseRedrawTimeout = setTimeout(function () {
        _planifCollapseRedrawTimeout = 0;
        if (_planifTabulator && typeof _planifTabulator.redraw === 'function') {
          _planifTabulator.redraw(false);
        }
      }, 150);
    }
  }

  function ensureToggleLeftBinding() {
    if (!app._planifToggleLeftDelegated) {
      document.addEventListener('click', function (event) {
        var target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target : null);
        if (!target) return;
        var btn = target.closest('#planifBtnToggleLeft');
        if (!btn) return;
        event.preventDefault();
        applyLeftPanelCollapsed(!state.leftPanelCollapsed, /** @type {HTMLElement} */ (btn));
      });
      app._planifToggleLeftDelegated = true;
    }
  }

  function actividadTooltip(actividadId) {
    var act = state.actividades.find(function (a) {
      return String(a.id_actividad || a.id) === String(actividadId);
    });
    if (!act) return actividadId ? '#' + actividadId : '—';

    var nivel = String(act.nivel_grupo_nombre || 'Sin nivel').trim() || 'Sin nivel';
    var grupo = String(act.grupo_nombre || 'Sin grupo').trim() || 'Sin grupo';
    return [nivel, grupo].join(' - ');
  }

  function safeBadgeColor(value) {
    var raw = String(value || '').trim();
    if (!raw) return '#6c757d';
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
    return '#6c757d';
  }

  function agenteNombreCompleto(ag) {
    return [
      ag.apellido_1 || '',
      ag.apellido_2 || '',
      ag.nombre || '',
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function enriquecerAgentesConMeta(agentes, meta) {
    var list = Array.isArray(agentes) ? agentes : [];
    var empleos = meta && Array.isArray(meta.empleos) ? meta.empleos : [];
    var pelotones = meta && Array.isArray(meta.pelotones) ? meta.pelotones : [];
    var situaciones = meta && Array.isArray(meta.situaciones) ? meta.situaciones : [];
    var empleoById = {};
    var pelotonById = {};
    var situacionById = {};
    empleos.forEach(function (e) {
      empleoById[String(e.id_empleo)] = e;
    });
    pelotones.forEach(function (p) {
      pelotonById[String(p.id_peloton)] = p;
    });
    situaciones.forEach(function (s) {
      situacionById[String(s.id_situacion)] = s;
    });

    return list.map(function (ag) {
      var out = Object.assign({}, ag);
      var empleo = empleoById[String(ag.empleo_id)] || null;
      var peloton = pelotonById[String(ag.peloton_id)] || null;
      var situacion = situacionById[String(ag.situacion_id)] || null;
      var rawColor =
        ag.color_empleo || ag.empleo_color || (empleo && empleo.color) || '';
      var rawPelotonColor =
        ag.color_peloton || ag.peloton_color || (peloton && peloton.color) || '';
      var rawSituacionColor =
        ag.color_situacion || ag.situacion_color || (situacion && situacion.color) || '';

      out.color_empleo = safeBadgeColor(rawColor);
      if (!out.empleo_desc && empleo && empleo.descripcion) {
        out.empleo_desc = empleo.descripcion;
      }

      out.color_peloton = safeBadgeColor(rawPelotonColor);
      if (!out.peloton_desc && peloton && peloton.descripcion) {
        out.peloton_desc = peloton.descripcion;
      }

      out.color_situacion = safeBadgeColor(rawSituacionColor);
      if (!out.situacion_desc && situacion && situacion.descripcion) {
        out.situacion_desc = situacion.descripcion;
      }

      return out;
    });
  }

  function getVisibleRange() {
    var bounds = getActivePlanBounds();
    if (!bounds || !DateTime) {
      var fallbackStart = DateTime.fromObject({
        year: state.activeAnio,
        month: state.activeMes,
        day: 1,
      });
      var fallbackEnd = fallbackStart
        .plus({ months: Math.max(1, Number(state.viewMonths) || 1) - 1 })
        .endOf('month')
        .startOf('day');
      return { start: fallbackStart, end: fallbackEnd };
    }

    var inStart = getEl('planifVistaFechaInicio');
    var inEnd = getEl('planifVistaFechaFin');
    if (!inStart || !inEnd) {
      return { start: bounds.start, end: bounds.end };
    }

    // @ts-ignore
    var rawStart = String(inStart.value || '');
    // @ts-ignore
    var rawEnd = String(inEnd.value || '');

    var dtStart = DateTime.fromISO(rawStart, { zone: 'utc' }).startOf('day');
    var dtEnd = DateTime.fromISO(rawEnd, { zone: 'utc' }).startOf('day');

    if (!dtStart.isValid || dtStart < bounds.start || dtStart > bounds.end) {
      dtStart = bounds.start;
    }
    if (!dtEnd.isValid || dtEnd < bounds.start || dtEnd > bounds.end) {
      dtEnd = bounds.end;
    }
    if (dtStart > dtEnd) {
      dtEnd = dtStart;
    }

    return { start: dtStart, end: dtEnd };
  }

  function actualizarRangoInputs(forceEndToRange) {
    if (!DateTime || !state.activeAnio) return;
    var r = getVisibleRange();
    var minISO = r.start.toISODate();
    var maxISO = r.end.toISODate();
    var inInicio = getEl('planifFechaInicio');
    var inFin = getEl('planifFechaFin');
    if (!inInicio || !inFin) return;

    // @ts-ignore
    inInicio.min = minISO;
    // @ts-ignore
    inInicio.max = maxISO;
    // @ts-ignore
    inFin.min = minISO;
    // @ts-ignore
    inFin.max = maxISO;

    // @ts-ignore
    if (!inInicio.value || inInicio.value < minISO || inInicio.value > maxISO) {
      // @ts-ignore
      inInicio.value = minISO;
    }
    // Cuando cambia la vista de meses, la fecha final debe seguir el límite del rango visible.
    // @ts-ignore
    if (forceEndToRange || !inFin.value || inFin.value < minISO || inFin.value > maxISO) {
      // @ts-ignore
      inFin.value = maxISO;
    }
    // @ts-ignore
    if (inInicio.value > inFin.value) {
      // @ts-ignore
      inFin.value = inInicio.value;
    }
  }

  function normalizePlanRange(plan) {
    if (!plan || !DateTime) return plan;
    var out = Object.assign({}, plan);
    var dtInicio = DateTime.fromISO(String(out.fecha_inicio || '').slice(0, 10));
    if (!dtInicio.isValid) return out;
    var dtFin = DateTime.fromISO(String(out.fecha_fin || '').slice(0, 10));
    if (!dtFin.isValid || dtFin < dtInicio) {
      var meses = Number(out.num_meses || 0);
      if (!Number.isInteger(meses) || meses < 1) meses = 1;
      out.fecha_fin = dtInicio.plus({ months: meses }).minus({ days: 1 }).toISODate();
      out.num_meses = meses;
    } else {
      out.fecha_fin = dtFin.toISODate();
      out.num_meses = inferPlanMonthsFromDates(dtInicio, dtFin);
    }
    out.fecha_inicio = dtInicio.toISODate();
    return out;
  }

  function sortPlanesAsc(planes) {
    return (Array.isArray(planes) ? planes : [])
      .map(normalizePlanRange)
      .sort(function (a, b) {
        var fiA = String(a.fecha_inicio || '');
        var fiB = String(b.fecha_inicio || '');
        if (fiA < fiB) return -1;
        if (fiA > fiB) return 1;
        return Number(a.id_plan || 0) - Number(b.id_plan || 0);
      });
  }

  function indexByPlanId(planId) {
    var id = Number(planId);
    if (!id || !Array.isArray(state.planesDisponibles)) return -1;
    for (var i = 0; i < state.planesDisponibles.length; i++) {
      if (Number(state.planesDisponibles[i].id_plan) === id) return i;
    }
    return -1;
  }

  function pickInitialPlanIndex(planes, preferredId, referenceISO) {
    var list = Array.isArray(planes) ? planes : [];
    if (!list.length) return -1;

    var idxPreferred = -1;
    var wantedId = Number(preferredId);
    if (wantedId) {
      for (var pi = 0; pi < list.length; pi++) {
        if (Number(list[pi].id_plan) === wantedId) {
          idxPreferred = pi;
          break;
        }
      }
    }
    if (idxPreferred >= 0) return idxPreferred;

    var ref = referenceISO;
    if (!ref && DateTime) ref = DateTime.now().toISODate();
    if (ref) {
      var candidates = [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i] || {};
        var fi = String(p.fecha_inicio || '').slice(0, 10);
        var ff = String(p.fecha_fin || '').slice(0, 10);
        if (fi && ff && fi <= ref && ff >= ref) {
          candidates.push(i);
        }
      }
      if (candidates.length) return candidates[candidates.length - 1];
    }

    return list.length - 1;
  }

  function setActivePlanFromIndex(index) {
    if (!Array.isArray(state.planesDisponibles) || !state.planesDisponibles.length) {
      state.activePlanIndex = -1;
      state.activePlan = null;
      state.activePlanId = null;
      state.activeAnio = null;
      state.activeMes = null;
      return;
    }
    var idx = Math.max(0, Math.min(state.planesDisponibles.length - 1, Number(index) || 0));
    state.activePlanIndex = idx;
    state.activePlan = state.planesDisponibles[idx] || null;
    state.activePlanId = state.activePlan ? state.activePlan.id_plan : null;

    if (DateTime && state.activePlan && state.activePlan.fecha_inicio) {
      var dtInicio = DateTime.fromISO(String(state.activePlan.fecha_inicio).slice(0, 10));
      if (dtInicio.isValid) {
        state.activeAnio = dtInicio.year;
        state.activeMes = dtInicio.month;
      }
    }
  }

  function renderPlanSelector() {
    var sel = getEl('planifPlanSel');
    if (!sel) return;
    if (!Array.isArray(state.planesDisponibles) || !state.planesDisponibles.length) {
      sel.innerHTML = '<option value="">Sin planes</option>';
      return;
    }

    sel.innerHTML = state.planesDisponibles
      .map(function (p, idx) {
        var desc = String(p.descripcion || '').trim();
        var label = (desc ? desc + ' · ' : 'Plan #' + p.id_plan + ' · ') + fmtPlanRangeLabel(p);
        return (
          '<option value="' + idx + '">' + app.escapeHtml(label) + '</option>'
        );
      })
      .join('');

    // @ts-ignore
    sel.value = String(state.activePlanIndex >= 0 ? state.activePlanIndex : 0);
  }

  function syncPlanInCollection(plan) {
    if (!plan || !Array.isArray(state.planesDisponibles)) return;
    var normalized = normalizePlanRange(plan);
    var idx = indexByPlanId(normalized.id_plan);
    if (idx >= 0) {
      state.planesDisponibles[idx] = normalized;
      if (state.activePlanId && Number(state.activePlanId) === Number(normalized.id_plan)) {
        state.activePlan = normalized;
      }
      return;
    }
    state.planesDisponibles.push(normalized);
    state.planesDisponibles = sortPlanesAsc(state.planesDisponibles);
    var newIdx = indexByPlanId(normalized.id_plan);
    if (newIdx >= 0 && Number(state.activePlanId) === Number(normalized.id_plan)) {
      state.activePlanIndex = newIdx;
      state.activePlan = normalized;
    }
  }

  function getActivePlanStartDate() {
    if (!DateTime) return null;
    if (state.activePlan && state.activePlan.fecha_inicio) {
      var dtPlanStart = DateTime.fromISO(String(state.activePlan.fecha_inicio).slice(0, 10));
      if (dtPlanStart.isValid) return dtPlanStart.startOf('day');
    }
    if (state.activeAnio && state.activeMes) {
      var dtLegacy = DateTime.fromObject({
        year: state.activeAnio,
        month: state.activeMes,
        day: 1,
      });
      if (dtLegacy.isValid) return dtLegacy.startOf('day');
    }
    var dtNow = DateTime.now();
    return dtNow.isValid ? dtNow.startOf('month') : null;
  }

  function getPlanSelectionAfterDelete(deletedPlanId) {
    if (!Array.isArray(state.planesDisponibles) || !state.planesDisponibles.length) {
      return null;
    }

    var list = state.planesDisponibles;
    var deletedId = Number(deletedPlanId);
    var deletedIdx = -1;
    for (var i = 0; i < list.length; i++) {
      if (Number(list[i].id_plan) === deletedId) {
        deletedIdx = i;
        break;
      }
    }
    if (deletedIdx < 0) return null;

    // Regla predecible: vecino del mismo índice (siguiente); si no existe, el anterior.
    var nextIdx = deletedIdx < list.length - 1 ? deletedIdx + 1 : deletedIdx - 1;
    if (nextIdx < 0 || nextIdx >= list.length) return null;
    return list[nextIdx];
  }

  function removePlanFromCollection(deletedPlanId) {
    if (!Array.isArray(state.planesDisponibles) || !state.planesDisponibles.length) {
      return;
    }
    var deletedId = Number(deletedPlanId);
    state.planesDisponibles = state.planesDisponibles.filter(function (p) {
      return Number(p.id_plan) !== deletedId;
    });
    if (!state.planesDisponibles.length) {
      setActivePlanFromIndex(-1);
      return;
    }
    var idx = state.activePlanIndex;
    if (!Number.isInteger(idx) || idx < 0) idx = 0;
    if (idx >= state.planesDisponibles.length) idx = state.planesDisponibles.length - 1;
    setActivePlanFromIndex(idx);
  }

  // ── Navegador de plan ─────────────────────────────────────
  function actualizarNavMes() {
    var el = getEl('planifMesLabel');
    var fechasLabel = getEl('planifFechasLabel');
    var btnPrev = getEl('planifBtnMesAnterior');
    var btnNext = getEl('planifBtnMesSiguiente');

    renderPlanSelector();
    syncVistaFechaControls();
    if (el) {
      if (!state.activePlan) {
        el.textContent = 'Sin plan';
      } else {
        var desc = String(state.activePlan.descripcion || '').trim();
        el.textContent = desc || ('Plan #' + state.activePlan.id_plan);
      }
    }

    if (btnPrev) {
      // @ts-ignore
      btnPrev.disabled = state.activePlanIndex <= 0;
    }
    if (btnNext) {
      // @ts-ignore
      btnNext.disabled =
        !Array.isArray(state.planesDisponibles) ||
        state.activePlanIndex < 0 ||
        state.activePlanIndex >= state.planesDisponibles.length - 1;
    }

    if (fechasLabel && state.activePlan) {
      var rv = getVisibleRange();
      var fmt = function (dt) {
        return dt.day + '/' + dt.month + '/' + dt.year;
      };
      fechasLabel.textContent = fmt(rv.start) + ' — ' + fmt(rv.end);
    } else if (fechasLabel) {
      fechasLabel.textContent = '';
    }
  }

  async function irMesAnterior() {
    if (state.activePlanIndex <= 0) return;
    setActivePlanFromIndex(state.activePlanIndex - 1);
    actualizarNavMes();
    actualizarRangoInputs();
    await cargarPlanActivo();
  }

  async function irMesSiguiente() {
    if (!Array.isArray(state.planesDisponibles)) return;
    if (state.activePlanIndex < 0 || state.activePlanIndex >= state.planesDisponibles.length - 1) return;
    setActivePlanFromIndex(state.activePlanIndex + 1);
    actualizarNavMes();
    actualizarRangoInputs();
    await cargarPlanActivo();
  }

  async function cargarPlanActivo() {
    var perfStart = nowMs();
    state.versiones = [];
    state.activeVersionId = null;
    state.asignaciones = [];

    if (state.activePlanId) {
      try {
        var planResp = await getPlanifApiClient().getPlanById(state.activePlanId);
        if (planResp && planResp.plan) {
          syncPlanInCollection(planResp.plan);
          var idx = indexByPlanId(planResp.plan.id_plan);
          if (idx >= 0) setActivePlanFromIndex(idx);
        }
      } catch (e) {
        if (String((e && e.message) || '').indexOf('404') !== -1) {
          removePlanFromCollection(state.activePlanId);
        } else {
          showAlert('Error al recargar plan activo: ' + e.message, 'warning');
        }
      }
    }

    await cargarFestivos();

    actualizarInfoGrid();
    actualizarRangoInputs();

    if (state.activePlanId) {
      await cargarBorradores(state.activePlanId);
    } else {
      var verSel = getEl('planifVersionSel');
      if (verSel)
        verSel.innerHTML = '<option value="">— Sin plan —</option>';
      renderGrid();
    }
    logPerf(
      'cargarPlanActivo',
      perfStart,
      'plan=' + (state.activePlanId || 'none')
    );
  }

  // ── Cargar planes y seleccionar activo ───────────────────
  async function cargarPlanMes(anio, mes, options) {
    var opts = options || {};
    var perfStart = nowMs();
    state.referenceISO = monthRefISO(anio, mes) || state.referenceISO;
    var currentPlanId = state.activePlanId;

    state.planesDisponibles = [];
    state.activePlan = null;
    state.activePlanId = null;
    state.activePlanIndex = -1;
    state.versiones = [];
    state.activeVersionId = null;
    state.asignaciones = [];

    try {
      var data = await getPlanifApiClient().listPlanesForNavigation(200);
      var planes = Array.isArray(data.planes) ? data.planes : [];
      state.planesDisponibles = sortPlanesAsc(planes);

      var preferredId = opts.preferredPlanId;
      if (!preferredId && currentPlanId) preferredId = currentPlanId;
      var idx = pickInitialPlanIndex(
        state.planesDisponibles,
        preferredId,
        state.referenceISO
      );
      setActivePlanFromIndex(idx);
      if (state.activePlan && state.activePlan.fecha_inicio) {
        state.referenceISO = String(state.activePlan.fecha_inicio).slice(0, 10);
      }
    } catch (e) {
      showAlert('Error al cargar planes: ' + e.message, 'danger');
    }

    actualizarNavMes();
    actualizarInfoGrid();
    actualizarRangoInputs();

    if (state.activePlanId) {
      await cargarBorradores(state.activePlanId);
    } else {
      var verSel = getEl('planifVersionSel');
      if (verSel)
        verSel.innerHTML = '<option value="">— Sin planes disponibles —</option>';
      renderGrid();
    }
    logPerf(
      'cargarPlanMes',
      perfStart,
      'planes=' + state.planesDisponibles.length + ', plan=' + (state.activePlanId || 'none')
    );
  }

  function actualizarInfoGrid() {
    var infoEl = getEl('planifGridInfo');
    var fechasEl = getEl('planifFechasLabel');
    if (!state.activePlan) {
      if (infoEl) infoEl.textContent = '— Sin plan —';
      if (fechasEl) fechasEl.textContent = '';
      return;
    }
    var fi = fmtFecha(state.activePlan.fecha_inicio);
    var ff = state.activePlan.fecha_fin
      ? fmtFecha(state.activePlan.fecha_fin)
      : '—';
    var label = fmtPlanRangeLabel(state.activePlan);
    if (infoEl) infoEl.textContent = label;
    if (fechasEl) fechasEl.textContent = fi + ' – ' + ff;
  }

  // ── Cargar datos maestros ─────────────────────────────────
  async function cargarActividades() {
    try {
      var data = await api('/api/actividades');
      state.actividades = Array.isArray(data.actividades)
        ? data.actividades
        : Array.isArray(data)
          ? data
          : [];
      renderActividadFiltroList('');
    } catch (e) {
      console.warn('[Planif] Error cargando actividades:', e.message);
    }
  }

  async function cargarFestivos() {
    try {
      state.festivosSet = new Set();
      var apiClient = getPlanifApiClient();

      var arsId = app.globalState && app.globalState.activeArsId;
      if (!arsId) return;

      var cals = await apiClient.listCalendariosByArs(arsId);
      var lista = Array.isArray(cals.data) ? cals.data : [];
      var cal = lista.find(function (c) { return c.activo; });
      if (!cal) return;

      var festivos = await apiClient.listFestivos(cal.id);
      var rows = Array.isArray(festivos.data) ? festivos.data : [];
      var visible = getVisibleRange();
      var startYear = visible.start.year;
      var endYear = visible.end.year;

      rows.forEach(function (f) {
        var raw = String(f.fecha).slice(0, 10);
        var parts = raw.split('-');
        if (parts.length !== 3) return;
        if (f.es_recurrente) {
          for (var yr = startYear; yr <= endYear; yr++) {
            state.festivosSet.add(yr + '-' + parts[1] + '-' + parts[2]);
          }
        } else {
          state.festivosSet.add(raw);
        }
      });
    } catch (e) {
      console.warn('[Planif] Error cargando festivos:', e.message);
      showAlert('No se pudieron cargar los festivos: ' + e.message, 'warning');
    }
  }

  async function cargarAgentes() {
    try {
      var apiClient = getPlanifApiClient();
      var data = await apiClient.listAgentes();
      var rawAgentes = Array.isArray(data.agentes) ? data.agentes : [];
      var meta = null;
      try {
        meta = await apiClient.getAgentesMeta();
      } catch (_) {
        meta = null;
      }
      state.agentes = enriquecerAgentesConMeta(rawAgentes, meta);
    } catch (e) {
      console.warn('[Planif] Error cargando agentes:', e.message);
    }
  }

  async function cargarBorradores(planId) {
    try {
      var data = await getPlanifApiClient().listBorradores(planId);
      var borradores = Array.isArray(data.borradores) ? data.borradores : [];
      poblarSelVersiones(borradores);
    } catch (e) {
      showAlert('Error al cargar borradores: ' + e.message, 'danger');
    }
  }

  async function cargarAsignaciones(versionId) {
    try {
      var data = await getPlanifApiClient().listAsignaciones(versionId);
      state.asignaciones = Array.isArray(data.asignaciones)
        ? data.asignaciones
        : [];
      renderGrid();
    } catch (e) {
      showAlert('Error al cargar asignaciones: ' + e.message, 'danger');
    }
  }

  // ── Poblar controles ──────────────────────────────────────
  function poblarSelVersiones(borradores) {
    var sel = getEl('planifVersionSel');
    if (!sel) return;
    state.versiones = borradores;

    if (!borradores.length) {
      sel.innerHTML = '<option value="">Sin borradores</option>';
      state.activeVersionId = null;
      renderGrid();
      return;
    }

    var options = [];
    borradores.forEach(function (b) {
      var versiones = Array.isArray(b.versiones)
        ? b.versiones.filter(Boolean)
        : [];
      versiones.forEach(function (v) {
        var label =
          (b.nombre || 'Borrador') +
          ' v' +
          v.version_num +
          (b.aprobado ? ' ✓' : '');
        options.push(
          '<option value="' + v.id + '">' + app.escapeHtml(label) + '</option>'
        );
      });
    });

    if (!options.length) {
      sel.innerHTML = '<option value="">Sin versiones</option>';
      state.activeVersionId = null;
      renderGrid();
      return;
    }

    sel.innerHTML = options.join('');
    // @ts-ignore
    state.activeVersionId = Number(sel.value);
    cargarAsignaciones(state.activeVersionId);
  }

  function getActiveBorradorContext() {
    if (!state.activeVersionId || !Array.isArray(state.versiones)) return null;
    for (var i = 0; i < state.versiones.length; i++) {
      var borrador = state.versiones[i];
      var versiones = Array.isArray(borrador.versiones)
        ? borrador.versiones.filter(Boolean)
        : [];
      for (var j = 0; j < versiones.length; j++) {
        var version = versiones[j];
        if (String(version.id) === String(state.activeVersionId)) {
          return { borrador: borrador, version: version };
        }
      }
    }
    return null;
  }

  function getActividadesActivas() {
    return state.actividades.filter(function (a) {
      return a.activo !== false;
    });
  }


  function renderActividadFiltroList(filtro) {
    var listEl = getEl('planifActividadList');
    if (!listEl) return;

    var activasDisponibles = getActividadesActivas();
    var allowed = new Set(
      activasDisponibles.map(function (a) {
        return String(a.id_actividad || a.id);
      })
    );
    state.selectedActividadIds.forEach(function (id) {
      var sid = String(id);
      if (sid === '__EMPTY__' || sid === '__ANY__') return;
      if (!allowed.has(sid)) state.selectedActividadIds.delete(sid);
    });

    var q = String(filtro || '').trim().toLowerCase();
    var activas = state.actividades.filter(function (a) {
      if (a.activo === false) return false;
      if (!q) return true;
      var codigo = (a.actividad || a.codigo || '').toLowerCase();
      var nombre = (a.nombre || '').toLowerCase();
      var desc = (a.descripcion || '').toLowerCase();
      return (
        codigo.indexOf(q) !== -1 ||
        nombre.indexOf(q) !== -1 ||
        desc.indexOf(q) !== -1
      );
    });

    // Entrada fija "Sin Actividad" (sentinel __EMPTY__): siempre visible al inicio del panel
    var sinActChecked = state.selectedActividadIds.has('__EMPTY__') ? ' checked' : '';
    var conActChecked = state.selectedActividadIds.has('__ANY__') ? ' checked' : '';
    var conActHtml =
      '<label class="planif-act-filter-item planif-act-filter-item--special">' +
      '<input type="checkbox" class="form-check-input planif-act-chk" data-id="__ANY__"' + conActChecked + '>' +
      '<span class="planif-ctx-dot" style="background:#e8f5e9;border:1px solid #81c784"></span>' +
      '<span class="planif-act-filter-body">' +
      '<span class="planif-act-filter-head">' +
      '<span class="planif-act-filter-title fst-italic">Con Actividad</span>' +
      '</span>' +
      '</span>' +
      '</label>';
    var sinActHtml =
      '<label class="planif-act-filter-item planif-act-filter-item--special">' +
      '<input type="checkbox" class="form-check-input planif-act-chk" data-id="__EMPTY__"' + sinActChecked + '>' +
      '<span class="planif-ctx-dot" style="background:#dee2e6;border:1px solid #adb5bd"></span>' +
      '<span class="planif-act-filter-body">' +
      '<span class="planif-act-filter-head">' +
      '<span class="planif-act-filter-title fst-italic">Sin Actividad (algún día)</span>' +
      '</span>' +
      '</span>' +
      '</label>';

    if (!activas.length) {
      listEl.innerHTML = conActHtml + sinActHtml +
        '<div class="text-muted small p-2">Sin actividades para mostrar</div>';
      updateActividadesSelCount();
      return;
    }

    listEl.innerHTML = conActHtml + sinActHtml + activas
      .map(function (act) {
        var id = String(act.id_actividad || act.id);
        var codigo = String(act.actividad || act.codigo || id);
        var nombre = String(act.nombre || '').trim();
        var label = nombre || codigo;
        var desc = act.descripcion || '';
        var color = safeBadgeColor(act.color || '#dee2e6');
        var checked = state.selectedActividadIds.has(id) ? ' checked' : '';
        return (
          '<label class="planif-act-filter-item">' +
          '<input type="checkbox" class="form-check-input planif-act-chk" data-id="' +
          app.escapeHtml(id) +
          '"' +
          checked +
          '>' +
          '<span class="planif-ctx-dot" style="background:' +
          app.escapeHtml(color) +
          '"></span>' +
          '<span class="planif-act-filter-body">' +
          '<span class="planif-act-filter-head">' +
          '<span class="planif-act-filter-title">' +
          app.escapeHtml(label) +
          '</span>' +
          '<span class="planif-act-filter-code">' +
          app.escapeHtml(codigo) +
          '</span>' +
          '</span>' +
          (desc
            ? '<span class="planif-act-filter-desc">' +
              app.escapeHtml(desc) +
              '</span>'
            : '') +
          '</span>' +
          '</label>'
        );
      })
      .join('');

    updateActividadesSelCount();
  }

  function updateActividadesSelCount() {
    var el = getEl('planifActividadesSelCount');
    if (el) el.textContent = state.selectedActividadIds.size + ' seleccionadas';
  }


  function buildPlanifActividadNivelMaps() {
    var byActividad = new Map(); // actividadId -> {tipo, color, orden}
    (state.actividades || []).forEach(function (a) {
      var actividadId = Number(a.id_actividad || a.id);
      if (!actividadId) return;
      var nivel =
        String(
          a.nivel_grupo_nombre ||
            'Sin nivel'
        ).trim() || 'Sin nivel';
      var tipo = nivel;
      var ordenRaw = Number(a.nivel_grupo_orden);
      var orden = Number.isFinite(ordenRaw) ? ordenRaw : 9999;
      var color = safeBadgeColor(a.nivel_grupo_color || '#6c757d');
      byActividad.set(actividadId, {
        tipo: tipo,
        color: color,
        orden: orden,
      });
    });
    return byActividad;
  }

  function renderPlanifKpiDonuts() {
    var host = getEl('planifKpiDonuts');
    if (!host) return;
    if (!app._planifCharts) app._planifCharts = {};

    function disposeChart() {
      if (!app._planifCharts.planifKpiDonut) return;
      try {
        app._planifCharts.planifKpiDonut.dispose();
      } catch (_) {
        //noop 
      }
      app._planifCharts.planifKpiDonut = null;
    }

    if (!state.activeVersionId || !Array.isArray(state.asignaciones)) {
      disposeChart();
      host.innerHTML =
        '<div class="text-muted" style="font-size:.68rem">Sin datos de actividades.</div>';
      return;
    }

    var maps = buildPlanifActividadNivelMaps();
    var visible = getVisibleRange();
    var startISO = visible.start.toISODate();
    var endISO = visible.end.toISODate();

    // Agentes visibles en el grid (filtros de cabecera Tabulator)
    var activeAgentes = null;
    if (_planifTabulator && typeof _planifTabulator.getData === 'function') {
      try {
        var activeRows = _planifTabulator.getData('active');
        if (Array.isArray(activeRows) && activeRows.length) {
          activeAgentes = new Set(activeRows.map(function (r) { return String(r.agente_id || ''); }));
        }
      } catch (_) {
        //noop 
      }
    }
    var agentesFilter = activeAgentes || state.gridFilterAgentes;

    // tipoAgentes: tipo -> Set de pares agente|actividad únicos
    var tipoAgentes = new Map();

    state.asignaciones.forEach(function (a) {
      var actividadId = Number(a && a.actividad_id);
      if (!actividadId) return;
      var fecha = String(a && a.fecha ? a.fecha : '').slice(0, 10);
      if (!fecha || fecha < startISO || fecha > endISO) return;
      var agenteId = String(a.agente_id || '');
      if (agentesFilter && agentesFilter.size) {
        if (!agentesFilter.has(agenteId)) return;
      }
      var meta = maps.get(actividadId) || { tipo: 'Sin nivel', color: '#6c757d', orden: 9999 };
      if (!tipoAgentes.has(meta.tipo)) {
        tipoAgentes.set(meta.tipo, { pares: new Set(), color: meta.color, orden: meta.orden });
      }
      tipoAgentes.get(meta.tipo).pares.add(agenteId + '|' + actividadId);
    });

    var tipoCounts = new Map();
    var total = 0;
    tipoAgentes.forEach(function (v, tipo) {
      var count = v.pares.size;
      tipoCounts.set(tipo, { count: count, color: v.color, orden: v.orden });
      total += count;
    });

    if (!total || !tipoCounts.size) {
      disposeChart();
      host.innerHTML =
        '<div class="text-muted" style="font-size:.68rem">Sin actividades en el rango actual.</div>';
      return;
    }

    if (typeof echarts === 'undefined') {
      disposeChart();
      host.innerHTML =
        '<div class="text-muted" style="font-size:.68rem">La librería de gráficos no está disponible.</div>';
      return;
    }

    var items = Array.from(tipoCounts.entries())
      .map(function (entry) {
        var tipo = entry[0];
        var data = entry[1];
        var pct = Math.round((data.count * 100) / total);
        return {
          tipo: tipo,
          count: data.count,
          color: data.color,
          orden: data.orden,
          pct: pct,
        };
      })
      .sort(function (a, b) {
        if (a.orden !== b.orden) return a.orden - b.orden;
        return b.count - a.count;
      });

    host.innerHTML =
      '<div class="d-flex align-items-center justify-content-between mb-1">' +
      '<small class="text-muted" style="font-size:.66rem">Servicios x Agente y Grupo Actividad </small>' +
      '<small class="text-muted" style="font-size:.64rem">Total: ' +
      app.escapeHtml(String(total)) +
      '</small>' +
      '</div>' +
      '<div id="planifKpiDonutChart" style="width:100%;height:180px;"></div>';

    var chartEl = getEl('planifKpiDonutChart');
    if (!chartEl) return;
    disposeChart();
    var chart = echarts.init(chartEl, null, { renderer: 'svg' });
    app._planifCharts.planifKpiDonut = chart;
    chart.setOption({
      animation: false,
      tooltip: {
        trigger: 'item',
        confine: true,
        textStyle: {
          fontSize: 10,
        },
        extraCssText: 'padding:4px 6px;line-height:1.15;',
        formatter: '{b}: {c} ({d}%)',
      },
      legend: {
        bottom: 0,
        left: 'center',
        itemWidth: 8,
        itemHeight: 8,
        icon: 'circle',
        textStyle: {
          fontSize: 9,
        },
      },
      series: [
        {
          name: 'Distribución',
          type: 'pie',
          radius: ['46%', '68%'],
          center: ['50%', '34%'],
          avoidLabelOverlap: false,
          label: {
            show: true,
            fontSize: 9,
            formatter: '{d}%',
            color: '#333',
          },
          labelLine: { show: true, length: 6, length2: 4 },
          emphasis: false,
          data: items.map(function (it) {
            return {
              value: it.count,
              name: it.tipo,
              itemStyle: { color: it.color },
            };
          }),
        },
      ],
    });
  }

  function getSelectedActividadIds() {
    return Array.from(state.selectedActividadIds);
  }

  // ── Exportación a Excel ──────────────────────────────────
  async function exportAgentesSeleccionadosExcel() {
    if (!_planifTabulator || !_planifSelectedAgenteIds.size) {
      showAlert('Selecciona al menos un agente para exportar.', 'warning');
      return;
    }

    if (!state.activeVersionId) {
      showAlert('No hay versión activa para exportar.', 'warning');
      return;
    }

    try {
      // Obtener rango visible de fechas
      var visible = getVisibleRange();
      var startISO = visible.start.toISODate();
      var endISO = visible.end.toISODate();

      // Mostrar indicador de exportación
      showAlert('Exportando ' + _planifSelectedAgenteIds.size + ' agente(s)... Por favor espera.', 'info');

      // Llamar al endpoint del servidor con timeout
      var controller = new AbortController();
      var timeoutId = setTimeout(function () {
        controller.abort();
      }, 180000); // 3 minutos timeout

      // Payload mínimo: solo IDs de agentes y rango de fechas
      var payload = {
        agenteIds: Array.from(_planifSelectedAgenteIds).map(function (id) {
          return Number(id);
        }),
        fechaInicio: startISO,
        fechaFin: endISO,
      };

      try {
        var response = await fetch('/api/planificacion/versiones/' + state.activeVersionId + '/agentes/excel', {
          method: 'POST',
          headers: Object.assign(
            { 'Content-Type': 'application/json' },
            headers()
          ),
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          var errorText = await response.text();
          showAlert('Error al exportar: status ' + response.status + ' - ' + errorText, 'danger');
          return;
        }

        var blob = await response.blob();
        var contentDisposition = response.headers.get('Content-Disposition') || '';
        var filename = 'Agentes_Planificacion.xlsx';
        
        var match = contentDisposition.match(/filename="?([^";]+)"?/i);
        if (match && match[1]) {
          filename = match[1];
        }

        var blobUrl = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);

        showAlert(_planifSelectedAgenteIds.size + ' agente(s) exportado(s) correctamente.', 'success');
        _planifSelectedAgenteIds.clear();
        _planifTabulator.redraw();
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
          showAlert('Timeout al exportar. El archivo es muy grande. Intenta con menos agentes.', 'danger');
        } else {
          showAlert('Error al exportar: ' + e.message, 'danger');
        }
      }
    } catch (e) {
      showAlert('Error al preparar exportación: ' + e.message, 'danger');
    }
  }

  // ── Selección nativa Tabulator ───────────────────────────
  // Items sobre los que opera el menú contextual actual
  var _contextMenuItems = [];
  var _planifClipboardMatrix = null; // Matriz para copiar/pegar

  // ── Funciones de copiar/pegar para planificación ─────────
  function capturePlanifSelectedCells() {
    if (!_planifTabulator || !_contextMenuItems.length) return null;

    var rows = _planifTabulator.getRows();
    var cols = _planifTabulator.getColumns();

    // Construir matriz rectangular con todas las celdas del rango
    var minRow = Infinity;
    var maxRow = -Infinity;
    var minCol = Infinity;
    var maxCol = -Infinity;

    _contextMenuItems.forEach(function (item) {
      var agId = String(item.agente_id);
      var fecha = String(item.fecha).slice(0, 10);
      var rowIdx = rows.findIndex(function (r) { return String(r.getData().agente_id) === agId; });
      var colIdx = cols.findIndex(function (c) { 
        var f = c.getField();
        return f === 'd_' + fecha;
      });
      if (rowIdx >= 0 && colIdx >= 0) {
        minRow = Math.min(minRow, rowIdx);
        maxRow = Math.max(maxRow, rowIdx);
        minCol = Math.min(minCol, colIdx);
        maxCol = Math.max(maxCol, colIdx);
      }
    });

    if (minRow === Infinity) return null;

    var matrix = [];
    for (var r = minRow; r <= maxRow; r++) {
      var rowArr = [];
      for (var c = minCol; c <= maxCol; c++) {
        var row = rows[r];
        var col = cols[c];
        var cell = row && col ? row.getCell(col.getField()) : null;
        rowArr.push({
          value: cell ? cell.getValue() : null,
          rowIdx: r,
          colIdx: c,
        });
      }
      matrix.push(rowArr);
    }

    _planifClipboardMatrix = matrix;
    return matrix;
  }

  function pastePlanifMatrix(anchorRowIdx, anchorColIdx, matrix) {
    if (!_planifTabulator || !matrix || !matrix.length) return [];
    var rows = _planifTabulator.getRows();
    var cols = _planifTabulator.getColumns();
    var targets = [];

    matrix.forEach(function (matrixRow, rOffset) {
      matrixRow.forEach(function (entry, cOffset) {
        var targetRowIdx = anchorRowIdx + rOffset;
        var targetColIdx = anchorColIdx + cOffset;
        if (targetRowIdx >= rows.length || targetColIdx >= cols.length) return;

        var targetRow = rows[targetRowIdx];
        var targetCol = cols[targetColIdx];
        if (!targetRow || !targetCol) return;

        var field = targetCol.getField();
        if (!field || !field.startsWith('d_')) return;

        var targetCell = targetRow.getCell(field);
        if (!targetCell) return;

        targets.push({
          cell: targetCell,
          row: targetRow,
          field: field,
          fecha: field.slice(2), // "d_YYYY-MM-DD" → "YYYY-MM-DD"
          agente_id: targetRow.getData().agente_id,
          nextValue: entry ? entry.value : null,
          previousValue: targetCell.getValue(),
        });
      });
    });

    return targets;
  }

  async function persistPlanifPaste(targets) {
    if (!Array.isArray(targets) || !targets.length) return { afectados: 0 };
    if (!state.activeVersionId) throw new Error('Sin versión activa');

    var items = targets.map(function (t) {
      return {
        fecha: t.fecha,
        agente_id: Number(t.agente_id),
        actividad_id: t.nextValue ? Number(t.nextValue) : null,
      };
    });

    // Actualizar UI primero (optimistic update)
    targets.forEach(function (t) {
      t.cell.setValue(t.nextValue);
    });

    try {
      // Persistir via API
      var data = await getPlanifApiClient().bulkAsignaciones(
        state.activeVersionId,
        items
      );

      // Actualizar state.asignaciones
      items.forEach(function (item) {
        var isoFecha = String(item.fecha).slice(0, 10);
        var idx = state.asignaciones.findIndex(function (a) {
          return (
            String(a.agente_id) === String(item.agente_id) &&
            String(a.fecha).slice(0, 10) === isoFecha
          );
        });
        if (item.actividad_id) {
          if (idx >= 0) {
            state.asignaciones[idx].actividad_id = item.actividad_id;
          } else {
            state.asignaciones.push({
              agente_id: item.agente_id,
              fecha: isoFecha,
              actividad_id: item.actividad_id,
            });
          }
        } else {
          if (idx >= 0) state.asignaciones.splice(idx, 1);
        }
      });

      return data;
    } catch (e) {
      // Revertir cambios en UI si falla
      targets.forEach(function (t) {
        t.cell.setValue(t.previousValue);
      });
      throw e;
    }
  }

  // Devuelve [{agente_id, fecha}] de todas las celdas de día en el rango activo
  function getRangeCeldasItems() {
    if (!_planifTabulator) return [];
    var ranges = _planifTabulator.getRanges();
    if (!ranges || !ranges.length) return [];
    var seen = new Set();
    var result = [];
    ranges.forEach(function (range) {
      range.getCells().forEach(function (cellRow) {
        var cells = Array.isArray(cellRow) ? cellRow : [cellRow];
        cells.forEach(function (cell) {
          var field = cell.getColumn().getField();
          if (!field || !field.startsWith('d_')) return;
          var agenteId = String(cell.getRow().getData().agente_id);
          var fecha = field.slice(2); // "d_YYYY-MM-DD" → "YYYY-MM-DD"
          var key = agenteId + '|' + fecha;
          if (!seen.has(key)) {
            seen.add(key);
            result.push({ agente_id: agenteId, fecha: fecha });
          }
        });
      });
    });
    return result;
  }

  function actualizarContadorCeldas() {
    var infoEl = getEl('planifSelCeldasCount');
    if (!infoEl) return;
    var items = getRangeCeldasItems();
    infoEl.textContent = items.length ? items.length + ' celda(s) sel.' : '';
  }

  // ── Menú contextual ───────────────────────────────────────
  function buildContextMenu(e, agenteId, fecha) {
    if (guardReadOnlyAction()) return;
    e.preventDefault();
    closePlanifContextMenu();

    // Si la celda clicada está en el rango activo → operar sobre todo el rango
    // Si no → operar solo sobre esa celda
    var rangeItems = getRangeCeldasItems();
    var inRange = rangeItems.some(function (item) {
      return String(item.agente_id) === String(agenteId) && item.fecha === fecha;
    });
    _contextMenuItems = inRange
      ? rangeItems
      : [{ agente_id: agenteId, fecha: fecha }];

    var menu = document.createElement('div');
    menu.id = 'planifContextMenu';
    menu.className = 'planif-ctx-menu shadow';

    var numSel = _contextMenuItems.length;
    var header = document.createElement('div');
    header.className = 'planif-ctx-header';
    header.textContent =
      numSel +
      ' celda' +
      (numSel !== 1 ? 's' : '') +
      ' seleccionada' +
      (numSel !== 1 ? 's' : '');
    menu.appendChild(header);

    // ─ Opción Copiar ─
    var itemCopiar = document.createElement('div');
    itemCopiar.className = 'planif-ctx-item';
    itemCopiar.innerHTML =
      '<i class="bi bi-clipboard me-1"></i>Copiar';
    itemCopiar.addEventListener('click', function () {
      closePlanifContextMenu();
      var matrix = capturePlanifSelectedCells();
      if (!matrix || !matrix.length) {
        showAlert('No hay celdas para copiar.', 'warning');
        return;
      }
      showAlert('Celdas copiadas (' + _contextMenuItems.length + ').', 'success');
    });
    menu.appendChild(itemCopiar);

    // ─ Opción Pegar ─
    var itemPegar = document.createElement('div');
    itemPegar.className = 'planif-ctx-item';
    itemPegar.innerHTML =
      '<i class="bi bi-clipboard-check me-1"></i>Pegar';
    itemPegar.addEventListener('click', async function () {
      closePlanifContextMenu();
      if (!_planifClipboardMatrix || !_planifClipboardMatrix.length) {
        showAlert('No hay contenido copiado para pegar.', 'warning');
        return;
      }
      if (!_planifTabulator || !_contextMenuItems.length) {
        showAlert('No hay celda de destino seleccionada.', 'warning');
        return;
      }

      var rows = _planifTabulator.getRows();
      var cols = _planifTabulator.getColumns();
      var anchorItem = _contextMenuItems[0];
      var anchorRowIdx = rows.findIndex(function (r) {
        return String(r.getData().agente_id) === String(anchorItem.agente_id);
      });
      var anchorColIdx = cols.findIndex(function (c) {
        var f = c.getField();
        return f === 'd_' + String(anchorItem.fecha).slice(0, 10);
      });

      if (anchorRowIdx < 0 || anchorColIdx < 0) {
        showAlert('No se encontró celda de destino válida.', 'warning');
        return;
      }

      var targets = pastePlanifMatrix(anchorRowIdx, anchorColIdx, _planifClipboardMatrix);
      if (!targets.length) {
        showAlert('No se pudieron pegar celdas.', 'warning');
        return;
      }

      try {
        var result = await persistPlanifPaste(targets);
        parchearCeldasEnGrid(
          targets.map(function (t) { 
            return { agente_id: t.agente_id, fecha: t.fecha, actividad_id: t.nextValue }; 
          })
        );
        renderPlanifKpiDonuts();
        actualizarContadorCeldas();
        showAlert('Pegado persistido (' + result.afectados + ' celdas).', 'success');
      } catch (e) {
        showAlert('Error al pegar: ' + e.message, 'danger');
      }
    });
    menu.appendChild(itemPegar);

    // Separador antes de Borrar
    var sep1 = document.createElement('div');
    sep1.className = 'planif-ctx-sep';
    menu.appendChild(sep1);

    // Separador "Borrar"
    var itemBorrar = document.createElement('div');
    itemBorrar.className = 'planif-ctx-item planif-ctx-item-danger';
    itemBorrar.innerHTML =
      '<i class="bi bi-x-circle me-1"></i>Borrar asignación';
    itemBorrar.addEventListener('click', function () {
      closePlanifContextMenu();
      aplicarActividadASeleccion(null);
    });
    menu.appendChild(itemBorrar);

    var sep = document.createElement('div');
    sep.className = 'planif-ctx-sep';
    menu.appendChild(sep);

    // Buscador Notion-style
    var activas = state.actividades.filter(function (a) {
      return a.activo !== false;
    });

    var searchWrap = document.createElement('div');
    searchWrap.className = 'planif-ctx-search';
    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Buscar actividad…';
    searchInput.setAttribute('autocomplete', 'off');
    searchWrap.appendChild(searchInput);
    menu.appendChild(searchWrap);

    var listWrap = document.createElement('div');
    menu.appendChild(listWrap);

    function renderActItems(filtro) {
      listWrap.innerHTML = '';
      var filtradas = filtro
        ? activas.filter(function (a) {
            var codigo = (a.actividad || a.codigo || '').toLowerCase();
            var nombre = (a.nombre || '').toLowerCase();
            var desc = (a.descripcion || '').toLowerCase();
            return codigo.includes(filtro) || nombre.includes(filtro) || desc.includes(filtro);
          })
        : activas;

      if (!filtradas.length) {
        var empty = document.createElement('div');
        empty.className = 'planif-ctx-header';
        empty.textContent = 'Sin resultados';
        listWrap.appendChild(empty);
        return;
      }

      filtradas.forEach(function (act) {
        var id = act.id_actividad || act.id;
        var codigo = act.actividad || act.codigo || String(id);
        var nombre = act.nombre || '';
        var label = nombre && nombre !== codigo ? codigo + ' · ' + nombre : codigo;
        var desc = act.descripcion || '';
        var color = act.color || '#dee2e6';

        var item = document.createElement('div');
        item.className = 'planif-ctx-item';
        item.style.alignItems = 'flex-start';
        item.innerHTML =
          '<span class="planif-ctx-dot" style="background:' + color + ';margin-top:3px"></span>' +
          '<div class="planif-ctx-body">' +
            '<div class="planif-ctx-title">' +
              app.escapeHtml(label) +
            '</div>' +
            (desc ? '<div class="planif-ctx-desc">' + app.escapeHtml(desc) + '</div>' : '') +
          '</div>';
        item.addEventListener('click', function () {
          closePlanifContextMenu();
          aplicarActividadASeleccion(id);
        });
        listWrap.appendChild(item);
      });
    }

    renderActItems('');
    searchInput.addEventListener('input', function () {
      renderActItems(searchInput.value.trim().toLowerCase());
    });
    setTimeout(function () { searchInput.focus(); }, 30);

    // Posicionar
    document.body.appendChild(menu);
    var mx = e.clientX + window.scrollX;
    var my = e.clientY + window.scrollY;
    // Evitar salir del viewport
    var mw = 220;
    var mh = Math.min(menu.offsetHeight || 300, window.innerHeight - 20);
    if (mx + mw > window.innerWidth + window.scrollX) mx -= mw;
    if (my + mh > window.innerHeight + window.scrollY) my -= mh;
    menu.style.left = mx + 'px';
    menu.style.top = my + 'px';
  }

  function closePlanifContextMenu() {
    var m = document.getElementById('planifContextMenu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  async function aplicarActividadASeleccion(actividadId) {
    if (guardReadOnlyAction()) return;
    if (!state.activeVersionId) {
      showAlert('Sin versión activa.', 'warning');
      return;
    }
    if (!_contextMenuItems.length) return;

    var items = _contextMenuItems.map(function (v) {
      return {
        fecha: v.fecha,
        agente_id: Number(v.agente_id),
        actividad_id: actividadId || null,
      };
    });

    // ─ Si son pocas celdas, procesar sin confirmación ─
    if (items.length < 500) {
      await procesarBulkAsignaciones(items, actividadId);
      return;
    }

    // ─ Modal con confirmación para >= 500 celdas ─
    var modalId = 'bulkProgressModal';
    var existingModal = document.getElementById(modalId);
    if (existingModal) existingModal.remove();

    var modalHtml = `
      <div id="${modalId}" class="modal fade" tabindex="-1" style="backdrop-filter: blur(3px);">
        <div class="modal-dialog modal-sm">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="bulkModalTitle">Confirmar asignación masiva</h5>
            </div>
            <div class="modal-body">
              <!-- PANEL DE CONFIRMACIÓN -->
              <div id="bulkConfirmPanel">
                <div class="alert alert-warning mb-3" role="alert">
                  <div class="fw-semibold mb-2">⚠️ Operación masiva</div>
                  <div id="bulkCellCount" style="font-size: 1.2rem; color: #d39e00; margin-bottom: 8px;">
                    0 celda(s)
                  </div>
                  <small class="text-muted">Esta operación puede tardar varios minutos.</small>
                </div>
                <div class="d-grid gap-2">
                  <button type="button" class="btn btn-primary" id="bulkConfirmBtn">
                    <i class="bi bi-check-circle me-1"></i>Continuar
                  </button>
                  <button type="button" class="btn btn-secondary" id="bulkCancelBtn" data-bs-dismiss="modal">
                    <i class="bi bi-x-circle me-1"></i>Cancelar
                  </button>
                </div>
              </div>

              <!-- PANEL DE PROGRESO (oculto inicialmente) -->
              <div id="bulkProgressPanel" style="display: none;">
                <div class="mb-3">
                  <small class="text-muted"><span id="bulkProgressText">0</span> / <span id="bulkProgressTotal">${items.length}</span> celda(s)</small>
                </div>
                <div class="progress" style="height: 24px;">
                  <div id="bulkProgressBar" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    var modal = new bootstrap.Modal(document.getElementById(modalId), { 
      backdrop: 'static', 
      keyboard: false 
    });
    
    // ─ Actualizar texto de confirmación ─
    document.getElementById('bulkCellCount').textContent = items.length + ' celda(s)';
    
    // ─ Botón Continuar ─
    document.getElementById('bulkConfirmBtn').addEventListener('click', async function () {
      document.getElementById('bulkConfirmPanel').style.display = 'none';
      document.getElementById('bulkProgressPanel').style.display = 'block';
      document.getElementById('bulkModalTitle').textContent = 'Procesando asignación masiva...';
      document.getElementById('bulkConfirmBtn').disabled = true;
      document.getElementById('bulkCancelBtn').disabled = true;

      try {
        await procesarBulkAsignaciones(items, actividadId, modalId, modal);
      } catch (e) {
        modal.hide();
        document.getElementById(modalId).remove();
        showAlert(e.message, 'danger');
      }
    });

    modal.show();
  }

  // ─ Función auxiliar para procesar bulk con chunking ─
  async function procesarBulkAsignaciones(items, actividadId, modalId, modal) {
    try {
      var chunkSize = 500;
      var totalProcessed = 0;
      var totalAffected = 0;

      // ─ Procesar en chunks ─
      for (var c = 0; c < items.length; c += chunkSize) {
        var chunk = items.slice(c, Math.min(c + chunkSize, items.length));
        
        var data = await getPlanifApiClient().bulkAsignaciones(
          state.activeVersionId,
          chunk
        );
        
        totalProcessed += chunk.length;
        totalAffected += data.afectados || 0;

        // ─ Actualizar state.asignaciones en memoria ─
        chunk.forEach(function (item) {
          var isoFecha = String(item.fecha).slice(0, 10);
          var idx = state.asignaciones.findIndex(function (a) {
            return (
              String(a.agente_id) === String(item.agente_id) &&
              String(a.fecha).slice(0, 10) === isoFecha
            );
          });
          if (actividadId) {
            if (idx >= 0) {
              state.asignaciones[idx].actividad_id = actividadId;
            } else {
              state.asignaciones.push({
                agente_id: item.agente_id,
                fecha: isoFecha,
                actividad_id: actividadId,
              });
            }
          } else {
            if (idx >= 0) state.asignaciones.splice(idx, 1);
          }
        });

        // ─ Actualizar progreso visual (solo si hay modal) ─
        if (modalId) {
          var pct = Math.round((totalProcessed / items.length) * 100);
          var barEl = document.getElementById('bulkProgressBar');
          if (barEl) {
            barEl.style.width = pct + '%';
            barEl.setAttribute('aria-valuenow', pct);
          }
          var textEl = document.getElementById('bulkProgressText');
          if (textEl) textEl.textContent = totalProcessed;
        }

        // ─ Pequeña pausa para dejar respirar el navegador ─
        await new Promise(function (resolve) { setTimeout(resolve, 100); });
      }

      // ─ Parche in-place en Tabulator sin reconstruir la tabla ─
      parchearCeldasEnGrid(items, actividadId);
      renderPlanifKpiDonuts();
      _contextMenuItems = [];
      actualizarContadorCeldas();

      // ─ Cerrar modal si existe y mostrar éxito ─
      if (modal) {
        modal.hide();
        document.getElementById(modalId).remove();
      }
      showAlert(totalAffected + ' celda(s) actualizadas.', 'success');
    } catch (e) {
      if (modal) {
        modal.hide();
        document.getElementById(modalId).remove();
      }
      throw e;
    }
  }

  // ── Parche in-place de celdas sin reconstruir Tabulator ──
  function parchearCeldasEnGrid(items, actividadId) {
    if (!_planifTabulator) return;
    // Agrupar por agente_id para minimizar llamadas a updateData
    var porAgente = {};
    items.forEach(function (item) {
      var id = String(item.agente_id);
      if (!porAgente[id]) porAgente[id] = {};
      // Si actividadId se proporciona explícitamente (incluso null), usarlo para todos
      // Si no se proporciona (undefined), usar item.actividad_id de cada item
      var valor = actividadId !== undefined ? actividadId : (item.actividad_id !== undefined ? item.actividad_id : null);
      porAgente[id]['d_' + String(item.fecha).slice(0, 10)] = valor;
    });
    var rows = _planifTabulator.getRows();
    rows.forEach(function (row) {
      var rd = row.getData();
      var patch = porAgente[String(rd.agente_id)];
      if (!patch) return;
      Object.keys(patch).forEach(function (field) {
        var cell = row.getCell(field);
        if (cell) cell.setValue(patch[field]);
      });
    });
  }

  // ── Render del grid mensual (Tabulator) ─────────────────
  var _planifTabulator = null;
  var gridBuilders = app.createPlanificacionGridBuilders
    ? app.createPlanificacionGridBuilders({
        safeBadgeColor: safeBadgeColor,
        agenteNombreCompleto: agenteNombreCompleto,
        actividadColor: actividadColor,
        actividadNombre: actividadNombre,
        actividadTooltip: actividadTooltip,
        escapeHtml: app.escapeHtml,
        buildContextMenu: buildContextMenu,
        getFestivosSet: function () {
          return state.festivosSet;
        },
        getGridFilterAgentes: function () {
          return state.gridFilterAgentes;
        },
        meses: MESES,
      })
    : null;

  function renderGrid() {
    var perfStart = nowMs();
    var container = getEl('planifGridContainer');
    if (!container) {
      logPerf('renderGrid', perfStart, 'skip=no-container');
      return;
    }

    // Destruir instancia anterior
    if (_planifTabulator) {
      try {
        _planifTabulator.destroy();
      } catch (_) {
        //noop 
      }
      _planifTabulator = null;
    }

    // ── Mensaje vacío sin Tabulator ───────────────────────
    function showPlaceholder(msg) {
      container.innerHTML =
        '<div class="text-center text-muted py-4" style="font-size:.85rem">' +
        msg +
        '</div>';
    }

    if (!state.activePlan) {
      showPlaceholder(
        'No hay planes disponibles para la agrupacion activa. Usa <em>Nuevo plan</em> para crearlo.'
      );
      renderPlanifKpiDonuts();
      logPerf('renderGrid', perfStart, 'placeholder=no-plan');
      return;
    }
    if (!state.activeVersionId) {
      showPlaceholder('Sin versión activa. Crea un borrador.');
      renderPlanifKpiDonuts();
      logPerf('renderGrid', perfStart, 'placeholder=no-version');
      return;
    }
    // @ts-ignore
    if (!DateTime || typeof Tabulator === 'undefined') {
      showPlaceholder('Dependencias no disponibles (Luxon / Tabulator).');
      renderPlanifKpiDonuts();
      logPerf('renderGrid', perfStart, 'placeholder=missing-deps');
      return;
    }

    // ── Construir fechas del rango visible ────────────────
    var visible = getVisibleRange();
    var dias = Math.floor(visible.end.diff(visible.start, 'days').days) + 1;
    var fechas = Array.from({ length: dias }, function (_, i) {
      return visible.start.plus({ days: i });
    });

    // ── Mapa agente_id con meta y filas base ───────────────
    if (!gridBuilders) {
      showPlaceholder('Dependencias no disponibles (Grid Builders).');
      logPerf('renderGrid', perfStart, 'placeholder=missing-grid-builders');
      return;
    }

    var agenteMetaById = gridBuilders.buildAgenteMetaById(state.agentes);
    var agentesMap = gridBuilders.buildAgentesMap(
      state.agentes,
      state.asignaciones,
      agenteMetaById
    );

    // ── Construir filas para Tabulator ────────────────────
    var tableData = gridBuilders.buildTableData(agentesMap, fechas);

    // ── Columnas de días agrupadas por mes ────────────────
    var groupColumns = gridBuilders.buildMonthGroupColumns(fechas);

    // Columnas maestras (TIP / Agente / Empleo) + grupos de meses
    var columns = [
      {
        formatter: 'rowSelection',
        titleFormatter: 'html',
        titleFormatterParams: {},
        title:
          '<input type="checkbox" class="form-check-input planif-select-all-agentes" ' +
          'aria-label="Seleccionar/deseleccionar todos agentes" title="Seleccionar/deseleccionar todos agentes">',
        headerClick: function (_e) {
          var allChecked = document.querySelector('.planif-select-all-agentes');
          if (!allChecked) return;
          // El clic en el checkbox se maneja en su event listener
          // Este headerClick es para clics en el header en general
        },
        cellClick: function (e, cell) {
          e.stopPropagation();
        },
        frozen: true,
        headerSort: false,
        hozAlign: 'center',
        minWidth: 42,
        widthGrow: 0,
      },
      {
        title: 'Escalafon',
        field: 'escalafon',
        visible: false,
        frozen: true,
        sorter: 'string',
        headerSort: true,
      },
      {
        title: 'TIP',
        field: 'tip',
        frozen: true,
        minWidth: 50,
        width: 55,
        headerSort: true,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar (*,=,!=,^,$,!,&&,||)...',
        headerFilterFunc: planifHeaderFilterQbe,
        formatter: function (cell) {
          return (
            '<span class="text-muted" style="font-size:.68rem">' +
            app.escapeHtml(cell.getValue() || '') +
            '</span>'
          );
        },
      },
      {
        title: 'Agente',
        field: 'nombre',
        frozen: true,
        minWidth: 105,
        headerSort: true,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar (*,=,!=,^,$,!,&&,||)...',
        headerFilterFunc: planifHeaderFilterQbe,
        formatter: function (cell) {
          var rd = cell.getRow().getData() || {};
          var empleoLabel = String(rd.empleo_desc || rd.empleo_id || '').trim();
          var aptitudesLabel = String(rd.aptitudes || '').trim();
          var situacionId = String(rd.situacion_id || '').trim();
          var situacionDesc = String(rd.situacion_desc || '').trim();

          var badges = [];
          if (empleoLabel) {
            badges.push(
              GRS1Utils.renderColorBadgeHtml(
                empleoLabel,
                safeBadgeColor(rd.color_empleo),
                {
                  escapeHtmlFn: app.escapeHtml,
                  className: 'badge',
                  fontSize: '.60rem',
                  padding: '.22em .45em',
                  contrastThreshold: 0.6,
                }
              )
            );
          }
          if (aptitudesLabel) {
            badges.push(
              GRS1Utils.renderSemanticBadgeHtml(aptitudesLabel, 'secondary', {
                escapeHtmlFn: app.escapeHtml,
                fontSize: '.60rem',
                padding: '.22em .45em',
              })
            );
          }
          if (situacionId || situacionDesc) {
            var situacionLabel = situacionId && situacionDesc
              ? situacionId + ' · ' + situacionDesc
              : situacionId || situacionDesc;
            badges.push(
              GRS1Utils.renderColorBadgeHtml(
                situacionLabel,
                safeBadgeColor(rd.color_situacion),
                {
                  escapeHtmlFn: app.escapeHtml,
                  className: 'badge',
                  fontSize: '.60rem',
                  padding: '.22em .45em',
                  contrastThreshold: 0.6,
                }
              )
            );
          }

          return (
            '<div>' +
              '<div>' + app.escapeHtml(cell.getValue() || '') + '</div>' +
              (badges.length
                ? '<div style="display:flex; flex-wrap:wrap; gap:2px;">' + badges.join('') + '</div>'
                : '') +
            '</div>'
          );
        },
      },
      {
        title: 'Pelotón',
        field: 'peloton_desc',
        frozen: true,
        minWidth: 75,
        headerSort: true,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar (*,=,!=,^,$,!,&&,||)...',
        headerFilterFunc: planifHeaderFilterQbe,
        formatter: function (cell) {
          var rd = cell.getRow().getData() || {};
          var label = app.escapeHtml(cell.getValue() || '');
          var color = app.escapeHtml(safeBadgeColor(rd.color_peloton));
          if (!label) return '';
          return (
            '<span class="badge" style="background-color:' +
            color +
            ';font-size:.63rem;padding:.28em .52em">' +
            label +
            '</span>'
          );
        },
      },
    // @ts-ignore
    ].concat(groupColumns);
    // Esto NO es un error de indentación, es la concatenación de columnas maestras + grupos de meses.
    // NO QUITAR EL CONCAT. Si separamos el array de columnas maestras y el de grupos, Tabulator no los interpreta como parte de la misma definición de columnas y no los renderiza correctamente.
    // ── Crear Tabulator ───────────────────────────────────
    // @ts-ignore
    _planifTabulator = new Tabulator(container, {
      data: tableData,
      layout: 'fitData',
      height: '100%',
      initialSort:[
        {column:"escalafon", dir:"asc"} //Ordenacion de carga del Grid, para que respete el orden del filtro de agentes (que a su vez respeta el orden de la lista de agentes cargada desde el backend)
      ],
      renderHorizontal: PLANIF_TABULATOR_RENDER_HORIZONTAL,
      columnDefaults: { resizable: true, headerHozAlign: 'center' },
      selectableRange: function(cell) {
        // Solo permitir selección en columnas de fechas (índice >= 5)
        // Las primeras 5 columnas (0-4) son: checkbox, escalafon, tip, agente, peloton
        var colIdx = cell.getColumn().getIndex();
        return colIdx >= 5;
      },
      selectableRangeColumns: false,
      selectableRangeRows: true,
      selectableRangeClearCells: true,
      columns: columns,
      placeholder:
        'Sin asignaciones. Selecciona agentes y aplica un rango de días.',
    });

    // Actualizar contador al cambiar el rango nativo
    _planifTabulator.on('rangeChanged', actualizarContadorCeldas);
    _planifTabulator.on('rangeAdded', actualizarContadorCeldas);
    _planifTabulator.on('rangeRemoved', actualizarContadorCeldas);
    _planifTabulator.on('dataFiltered', function () {
      renderPlanifKpiDonuts();
    });
    _planifTabulator.on('rowSelectionChanged', function (data, rows) {
      rows.forEach(function (row) {
        var agenteId = String(row.getData().agente_id || '');
        if (row.isSelected && row.isSelected()) {
          _planifSelectedAgenteIds.add(agenteId);
        } else {
          _planifSelectedAgenteIds.delete(agenteId);
        }
      });
    });

    // ─ Event listener para checkbox "Seleccionar todos" ─
    setTimeout(function () {
      var selectAllCheckbox = document.querySelector('.planif-select-all-agentes');
      if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function (e) {
          e.stopPropagation();
          if (this.checked) {
            // Seleccionar todas las filas activas (visibles)
            _planifTabulator.selectRow('active');
          } else {
            // Deseleccionar todas las filas
            _planifTabulator.deselectRow('active');
          }
        });
      }
    }, 100);

    renderPlanifKpiDonuts();
    logPerf('renderGrid', perfStart, 'rows=' + tableData.length + ', days=' + fechas.length);
  }

  // ── Crear nuevo borrador vacío ────────────────────────────
  function abrirModalNuevoBorrador() {
    if (guardReadOnlyAction()) return;
    if (!state.activePlanId) {
      showAlert('Crea primero un plan activo.', 'warning');
      return;
    }
    showAlert('', 'info', 'planifBorradorAlert');
    var inNombre = getEl('planifBorradorNombre');
    var inDesc = getEl('planifBorradorDesc');
    // @ts-ignore
    if (inNombre) inNombre.value = '';
    // @ts-ignore
    if (inDesc) inDesc.value = '';
    new bootstrap.Modal(getEl('planifModalNuevoBorrador')).show();
  }

  async function guardarNuevoBorrador() {
    if (guardReadOnlyAction()) return;
    showAlert('', 'info', 'planifBorradorAlert');
    // @ts-ignore
    var nombre = (getEl('planifBorradorNombre').value || '').trim();
    // @ts-ignore
    var descripcion = (getEl('planifBorradorDesc').value || '').trim();

    var btn = getEl('planifBtnBorradorGuardar');
    // @ts-ignore
    btn.disabled = true;
    try {
      var data = await getPlanifApiClient().createBorrador(state.activePlanId, {
        nombre: nombre || undefined,
        descripcion: descripcion || undefined,
      }
      );
      bootstrap.Modal.getInstance(getEl('planifModalNuevoBorrador')).hide();
      showAlert('Borrador creado. Versión #' + data.version_id, 'success');
      await cargarBorradores(state.activePlanId);
      if (data.version_id) {
        var sel = getEl('planifVersionSel');
        // @ts-ignore
        if (sel) sel.value = String(data.version_id);
        state.activeVersionId = data.version_id;
        await cargarAsignaciones(state.activeVersionId);
      }
    } catch (e) {
      showAlert(e.message, 'danger', 'planifBorradorAlert');
    } finally {
      // @ts-ignore
      btn.disabled = false;
    }
  }

  // ── Crear nuevo plan ──────────────────────────────────────
  async function guardarNuevoPlan() {
    if (guardReadOnlyAction()) return;
    showAlert('', 'info', 'planifNuevoAlert');
    // @ts-ignore
    var fechaInicio = (getEl('planifNuevoFechaInicio').value || '').trim();
    // @ts-ignore
    var numMeses = Number(getEl('planifNuevoNumMeses').value);
    // @ts-ignore
    var desc = (getEl('planifNuevoDesc').value || '').trim();

    if (!fechaInicio) {
      showAlert('Fecha inicio requerida.', 'warning', 'planifNuevoAlert');
      return;
    }
    if (!Number.isInteger(numMeses) || numMeses < 1 || numMeses > 12) {
      showAlert('Duración inválida (1-12 meses).', 'warning', 'planifNuevoAlert');
      return;
    }

    var dtInicio = DateTime ? DateTime.fromISO(fechaInicio) : null;
    if (!dtInicio || !dtInicio.isValid) {
      showAlert('Fecha inicio inválida.', 'warning', 'planifNuevoAlert');
      return;
    }
    var dtFin = dtInicio.plus({ months: numMeses }).minus({ days: 1 }).startOf('day');

    var btn = getEl('planifBtnNuevoGuardar');
    // @ts-ignore
    btn.disabled = true;
    try {
      var data = await getPlanifApiClient().createPlan({
        fecha_inicio: fechaInicio,
        fecha_fin: dtFin.toISODate(),
        num_meses: numMeses,
        descripcion: desc || undefined,
      });
      bootstrap.Modal.getInstance(getEl('planifModalNuevo')).hide();
      showAlert(
        'Plan creado: ' +
          dtInicio.toFormat('dd/MM/yyyy') +
          ' → ' +
          dtFin.toFormat('dd/MM/yyyy') +
          '.',
        'success'
      );
      var createdPlan = data && data.plan ? normalizePlanRange(data.plan) : null;
      if (createdPlan) {
        syncPlanInCollection(createdPlan);
        var createdIdx = indexByPlanId(createdPlan.id_plan);
        if (createdIdx >= 0) {
          setActivePlanFromIndex(createdIdx);
          state.referenceISO = String(createdPlan.fecha_inicio).slice(0, 10);
          actualizarNavMes();
          await cargarPlanActivo();
        } else {
          await cargarPlanMes(dtInicio.year, dtInicio.month, {
            preferredPlanId: createdPlan.id_plan,
          });
        }
      } else {
        await cargarPlanMes(dtInicio.year, dtInicio.month, {});
      }
    } catch (e) {
      showAlert(e.message, 'danger', 'planifNuevoAlert');
    } finally {
      // @ts-ignore
      btn.disabled = false;
    }
  }

  // ── Copiar desde plan anterior ────────────────────────────
  function abrirModalCopiar() {
    if (guardReadOnlyAction()) return;
    if (!state.activePlanId) {
      showAlert('Crea primero un plan activo.', 'warning');
      return;
    }
    showAlert('', 'info', 'planifCopiarAlert');
    getPlanifApiClient().listPlanesGlobal()
      .then(function (data) {
        var planes = Array.isArray(data.planes) ? data.planes : [];
        var otros = planes.filter(function (p) {
          return p.id_plan !== state.activePlanId;
        });
        var sel = getEl('planifCopiarOrigenSel');
        if (!sel) return;
        if (!otros.length) {
          showAlert('No hay otros planes disponibles como origen.', 'warning');
          return;
        }
        sel.innerHTML = otros
          .map(function (p) {
            var label = fmtPlanRangeLabel(p);
            return (
              '<option value="' +
              p.id_plan +
              '">' +
              app.escapeHtml(label) +
              '</option>'
            );
          })
          .join('');
        new bootstrap.Modal(getEl('planifModalCopiar')).show();
      })
      .catch(function (e) {
        showAlert('Error cargando planes: ' + e.message, 'danger');
      });
  }

  async function guardarCopia() {
    if (guardReadOnlyAction()) return;
    if (!state.activePlanId) {
      showAlert('No hay plan destino activo.', 'warning', 'planifCopiarAlert');
      return;
    }
    // @ts-ignore
    var fromId = Number(getEl('planifCopiarOrigenSel').value);
    // @ts-ignore
    var nombre = (getEl('planifCopiarNombre').value || 'Copia').trim();
    // @ts-ignore
    var versionDesc = (getEl('planifCopiarVersion').value || 'v1 copia').trim();

    var btn = getEl('planifBtnCopiarGuardar');
    // @ts-ignore
    btn.disabled = true;
    showAlert('', 'info', 'planifCopiarAlert');
    try {
      var data = await getPlanifApiClient().copyDesdePlan(state.activePlanId, {
        from_plan_id: fromId,
        draft_nombre: nombre,
        version_descripcion: versionDesc,
      }
      );
      bootstrap.Modal.getInstance(getEl('planifModalCopiar')).hide();
      showAlert('Copia creada. Versión #' + data.version_id, 'success');
      await cargarBorradores(state.activePlanId);
      if (data.version_id) {
        var sel = getEl('planifVersionSel');
        // @ts-ignore
        if (sel) sel.value = String(data.version_id);
        state.activeVersionId = data.version_id;
        await cargarAsignaciones(state.activeVersionId);
      }
    } catch (e) {
      showAlert(e.message, 'danger', 'planifCopiarAlert');
    } finally {
      // @ts-ignore
      btn.disabled = false;
    }
  }

  // ── Utilidades de rango diario ───────────────────────────
  function iterarFechasInclusivo(inicioISO, finISO) {
    var inicio = DateTime.fromISO(inicioISO);
    var fin = DateTime.fromISO(finISO);
    var fechas = [];
    if (!inicio.isValid || !fin.isValid || inicio > fin) return fechas;
    var actual = inicio.startOf('day');
    var max = fin.startOf('day');
    while (actual <= max) {
      fechas.push(actual.toISODate());
      actual = actual.plus({ days: 1 });
    }
    return fechas;
  }

  function filtrarPorActividadesSeleccionadas() {
    // @ts-ignore
    var fechaInicio = getEl('planifFechaInicio').value;
    // @ts-ignore
    var fechaFin = getEl('planifFechaFin').value;
    if (!fechaInicio || !fechaFin) {
      showAlert('Define fecha inicio y fecha fin.', 'warning');
      return;
    }
    if (!state.activeVersionId) {
      showAlert('Selecciona una versión activa para buscar.', 'warning');
      return;
    }

    var allSelectedIds = getSelectedActividadIds();
    var filterEmpty = allSelectedIds.indexOf('__EMPTY__') !== -1;
    var filterAny = allSelectedIds.indexOf('__ANY__') !== -1;
    var actividadIds = allSelectedIds.filter(function (id) { return id !== '__EMPTY__'; });
    actividadIds = actividadIds.filter(function (id) { return id !== '__ANY__'; });

    if (!actividadIds.length && !filterEmpty && !filterAny) {
      showAlert('Marca al menos una actividad para buscar.', 'warning');
      return;
    }

    var fechas = iterarFechasInclusivo(fechaInicio, fechaFin);
    if (!fechas.length) {
      showAlert('Rango de fechas inválido.', 'warning');
      return;
    }

    var idsSet = new Set();

    // Agentes con actividades concretas en el rango
    if (actividadIds.length) {
      var actividadSet = new Set(
        actividadIds.map(function (id) { return String(id); })
      );
      state.asignaciones.forEach(function (a) {
        var fecha = String(a.fecha).slice(0, 10);
        var actividad = String(a.actividad_id || '');
        if (!actividad) return;
        if (fecha < fechaInicio || fecha > fechaFin) return;
        if (!actividadSet.has(actividad)) return;
        idsSet.add(String(a.agente_id));
      });
    }

    // Agentes con CUALQUIER actividad en el rango (OR con los anteriores)
    if (filterAny) {
      state.asignaciones.forEach(function (a) {
        var fecha = String(a.fecha).slice(0, 10);
        if (fecha < fechaInicio || fecha > fechaFin) return;
        if (!a.actividad_id) return;
        idsSet.add(String(a.agente_id));
      });
    }

    // Agentes con al menos un día SIN actividad en el rango (OR con los anteriores)
    if (filterEmpty) {
      var fechasSet = new Set(fechas);
      var actividadPorAgente = {};
      state.asignaciones.forEach(function (a) {
        var fecha = String(a.fecha).slice(0, 10);
        if (!fechasSet.has(fecha)) return;
        if (!a.actividad_id) return;
        var aidKey = String(a.agente_id || '');
        if (!aidKey) return;
        if (!actividadPorAgente[aidKey]) actividadPorAgente[aidKey] = new Set();
        actividadPorAgente[aidKey].add(fecha);
      });
      state.agentes.forEach(function (ag) {
        var aid = String(ag.id || ag.agente_id || '');
        if (!aid) return;
        var diasConActividad = actividadPorAgente[aid] || new Set();
        var tieneAlgunDiaSinActividad = fechas.some(function (f) {
          return !diasConActividad.has(f);
        });
        if (tieneAlgunDiaSinActividad) idsSet.add(aid);
      });
    }

    state.gridFilterAgentes = idsSet;
    renderGrid();
    showAlert(
      idsSet.size + ' agente(s) encontrado(s) en el rango seleccionado.',
      idsSet.size ? 'success' : 'warning'
    );
  }

  // ── Aprobar versión ───────────────────────────────────────
  function aprobarVersion() {
    if (guardReadOnlyAction()) return;
    if (!state.activeVersionId) {
      showAlert('No hay versión activa para aprobar.', 'warning');
      return;
    }

    var ctx = getActiveBorradorContext();
    if (!ctx || !ctx.borrador) {
      showAlert('No se pudo resolver el borrador activo.', 'warning');
      return;
    }

    var nombreEl = getEl('planifAprobarNombre');
    var estadoPrevioEl = getEl('planifAprobarEstadoPrevio');
    var comentarioEl = getEl('planifAprobarComentario');

    if (nombreEl) nombreEl.textContent = ctx.borrador.nombre || 'Borrador';
    if (comentarioEl) {
      // @ts-ignore
      comentarioEl.value = String(ctx.borrador.observaciones || '');
    }

    if (estadoPrevioEl) {
      if (ctx.borrador.aprobado) {
        var autor = ctx.borrador.aprobado_by_username || '—';
        var fecha = ctx.borrador.aprobado_at
          ? fmtFecha(String(ctx.borrador.aprobado_at).slice(0, 10))
          : '—';
        estadoPrevioEl.textContent =
          'Actualmente aprobado por ' + autor + ' el ' + fecha + '.';
      } else {
        estadoPrevioEl.textContent =
          'Aún no hay aprobación previa de este borrador.';
      }
    }

    var confirmPanel = getEl('planifAprobarConfirmPanel');
    var progressPanel = getEl('planifAprobarProgressPanel');
    var progressText = getEl('planifAprobarProgressText');
    var progressTotal = getEl('planifAprobarProgressTotal');
    var progressBar = getEl('planifAprobarProgressBar');
    var titleEl = getEl('planifAprobarModalTitle');
    var btnCancel = getEl('planifAprobarCancelBtn');
    var btnConfirm = getEl('planifAprobarConfirmBtn');

    if (confirmPanel) confirmPanel.style.display = '';
    if (progressPanel) progressPanel.style.display = 'none';
    if (progressText) progressText.textContent = '0';
    if (progressTotal) progressTotal.textContent = '0';
    if (progressBar) {
      progressBar.style.width = '0%';
      progressBar.setAttribute('aria-valuenow', '0');
    }
    if (titleEl) titleEl.textContent = 'Aprobar borrador';
    // @ts-ignore
    if (btnCancel) btnCancel.disabled = false;
    // @ts-ignore
    if (btnConfirm) btnConfirm.disabled = false;

    bootstrap.Modal.getOrCreateInstance(getEl('planifModalAprobar')).show();
  }

  async function confirmarAprobacion() {
    if (guardReadOnlyAction()) return;
    if (!state.activeVersionId) {
      showAlert('No hay versión activa para aprobar.', 'warning');
      return;
    }

    var comentarioEl = getEl('planifAprobarComentario');
    // @ts-ignore
    var comentario = comentarioEl ? comentarioEl.value : '';

    showAlert('', 'info');
    var btn = getEl('planifAprobarConfirmBtn');
    var btnCancel = getEl('planifAprobarCancelBtn');
    var titleEl = getEl('planifAprobarModalTitle');
    var confirmPanel = getEl('planifAprobarConfirmPanel');
    var progressPanel = getEl('planifAprobarProgressPanel');
    var progressText = getEl('planifAprobarProgressText');
    var progressTotal = getEl('planifAprobarProgressTotal');
    var progressBar = getEl('planifAprobarProgressBar');

    function setProgress(processed, total) {
      var safeTotal = Math.max(0, Number(total) || 0);
      var safeProcessed = Math.max(0, Math.min(Number(processed) || 0, safeTotal));
      var pct = safeTotal > 0 ? Math.round((safeProcessed * 100) / safeTotal) : 100;
      if (progressText) progressText.textContent = String(safeProcessed);
      if (progressTotal) progressTotal.textContent = String(safeTotal);
      if (progressBar) {
        progressBar.style.width = pct + '%';
        progressBar.setAttribute('aria-valuenow', String(pct));
      }
    }

    // @ts-ignore
    if (btn) btn.disabled = true;
    // @ts-ignore
    if (btnCancel) btnCancel.disabled = true;
    if (confirmPanel) confirmPanel.style.display = 'none';
    if (progressPanel) progressPanel.style.display = '';
    if (titleEl) titleEl.textContent = 'Aprobando borrador...';
    setProgress(0, 0);

    try {
      var apiClient = getPlanifApiClient();
      var hasChunkApi =
        apiClient &&
        typeof apiClient.aprobarVersionPrepare === 'function' &&
        typeof apiClient.aprobarVersionChunk === 'function' &&
        typeof apiClient.aprobarVersionFinalize === 'function';

      var data;
      if (!hasChunkApi) {
        data = await apiClient.aprobarVersion(state.activeVersionId, comentario);
      } else {
        var prep = await apiClient.aprobarVersionPrepare(state.activeVersionId);
        var total = Math.max(0, Number(prep.total) || 0);
        var chunkSize = 500;
        var processed = 0;
        var aprobados = 0;
        var auditados = 0;

        setProgress(0, total);

        for (var offset = 0; offset < total; offset += chunkSize) {
          var partial = await apiClient.aprobarVersionChunk(
            state.activeVersionId,
            offset,
            chunkSize
          );
          processed += Number(partial.procesadas || 0);
          aprobados += Number(partial.aprobados || 0);
          auditados += Number(partial.auditados || 0);
          setProgress(processed, total);
        }

        var fin = await apiClient.aprobarVersionFinalize(state.activeVersionId, comentario);
        setProgress(total, total);
        data = {
          aprobados: aprobados,
          auditados: auditados,
          borrador: fin && fin.borrador ? fin.borrador : null,
        };
      }

      try {
        bootstrap.Modal.getOrCreateInstance(getEl('planifModalAprobar')).hide();
      } catch (_) {
        //noop 
      }
      showAlert(
        'Versión aprobada. ' + data.aprobados + ' asignaciones consolidadas.',
        'success'
      );
      await cargarBorradores(state.activePlanId);
    } catch (e) {
      showAlert(e.message, 'danger');
    } finally {
      if (confirmPanel) confirmPanel.style.display = '';
      if (progressPanel) progressPanel.style.display = 'none';
      if (titleEl) titleEl.textContent = 'Aprobar borrador';
      // @ts-ignore
      if (btn) btn.disabled = false;
      // @ts-ignore
      if (btnCancel) btnCancel.disabled = false;
    }
  }

  function abrirModalDescartarBorrador() {
    if (guardReadOnlyAction()) return;
    var ctx = getActiveBorradorContext();
    if (!ctx || !ctx.borrador) {
      showAlert('No hay borrador activo para descartar.', 'warning');
      return;
    }
    var nombreEl = getEl('planifDescartarNombre');
    if (nombreEl) nombreEl.textContent = ctx.borrador.nombre || 'Borrador';
    bootstrap.Modal.getOrCreateInstance(getEl('planifModalDescartar')).show();
  }

  async function confirmarDescarteBorrador() {
    if (guardReadOnlyAction()) return;
    var ctx = getActiveBorradorContext();
    if (!ctx || !ctx.borrador) {
      showAlert('No hay borrador activo para descartar.', 'warning');
      return;
    }

    var btn = getEl('planifDescartarConfirmBtn');
    // @ts-ignore
    if (btn) btn.disabled = true;

    showAlert('', 'info');
    try {
      await getPlanifApiClient().descartarBorrador(ctx.borrador.id);
      try {
        bootstrap.Modal.getOrCreateInstance(getEl('planifModalDescartar')).hide();
      } catch (_) {
        //noop 
      }
      showAlert('Borrador descartado. Ya no aparece en el selector.', 'success');
      await cargarBorradores(state.activePlanId);
      if (state.activeVersionId) await cargarAsignaciones(state.activeVersionId);
      else renderGrid();
    } catch (e) {
      showAlert(e.message, 'danger');
    } finally {
      // @ts-ignore
      if (btn) btn.disabled = false;
    }
  }

  // ── Preview en modal nuevo ────────────────────────────────
  function actualizarPreviewFecha() {
    var el = getEl('planifNuevoFechaPreview');
    if (!el || !DateTime) return;
    // @ts-ignore
    var fechaInicio = (getEl('planifNuevoFechaInicio').value || '').trim();
    // @ts-ignore
    var numMeses = Number(getEl('planifNuevoNumMeses').value);
    if (!fechaInicio || !Number.isInteger(numMeses) || numMeses < 1) {
      el.textContent = '';
      return;
    }
    var dtInicio = DateTime.fromISO(fechaInicio).startOf('day');
    if (!dtInicio.isValid) {
      el.textContent = '';
      return;
    }
    var dtFin = dtInicio.plus({ months: numMeses }).minus({ days: 1 });
    var dias = Math.floor(dtFin.diff(dtInicio, 'days').days) + 1;
    el.textContent =
      dtInicio.toFormat('dd/MM/yyyy') +
      ' → ' +
      dtFin.toFormat('dd/MM/yyyy') +
      '  (' +
      dias +
      ' días)';
  }

  // ── Filtrar agentes sin actividad en el rango ───────────
  function filtrarSinActividad() {
    var fechaInicio =
      // @ts-ignore
      getEl('planifFechaInicio') && getEl('planifFechaInicio').value;
    // @ts-ignore
    var fechaFin = getEl('planifFechaFin') && getEl('planifFechaFin').value;
    if (!fechaInicio || !fechaFin) {
      showAlert('Define fecha inicio y fecha fin antes de filtrar.', 'warning');
      return;
    }
    var fechas = iterarFechasInclusivo(fechaInicio, fechaFin);
    if (!fechas.length) {
      showAlert('Rango de fechas inválido.', 'warning');
      return;
    }

    // Mapa agente_id → Set de fechas con actividad asignada
    var asigMap = {};
    state.asignaciones.forEach(function (a) {
      var id = String(a.agente_id);
      if (!asigMap[id]) asigMap[id] = new Set();
      if (a.actividad_id) asigMap[id].add(String(a.fecha).slice(0, 10));
    });

    // Agentes que tienen al menos un día sin actividad en el rango
    var sinActividad = state.agentes.filter(function (ag) {
      var dias = asigMap[String(ag.id)] || new Set();
      return fechas.some(function (f) {
        return !dias.has(f);
      });
    });

    var idsSet = new Set(
      sinActividad.map(function (ag) {
        return String(ag.id);
      })
    );
    state.gridFilterAgentes = idsSet;
    renderGrid();
    showAlert(
      sinActividad.length +
        ' agente(s) sin cobertura completa en el rango seleccionado.',
      sinActividad.length ? 'warning' : 'success'
    );
  }

  function limpiarFiltroGrid() {
    state.gridFilterAgentes = null;
    state.selectedActividadIds.clear();
    var buscarAct = getEl('planifActividadBuscar');
    if (buscarAct) {
      // @ts-ignore
      buscarAct.value = '';
    }
    renderActividadFiltroList('');
    renderGrid();
    showAlert('', 'info');
  }

  // ── Borrado ordenado ─────────────────────────────────────────
  var _borrarTipo = null; // 'version' | 'borrador' | 'plan'

  function abrirModalBorrar(tipo) {
    if (guardReadOnlyAction()) return;
    var descEl = getEl('planifBorrarModalDesc');
    var titleEl = getEl('planifBorrarModalLabel');
    var switchEl = getEl('planifBorrarSwitch');
    var switchLabel = getEl('planifBorrarSwitchLabel');
    var confirmBtn = getEl('planifBorrarConfirmBtn');

    var desc = '';
    var titulo = 'Confirmar borrado';
    if (tipo === 'version') {
      if (!state.activeVersionId) { showAlert('No hay versión activa seleccionada.', 'warning'); return; }
      titulo = 'Borrar versión activa';
      desc = 'Se eliminará la versión activa del borrador y todas sus asignaciones. El borrador permanecerá con el resto de versiones.';
    } else if (tipo === 'borrador') {
      if (!state.versiones.length) { showAlert('No hay borrador activo.', 'warning'); return; }
      titulo = 'Borrar borrador activo';
      desc = 'Se eliminará el borrador activo con TODAS sus versiones y asignaciones.';
    } else if (tipo === 'plan') {
      if (!state.activePlanId) { showAlert('No hay plan activo para borrar.', 'warning'); return; }
      titulo = 'Borrar plan activo';
      desc = 'Se eliminará el plan activo completo, incluyendo TODOS los borradores, versiones y asignaciones asociadas.';
    }

    _borrarTipo = tipo;
    if (titleEl) titleEl.innerHTML = '<i class="bi bi-trash me-2"></i>' + titulo;
    if (descEl) descEl.textContent = desc;
    // @ts-ignore
    if (switchEl) { switchEl.checked = false; }
    if (switchLabel) switchLabel.textContent = 'No';
    // @ts-ignore
    if (confirmBtn) confirmBtn.disabled = true;

    // Bind handler de confirmación sin reemplazar el nodo para no perder
    // la referencia que usa el switch al habilitar/deshabilitar el botón.
    if (confirmBtn) {
      confirmBtn.onclick = function () {
        ejecutarBorrado(_borrarTipo);
      };
    }

    try {
      var modalEl = getEl('planifBorrarModal');
      // @ts-ignore
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (e) {
      // noop
    }
  }

  async function ejecutarBorrado(tipo) {
    if (guardReadOnlyAction()) return;
    var modalEl = getEl('planifBorrarModal');
    try {
      var apiClient = getPlanifApiClient();
      if (tipo === 'version') {
        if (!state.activeVersionId) return;
        await apiClient.deleteVersion(state.activeVersionId);
        showAlert('Versión eliminada correctamente.', 'success');
      } else if (tipo === 'borrador') {
        // Borrar el borrador que contiene la versión activa
        var versionActual = state.versiones.find(function (v) { return v.id === state.activeVersionId; });
        if (!versionActual) return;
        // La API listarBorradores devuelve borradores con sus versiones; aquí buscamos por versionId
        var borradores = await apiClient.listBorradores(state.activePlanId);
        var borrador = (borradores.borradores || borradores).find(function (b) {
          return Array.isArray(b.versiones) && b.versiones.some(function (v) { return v && v.id === state.activeVersionId; });
        });
        if (!borrador) { showAlert('No se pudo identificar el borrador activo.', 'warning'); return; }
        await apiClient.deleteBorrador(borrador.id);
        showAlert('Borrador eliminado correctamente.', 'success');
      } else if (tipo === 'plan') {
        if (!state.activePlanId) return;
        var deletedPlanId = Number(state.activePlanId);
        var neighbor = getPlanSelectionAfterDelete(deletedPlanId);
        await apiClient.deletePlan(deletedPlanId);
        showAlert('Plan eliminado correctamente.', 'success');

        removePlanFromCollection(deletedPlanId);
        if (neighbor && neighbor.id_plan) {
          var neighborIdx = indexByPlanId(neighbor.id_plan);
          if (neighborIdx >= 0) {
            setActivePlanFromIndex(neighborIdx);
            state.referenceISO = String(neighbor.fecha_inicio || '').slice(0, 10) || state.referenceISO;
          }
        }
      }
      try { bootstrap.Modal.getOrCreateInstance(modalEl).hide(); } catch (e) { /* noop */ }
      if (tipo === 'plan') {
        actualizarNavMes();
        await cargarPlanActivo();
      } else {
        await cargarPlanActivo();
      }
    } catch (err) {
      showAlert('Error al borrar: ' + (err.message || err), 'danger');
    }
  }

  // ── Bind events ───────────────────────────────────────────
  function bindEvents() {
    // Navegador de plan
    var btnAnterior = getEl('planifBtnMesAnterior');
    if (btnAnterior) btnAnterior.addEventListener('click', irMesAnterior);
    var btnSiguiente = getEl('planifBtnMesSiguiente');
    if (btnSiguiente) btnSiguiente.addEventListener('click', irMesSiguiente);
    ensureToggleLeftBinding();
    // @ts-ignore
    var vistaInicio = /** @type {HTMLInputElement|null} */ (getEl('planifVistaFechaInicio'));
    // @ts-ignore
    var vistaFin = /** @type {HTMLInputElement|null} */ (getEl('planifVistaFechaFin'));
    if (vistaInicio && vistaFin) {
      var applyVistaFechaChange = async function () {
        syncVistaFechaControls();
        actualizarNavMes();
        actualizarRangoInputs(true);
        await cargarFestivos();
        renderGrid();
      };

      vistaInicio.addEventListener('change', function () {
        applyVistaFechaChange();
      });
      vistaFin.addEventListener('change', function () {
        applyVistaFechaChange();
      });
    }

    var planSel = getEl('planifPlanSel');
    if (planSel) {
      planSel.addEventListener('change', async function () {
        // @ts-ignore
        var idx = Number(this.value);
        if (!Number.isInteger(idx) || idx < 0) return;
        setActivePlanFromIndex(idx);
        actualizarNavMes();
        actualizarRangoInputs();
        await cargarPlanActivo();
      });
    }

    // Cambio de versión
    var verSel = getEl('planifVersionSel');
    if (verSel)
      verSel.addEventListener('change', function () {
        // @ts-ignore
        state.activeVersionId = Number(this.value) || null;
        state.gridFilterAgentes = null;
        if (state.activeVersionId) cargarAsignaciones(state.activeVersionId);
        else renderGrid();
      });

    // Botón nuevo plan — pre-rellena con el inicio del plan activo
    var btnNuevo = getEl('planifBtnNuevo');
    if (btnNuevo)
      btnNuevo.addEventListener('click', function () {
        if (guardReadOnlyAction()) return;
        showAlert('', 'info', 'planifNuevoAlert');
        var dtBase = getActivePlanStartDate();
        // @ts-ignore
        getEl('planifNuevoFechaInicio').value = dtBase
          ? dtBase.toISODate()
          : '';
        // @ts-ignore
        getEl('planifNuevoNumMeses').value = 1;
        actualizarPreviewFecha();
        new bootstrap.Modal(getEl('planifModalNuevo')).show();
      });
    var btnNuevoGuardar = getEl('planifBtnNuevoGuardar');
    if (btnNuevoGuardar)
      btnNuevoGuardar.addEventListener('click', guardarNuevoPlan);

    ['planifNuevoFechaInicio', 'planifNuevoNumMeses'].forEach(function (id) {
      var el = getEl(id);
      if (el) el.addEventListener('change', actualizarPreviewFecha);
    });

    // Botón copiar
    var btnCopiar = getEl('planifBtnCopiar');
    if (btnCopiar) btnCopiar.addEventListener('click', abrirModalCopiar);
    var btnCopiarGuardar = getEl('planifBtnCopiarGuardar');
    if (btnCopiarGuardar)
      btnCopiarGuardar.addEventListener('click', guardarCopia);

    // Botón nueva versión / borrador vacío
    var btnNuevaVersion = getEl('planifBtnNuevaVersion');
    if (btnNuevaVersion)
      btnNuevaVersion.addEventListener('click', abrirModalNuevoBorrador);
    var btnBorradorGuardar = getEl('planifBtnBorradorGuardar');
    if (btnBorradorGuardar)
      btnBorradorGuardar.addEventListener('click', guardarNuevoBorrador);

    // Botón aprobar
    var btnAprobar = getEl('planifBtnAprobar');
    if (btnAprobar) btnAprobar.addEventListener('click', aprobarVersion);
    var btnAprobarConfirm = getEl('planifAprobarConfirmBtn');
    if (btnAprobarConfirm)
      btnAprobarConfirm.addEventListener('click', confirmarAprobacion);
    var btnDescartarConfirm = getEl('planifDescartarConfirmBtn');
    if (btnDescartarConfirm)
      btnDescartarConfirm.addEventListener('click', confirmarDescarteBorrador);

    // Botones borrado ordenado
    var btnBorrarVersion = getEl('planifBtnBorrarVersion');
    if (btnBorrarVersion)
      btnBorrarVersion.addEventListener('click', function () {
        abrirModalBorrar('version');
      });
    var btnDescartarBorrador = getEl('planifBtnDescartarBorrador');
    if (btnDescartarBorrador)
      btnDescartarBorrador.addEventListener('click', abrirModalDescartarBorrador);
    var btnBorrarPlan = getEl('planifBtnBorrarPlan');
    if (btnBorrarPlan)
      btnBorrarPlan.addEventListener('click', function () {
        abrirModalBorrar('plan');
      });

    // Switch del modal de borrado
    var borrarSwitch = getEl('planifBorrarSwitch');
    var borrarConfirmBtn = getEl('planifBorrarConfirmBtn');
    var borrarSwitchLabel = getEl('planifBorrarSwitchLabel');
    if (borrarSwitch && borrarConfirmBtn) {
      borrarSwitch.addEventListener('change', function () {
        // @ts-ignore
        var checked = borrarSwitch.checked;
        // @ts-ignore
        borrarConfirmBtn.disabled = !checked;
        if (borrarSwitchLabel) borrarSwitchLabel.textContent = checked ? 'Sí' : 'No';
      });
    }

    // Botón recargar
    var btnRefresh = getEl('planifBtnRefresh');
    if (btnRefresh)
      btnRefresh.addEventListener('click', function () {
        showAlert('', 'info');
        cargarPlanActivo();
      });

    // Botón exportar agentes a Excel
    var btnExportarExcel = getEl('planifBtnExportarExcel');
    if (btnExportarExcel)
      btnExportarExcel.addEventListener('click', exportAgentesSeleccionadosExcel);

    ['planifFechaInicio', 'planifFechaFin'].forEach(function (id) {
      var elRango = getEl(id);
      if (elRango) {
        elRango.addEventListener('change', function () {
          var inInicio = getEl('planifFechaInicio');
          var inFin = getEl('planifFechaFin');
          if (
            inInicio &&
            inFin &&
            // @ts-ignore
            inInicio.value &&
            // @ts-ignore
            inFin.value &&
            // @ts-ignore
            inInicio.value > inFin.value
          ) {
            // @ts-ignore
            if (id === 'planifFechaInicio') inFin.value = inInicio.value;
            // @ts-ignore
            else inInicio.value = inFin.value;
          }
        });
      }
    });

    // Buscador y checks de actividades
    var buscarAct = getEl('planifActividadBuscar');
    if (buscarAct)
      buscarAct.addEventListener('input', function () {
        // @ts-ignore
        renderActividadFiltroList(buscarAct.value);
      });

    document.addEventListener('change', function (e) {
      // @ts-ignore
      if (e.target && e.target.classList.contains('planif-act-chk')) {
        // @ts-ignore
        var id = String(e.target.dataset.id || '');
        // @ts-ignore
        if (e.target.checked) state.selectedActividadIds.add(id);
        else state.selectedActividadIds.delete(id);
        updateActividadesSelCount();
      }
    });

    // Buscar por actividades
    var btnAplicar = getEl('planifBtnAplicarRango');
    if (btnAplicar)
      btnAplicar.addEventListener('click', filtrarPorActividadesSeleccionadas);

    // Filtrar sin actividad
    var btnFiltrarSin = getEl('planifBtnFiltrarSinActiv');
    if (btnFiltrarSin)
      btnFiltrarSin.addEventListener('click', filtrarSinActividad);
    var btnLimpiarFiltro = getEl('planifBtnLimpiarFiltro');
    if (btnLimpiarFiltro)
      btnLimpiarFiltro.addEventListener('click', limpiarFiltroGrid);

    // Cerrar menú contextual al clicar fuera
    document.addEventListener('click', function (e) {
      // @ts-ignore
      if (!e.target.closest('#planifContextMenu')) closePlanifContextMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closePlanifContextMenu();
      }
    });
  }

  // ── Punto de entrada ──────────────────────────────────────

  app.resetPlanificacionState = function resetPlanificacionState() {
    resetPlanificacionStateData();
  };
  app.initializePlanificacion = async function initializePlanificacion() {
    var perfStart = nowMs();
    var root = getEl('planificacionSection');
    if (!root) return;

    state.perfEnabled = isPerfEnabled();

    if (!state.initialized) {
      state.initialized = true;
      bindEvents();
    }

    // El include puede re-renderizarse entre aperturas de sección; reasegurar binding del toggle.
    ensureToggleLeftBinding();

    applyConsultaReadOnlyUi();

    resetPlanificacionStateData();

    // Inicializar referencia temporal actual para resolver plan inicial
    var ahora = DateTime ? DateTime.now() : null;
    state.activeAnio = ahora ? ahora.year : new Date().getFullYear();
    state.activeMes = ahora ? ahora.month : new Date().getMonth() + 1;
    state.referenceISO = monthRefISO(state.activeAnio, state.activeMes);
    state.viewMonths = 1;
    state.leftPanelCollapsed = false;

    actualizarNavMes();
    applyLeftPanelCollapsed(false);
    actualizarRangoInputs();
    showAlert('', 'info');

    await Promise.all([cargarActividades(), cargarAgentes()]);
    await cargarPlanMes(state.activeAnio, state.activeMes, {});
    logPerf(
      'initializePlanificacion',
      perfStart,
      'anio=' + state.activeAnio + ', mes=' + state.activeMes
    );
  };
})();
