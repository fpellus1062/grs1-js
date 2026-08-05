// @ts-nocheck
(function () {
  let app = window.GRS1Dashboard;
  if (!app) return;

  let AGENTE_EDITABLE_FIELDS = [
    'nombre',
    'apellido_1',
    'apellido_2',
    'email',
    'peloton_id',
    'empleo_id',
    'orden_gc',
    'tip',
    'nif',
    'telefono',
    'aptitudes',
    'situacion_id',
    'comentarios',
    'fecha_ant_empleo',
    'domicilio',
    'codigo_postal',
    'poblacion',
    'provincia',
    'fecha_baja',
  ];

  let state = {
    initialized: false,
    table: null,
    quickFilterEstado: 'todos',
    searchTerm: '',
    agentes: [],
    originalAgentes: [],
    cambiosPendientes: new Map(),
  };

  let utils = window['GRS1Utils'] || {};
  // @ts-ignore
  let TABULATOR_LANGS = window.GRS1TabulatorLangs;
  // @ts-ignore
  let esc = window.GRS1Utils.esc;
  // @ts-ignore
  let sameValue = window.GRS1Utils.sameValue;
  // @ts-ignore
  let cloneRows = window.GRS1Utils.cloneRows;
  let normalizeCssColor =
    typeof utils.normalizeHexColor === 'function'
      ? utils.normalizeHexColor
      : function () {
          return '';
        };

  function isConsultaReadOnly() {
    return (
      window.GRS1Utils &&
      typeof window.GRS1Utils.isConsultaReadOnlyRole === 'function' &&
      window.GRS1Utils.isConsultaReadOnlyRole(app)
    );
  }

  function guardReadOnlyAction() {
    if (!isConsultaReadOnly()) return false;
    showAlert('Perfil consulta: solo lectura', 'warning');
    return true;
  }

  function applyConsultaReadOnlyUi() {
    if (!isConsultaReadOnly()) return;
    if (!window.GRS1Utils || typeof window.GRS1Utils.disableElementsById !== 'function') {
      return;
    }
    window.GRS1Utils.disableElementsById([
      'btnAgregarNuevoAgente',
      'btnSaveAllChangesAgente',
      'btnDiscardChangesAgente',
      'btnSaveAgente',
      'confirmAgenteDeleteBtn',
      'btnSaveComentariosAgente',
    ]);
  }

  function setStatus(message, isError) {
    let el = document.getElementById('estadoCargaAgente');
    if (!el) return;
    if (isError && message) {
      el.textContent = message;
      el.className = 'px-3 pb-1 text-danger small';
    } else {
      el.textContent = '';
      el.className = 'd-none';
    }
  }

  function showAlert(message, type) {
    setAlert(message, type);
    if (!message) return;
    setTimeout(function () {
      setAlert('', 'info');
    }, 5000);
  }

  function setAlert(message, type) {
    let el = document.getElementById('alertContainerAgente');
    if (!el) return;
    if (!message) {
      el.innerHTML = '';
      return;
    }
    let cls = type || 'info';
    el.innerHTML =
      '<div class="alert alert-' +
      esc(cls) +
      ' py-2 px-3 mb-0" role="alert" style="font-size:.82rem">' +
      esc(message) +
      '</div>';
  }

  function updateCounters() {
    let table = state.table;
    if (!table) return;
    let total = (table.getData() || []).length;
    let filtered = (table.getData('active') || []).length;
    let hidden = total - filtered;
    let totalEl = document.getElementById('totalRecordsAgente');
    let filteredEl = document.getElementById('filteredRecordsAgente');
    let hiddenEl = document.getElementById('shownRecordsAgente');
    if (totalEl) totalEl.textContent = String(total);
    if (filteredEl) filteredEl.textContent = String(filtered);
    if (hiddenEl) hiddenEl.textContent = String(hidden);
  }

  function syncPendingInfo(dataLength) {
    let el = document.getElementById('pendingChangesCountAgente');
    if (!el) return;
    el.textContent = String(dataLength || 0);
  }

  function syncSelectedAgentesForDetalle() {
    if (!state.table) {
      if (app.globalState) app.globalState.selectedAgenteIdsForBulk = [];
      if (app.agentesState) app.agentesState.selectedAgenteIdsVista = [];
      updateAgenteAsignacionesDetalleButtonState();
      return;
    }

    let ids = state.table
      .getSelectedData()
      .map(function (row) {
        return Number(row.id);
      })
      .filter(function (id) {
        return Number.isFinite(id) && id > 0;
      });

    let uniqueIds = Array.from(new Set(ids));
    if (app.globalState) app.globalState.selectedAgenteIdsForBulk = uniqueIds;
    if (app.agentesState) app.agentesState.selectedAgenteIdsVista = uniqueIds;
    updateAgenteAsignacionesDetalleButtonState();
  }

  function updateAgenteAsignacionesDetalleButtonState() {
    let btn = document.getElementById('btnAgenteAsignacionesDetalle');
    if (!btn) return;
    let selectedIds =
      app.agentesState && Array.isArray(app.agentesState.selectedAgenteIdsVista)
        ? app.agentesState.selectedAgenteIdsVista.filter(function (id) {
            return Number(id) > 0;
          })
        : [];
    let count = selectedIds.length;
    // @ts-ignore
    btn.disabled = count !== 1;
    if (count === 0) {
      btn.title = 'Selecciona un agente en el listado';
      return;
    }
    if (count > 1) {
      btn.title = 'Selecciona solo un agente para ver su cuadrante';
      return;
    }
    btn.title = 'Ver cuadrante del agente seleccionado';
  }

  function ensureAgenteDetalleModalVisibleHost() {
    let modalEl = document.getElementById('modalAgenteAsignacionesDetalle');
    if (!modalEl) return;
    if (modalEl.parentElement !== document.body) {
      document.body.appendChild(modalEl);
    }
  }

  function getSelectedAgenteRows() {
    if (!state.table) return [];
    let selectedIds =
      app.agentesState && Array.isArray(app.agentesState.selectedAgenteIdsVista)
        ? app.agentesState.selectedAgenteIdsVista
            .map(Number)
            .filter(function (id) {
              return Number.isFinite(id) && id > 0;
            })
        : [];
    if (!selectedIds.length) return [];
    let selectedSet = new Set(selectedIds);
    return (state.table.getData() || []).filter(function (row) {
      return selectedSet.has(Number(row && row.id));
    });
  }

  function resolveAsignacionesPeriodoFromState() {
    let asigState = app.asignacionesState || {};
    let cuadrante = asigState.cuadranteSeleccionado || null;
    let anio = Number(
      asigState.anio || (cuadrante && cuadrante.anio_referencia) || 0
    );
    let mes = Number(
      asigState.mes || (cuadrante && cuadrante.mes_referencia) || 0
    );
    return {
      anio: Number.isInteger(anio) && anio > 0 ? anio : null,
      mes: Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : null,
      cuadrante: cuadrante,
    };
  }

  function getAgenteDetalleMesSeleccionado() {
    let mesEl = document.getElementById('agenteAsigDetalleMes');
    let mes = Number(mesEl && mesEl.value ? mesEl.value : 0);
    return Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : null;
  }

  function getAgenteDetalleAnioActual() {
    let anioEl = document.getElementById('agenteAsigDetalleAnio');
    let anio = Number(anioEl && anioEl.value ? anioEl.value : 0);
    return Number.isInteger(anio) && anio > 0 ? anio : null;
  }

  function getAgenteDetalleSeleccionadoId() {
    let selectedRows = getSelectedAgenteRows();
    if (selectedRows.length !== 1) return 0;
    return Number(selectedRows[0].id || 0) || 0;
  }

  function syncAgenteDetallePeriodoControls(periodo) {
    let anioEl = document.getElementById('agenteAsigDetalleAnio');
    let mesEl = document.getElementById('agenteAsigDetalleMes');
    let anio = Number(periodo && periodo.anio);
    let mes = Number(periodo && periodo.mes);

    if (anioEl && Number.isInteger(anio) && anio > 0) {
      anioEl.value = String(anio);
    }
    if (mesEl && Number.isInteger(mes) && mes >= 1 && mes <= 12) {
      mesEl.value = String(mes);
    }
  }

  function getAgenteMesesLabels() {
    let months =
      window.GRS1Dashboard &&
      window.GRS1Dashboard._asig &&
      Array.isArray(window.GRS1Dashboard._asig.MONTHS)
        ? window.GRS1Dashboard._asig.MONTHS
        : [
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
    return [''].concat(months);
  }

  function buildAgenteDetallePeriodos(items) {
    let porAnio = new Map();
    (items || []).forEach(function (item) {
      if (!item) return;
      if (item.estado === 'archivado') return;
      let anio = Number(item.anio != null ? item.anio : item.anio_referencia);
      let mes = Number(item.mes != null ? item.mes : item.mes_referencia);
      if (!Number.isInteger(anio) || anio <= 0) return;
      if (!Number.isInteger(mes) || mes < 1 || mes > 12) return;
      if (!porAnio.has(anio)) porAnio.set(anio, new Set());
      porAnio.get(anio).add(mes);
    });

    return Array.from(porAnio.entries())
      .map(function (entry) {
        return {
          anio: entry[0],
          meses: Array.from(entry[1]).sort(function (a, b) {
            return a - b;
          }),
        };
      })
      .sort(function (a, b) {
        return b.anio - a.anio;
      });
  }

  function _populateAgenteDetalleMeses(periodos, anio, mesActual) {
    let mesEl = document.getElementById('agenteAsigDetalleMes');
    if (!mesEl) return;

    let periodo =
      (periodos || []).find(function (p) {
        return Number(p && p.anio) === Number(anio);
      }) ||
      (periodos && periodos[0]);

    let meses = periodo && Array.isArray(periodo.meses) ? periodo.meses : [];
    if (!meses.length) {
      mesEl.innerHTML = '<option value="">Sin meses</option>';
      return;
    }

    let labels = getAgenteMesesLabels();
    mesEl.innerHTML = meses
      .map(function (m) {
        return (
          '<option value="' +
          m +
          '">' +
          app.escapeHtml(labels[m] || String(m)) +
          '</option>'
        );
      })
      .join('');

    let selectedMes =
      meses.indexOf(Number(mesActual)) !== -1
        ? Number(mesActual)
        : meses[meses.length - 1];
    mesEl.value = String(selectedMes);
  }

  function populateAgenteDetallePeriodoSelects(items, anioActual, mesActual) {
    let anioEl = document.getElementById('agenteAsigDetalleAnio');
    let mesEl = document.getElementById('agenteAsigDetalleMes');
    if (!anioEl || !mesEl) return;

    let periodos = buildAgenteDetallePeriodos(items);
    if (!periodos.length) {
      anioEl.innerHTML = '<option value="">Sin años</option>';
      mesEl.innerHTML = '<option value="">Sin meses</option>';
      return;
    }

    anioEl.innerHTML = periodos
      .map(function (p) {
        return '<option value="' + p.anio + '">' + p.anio + '</option>';
      })
      .join('');

    let selectedAnio = periodos.some(function (p) {
      return p.anio === Number(anioActual);
    })
      ? Number(anioActual)
      : periodos[0].anio;
    anioEl.value = String(selectedAnio);
    _populateAgenteDetalleMeses(periodos, selectedAnio, mesActual);
  }

  function setAgenteAsignacionesDetalleState(message, subtitle) {
    let subtitleEl = document.getElementById('agenteAsignacionesDetalleSubtitulo');
    let containerEl = document.getElementById('agenteAsignacionesDetalleGridContainer');
    if (subtitleEl && typeof subtitle === 'string') {
      subtitleEl.textContent = subtitle;
    }
    if (containerEl) {
      containerEl.innerHTML =
        '<div class="text-center text-muted py-4">' +
        app.escapeHtml(message || 'Sin datos para mostrar.') +
        '</div>';
    }
  }

  function getAgenteDetalleFuente() {
    let el = document.getElementById('agenteAsigDetalleFuente');
    let value = el ? String(el.value || '').toLowerCase() : 'borrador';
    return value === 'definitivo' ? 'definitivo' : 'borrador';
  }

  function normalizeBorradoresPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.borradores)) return payload.borradores;
    if (payload && payload.data && Array.isArray(payload.data)) return payload.data;
    return [];
  }

  async function cargarPeriodosDisponiblesAgenteDetalle(headers) {
    let periodosDisponibles = [];
    let agenteId = getAgenteDetalleSeleccionadoId();
    let fuente = getAgenteDetalleFuente();

    try {
      let periodosUrl =
        '/api/asignaciones/periodos-disponibles?source=' +
        encodeURIComponent(fuente);
      if (agenteId > 0) {
        periodosUrl += '&agente_id=' + encodeURIComponent(String(agenteId));
      }
      let periodosRes = await fetch(periodosUrl, {
        headers: headers,
        cache: 'no-store',
      });
      if (!periodosRes.ok)
        throw new Error('No se pudieron cargar períodos efectivos.');
      let periodosJson = await periodosRes.json();
      periodosDisponibles = Array.isArray(periodosJson.periodos)
        ? periodosJson.periodos
        : [];
    } catch (_e) {
      try {
        let cuadrantesRes = await fetch('/api/cuadrantes', {
          headers: headers,
          cache: 'no-store',
        });
        let cuadrantesJson = cuadrantesRes.ok
          ? await cuadrantesRes.json()
          : { data: [] };
        periodosDisponibles = Array.isArray(cuadrantesJson.data)
          ? cuadrantesJson.data
          : [];
      } catch (_e2) {
        periodosDisponibles = [];
      }
    }

    app.agentesState._detallePeriodosDisponibles = periodosDisponibles;
    return periodosDisponibles;
  }

  async function resolveCuadranteContextByPeriodo(anio, mes, headers) {
    let listRes = await fetch('/api/cuadrantes', {
      headers: headers,
      cache: 'no-store',
    });
    if (!listRes.ok) {
      throw new Error('No se pudieron cargar los cuadrantes disponibles.');
    }
    let listJson = await listRes.json();
    let cuadrantes = Array.isArray(listJson.data) ? listJson.data : [];
    let matches = cuadrantes.filter(function (item) {
      return (
        item &&
        item.estado !== 'archivado' &&
        Number(item.anio_referencia) === Number(anio) &&
        Number(item.mes_referencia) === Number(mes)
      );
    });
    if (!matches.length) {
      throw new Error(
        'No existe cuadrante para ' +
          String(mes).padStart(2, '0') +
          '/' +
          String(anio) +
          '.'
      );
    }

    let preferred =
      matches.find(function (item) {
        return String(item.estado || '').toLowerCase() === 'activo';
      }) || matches[0];

    let detailRes = await fetch('/api/cuadrantes/' + preferred.id, {
      headers: headers,
      cache: 'no-store',
    });
    if (!detailRes.ok) {
      throw new Error('No se pudo cargar el cuadrante del período seleccionado.');
    }
    let detailJson = await detailRes.json();
    let cuadrante = detailJson && detailJson.data ? detailJson.data : null;
    if (!cuadrante) {
      throw new Error(
        'El cuadrante del período seleccionado no devolvió datos válidos.'
      );
    }
    return {
      anio: Number(cuadrante.anio_referencia) || Number(anio),
      mes: Number(cuadrante.mes_referencia) || Number(mes),
      cuadrante: cuadrante,
    };
  }

  async function ensureCuadranteContextForAgenteDetalle(periodoOverride) {
    let headers =
      typeof app.getHeaders === 'function'
        ? app.getHeaders(false)
        : { Authorization: 'Bearer ' + app.globalState.token };

    let overrideAnio = Number(periodoOverride && periodoOverride.anio);
    let overrideMes = Number(periodoOverride && periodoOverride.mes);
    if (
      Number.isInteger(overrideAnio) &&
      overrideAnio > 0 &&
      Number.isInteger(overrideMes) &&
      overrideMes >= 1 &&
      overrideMes <= 12
    ) {
      let byPeriod = await resolveCuadranteContextByPeriodo(
        overrideAnio,
        overrideMes,
        headers
      );
      if (app.asignacionesState) {
        app.asignacionesState.cuadranteSeleccionado = byPeriod.cuadrante;
        app.asignacionesState.anio = byPeriod.anio;
        app.asignacionesState.mes = byPeriod.mes;
      }
      return byPeriod;
    }

    let periodo = resolveAsignacionesPeriodoFromState();
    if (periodo.cuadrante && periodo.anio && periodo.mes) {
      return periodo;
    }

    let cuadrantesRes = await fetch('/api/cuadrantes', {
      headers: headers,
      cache: 'no-store',
    });
    if (!cuadrantesRes.ok) {
      throw new Error('No se pudieron cargar los cuadrantes disponibles.');
    }

    let cuadrantesJson = await cuadrantesRes.json();
    let cuadrantes = Array.isArray(cuadrantesJson.data) ? cuadrantesJson.data : [];
    let disponibles = cuadrantes.filter(function (item) {
      return item && item.estado !== 'archivado';
    });
    if (!disponibles.length) {
      throw new Error('No hay cuadrantes disponibles para la ARS activa.');
    }

    let preferred =
      disponibles.find(function (item) {
        return String(item.estado || '').toLowerCase() === 'activo';
      }) || disponibles[0];

    let detalleRes = await fetch('/api/cuadrantes/' + preferred.id, {
      headers: headers,
    });
    if (!detalleRes.ok) {
      throw new Error('No se pudo cargar el cuadrante disponible para el agente.');
    }

    let detalleJson = await detalleRes.json();
    let cuadrante = detalleJson && detalleJson.data ? detalleJson.data : null;
    if (!cuadrante) {
      throw new Error('El cuadrante seleccionado no devolvió datos válidos.');
    }

    if (app.asignacionesState) {
      app.asignacionesState.cuadranteSeleccionado = cuadrante;
      app.asignacionesState.anio = Number(cuadrante.anio_referencia) || null;
      app.asignacionesState.mes = Number(cuadrante.mes_referencia) || null;
    }

    return {
      anio: Number(cuadrante.anio_referencia) || null,
      mes: Number(cuadrante.mes_referencia) || null,
      cuadrante: cuadrante,
    };
  }

  function buildPlanningDaysFromCuadrante(cuadrante) {
    let DateTime = window.luxon && window.luxon.DateTime;
    let weekdayShort = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    if (!DateTime || !cuadrante || !Array.isArray(cuadrante.dias)) return [];
    return cuadrante.dias
      .map(function (d) {
        let dt = DateTime.fromISO(String(d.fecha), { zone: 'utc' });
        if (!dt.isValid) return null;
        let weekdayIndex = Math.max(0, Math.min(6, Number(d.dia_semana) - 1));
        return {
          key: dt.toISODate(),
          anio: dt.year,
          mes: dt.month,
          dia: dt.day,
          weekdayIndex: weekdayIndex,
          label: weekdayShort[weekdayIndex],
          esTraspaso: !d.es_del_mes_ref,
          esFestivo: Boolean(d.es_festivo),
        };
      })
      .filter(Boolean);
  }

  function buildServiciosMapForAgenteDetalle(responseData, fuente) {
    let map = new Map();
    let isBorrador = String(fuente || '').toLowerCase() !== 'definitivo';
    let sourceRows = isBorrador
      ? responseData.borradorServicios
      : responseData.definitivoServicios;
    let keyField = isBorrador ? 'asignacion_borrador_id' : 'asignacion_id';
    (sourceRows || []).forEach(function (item) {
      let key = Number(item && item[keyField]);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      let codigo = String(item.actividad_codigo || '').trim();
      let nombre = String(item.actividad_nombre || '').trim();
      map.get(key).push({
        id: Number(item.actividad_id),
        label:
          codigo && nombre
            ? codigo + ' - ' + nombre
            : codigo || nombre || '#' + String(item.actividad_id || ''),
      });
    });
    return map;
  }

  function getTextColorForBackground(hexColor) {
    let normalized = normalizeCssColor(hexColor);
    if (!normalized) return '#0f172a';
    return typeof utils.getTextColorForHexBackground === 'function'
      ? utils.getTextColorForHexBackground(normalized, 168 / 255)
      : '#0f172a';
  }

  async function ensureAsignacionesMetaLoaded() {
    if (
      app.agentesState._asignacionesMetaLoaded &&
      app.agentesState._asignacionesMeta
    ) {
      return app.agentesState._asignacionesMeta;
    }
    if (app.asignacionesState && app.asignacionesState.meta) {
      app.agentesState._asignacionesMeta = app.asignacionesState.meta;
      app.agentesState._asignacionesMetaLoaded = true;
      return app.agentesState._asignacionesMeta;
    }

    let headers =
      typeof app.getHeaders === 'function'
        ? app.getHeaders(false)
        : { Authorization: 'Bearer ' + app.globalState.token };
    let response = await fetch('/api/asignaciones/meta', { headers: headers });
    if (!response.ok)
      throw new Error('No se pudieron cargar los metadatos de asignaciones.');
    app.agentesState._asignacionesMeta = await response.json();
    app.agentesState._asignacionesMetaLoaded = true;
    return app.agentesState._asignacionesMeta;
  }

  function buildActividadStyleMap(meta) {
    let actividades = (meta && meta.actividades) || [];
    let styleMap = new Map();
    actividades.forEach(function (actividad) {
      let id = Number(actividad.id_actividad);
      if (!id) return;
      let grupoColor =
        normalizeCssColor(actividad.grupo_color) ||
        normalizeCssColor(actividad.nivel_grupo_color) ||
        '#475569';
      let textColor = getTextColorForBackground(grupoColor);
      styleMap.set(id, {
        grupoNombre:
          String(
            actividad.grupo_nombre || actividad.nivel_grupo_nombre || 'Servicio'
          ).trim() || 'Servicio',
        background: grupoColor,
        color: textColor,
      });
    });
    return styleMap;
  }

  function formatIsoDateEs(value) {
    let DateTime = window.luxon && window.luxon.DateTime;
    if (!DateTime || !value) return String(value || '');
    let dt = DateTime.fromISO(String(value), { setZone: true });
    if (!dt.isValid) return String(value || '');
    return dt.setLocale('es').toFormat('dd/MM/yyyy');
  }

  function resolveCatalogDescripcion(items, idField, value, fallbackFields, rowData) {
    let found = (items || []).find(function (item) {
      return String(item && item[idField]) === String(value == null ? '' : value);
    });
    if (found && found.descripcion) return String(found.descripcion);

    let fallbacks = Array.isArray(fallbackFields) ? fallbackFields : [];
    for (let i = 0; i < fallbacks.length; i += 1) {
      let field = fallbacks[i];
      let raw = rowData && rowData[field];
      if (raw != null && String(raw).trim()) return String(raw).trim();
    }

    return value != null && String(value).trim() ? String(value).trim() : '';
  }

  function renderAgenteInfoCardHtml(agentInfo) {
    return (
      '<div class="agente-asig-card p-3 mb-3">' +
      '  <div class="agente-asig-card-grid">' +
      '    <div class="agente-asig-card-item"><span class="agente-asig-card-label">TIP</span><span class="agente-asig-card-value">' +
      app.escapeHtml(agentInfo.tip || '-') +
      '</span></div>' +
      '    <div class="agente-asig-card-item"><span class="agente-asig-card-label">Nombre</span><span class="agente-asig-card-value">' +
      app.escapeHtml(agentInfo.nombre || '-') +
      '</span></div>' +
      '    <div class="agente-asig-card-item"><span class="agente-asig-card-label">Pelotón</span><span class="agente-asig-card-value">' +
      app.escapeHtml(agentInfo.peloton || '-') +
      '</span></div>' +
      '    <div class="agente-asig-card-item"><span class="agente-asig-card-label">Empleo</span><span class="agente-asig-card-value">' +
      app.escapeHtml(agentInfo.empleo || '-') +
      '</span></div>' +
      '  </div>' +
      '</div>'
    );
  }

  function renderAgenteAsignacionesCalendarHtml(planningDays, assignmentsByDate, actividadStyleMap) {
    let weekdayHeaders = [
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ];
    if (!planningDays.length) {
      return '<div class="text-center text-muted py-4">No hay días definidos para el cuadrante seleccionado.</div>';
    }

    let cells = [];
    let firstDay = planningDays[0];
    let leadingEmpty = Math.max(0, Number(firstDay.weekdayIndex || 0));
    for (let i = 0; i < leadingEmpty; i += 1) {
      cells.push('<div class="agente-asig-calendar-cell is-empty" aria-hidden="true"></div>');
    }

    planningDays.forEach(function (day) {
      let dayData = assignmentsByDate.get(day.key) || null;
      let classNames = ['agente-asig-calendar-cell'];
      if (day.esTraspaso) classNames.push('is-traspaso');
      if (day.esFestivo) classNames.push('is-festivo');
      if (Number(day.weekdayIndex) >= 5) classNames.push('is-weekend');

      let servicesHtml = '';
      let services =
        dayData && Array.isArray(dayData.servicios) ? dayData.servicios : [];
      if (services.length) {
        servicesHtml = services
          .map(function (service) {
            let style = actividadStyleMap.get(Number(service.id)) || {
              grupoNombre: 'Servicio',
              background: '#475569',
              color: '#ffffff',
            };
            return (
              '<div class="agente-asig-service" style="background:' +
              app.escapeHtml(style.background) +
              ';color:' +
              app.escapeHtml(style.color) +
              ';">' +
              '  <span class="agente-asig-service-group">' +
              app.escapeHtml(style.grupoNombre) +
              '</span>' +
              '  <span class="agente-asig-service-label">' +
              app.escapeHtml(String(service.label || '-')) +
              '</span>' +
              '</div>'
            );
          })
          .join('');
      } else {
        servicesHtml =
          '<div class="agente-asig-calendar-empty">Sin servicio asignado</div>';
      }

      let obsHtml =
        dayData && dayData.observaciones && String(dayData.observaciones).trim()
          ? '<div class="agente-asig-calendar-obs"><i class="bi bi-chat-left-text me-1"></i>' +
            app.escapeHtml(String(dayData.observaciones)) +
            '</div>'
          : '';

      cells.push(
        '<div class="' +
          classNames.join(' ') +
          '">' +
          '  <div class="agente-asig-calendar-day">' +
          '    <span class="agente-asig-calendar-daynum">' +
          app.escapeHtml(String(day.dia)) +
          '</span>' +
          '    <span class="agente-asig-calendar-daymeta">' +
          app.escapeHtml(day.label || '') +
          (day.esTraspaso ? '<br>Traspaso' : '') +
          (day.esFestivo ? '<br>Festivo' : '') +
          '    </span>' +
          '  </div>' +
          '  <div class="agente-asig-calendar-services">' +
          servicesHtml +
          '</div>' +
          obsHtml +
          '</div>'
      );
    });

    return (
      '<div class="agente-asig-calendar mb-2">' +
      weekdayHeaders
        .map(function (label) {
          return (
            '<div class="agente-asig-calendar-head">' +
            app.escapeHtml(label) +
            '</div>'
          );
        })
        .join('') +
      cells.join('') +
      '</div>'
    );
  }

  function buildAgenteDetalleCuadranteUrl(periodo, borradorId, fuente) {
    let base = '/api/asignaciones/cuadrante/' + periodo.anio + '/' + periodo.mes;
    let fechaInicio =
      periodo && periodo.cuadrante && periodo.cuadrante.fecha_inicio
        ? String(periodo.cuadrante.fecha_inicio).slice(0, 10)
        : '';
    let fechaFin =
      periodo && periodo.cuadrante && periodo.cuadrante.fecha_fin
        ? String(periodo.cuadrante.fecha_fin).slice(0, 10)
        : '';

    if (!borradorId) {
      if (String(fuente || '').toLowerCase() === 'definitivo') {
        let url = base + '?source=definitivo';
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio)) {
          url += '&fecha_inicio=' + encodeURIComponent(fechaInicio);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaFin)) {
          url += '&fecha_fin=' + encodeURIComponent(fechaFin);
        }
        return url;
      }
      return base;
    }
    return base + '?borrador_id=' + encodeURIComponent(String(borradorId));
  }

  function populateAgenteDetalleBorradoresSelect(borradores, selectedId) {
    let wrap = document.getElementById('agenteAsigDetalleBorradorWrap');
    let sel = document.getElementById('agenteAsigDetalleBorrador');
    if (!wrap || !sel) return;

    let fuente = getAgenteDetalleFuente();
    wrap.style.display = fuente === 'borrador' ? '' : 'none';
    if (fuente !== 'borrador') return;

    let items = Array.isArray(borradores) ? borradores : [];
    if (!items.length) {
      sel.innerHTML = '<option value="">Sin borradores disponibles</option>';
      sel.value = '';
      return;
    }

    sel.innerHTML = items
      .map(function (b) {
        return (
          '<option value="' +
          app.escapeHtml(String(b.id)) +
          '">' +
          app.escapeHtml(
            (b.nombre || 'Borrador') +
              ' v' +
              (b.version || 1) +
              ' · ' +
              (b.estado || 'borrador')
          ) +
          '</option>'
        );
      })
      .join('');

    let exists = items.some(function (item) {
      return Number(item.id) === Number(selectedId);
    });
    sel.value = exists ? String(selectedId) : String(items[0].id);
  }

  async function fetchAgenteAsignacionesDetalleContext(options) {
    let opts = options || {};
    let selectedRows = getSelectedAgenteRows();
    if (selectedRows.length !== 1) {
      throw new Error('Debe seleccionar exactamente un agente en el listado.');
    }

    let periodo = await ensureCuadranteContextForAgenteDetalle({
      anio: opts.anio,
      mes: opts.mes,
    });
    if (!periodo.cuadrante || !periodo.anio || !periodo.mes) {
      throw new Error('No se pudo resolver un cuadrante válido para el agente.');
    }

    let headers =
      typeof app.getHeaders === 'function'
        ? app.getHeaders(false)
        : { Authorization: 'Bearer ' + app.globalState.token };
    let fuente = opts.fuente || getAgenteDetalleFuente();
    let borradores = normalizeBorradoresPayload(app.asignacionesState.borradores).slice();

    if (!borradores.length) {
      let borradoresRes = await fetch(
        '/api/asignaciones/borradores/' +
          periodo.anio +
          '/' +
          periodo.mes +
          '?_ts=' +
          encodeURIComponent(String(Date.now())),
        { headers: headers, cache: 'no-store' }
      );
      if (borradoresRes.ok) {
        let borradoresJson = await borradoresRes.json();
        borradores = normalizeBorradoresPayload(borradoresJson);
        app.asignacionesState.borradores = borradores.slice();
      }
    }

    let borradorId = null;
    if (fuente === 'borrador') {
      borradorId = Number(opts.borradorId || app.asignacionesState.borradorId || 0);
      if (
        !borradorId ||
        !borradores.some(function (item) {
          return Number(item.id) === borradorId;
        })
      ) {
        let preferido = borradores[0];
        borradorId = Number(preferido && preferido.id);
      }
      if (!borradorId) {
        throw new Error('No hay borrador disponible para el cuadrante activo.');
      }
    }

    let cuadranteRes = await fetch(
      buildAgenteDetalleCuadranteUrl(periodo, borradorId, fuente),
      { headers: headers, cache: 'no-store' }
    );
    if (!cuadranteRes.ok) {
      throw new Error('No se pudo cargar el cuadrante del agente.');
    }
    let cuadranteData = await cuadranteRes.json();
    let asignacionesMeta = await ensureAsignacionesMetaLoaded();

    return {
      agente: selectedRows[0],
      periodo: periodo,
      fuente: fuente,
      borradores: borradores,
      borradorId: borradorId,
      cuadranteData: cuadranteData,
      asignacionesMeta: asignacionesMeta,
    };
  }

  async function renderAgenteAsignacionesDetalle(options) {
    setAgenteAsignacionesDetalleState('Cargando cuadrante del agente...');
    let context = await fetchAgenteAsignacionesDetalleContext(options);
    populateAgenteDetalleBorradoresSelect(context.borradores, context.borradorId);

    let agente = context.agente;
    let periodo = context.periodo;
    let planningDays = buildPlanningDaysFromCuadrante(periodo.cuadrante);
    let actividadStyleMap = buildActividadStyleMap(context.asignacionesMeta);
    let isBorradorFuente =
      String(context.fuente || '').toLowerCase() !== 'definitivo';
    let serviciosMap = buildServiciosMapForAgenteDetalle(
      context.cuadranteData,
      context.fuente
    );
    let sourceRows = isBorradorFuente
      ? context.cuadranteData.borrador || []
      : context.cuadranteData.definitivo || [];
    let agenteId = Number(agente.id);
    let empleoNombre = resolveCatalogDescripcion(
      app.agentesState.empleos || [],
      'id_empleo',
      agente.empleo_id,
      ['empleo_nombre', 'empleo', '__escala'],
      agente
    );
    let pelotonNombre = resolveCatalogDescripcion(
      app.agentesState.pelotones || [],
      'id_peloton',
      agente.peloton_id,
      ['peloton_codigo', 'peloton_nombre', 'peloton'],
      agente
    );
    let assignmentsByDate = new Map();

    sourceRows.forEach(function (item) {
      if (Number(item.agente_id) !== agenteId) return;
      let fecha = item.fecha
        ? String(item.fecha).slice(0, 10)
        : String(item.anio) +
          '-' +
          String(item.mes).padStart(2, '0') +
          '-' +
          String(item.dia).padStart(2, '0');
      assignmentsByDate.set(fecha, {
        asignacionId: Number(item.id),
        servicios: serviciosMap.get(Number(item.id)) || [],
        observaciones: item.observaciones || null,
      });
    });

    let subtitleEl = document.getElementById('agenteAsignacionesDetalleSubtitulo');
    let containerEl = document.getElementById('agenteAsignacionesDetalleGridContainer');
    if (!subtitleEl || !containerEl) {
      throw new Error('No se pudo preparar la modal de cuadrante del agente.');
    }

    syncAgenteDetallePeriodoControls(periodo);

    let meses = getAgenteMesesLabels();
    let ventanaInicio = formatIsoDateEs(
      periodo.cuadrante && periodo.cuadrante.fecha_inicio
    );
    let ventanaFin = formatIsoDateEs(
      periodo.cuadrante && periodo.cuadrante.fecha_fin
    );
    let agenteNombre = [agente.nombre, agente.apellido_1, agente.apellido_2]
      .filter(Boolean)
      .join(' ');

    subtitleEl.textContent =
      (agente.tip ? agente.tip + ' · ' : '') +
      agenteNombre +
      ' · Cuadrante: ' +
      String(meses[Number(periodo.mes)] || periodo.mes) +
      ' ' +
      String(periodo.anio) +
      ' · Ventana: ' +
      ventanaInicio +
      ' - ' +
      ventanaFin;

    if (!planningDays.length) {
      containerEl.innerHTML =
        '<div class="text-center text-muted py-4">No hay días de planificación para este período.</div>';
      return context;
    }

    if (!assignmentsByDate.size) {
      containerEl.innerHTML =
        '<div class="text-center text-muted py-4">No hay asignaciones para este agente en el período y fuente seleccionados.</div>';
      return context;
    }

    containerEl.innerHTML =
      renderAgenteInfoCardHtml({
        tip: agente.tip || '',
        nombre: agenteNombre,
        peloton: pelotonNombre,
        empleo: empleoNombre,
      }) +
      renderAgenteAsignacionesCalendarHtml(
        planningDays,
        assignmentsByDate,
        actividadStyleMap
      );

    return context;
  }

  app.openAgenteAsignacionesDetalle = async function openAgenteAsignacionesDetalle() {
    try {
      let modalEl = document.getElementById('modalAgenteAsignacionesDetalle');
      let fuenteEl = document.getElementById('agenteAsigDetalleFuente');
      let borradorEl = document.getElementById('agenteAsigDetalleBorrador');
      let mesEl = document.getElementById('agenteAsigDetalleMes');
      let anioEl = document.getElementById('agenteAsigDetalleAnio');
      if (!modalEl) throw new Error('Modal de cuadrante no disponible.');

      let headers =
        typeof app.getHeaders === 'function'
          ? app.getHeaders(false)
          : { Authorization: 'Bearer ' + app.globalState.token };

      await cargarPeriodosDisponiblesAgenteDetalle(headers);

      let estadoAnio = getAgenteDetalleAnioActual();
      let estadoMes = getAgenteDetalleMesSeleccionado();
      if (!estadoAnio || !estadoMes) {
        let estadoPeriodo = resolveAsignacionesPeriodoFromState();
        estadoAnio = estadoAnio || estadoPeriodo.anio;
        estadoMes = estadoMes || estadoPeriodo.mes;
      }
      populateAgenteDetallePeriodoSelects(
        app.agentesState._detallePeriodosDisponibles || [],
        estadoAnio,
        estadoMes
      );

      if (anioEl && !anioEl.dataset.bound) {
        anioEl.dataset.bound = '1';
        anioEl.addEventListener('change', function () {
          let periodos = buildAgenteDetallePeriodos(
            app.agentesState._detallePeriodosDisponibles || []
          );
          _populateAgenteDetalleMeses(periodos, Number(anioEl.value), null);
          renderAgenteAsignacionesDetalle({
            fuente: getAgenteDetalleFuente(),
            anio: getAgenteDetalleAnioActual(),
            mes: getAgenteDetalleMesSeleccionado(),
          }).catch(function (error) {
            setAgenteAsignacionesDetalleState(
              error.message || 'No hay datos para el período seleccionado.'
            );
            showAlert(
              error.message || 'No se pudo recargar el cuadrante del agente.',
              'warning'
            );
          });
        });
      }

      if (fuenteEl && !fuenteEl.dataset.bound) {
        fuenteEl.dataset.bound = '1';
        fuenteEl.addEventListener('change', function () {
          renderAgenteAsignacionesDetalle({
            fuente: getAgenteDetalleFuente(),
            anio: getAgenteDetalleAnioActual(),
            mes: getAgenteDetalleMesSeleccionado(),
          }).catch(function (error) {
            setAgenteAsignacionesDetalleState(
              error.message || 'No hay datos para el período seleccionado.'
            );
            showAlert(
              error.message || 'No se pudo recargar el cuadrante del agente.',
              'warning'
            );
          });
        });
      }

      if (borradorEl && !borradorEl.dataset.bound) {
        borradorEl.dataset.bound = '1';
        borradorEl.addEventListener('change', function () {
          renderAgenteAsignacionesDetalle({
            fuente: 'borrador',
            borradorId: Number(borradorEl.value || 0),
            anio: getAgenteDetalleAnioActual(),
            mes: getAgenteDetalleMesSeleccionado(),
          }).catch(function (error) {
            setAgenteAsignacionesDetalleState(
              error.message || 'No hay datos para el período seleccionado.'
            );
            showAlert(
              error.message || 'No se pudo recargar el cuadrante del agente.',
              'warning'
            );
          });
        });
      }

      if (mesEl && !mesEl.dataset.bound) {
        mesEl.dataset.bound = '1';
        mesEl.addEventListener('change', function () {
          renderAgenteAsignacionesDetalle({
            fuente: getAgenteDetalleFuente(),
            anio: getAgenteDetalleAnioActual(),
            mes: getAgenteDetalleMesSeleccionado(),
          }).catch(function (error) {
            setAgenteAsignacionesDetalleState(
              error.message || 'No hay datos para el período seleccionado.'
            );
            showAlert(
              error.message || 'No se pudo recargar el cuadrante del agente.',
              'warning'
            );
          });
        });
      }

      await renderAgenteAsignacionesDetalle({
        fuente: getAgenteDetalleFuente(),
        anio: getAgenteDetalleAnioActual(),
        mes: getAgenteDetalleMesSeleccionado(),
      });

      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (error) {
      setAgenteAsignacionesDetalleState(
        error.message || 'No hay datos para el período seleccionado.'
      );
      showAlert(
        error.message || 'No se pudo abrir el cuadrante del agente.',
        'warning'
      );
    }
  };

  function applyEstadoFilter() {
    let table = state.table;
    if (!table) return;

    let search = String(state.searchTerm || '')
      .trim()
      .toLowerCase();
    let quick = String(state.quickFilterEstado || 'todos');
    let hasQuickFilter = quick === 'activos' || quick === 'baja';
    let hasSearch = !!search;

    if (!hasQuickFilter && !hasSearch) {
      // Limpiar solo filtros programáticos; los header filters se mantienen.
      table.clearFilter();
      updateCounters();
      return;
    }

    table.setFilter(function (rowData) {
      let row = rowData || {};
      let hasFechaBaja = !!String(row.fecha_baja || '').trim();

      if (quick === 'activos' && hasFechaBaja) return false;
      if (quick === 'baja' && !hasFechaBaja) return false;

      if (hasSearch) {
        let haystack = [
          row.tip,
          row.nombre,
          row.apellido_1,
          row.apellido_2,
          row.email,
          row.nif,
          row.telefono,
          row.peloton_id,
          row.escalafon,
          row.empleo_id,
          row.orden_gc,
          row.aptitudes,
          row.comentarios,
          row.poblacion,
          row.provincia,
        ]
          .filter(function (value) {
            return value != null && String(value).trim() !== '';
          })
          .join(' ')
          .toLowerCase();
        return haystack.indexOf(search) !== -1;
      }

      return true;
    });
    updateCounters();
  }

  function updateQuickFilterActiveItem() {
    let selector = '#agentesQuickFilterEstado .dropdown-item';
    let activeEstado = state.quickFilterEstado || 'todos';
    document.querySelectorAll(selector).forEach(function (item) {
      item.classList.toggle(
        'active',
        item.getAttribute('data-estado') === activeEstado
      );
    });
  }

  function resetFilters() {
    if (!state.table) return;
    state.quickFilterEstado = 'todos';
    state.searchTerm = '';
    let label = document.getElementById('agentesEstadoLabel');
    if (label) label.textContent = 'Todos';
    let search = document.getElementById('agentesGlobalSearch');
    // @ts-ignore
    if (search) search.value = '';
    updateQuickFilterActiveItem();
    state.table.clearHeaderFilter();
    applyEstadoFilter();
    setStatus('Filtros limpiados');
  }

  function exportExcel() {
    if (!state.table) return;
    if (typeof XLSX === 'undefined' || !XLSX.utils) {
      showAlert('No está disponible XLSX para exportar Excel', 'warning');
      return;
    }

    let selectedRows = state.table.getSelectedData();
    if (!Array.isArray(selectedRows) || !selectedRows.length) {
      showAlert('Marca al menos un agente para exportar a Excel.', 'warning');
      return;
    }

    let cols = state.table.getColumns().filter(function (c) {
      let def = c.getDefinition();
      return !!def.title && !!def.field;
    });
    let exportColumns = cols
      .map(function (c) {
        let def = c.getDefinition();
        return {
          title: String(def.title || ''),
          field: String(def.field || ''),
          excelValue: null,
          accessorDownload:
            typeof def.accessorDownload === 'function'
              ? def.accessorDownload
              : null,
        };
      })
      .filter(function (col) {
        return col.field !== 'pei' && col.field !== 'paef';
      });

    exportColumns = exportColumns.reduce(function (acc, col) {
      if (col.field !== 'provincia') {
        acc.push(col);
        return acc;
      }

      acc.push({
        title: 'Provincia',
        field: 'provincia',
        excelValue: function (row) {
          return String(row.provincia || '').trim();
        },
        accessorDownload: null,
      });

      acc.push({
        title: 'Descripcion_provincia',
        field: 'provincia',
        excelValue: function (row) {
          let code = String(row.provincia || '').trim();
          if (!code) return '';
          let found = (app.agentesState.provincias || []).find(function (p) {
            return String(p.value || '') === code;
          });
          let label = String((found && found.label) || '').trim();
          if (!label) return '';
          let sep = ' - ';
          if (label.indexOf(sep) === -1) return label === code ? '' : label;
          return label.split(sep).slice(1).join(sep).trim();
        },
        accessorDownload: null,
      });

      return acc;
    }, []);

    if (
      !exportColumns.some(function (col) {
        return col.field === 'ars_unidad_id';
      })
    ) {
      exportColumns.push({
        title: 'Agrupación ID',
        field: 'ars_unidad_id',
        accessorDownload: null,
      });
    }

    let header = exportColumns.map(function (col) {
      return col.title;
    });
    let rows = selectedRows.map(function (row) {
      return exportColumns.map(function (col) {
        let value = row[col.field];
        if (col.field === 'fecha_baja') {
          return formatTimestampWithoutZone(value);
        }
        if (col.field === 'requisitos_pct') {
          return buildRequisitosResumenTexto(row);
        }
        if (typeof col.excelValue === 'function') {
          return col.excelValue(row);
        }
        if (col.accessorDownload) {
          try {
            return col.accessorDownload(value, row);
          } catch (_error) {
            return value == null ? '' : String(value);
          }
        }
        return value == null ? '' : String(value);
      });
    });

    let ws = XLSX.utils.aoa_to_sheet([header].concat(rows));
    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Agentes');

    let ts = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');
    XLSX.writeFile(wb, 'agentes_' + ts + '.xlsx');
  }

  function exportPdfVisible() {
    if (!state.table) return;
    if (
      // @ts-ignore
      !window.jspdf ||
      // @ts-ignore
      !window.jspdf.jsPDF ||
      // @ts-ignore
      typeof window.jspdf.jsPDF !== 'function'
    ) {
      showAlert('No esta disponible jsPDF para exportar PDF', 'warning');
      return;
    }

    let cols = state.table.getColumns().filter(function (c) {
      let def = c.getDefinition();
      return !!def.title && !!def.field;
    });
    let exportColumns = cols.map(function (c) {
      let def = c.getDefinition();
      return {
        title: String(def.title || ''),
        field: String(def.field || ''),
      };
    }).filter(function (col) {
      return col.field !== 'pei' && col.field !== 'paef';
    });
    if (
      !exportColumns.some(function (col) {
        return col.field === 'ars_unidad_id';
      })
    ) {
      exportColumns.push({
        title: 'Agrupación ID',
        field: 'ars_unidad_id',
      });
    }
    let head = [
      exportColumns.map(function (col) {
        return col.title;
      }),
    ];
    let body = state.table.getData('active').map(function (row) {
      return exportColumns.map(function (col) {
        let field = col.field;
        let val = row[field];
        if (field === 'fecha_baja') {
          return formatTimestampWithoutZone(val);
        }
        return val == null ? '' : String(val);
      });
    });

    // @ts-ignore
    let jsPDF = window.jspdf.jsPDF;
    let doc = new jsPDF({ orientation: 'landscape' });
    doc.autoTable({
      head: head,
      body: body,
      startY: 18,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [52, 58, 64], fontSize: 7 },
      margin: { top: 18, bottom: 14 },
      didDrawPage: function () {
        let pw = doc.internal.pageSize.getWidth();
        let ph = doc.internal.pageSize.getHeight();
        let p = doc.internal.getCurrentPageInfo().pageNumber;
        let t = doc.internal.getNumberOfPages();
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.text('Listado de Agentes', 14, 12);
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text('Pagina ' + p + ' de ' + t, pw - 14, ph - 5, {
          align: 'right',
        });
      },
    });
    let ts = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');
    doc.save('agentes_' + ts + '.pdf');
  }


  function hydrateAgente(row) {
    let next = Object.assign({}, row || {});
    return next;
  }

  function hydrateAgentes(rows) {
    return (rows || []).map(hydrateAgente);
  }

  function trackPendingField(id, field, newValue) {
    let original = state.originalAgentes.find(function (a) {
      return Number(a.id) === Number(id);
    });
    if (!original) {
      updatePendingChangesUi();
      return;
    }

    let currentPending = state.cambiosPendientes.get(Number(id));
    let originalValue = original[field];

    if (!currentPending && sameValue(originalValue, newValue)) {
      updatePendingChangesUi();
      return;
    }

    if (!currentPending) {
      state.cambiosPendientes.set(Number(id), Object.assign({}, original));
    }

    let pendingData = state.cambiosPendientes.get(Number(id));
    pendingData[field] = newValue;

    let hasDifferences = Object.keys(original).some(function (key) {
      return !sameValue(original[key], pendingData[key]);
    });

    if (!hasDifferences) {
      state.cambiosPendientes.delete(Number(id));
    }

    let agente = state.agentes.find(function (a) {
      return Number(a.id) === Number(id);
    });
    if (agente) {
      agente[field] = newValue;
    }

    updatePendingChangesUi();
  }

  function buildChangesPayload(id, changes) {
    let original = state.originalAgentes.find(function (a) {
      return Number(a.id) === Number(id);
    });
    if (!original) return {};

    function normalizePayloadValue(field, value) {
      if (field === 'fecha_baja') {
        if (value === '' || value == null) return null;
        let raw = String(value).trim();
        let DateTime = window.luxon && window.luxon.DateTime;
        if (!DateTime) return raw;
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          let dtDateOnly = DateTime.fromISO(raw);
          if (dtDateOnly.isValid) {
            return dtDateOnly.toFormat('yyyy-LL-dd HH:mm:ss');
          }
        }
        let dtSql = DateTime.fromSQL(raw);
        if (dtSql.isValid) {
          return dtSql.toFormat('yyyy-LL-dd HH:mm:ss');
        }
        let dtIso = DateTime.fromISO(raw);
        if (dtIso.isValid) {
          return dtIso.toFormat('yyyy-LL-dd HH:mm:ss');
        }
        return raw;
      }
      return value;
    }

    return AGENTE_EDITABLE_FIELDS.reduce(function (payload, field) {
      if (
        Object.prototype.hasOwnProperty.call(changes, field) &&
        !sameValue(original[field], changes[field])
      ) {
        payload[field] = normalizePayloadValue(field, changes[field]);
      }
      return payload;
    }, {});
  }

  function updatePendingChangesUi() {
    let count = state.cambiosPendientes.size;
    let sectionEl = document.getElementById('saveChangesSectionAgente');
    let saveBtn = document.getElementById('btnSaveAllChangesAgente');
    let discardBtn = document.getElementById('btnDiscardChangesAgente');
    syncPendingInfo(count);
    if (sectionEl) {
      sectionEl.classList.toggle('pending-changes-active', count > 0);
      sectionEl.classList.toggle('pending-changes-idle', count === 0);
    }
    // @ts-ignore
    if (saveBtn) saveBtn.disabled = isConsultaReadOnly() ? true : count === 0;
    // @ts-ignore
    if (discardBtn) discardBtn.disabled = isConsultaReadOnly() ? true : count === 0;
    applyConsultaReadOnlyUi();
  }

  async function saveAllChanges() {
    if (guardReadOnlyAction()) return;
    if (state.cambiosPendientes.size === 0) {
      showAlert('No hay cambios pendientes', 'info');
      return;
    }

    let token = app.globalState && app.globalState.token;
    let headers = {
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = 'Bearer ' + token;

    let requests = [];
    state.cambiosPendientes.forEach(function (changes, id) {
      let payload = buildChangesPayload(id, changes);
      if (Object.keys(payload).length === 0) return;
      requests.push(
        fetch('/api/agentes/' + encodeURIComponent(id), {
          method: 'PUT',
          headers: headers,
          body: JSON.stringify(payload),
        })
      );
    });

    try {
      let responses = await Promise.all(requests);
      let failed = responses.filter(function (r) {
        return !r.ok;
      }).length;

      if (failed === 0) {
        showAlert('Todos los cambios guardados correctamente', 'success');
        await loadAgentesFromApi();
        return;
      }

      showAlert(
        String(failed) + ' cambios fallaron. Revisa los datos.',
        'warning'
      );
    } catch (error) {
      showAlert(
        error && error.message ? error.message : 'Error al guardar cambios',
        'danger'
      );
    }
  }

  function discardPendingChanges() {
    if (guardReadOnlyAction()) return;
    state.cambiosPendientes.clear();
    state.agentes = hydrateAgentes(cloneRows(state.originalAgentes));
    if (state.table) {
      state.table.setData(state.agentes);
    }
    updatePendingChangesUi();
    showAlert('Cambios descartados', 'info');
  }

  function dateFormatter(cell) {
    let val = cell.getValue();
    if (!val) return '';
    let dt = window.luxon && window.luxon.DateTime.fromISO(String(val));
    return dt && dt.isValid
      ? dt.setLocale('es').toFormat('dd/MM/yyyy')
      : esc(val);
  }

  function getRequisitoPctBadgeColors(pct) {
    return window.GRS1Utils.getRequisitoPctBadgeColors(pct);
  }

  function getRequisitosDetalleVisible(rowData) {
    return window.GRS1Utils.getRequisitosDetalleVisible(rowData);
  }

  function buildRequisitosTooltip(rowData) {
    return window.GRS1Utils.buildRequisitosTooltip(rowData);
  }

  function buildRequisitosResumenTexto(rowData) {
    return window.GRS1Utils.buildRequisitosResumenTexto(rowData);
  }

  async function loadRequisitosResumenByAgente() {
    let res = await fetch('/api/agentes/requisitos', {
      headers: getAgentesAuthHeaders(false),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error('No se pudo cargar resumen de requisitos de agentes');
    }

    let json = await res.json().catch(function () {
      return null;
    });
    let rows = Array.isArray(json && json.requisitos) ? json.requisitos : [];
    let map = {};

    rows.forEach(function (row) {
      let agenteId = Number(row && row.agente_id);
      if (!Number.isFinite(agenteId) || agenteId <= 0) return;

      if (!map[agenteId]) {
        map[agenteId] = {
          completado_total: 0,
          objetivo_total: 0,
          detalle: [],
        };
      }

      let objetivo = Number(row && row.objetivo_total ? row.objetivo_total : 0);
      let completado = Number(
        row && row.completado_total ? row.completado_total : 0
      );
      let pct = null;
      if (row && row.progress_pct != null) {
        let rawPct = String(row.progress_pct).replace('%', '').trim();
        let parsedPct = Number(rawPct);
        if (Number.isFinite(parsedPct)) pct = parsedPct;
      }
      if (pct == null && objetivo > 0) {
        pct = Math.min(100, Math.round((completado * 100) / objetivo));
      }

      let tipo = String(
        (row && (row.tipo_requisito || row.plantilla_nombre)) || 'Requisito'
      ).trim();

      map[agenteId].completado_total += completado;
      map[agenteId].objetivo_total += objetivo;
      map[agenteId].detalle.push({
        tipo: tipo,
        plantilla_nombre: row && row.plantilla_nombre ? String(row.plantilla_nombre) : '',
        completado_total: completado,
        objetivo_total: objetivo,
        pct: pct,
        estado: row && row.estado ? String(row.estado) : '',
      });
    });

    Object.keys(map).forEach(function (key) {
      let item = map[key];
      let objetivo = Number(item.objetivo_total || 0);
      let completado = Number(item.completado_total || 0);
      item.pct =
        objetivo > 0 ? Math.min(100, Math.round((completado * 100) / objetivo)) : null;
    });

    return map;
  }

  function parseTimestampWithoutZone(value) {
    let DateTime = window.luxon && window.luxon.DateTime;
    if (!DateTime || value == null) return null;
    let raw = String(value).trim();
    if (!raw) return null;
    let dtSql = DateTime.fromSQL(raw);
    if (dtSql.isValid) return dtSql;
    let dtIso = DateTime.fromISO(raw);
    if (dtIso.isValid) return dtIso;
    return null;
  }

  function formatTimestampWithoutZone(value) {
    let dt = parseTimestampWithoutZone(value);
    if (dt && dt.isValid) {
      return dt.setLocale('es').toFormat('dd/MM/yyyy HH:mm:ss');
    }
    return value == null ? '' : String(value);
  }

  function fechaBajaFormatter(cell) {
    let val = cell.getValue();
    if (!val) {
      return window.GRS1Utils.renderSemanticBadgeHtml('Activa', 'success', {
        escapeHtmlFn: app.escapeHtml,
      });
    }
    return window.GRS1Utils.renderSemanticBadgeHtml(
      formatTimestampWithoutZone(val),
      'danger',
      {
        escapeHtmlFn: app.escapeHtml,
      }
    );
  }

  // ── Helpers de avatar (igual que Lista Agentes) ──────────────────────────
  function ttGetInitials(row) {
    let nombre = String((row && row.nombre) || '').trim();
    let apellido1 = String((row && row.apellido_1) || '').trim();
    let first = nombre ? nombre.charAt(0) : '';
    let second = apellido1 ? apellido1.charAt(0) : '';
    return (first + second || '?').toUpperCase();
  }

  function ttAvatarBg(row) {
    let seed =
      (row && row.id ? String(row.id) : '') +
      '|' +
      ((row && row.nombre) || '') +
      '|' +
      ((row && row.apellido_1) || '');
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    let hue = Math.abs(hash) % 360;
    return 'hsl(' + hue + ' 55% 45%)';
  }

  function ttAvatarUrlByTip(tip) {
    if (!tip) return '';
    let v = app._agentesAvatarVersion || 1;
    return (
      '/avatars/' +
      encodeURIComponent(tip) +
      '.webp?v=' +
      encodeURIComponent(String(v))
    );
  }

  function bindAvatarFallbackHandler() {
    if (app._agentesAvatarFallbackBound) return;

    document.addEventListener(
      'error',
      function (event) {
        let img = event.target;
        if (!(img instanceof HTMLImageElement)) return;
        if (!img.classList.contains('grs-avatar__img')) return;

        let fallback = img.nextElementSibling;
        if (fallback && fallback.classList.contains('grs-avatar__fallback')) {
          img.style.display = 'none';
          fallback.style.display = 'inline-flex';
        }
      },
      true
    );

    app._agentesAvatarFallbackBound = true;
  }

  function ttAvatarFormatter(cell) {
    let row = cell.getRow().getData();
    let initials = ttGetInitials(row);
    let bg = ttAvatarBg(row);
    let tip = row.tip || '';
    let url = tip ? ttAvatarUrlByTip(tip) : '';
    if (!url) {
      return (
        '<div class="grs-avatar" style="--avatar-bg:' +
        bg +
        ';">' +
        '<span class="grs-avatar__fallback">' +
        esc(initials) +
        '</span>' +
        '</div>'
      );
    }
    return (
      '<div class="grs-avatar" style="--avatar-bg:' +
      bg +
      ';">' +
      '<img class="grs-avatar__img" src="' +
      url +
      '" alt="' +
      esc(initials) +
      '" loading="lazy">' +
      '<span class="grs-avatar__fallback" style="display:none;">' +
      esc(initials) +
      '</span>' +
      '</div>'
    );
  }

  function buildColumns() {
    let pelotones = (app.agentesState && app.agentesState.pelotones) || [];
    let empleos = (app.agentesState && app.agentesState.empleos) || [];
    let situaciones = (app.agentesState && app.agentesState.situaciones) || [];

    function pelotonLabel(id) {
      let p = pelotones.find(function (x) {
        return String(x.id_peloton) === String(id);
      });
      return p ? p.descripcion : id || '';
    }

    function empleoLabel(id) {
      let e = empleos.find(function (x) {
        return String(x.id_empleo) === String(id);
      });
      return e ? e.descripcion : id || '';
    }

    function situacionLabel(id) {
      let s = situaciones.find(function (x) {
        return String(x.id_situacion) === String(id);
      });
      return s ? s.descripcion : id || '';
    }

    return [
      {
        formatter: 'rowSelection',
        titleFormatter: 'rowSelection',
        headerSort: false,
        width: 40,
        frozen: true,
        hozAlign: 'center',
        headerHozAlign: 'center',
        editable: false,
        // @ts-ignore
        cellClick: function (e, cell) {
          cell.getRow().toggleSelect();
        },
      },
      {
        title: '',
        field: '__avatar',
        width: 52,
        frozen: true,
        headerSort: false,
        hozAlign: 'center',
        headerHozAlign: 'center',
        editable: false,
        download: false,
        formatter: ttAvatarFormatter,
      },
      {
        title: 'ID',
        field: 'id',
        width: 70,
        sorter: 'number',
        frozen: true,
        visible: false,
      },
      {
        title: 'TIP',
        field: 'tip',
        headerFilter: 'input',
        editor: 'input',
        frozen: true,
      },
      {
        title: 'Nombre',
        field: 'nombre',
        headerFilter: 'input',
        editor: 'input',
        frozen: true,
      },
      {
        title: 'Apellido 1',
        field: 'apellido_1',
        headerFilter: 'input',
        editor: 'input',
        frozen: true,
      },
      {
        title: 'Apellido 2',
        field: 'apellido_2',
        headerFilter: 'input',
        editor: 'input',
        frozen: true,
      },
      {
        title: 'Email',
        field: 'email',
        headerFilter: 'input',
        editor: 'input',
      },
      { title: 'NIF', field: 'nif', headerFilter: 'input', editor: 'input' },
      {
        title: 'Telefono',
        field: 'telefono',
        headerFilter: 'input',
        editor: 'input',
      },
      {
        title: 'Pelotón',
        field: 'peloton_id',
        headerFilter: 'input',
        formatter: function (cell) {
          let val = cell.getValue();
          if (!val) return '';
          let p = (app.agentesState.pelotones || []).find(function (x) {
            return String(x.id_peloton) === String(val);
          });
          if (!p) return esc(val);
          if (p.color) {
            return window.GRS1Utils.renderColorBadgeHtml(p.descripcion, p.color, {
              escapeHtmlFn: app.escapeHtml,
              className: 'badge',
              fontSize: '0.88em',
              padding: '.4em .65em',
              contrastThreshold: 0.6,
            });
          }
          return app.escapeHtml(p.descripcion);
        },
        accessorDownload: function (value) {
          return pelotonLabel(value);
        },
        editor: 'list',
        editorParams: function () {
          let _pelotones =
            (app.agentesState && app.agentesState.pelotones) || [];
          return {
            values: _pelotones.reduce(function (acc, p) {
              acc[p.id_peloton] = p.descripcion;
              return acc;
            }, {}),
            clearable: true,
          };
        },
      },
      {
        title: 'Empleo',
        field: 'empleo_id',
        headerFilter: 'input',
        formatter: function (cell) {
          let val = cell.getValue();
          if (!val) return '';
          let e = (app.agentesState.empleos || []).find(function (x) {
            return String(x.id_empleo) === String(val);
          });
          if (!e) return esc(val);
          let color = e.color || '#6c757d';
          return window.GRS1Utils.renderColorBadgeHtml(e.descripcion, color, {
            escapeHtmlFn: app.escapeHtml,
            className: 'badge',
            fontSize: '0.88em',
            padding: '.4em .65em',
            contrastThreshold: 0.6,
          });
        },
        accessorDownload: function (value) {
          return empleoLabel(value);
        },
        editor: 'list',
        editorParams: function () {
          let _empleos = (app.agentesState && app.agentesState.empleos) || [];
          return {
            values: _empleos.reduce(function (acc, e) {
              acc[e.id_empleo] = e.descripcion;
              return acc;
            }, {}),
            clearable: true,
          };
        },
      },
      {
        title: 'Requisitos',
        field: 'requisitos_pct',
        minWidth: 140,
        variableHeight: true,
        headerFilter: 'input',
        hozAlign: 'left',
        tooltip: function (_e, cell) {
          let rowData = cell.getRow().getData() || {};
          let detalle = getRequisitosDetalleVisible(rowData);
          if (!detalle.length) return false;
          return buildRequisitosTooltip(rowData);
        },
        formatter: function (cell) {
          let rowData = cell.getRow().getData() || {};
          if (
            window.GRS1Utils &&
            typeof window.GRS1Utils.renderRequisitosBadgesHtml === 'function'
          ) {
            return window.GRS1Utils.renderRequisitosBadgesHtml(
              rowData,
              app.escapeHtml
            );
          }
          let detalle = getRequisitosDetalleVisible(rowData);
          if (!detalle.length) return '';
          return buildRequisitosResumenTexto(rowData);
        },
        accessorDownload: function (_value, rowData) {
          let detalle = getRequisitosDetalleVisible(rowData || {});
          if (!detalle.length) return '';
          return detalle
            .map(function (item) {
              let tipo = String(
                item && (item.tipo || item.plantilla_nombre)
                  ? item.tipo || item.plantilla_nombre
                  : 'Requisito'
              ).trim();
              let pctVal =
                item && item.pct != null && Number.isFinite(Number(item.pct))
                  ? Math.max(0, Math.min(100, Math.round(Number(item.pct))))
                  : null;
              return tipo + ': ' + (pctVal == null ? '-' : String(pctVal) + '%');
            })
            .join(' | ');
        },
      },
      {
        title: 'Escalafón',
        field: 'escalafon',
        headerFilter: 'input',
        editable: false,
        sorter: 'string',
        formatter: function (cell) {
          let val = cell.getValue();
          if (!val) return '';
          let rowData = cell.getRow().getData();
          let empleo = (app.agentesState.empleos || []).find(function (x) {
            return String(x.id_empleo) === String(rowData.empleo_id);
          });
          let color = (empleo && empleo.color) || '#6c757d';
          return window.GRS1Utils.renderColorBadgeHtml(String(val), color, {
            escapeHtmlFn: app.escapeHtml,
            className: 'badge',
            fontSize: '0.82em',
            contrastThreshold: 0.6,
          });
        },
      },
      {
        title: 'Orden',
        field: 'orden_gc',
        headerFilter: 'input',
        editor: 'number',
      },
      {
        title: 'Ant. Empleo',
        field: 'fecha_ant_empleo',
        headerFilter: 'input',
        formatter: dateFormatter,
        editor: 'date',
      },
      {
        title: 'Domicilio',
        field: 'domicilio',
        headerFilter: 'input',
        editor: 'input',
      },
      {
        title: 'C.P.',
        field: 'codigo_postal',
        headerFilter: 'input',
        editor: 'input',
      },
      {
        title: 'Poblacion',
        field: 'poblacion',
        headerFilter: 'input',
        editor: 'input',
      },
      {
        title: 'Provincia',
        field: 'provincia',
        headerFilter: 'input',
        editor: 'list',
        editorParams: function () {
          let _provincias =
            (app.agentesState && app.agentesState.provincias) || [];
          return {
            values: _provincias.reduce(function (acc, p) {
              acc[p.value] = p.label;
              return acc;
            }, {}),
            clearable: true,
            autocomplete: true,
          };
        },
        formatter: function (cell) {
          let val = String(cell.getValue() || '').trim();
          if (!val) return '';
          let found = (app.agentesState.provincias || []).find(function (p) {
            return p.value === val;
          });
          return found ? app.escapeHtml(found.label) : app.escapeHtml(val);
        },
        accessorDownload: function (value) {
          if (!value) return '';
          let found = (app.agentesState.provincias || []).find(function (p) {
            return p.value === String(value);
          });
          return found ? found.label : String(value);
        },
      },
      {
        title: 'Aptitudes',
        field: 'aptitudes',
        headerFilter: 'input',
        editor: 'input',
      },
      {
        title: 'Situacion',
        field: 'situacion_id',
        headerFilter: 'input',
        formatter: function (cell) {
          let val = cell.getValue();
          if (!val) return '';
          let sit = (app.agentesState.situaciones || []).find(function (s) {
            return String(s.id_situacion) === String(val);
          });
          if (!sit) return esc(val);
          if (sit.color) {
            return window.GRS1Utils.renderColorBadgeHtml(
              sit.descripcion,
              sit.color,
              {
                escapeHtmlFn: app.escapeHtml,
                className: 'badge',
                fontSize: '0.82em',
                contrastThreshold: 0.6,
              }
            );
          }
          return app.escapeHtml(sit.descripcion);
        },
        accessorDownload: function (value) {
          return situacionLabel(value);
        },
        editor: 'list',
        editorParams: function () {
          let _situaciones =
            (app.agentesState && app.agentesState.situaciones) || [];
          return {
            values: _situaciones.reduce(function (acc, s) {
              acc[s.id_situacion] = s.descripcion;
              return acc;
            }, {}),
            clearable: true,
          };
        },
      },
      {
        title: 'Comentarios',
        field: 'comentarios',
        editable: false,
        headerSort: false,
        width: 120,
        hozAlign: 'center',
        formatter: function (cell) {
          let val = cell.getValue();
          let hasContent = val && String(val).trim().length > 0;
          if (hasContent) {
            return window.GRS1Utils.renderSemanticBadgeHtml('Ver', 'primary', {
              escapeHtmlFn: app.escapeHtml,
              cursor: 'pointer',
            });
          }
          return window.GRS1Utils.renderSemanticBadgeHtml('Crear', 'success', {
            escapeHtmlFn: app.escapeHtml,
            cursor: 'pointer',
          });
        },
        // @ts-ignore
        cellClick: function (e, cell) {
          let row = cell.getRow().getData();
          if (typeof app.openComentariosModal === 'function') {
            state._comentariosFromAgentes = true;
            state._comentariosFromAgentesId = row.id;
            app.openComentariosModal(row.id, row.comentarios);
          }
        },
      },
      {
        title: 'Fecha Baja',
        field: 'fecha_baja',
        width: 154,
        editable: false,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar...',
        formatter: fechaBajaFormatter,
        accessorDownload: function (value) {
          if (!value) return '';
          let formatted = formatTimestampWithoutZone(value);
          return formatted || String(value);
        },
      },
      {
        title: '',
        width: 52,
        headerSort: false,
        editable: false,
        download: false,
        formatter: function () {
          return '<button class="btn btn-sm btn-outline-secondary" title="Ver ficha" type="button"><i class="bi bi-person-badge"></i></button>';
        },
        cellClick: function (e, cell) {
          if (e.target.closest('button')) {
            if (typeof app.openFichaAgente === 'function') {
              app.openFichaAgente(cell.getRow().getData());
            }
          }
        },
      },
      {
        title: '',
        width: 70,
        headerSort: false,
        editable: false,
        formatter: function (cell) {
          const row = cell.getRow().getData() || {};
          const actionTitle = row.fecha_baja ? 'Reactivar' : 'Dar de baja';
          const actionIconClass = row.fecha_baja
            ? 'bi bi-arrow-counterclockwise'
            : 'bi bi-trash';
          return (
            '<button class="btn btn-sm btn-outline-danger" title="' +
            app.escapeHtml(actionTitle) +
            '" type="button"><i class="' +
            actionIconClass +
            '"></i></button>'
          );
        },
        cellClick: function (e, cell) {
          if (e.target.closest('button')) {
            if (typeof app.openAgenteDeleteModal === 'function') {
              app.openAgenteDeleteModal(cell.getRow().getData().id);
            }
          }
        },
      },
    ];
  }

  function insertSearchBand() {
    let container = document.getElementById('tabulatorAgentes');
    if (!container || !state.table) return;
    let tabulatorRoot = container.querySelector('.tabulator');
    if (!tabulatorRoot) return;
    let headerEl = tabulatorRoot.querySelector('.tabulator-header');
    if (!headerEl) return;

    let existing = tabulatorRoot.querySelector('#agentesSearchBand');
    if (existing) return;

    let band = document.createElement('div');
    band.id = 'agentesSearchBand';
    band.className = 'px-2 py-1 border-bottom bg-white';
    band.style.cssText = 'position:sticky;top:0;z-index:5;';
    band.innerHTML =
      '<div class="input-group input-group-sm" style="max-width:520px;">' +
      '<span class="input-group-text" aria-hidden="true"><i class="bi bi-search"></i></span>' +
      '<input type="search" id="agentesGlobalSearch" class="form-control form-control-sm" ' +
      'placeholder="Buscar contenido en la tabla" aria-label="Buscar en todos los campos" autocomplete="off">' +
      '<button type="button" id="agentesLimpiarFiltros" class="btn btn-outline-secondary" ' +
      'title="Limpiar todos los filtros" aria-label="Limpiar todos los filtros">' +
      '<i class="bi bi-eraser"></i><span> Filtros</span></button>' +
      '</div>';

    tabulatorRoot.insertBefore(band, headerEl);

    let globalSearch = document.getElementById('agentesGlobalSearch');
    if (globalSearch) {
      globalSearch.addEventListener('input', function () {
        // @ts-ignore
        state.searchTerm = this.value || '';
        applyEstadoFilter();
      });
    }

    let clearBtn = document.getElementById('agentesLimpiarFiltros');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        resetFilters();
      });
    }
  }

  function ensureTable() {
    // La sección se inyecta una sola vez al inicio (loadIncludes) y nunca se
    // re-renderiza. Tabulator 6 usa la propiedad .element (no hay getElement()).
    // Llamar a destroy() elimina el nodo del DOM, impidiendo la re-creación.
    // Por eso: si la instancia existe y su nodo sigue en el documento, la reutilizamos.
    if (state.table) {
      let el = state.table.element;
      if (el && document.documentElement.contains(el)) {
        return state.table;
      }
      // El nodo fue eliminado externamente; limpiar referencia y recrear.
      state.table = null;
    }

    // @ts-ignore
    state.table = new Tabulator('#tabulatorAgentes', {
      locale: 'es-es',
      langs: TABULATOR_LANGS,
      height: 'calc(100vh - 330px)',
      layout: 'fitData',
      selectableRows: true,
      pagination: true,
      paginationSize: 25,
      paginationSizeSelector: [25, 50, 100, 250, true],
      reactiveData: false,
      headerVisible: true,
      placeholder: 'No hay datos cargados',
      columnDefaults: {
        resizable: true,
        headerFilterPlaceholder: 'Filtrar...',
      },
      initialSort: [{ column: 'escalafon', dir: 'asc' }],
      columns: buildColumns(),
    });

    // Reutiliza la lógica del modal de cuadrante de Lista Agentes
    app.tabulatorAgentes = state.table;

    state.table.on('cellEdited', function (cell) {
      let rowData = cell.getRow().getData();
      let id = Number(rowData.id);
      let field = cell.getField();
      let newValue = cell.getValue();
      trackPendingField(id, field, newValue);

      if (field === 'empleo_id') {
        cell.getRow().reformat();
      }
    });

    state.table.on('dataFiltered', updateCounters);
    state.table.on('dataLoaded', updateCounters);
    state.table.on('renderComplete', updateCounters);
    state.table.on('renderComplete', insertSearchBand);
    state.table.on('rowSelectionChanged', syncSelectedAgentesForDetalle);

    return state.table;
  }

  async function setTableData(rows, sourceLabel) {
    let table = ensureTable();
    app.tabulatorAgentes = table;
    let hydrated = hydrateAgentes(rows || []);
    hydrated.sort(function (a, b) {
      let ea = String(a.escalafon || '').toLowerCase();
      let eb = String(b.escalafon || '').toLowerCase();
      if (ea < eb) return -1;
      if (ea > eb) return 1;
      let aa = String(a.apellido_1 || '').toLowerCase();
      let ab2 = String(b.apellido_1 || '').toLowerCase();
      if (aa < ab2) return -1;
      if (aa > ab2) return 1;
      return 0;
    });
    state.agentes = hydrated;
    state.originalAgentes = cloneRows(hydrated);
    state.cambiosPendientes.clear();
    await table.replaceData(hydrated);
    table.setSort('escalafon', 'asc');
    if (table.getSelectedRows().length) {
      table.deselectRow();
    }
    syncSelectedAgentesForDetalle();
    let count = Array.isArray(rows) ? rows.length : 0;
    applyEstadoFilter();
    updateCounters();
    updatePendingChangesUi();
    setStatus(sourceLabel + ': ' + count + ' filas');
  }

  async function loadAgentesFromApi() {
    try {
      setAlert('', 'info');
      setStatus('Cargando agentes desde API...');
      if (typeof app.loadAgentesMeta === 'function') {
        try {
          await app.loadAgentesMeta();
        } catch (metaError) {
          setAlert(
            (metaError && metaError.message) ||
              'No se pudieron cargar metadatos, continuando...',
            'warning'
          );
        }
      }
      let token = app.globalState && app.globalState.token;
      let headers = token ? { Authorization: 'Bearer ' + token } : {};
      let res = await fetch('/api/agentes', {
        headers: headers,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('No se pudo cargar agentes');
      let json = await res.json();
      let rows = Array.isArray(json.agentes) ? json.agentes : [];
      let requisitosByAgente = {};
      try {
        requisitosByAgente = await loadRequisitosResumenByAgente();
      } catch (reqErr) {
        setAlert(
          (reqErr && reqErr.message) ||
            'No se pudo cargar resumen de requisitos, continuando...',
          'warning'
        );
      }

      rows = rows.map(function (row) {
        let id = Number(row && row.id);
        let req = requisitosByAgente[id] || null;
        if (!req) {
          return Object.assign({}, row, {
            requisitos_pct: null,
            requisitos_completado_total: 0,
            requisitos_objetivo_total: 0,
            requisitos_detalle_pct: [],
          });
        }

        return Object.assign({}, row, {
          requisitos_pct: req.pct,
          requisitos_completado_total: req.completado_total,
          requisitos_objetivo_total: req.objetivo_total,
          requisitos_detalle_pct: Array.isArray(req.detalle) ? req.detalle : [],
        });
      });
      await setTableData(rows, 'API Agentes');
    } catch (error) {
      setAlert(error.message || 'Error al cargar agentes', 'danger');
      setStatus(error.message || 'Error al cargar agentes', true);
    }
  }

  function getAgentesAuthHeaders(includeContentType) {
    if (typeof app.getHeaders === 'function') {
      return app.getHeaders(includeContentType !== false);
    }
    let h = {};
    if (app.globalState && app.globalState.token) {
      h.Authorization = 'Bearer ' + app.globalState.token;
    }
    if (includeContentType) {
      h['Content-Type'] = 'application/json';
    }
    return h;
  }

  function badgeHtml(color, label) {
    if (!color) return '<span>' + app.escapeHtml(label) + '</span>';
    return window.GRS1Utils.renderColorBadgeHtml(label, color, {
      escapeHtmlFn: app.escapeHtml,
      className: 'badge me-1',
      fontSize: '.82em',
      padding: '.35em .55em',
    });
  }

  function populateBadgeDropdown(menuId, btnId, inputId, emptyLabel, items) {
    let menu = document.getElementById(menuId);
    let btn = document.getElementById(btnId);
    let input = document.getElementById(inputId);
    if (!menu || !btn || !input) return;

    let html =
      '<li><a class="dropdown-item" href="#" data-value="" data-label="" data-color="">' +
      '<span class="text-muted">' +
      app.escapeHtml(emptyLabel) +
      '</span></a></li>';
    (items || []).forEach(function (item) {
      html +=
        '<li><a class="dropdown-item d-flex align-items-center" href="#"' +
        ' data-value="' +
        app.escapeHtml(String(item.value)) +
        '"' +
        ' data-label="' +
        app.escapeHtml(item.label) +
        '"' +
        ' data-color="' +
        app.escapeHtml(item.color || '') +
        '">' +
        badgeHtml(item.color, item.label) +
        '</a></li>';
    });
    menu.innerHTML = html;

    let current = input.value;
    if (current) {
      let found = (items || []).find(function (i) {
        return String(i.value) === current;
      });
      if (found) {
        btn.innerHTML = badgeHtml(found.color, found.label);
      }
    }

    menu.querySelectorAll('.dropdown-item').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        let val = this.getAttribute('data-value');
        let label = this.getAttribute('data-label');
        let color = this.getAttribute('data-color');
        input.value = val;
        if (!val) {
          btn.innerHTML =
            '<span class="text-muted">' +
            app.escapeHtml(emptyLabel) +
            '</span>';
        } else {
          btn.innerHTML = badgeHtml(color, label);
        }
      });
    });
  }

  function updateBoolVisual(toggle) {
    let input = toggle.querySelector('input[type="hidden"]');
    let val = input ? input.value : '';
    let label = toggle.querySelector('.notion-bool-label');

    toggle.classList.remove('is-true', 'is-false', 'is-null');
    if (val === 'true') {
      toggle.classList.add('is-true');
      if (label) label.textContent = 'Sí';
      return;
    }
    if (val === 'false') {
      toggle.classList.add('is-false');
      if (label) label.textContent = 'No';
      return;
    }
    toggle.classList.add('is-null');
    if (label) label.textContent = '—';
  }

  function cycleBool(toggle) {
    let input = toggle.querySelector('input[type="hidden"]');
    if (!input) return;
    if (input.value === '' || input.value == null) input.value = 'true';
    else if (input.value === 'true') input.value = 'false';
    else input.value = '';
    updateBoolVisual(toggle);
  }

  function initBoolToggles() {
    document
      .querySelectorAll('#agenteModal .notion-bool-toggle')
      .forEach(function (toggle) {
        if (toggle.dataset.ttBoolBound === '1') {
          updateBoolVisual(toggle);
          return;
        }
        toggle.dataset.ttBoolBound = '1';
        updateBoolVisual(toggle);
        toggle.addEventListener('click', function () {
          cycleBool(toggle);
        });
        toggle.addEventListener('keydown', function (e) {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            cycleBool(toggle);
          }
        });
      });
  }

  app.populateAgenteSituacionSelect = function populateAgenteSituacionSelect() {
    populateBadgeDropdown(
      'menuSituacion',
      'btnDropdownSituacion',
      'agenteSituacionId',
      '-- Sin situación --',
      (app.agentesState.situaciones || []).map(function (s) {
        return { value: s.id_situacion, label: s.descripcion, color: s.color };
      })
    );
  };

  app.populateAgentePelotonSelect = function populateAgentePelotonSelect() {
    populateBadgeDropdown(
      'menuPeloton',
      'btnDropdownPeloton',
      'agentePelotonId',
      '-- Sin pelotón --',
      (app.agentesState.pelotones || []).map(function (p) {
        return { value: p.id_peloton, label: p.descripcion, color: p.color };
      })
    );
  };

  app.populateAgenteEmpleoSelect = function populateAgenteEmpleoSelect() {
    populateBadgeDropdown(
      'menuEmpleo',
      'btnDropdownEmpleo',
      'agenteEmpleoId',
      '-- Sin empleo --',
      (app.agentesState.empleos || []).map(function (e) {
        return { value: e.id_empleo, label: e.descripcion, color: e.color };
      })
    );
  };

  app.populateAgenteProvinciaSelect = function populateAgenteProvinciaSelect() {
    let sel = document.getElementById('agenteProvincia');
    if (!sel) return;
    let current = sel.value;
    sel.innerHTML = '<option value="">-- Sin provincia --</option>';
    (app.agentesState.provincias || []).forEach(function (p) {
      let opt = document.createElement('option');
      opt.value = p.value;
      opt.textContent = p.label;
      sel.appendChild(opt);
    });
    sel.value = current;
  };

  app.loadAgentesMeta = async function loadAgentesMeta() {
    let response = await fetch('/api/agentes/meta', {
      headers: getAgentesAuthHeaders(false),
    });

    if (!response.ok) {
      throw new Error('Error al cargar metadatos de agentes');
    }

    let data = await response.json();
    app.agentesState.situaciones = Array.isArray(data.situaciones)
      ? data.situaciones
      : [];
    app.agentesState.pelotones = Array.isArray(data.pelotones)
      ? data.pelotones
      : [];
    app.agentesState.empleos = Array.isArray(data.empleos) ? data.empleos : [];

    try {
      let provRes = await fetch('/api/config/provincias', {
        headers: getAgentesAuthHeaders(false),
      });
      if (provRes.ok) {
        let provJson = await provRes.json();
        app.agentesState.provincias = (provJson.data || []).map(function (p) {
          return { value: String(p.id), label: p.id + ' - ' + p.nombre };
        });
      }
    } catch (_) {
      // noop
    }

    app.populateAgenteSituacionSelect();
    app.populateAgentePelotonSelect();
    app.populateAgenteEmpleoSelect();
    app.populateAgenteProvinciaSelect();
    initBoolToggles();
  };

  app.showAlertAgente = function showAlertAgente(message, type) {
    showAlert(message, type);
  };

  app.loadAgentes = async function loadAgentes() {
    await loadAgentesFromApi();
  };

  app.openAgenteDeleteModal = function openAgenteDeleteModal(id) {
    if (guardReadOnlyAction()) return;
    app.agenteIdToDelete = id;

    let agente = (state.agentes || []).find(function (item) {
      return Number(item.id) === Number(id);
    });
    let isBaja = !!(agente && agente.fecha_baja);
    let agenteNombre = [agente && agente.nombre, agente && agente.apellido_1, agente && agente.apellido_2]
      .filter(Boolean)
      .join(' ')
      .trim();

    let titleEl = document.getElementById('confirmAgenteDeleteTitle');
    let textEl = document.getElementById('confirmAgenteDeleteText');
    let hintEl = document.getElementById('confirmAgenteDeleteHint');
    let confirmBtn = document.getElementById('confirmAgenteDeleteBtn');

    if (titleEl) {
      titleEl.textContent = isBaja
        ? 'Confirmar reactivación'
        : 'Confirmar baja';
    }
    if (textEl) {
      textEl.innerHTML = isBaja
        ? '¿Está seguro de que desea reactivar al agente <strong>' +
          app.escapeHtml(agenteNombre || '#' + id) +
          '</strong>?'
        : '¿Está seguro de que desea dar de baja al agente <strong>' +
          app.escapeHtml(agenteNombre || '#' + id) +
          '</strong>?';
    }
    if (hintEl) {
      hintEl.innerHTML = isBaja
        ? '<i class="bi bi-arrow-counterclockwise"></i> <small>Se reactivará el agente y fecha_baja pasará a null.</small>'
        : '<i class="bi bi-exclamation-triangle-fill"></i> <small>Se registrará fecha_baja y el agente quedará inactivo en cuadrantes activos.</small>';
    }
    if (confirmBtn) {
      confirmBtn.textContent = isBaja ? 'Reactivar' : 'Dar de baja';
    }

    let modalEl = document.getElementById('confirmAgenteDeleteModal');
    if (!modalEl) return;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  };

  app.confirmDeleteAgente = async function confirmDeleteAgente() {
    if (guardReadOnlyAction()) return;
    if (app.agenteIdToDelete === null) return;
    try {
      let response = await fetch('/api/agentes/' + app.agenteIdToDelete, {
        method: 'DELETE',
        headers: getAgentesAuthHeaders(false),
      });

      if (!response.ok) {
        let errJson = await response.json().catch(function () {
          return null;
        });
        throw new Error(
          (errJson && errJson.message) || 'Error al cambiar estado del agente'
        );
      }

      let payload = await response.json().catch(function () {
        return null;
      });

      showAlert(
        (payload && payload.message) || 'Estado del agente actualizado',
        'success'
      );

      app.agenteIdToDelete = null;

      let modalEl = document.getElementById('confirmAgenteDeleteModal');
      if (modalEl) {
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }

      await loadAgentesFromApi();
    } catch (error) {
      showAlert(
        (error && error.message) || 'Error al cambiar estado del agente',
        'danger'
      );
    }
  };

  app.openAgenteModal = function openAgenteModal(agente) {
    let modalEl = document.getElementById('agenteModal');
    if (!modalEl) return;
    let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let title = document.getElementById('agenteModalTitle');

    if (agente) {
      app.agenteModalState.mode = 'edit';
      app.agenteModalState.id = agente.id;
      if (title) title.textContent = 'Editar Agente';
      if (typeof app.fillAgenteForm === 'function') {
        app.fillAgenteForm(agente);
      }
    } else {
      app.agenteModalState.mode = 'create';
      app.agenteModalState.id = null;
      if (typeof app.resetAgenteForm === 'function') {
        app.resetAgenteForm();
      }
      initBoolToggles();
    }

    modal.show();
    applyConsultaReadOnlyUi();
  };

  app.resetAgenteModalState = function resetAgenteModalState() {
    app.agenteModalState.mode = 'create';
    app.agenteModalState.id = null;
    if (typeof app.resetAgenteForm === 'function') {
      app.resetAgenteForm();
    }
  };

  app.createAgente = async function createAgente() {
    if (guardReadOnlyAction()) return;
    let agenteData = app.getAgenteFormData();
    try {
      let response = await fetch('/api/agentes', {
        method: 'POST',
        headers: getAgentesAuthHeaders(true),
        body: JSON.stringify(agenteData),
      });
      if (!response.ok) {
        let error = await response.json().catch(function () {
          return null;
        });
        throw new Error((error && error.message) || 'Error al crear agente');
      }

      let avatarWarning = '';
      if (typeof app.uploadAgenteAvatarIfSelected === 'function') {
        try {
          await app.uploadAgenteAvatarIfSelected(agenteData.tip);
        } catch (avatarError) {
          avatarWarning =
            (avatarError && avatarError.message) ||
            'El agente se creó, pero el avatar no se pudo subir';
        }
      }

      if (typeof app.hideAgenteModal === 'function') {
        app.hideAgenteModal();
      }
      showAlert(
        avatarWarning
          ? 'Agente creado correctamente. ' + avatarWarning
          : 'Agente creado correctamente',
        avatarWarning ? 'warning' : 'success'
      );
      await loadAgentesFromApi();
    } catch (error) {
      showAlert((error && error.message) || 'Error al crear agente', 'danger');
    }
  };

  app.updateAgente = async function updateAgente(id) {
    if (guardReadOnlyAction()) return;
    let agenteData = app.getAgenteFormData();
    try {
      let response = await fetch('/api/agentes/' + id, {
        method: 'PUT',
        headers: getAgentesAuthHeaders(true),
        body: JSON.stringify(agenteData),
      });
      if (!response.ok) {
        let error = await response.json().catch(function () {
          return null;
        });
        throw new Error(
          (error && error.message) || 'Error al actualizar agente'
        );
      }

      let avatarWarning = '';
      if (typeof app.uploadAgenteAvatarIfSelected === 'function') {
        try {
          await app.uploadAgenteAvatarIfSelected(agenteData.tip);
        } catch (avatarError) {
          avatarWarning =
            (avatarError && avatarError.message) ||
            'El agente se actualizó, pero el avatar no se pudo subir';
        }
      }

      if (typeof app.hideAgenteModal === 'function') {
        app.hideAgenteModal();
      }
      showAlert(
        avatarWarning
          ? 'Agente actualizado correctamente. ' + avatarWarning
          : 'Agente actualizado correctamente',
        avatarWarning ? 'warning' : 'success'
      );
      await loadAgentesFromApi();
    } catch (error) {
      showAlert(
        (error && error.message) || 'Error al actualizar agente',
        'danger'
      );
    }
  };

  app.handleAgenteSaveClick = function handleAgenteSaveClick() {
    if (guardReadOnlyAction()) return;
    if (typeof app.validateAgenteForm === 'function' && !app.validateAgenteForm()) {
      return;
    }
    if (app.agenteModalState.mode === 'edit' && app.agenteModalState.id !== null) {
      app.updateAgente(app.agenteModalState.id);
      return;
    }
    app.createAgente();
  };

  app.openComentariosModal = function openComentariosModal(id, currentText) {
    app.agentesState._comentariosId = id;
    let textarea = document.getElementById('comentariosAgenteTextarea');
    if (textarea) textarea.value = currentText || '';
    let modalEl = document.getElementById('comentariosAgenteModal');
    if (!modalEl) return;
    let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalEl.addEventListener('shown.bs.modal', function focusTA() {
      if (textarea) textarea.focus();
      modalEl.removeEventListener('shown.bs.modal', focusTA);
    });
    modal.show();
  };

  app.saveComentariosAgente = function saveComentariosAgente() {
    let id = app.agentesState._comentariosId;
    let textarea = document.getElementById('comentariosAgenteTextarea');
    if (!id || !textarea) return;
    let comentarios = textarea.value.trim() || null;

    trackPendingField(Number(id), 'comentarios', comentarios);
    if (state.table) {
      let row = state.table.getRow(Number(id));
      if (row) row.update({ comentarios: comentarios });
    }

    let modalEl = document.getElementById('comentariosAgenteModal');
    if (modalEl) {
      let modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
    }

    showAlert('Comentario marcado como cambio pendiente', 'info');
  };

  function fichaBadge(text, color) {
    if (!text) return '-';
    return window.GRS1Utils.renderColorBadgeHtml(text, color, {
      escapeHtmlFn: app.escapeHtml,
      className: 'badge',
      noColorClassName: 'badge bg-secondary',
      fontSize: '.9em',
      padding: '.35em .6em',
      maxWidth: '100%',
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
      lineHeight: '1.2',
      contrastThreshold: 0.6,
    });
  }

  function fichaField(label, value) {
    return (
      '<div class="col-12 col-md-6 mb-2">' +
      '<div class="text-muted" style="font-size:.75rem;margin-bottom:2px">' +
      label +
      '</div>' +
      '<div style="line-height:1.25;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">' +
      (value !== null && value !== undefined && value !== ''
        ? value
        : '<span class="text-muted">-</span>') +
      '</div>' +
      '</div>'
    );
  }

  function loadAvatarDataUrl(src) {
    function buildCircularAvatarDataUrl(imageSrc, onDone) {
      let img = new window.Image();
      img.onload = function () {
        let naturalW = img.naturalWidth || img.width || 0;
        let naturalH = img.naturalHeight || img.height || 0;
        if (!naturalW || !naturalH) {
          onDone(null);
          return;
        }

        let size = Math.min(naturalW, naturalH);
        let sx = Math.floor((naturalW - size) / 2);
        let sy = Math.floor((naturalH - size) / 2);

        let canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        try {
          let ctx = canvas.getContext('2d');
          if (!ctx) {
            onDone(null);
            return;
          }
          ctx.save();
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
          ctx.restore();
          onDone(canvas.toDataURL('image/png'));
        } catch (_e) {
          onDone(null);
        }
      };
      img.onerror = function () {
        onDone(null);
      };
      img.src = imageSrc;
    }

    return new Promise(function (resolve) {
      if (!src) {
        resolve(null);
        return;
      }
      // Primero intentar por fetch con credenciales para evitar problemas de CORS/cookies.
      if (window.fetch && window.FileReader) {
        window
          .fetch(src, { credentials: 'include' })
          .then(function (res) {
            if (!res.ok) throw new Error('Avatar no disponible');
            return res.blob();
          })
          .then(function (blob) {
            return new Promise(function (resolveBlob) {
              let objectUrl = window.URL.createObjectURL(blob);
              buildCircularAvatarDataUrl(objectUrl, function (dataUrl) {
                window.URL.revokeObjectURL(objectUrl);
                resolveBlob(dataUrl);
              });
            });
          })
          .then(function (dataUrl) {
            resolve(typeof dataUrl === 'string' ? dataUrl : null);
          })
          .catch(function () {
            buildCircularAvatarDataUrl(src, resolve);
          });
        return;
      }

      buildCircularAvatarDataUrl(src, resolve);
    });
  }

  let FICHA_AVATAR_SIZE_PX = 80;
  let MM_PER_PX = 0.264583;
  let FICHA_AVATAR_SIZE_PDF = Number(
    (FICHA_AVATAR_SIZE_PX * MM_PER_PX).toFixed(2)
  );

  app.openFichaAgente = function openFichaAgente(data) {
    let a = data || {};
    let empleo = (app.agentesState.empleos || []).find(function (x) {
      return String(x.id_empleo) === String(a.empleo_id);
    });
    let peloton = (app.agentesState.pelotones || []).find(function (x) {
      return String(x.id_peloton) === String(a.peloton_id);
    });
    let situacion = (app.agentesState.situaciones || []).find(function (x) {
      return String(x.id_situacion) === String(a.situacion_id);
    });

    let empleoNombre = empleo ? empleo.descripcion : a.empleo_id || '';
    let empleoColor = empleo ? empleo.color : null;
    let escalaNombre = empleo ? empleo.escala || empleo.grupo : null;
    let escalaColor = empleoColor;
    let pelotonNombre = peloton ? peloton.descripcion : a.peloton_id || '';
    let pelotonColor = peloton ? peloton.color : null;
    let situacionNombre = situacion
      ? situacion.descripcion
      : a.situacion_id || '';
    let situacionColor = situacion ? situacion.color : null;

    let initials = ttGetInitials(a);
    let bg = ttAvatarBg(a);
    let avatarUrl = ttAvatarUrlByTip(a.tip);
    let nombreCompleto = [a.nombre, a.apellido_1, a.apellido_2]
      .filter(Boolean)
      .join(' ');
    let provinciaObj = (app.agentesState.provincias || []).find(function (p) {
      return p.value === String(a.provincia || '');
    });
    let provinciaNombre = provinciaObj ? provinciaObj.label : a.provincia || '';
    let fechaAnt = '';
    if (a.fecha_ant_empleo) {
      let dtAnt =
        window.luxon &&
        window.luxon.DateTime.fromISO(String(a.fecha_ant_empleo));
      fechaAnt =
        dtAnt && dtAnt.isValid
          ? dtAnt.toFormat('dd/MM/yyyy')
          : String(a.fecha_ant_empleo);
    }
    let requisitosResumen = buildRequisitosResumenTexto(a);

    let html =
      '<div class="d-flex align-items-start gap-3 border-bottom pb-3 mb-3">' +
      '<div class="grs-avatar flex-shrink-0" style="--avatar-bg:' +
      bg +
      ';width:80px;height:80px;font-size:.82rem;">' +
      (avatarUrl
        ? '<img class="grs-avatar__img" src="' +
          avatarUrl +
          '" alt="' +
          app.escapeHtml(initials) +
          '"><span class="grs-avatar__fallback" style="display:none">' +
          app.escapeHtml(initials) +
          '</span>'
        : '<span class="grs-avatar__fallback">' +
          app.escapeHtml(initials) +
          '</span>') +
      '</div>' +
      '<div class="flex-grow-1" style="min-width:0;">' +
      '<div class="fw-semibold" style="font-size:1.05rem;line-height:1.2;overflow-wrap:anywhere;word-break:break-word;">' +
      app.escapeHtml(nombreCompleto || '-') +
      '</div>' +
      '<div class="mt-2 d-flex flex-wrap gap-2">' +
      (fichaBadge(empleoNombre, empleoColor) !== '-'
        ? fichaBadge(empleoNombre, empleoColor)
        : '') +
      (fichaBadge(escalaNombre, escalaColor) !== '-'
        ? fichaBadge(escalaNombre, escalaColor)
        : '') +
      '</div></div></div>' +
      '<div class="row g-2">' +
      fichaField('NIF', app.escapeHtml(a.nif || '')) +
      fichaField('TIP', app.escapeHtml(a.tip || '')) +
      fichaField('Orden', app.escapeHtml(a.orden_gc || '')) +
      fichaField('Teléfono', app.escapeHtml(a.telefono || '')) +
      fichaField('Email', app.escapeHtml(a.email || '')) +
      fichaField('Pelotón', fichaBadge(pelotonNombre, pelotonColor)) +
      fichaField('Situación', fichaBadge(situacionNombre, situacionColor)) +
      fichaField('Requisitos', app.escapeHtml(requisitosResumen || '')) +
      fichaField('Aptitudes', app.escapeHtml(a.aptitudes || '')) +
      fichaField('Antigüedad Empleo', app.escapeHtml(fechaAnt || '')) +
      fichaField('Domicilio', app.escapeHtml(a.domicilio || '')) +
      fichaField('Población', app.escapeHtml(a.poblacion || '')) +
      fichaField('C.P.', app.escapeHtml(a.codigo_postal || '')) +
      fichaField('Provincia', app.escapeHtml(provinciaNombre || '')) +
      '</div>' +
      '<div class="col-12 mt-3 border-top pt-3">' +
      '<div class="text-muted mb-1" style="font-size:.75rem">Comentarios</div>' +
      '<div class="border rounded p-2 bg-light" style="white-space:pre-wrap;min-height:60px;font-size:.9rem">' +
      app.escapeHtml(a.comentarios || '') +
      '</div></div>';

    let body = document.getElementById('fichaAgenteBody');
    let title = document.getElementById('modalFichaAgenteLabel');
    if (!body || !title) return;

    body.innerHTML = html;
    title.textContent = 'Ficha Completa del Agente - ' + (nombreCompleto || '');

    let exportBtn = document.getElementById('btnExportFichaAgentePDF');
    if (exportBtn) {
      exportBtn.onclick = function () {
        if (!window.jspdf || !window.jspdf.jsPDF) {
          showAlert('No está disponible jsPDF para exportar PDF', 'warning');
          return;
        }
        loadAvatarDataUrl(avatarUrl).then(function (avatarData) {
          let jsPDF = window.jspdf.jsPDF;
          let doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
          let pw = doc.internal.pageSize.getWidth();
          let ph = doc.internal.pageSize.getHeight();
          let fecha = new Date().toLocaleString('es-ES');
          let usuario =
            app.globalState.userName ||
            app.globalState.user?.nombre ||
            app.globalState.user?.name ||
            'N/D';
          let margin = 14;
          let cardW = pw - margin * 2;
          let y = 26;

          function drawPair(x, yPos, label, value, width) {
            doc.setFontSize(8);
            doc.setTextColor(108, 117, 125);
            doc.setFont(undefined, 'bold');
            doc.text(label, x, yPos);
            doc.setTextColor(33, 37, 41);
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            let lines = doc.splitTextToSize(value || '-', width);
            doc.text(lines, x, yPos + 5);
            return lines.length * 4.2 + 8;
          }

          // Header global
          doc.setFillColor(52, 58, 64);
          doc.rect(0, 0, pw, 22, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(13);
          doc.setFont(undefined, 'bold');
          doc.text('FICHA DE AGENTE', 14, 14);

          // Card de cabecera con estilo de modal
          let grupoNombrePdf = a.ars_unidad_id;
          let empleoNombrePdf = empleo ? empleo.descripcion : a.empleo_id || '-';
          let pelotonNombrePdf = peloton ? peloton.descripcion : a.peloton_id || '-';
          let escalaNombrePdf = empleo ? empleo.escala || empleo.grupo || '-' : '-';
          let situacionNombrePdf = situacion
            ? situacion.descripcion
            : a.situacion_id || '-';
          let provinciaObjP = (app.agentesState.provincias || []).find(
            function (p) {
              return p.value === String(a.provincia || '');
            }
          );
          let provinciaNombreP = provinciaObjP
            ? provinciaObjP.label
            : a.provincia || '-';
          let fechaAntP = '';
          if (a.fecha_ant_empleo) {
            let dtAntP =
              window.luxon &&
              window.luxon.DateTime.fromISO(String(a.fecha_ant_empleo));
            fechaAntP =
              dtAntP && dtAntP.isValid
                ? dtAntP.toFormat('dd/MM/yyyy')
                : String(a.fecha_ant_empleo);
          }

          let textX = margin + FICHA_AVATAR_SIZE_PDF + 12;
          let textW = Math.max(50, margin + cardW - textX - 6);
          let nombreLines = doc.splitTextToSize(nombreCompleto || '-', textW);
          let empleoLines = doc.splitTextToSize(
            'Empleo: ' + empleoNombrePdf,
            textW
          );
          let escalaLines = doc.splitTextToSize(
            'Escala: ' + escalaNombrePdf,
            textW
          );
          let headerTextH =
            nombreLines.length * 5.2 +
            empleoLines.length * 4.3 +
            escalaLines.length * 4.3 +
            6;
          let headerCardH = Math.max(
            FICHA_AVATAR_SIZE_PDF + 16,
            headerTextH + 12
          );

          doc.setDrawColor(222, 226, 230);
          doc.setFillColor(248, 249, 250);
          doc.roundedRect(margin, y, cardW, headerCardH, 2, 2, 'FD');

          if (avatarData) {
            try {
              doc.addImage(
                avatarData,
                'JPEG',
                margin + 6,
                y + 8,
                FICHA_AVATAR_SIZE_PDF,
                FICHA_AVATAR_SIZE_PDF
              );
            } catch (_e) {
              // noop
            }
          }

          doc.setTextColor(33, 37, 41);
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text(nombreLines, textX, y + 16);

          doc.setFontSize(9);
          doc.setFont(undefined, 'normal');
          doc.setTextColor(73, 80, 87);
          let infoY = y + 16 + nombreLines.length * 5.2 + 2;
          doc.text(empleoLines, textX, infoY);
          infoY += empleoLines.length * 4.3 + 1;
          doc.text(escalaLines, textX, infoY);

          y += headerCardH + 6;

          // Bloque de datos con UI similar al modal (2 columnas)
          let leftX = margin + 6;
          let rightX = margin + cardW / 2 + 2;
          let lineY = y + 8;

          let fields = [
            ['NIF', a.nif || '-', 'TIP', a.tip || '-'],
            ['Orden', a.orden_gc || '-', 'Teléfono', a.telefono || '-'],
            ['Email', a.email || '-', 'Empleo', empleoNombrePdf],
            ['Grupo', grupoNombrePdf || '-', '', null],
            ['Pelotón', pelotonNombrePdf, 'Escala', escalaNombrePdf],
            ['Situación', situacionNombrePdf, 'Aptitudes', a.aptitudes || '-'],
            ['Ant. Empleo', fechaAntP || '-', 'Domicilio', a.domicilio || '-'],
            ['Población', a.poblacion || '-', 'C.P.', a.codigo_postal || '-'],
            ['Provincia', provinciaNombreP || '-', '', ''],
          ];

          let colW = cardW / 2 - 12;
          let pairHeights = fields.map(function (row) {
            let l1 = doc.splitTextToSize(String(row[1] || '-'), colW);
            let l2 = doc.splitTextToSize(String(row[3] || '-'), colW);
            return Math.max(l1.length * 4.2 + 8, l2.length * 4.2 + 8);
          });
          let dataCardH = 8;
          pairHeights.forEach(function (h) {
            dataCardH += h;
          });

          doc.setDrawColor(222, 226, 230);
          doc.roundedRect(margin, y, cardW, dataCardH, 2, 2, 'S');

          fields.forEach(function (row, idx) {
            drawPair(leftX, lineY, row[0], String(row[1] || '-'), colW);
            if (row[2]) {
              drawPair(rightX, lineY, row[2], String(row[3] || '-'), colW);
            }
            lineY += pairHeights[idx];
          });

          y += dataCardH + 8;

          // Caja de comentarios como en modal
          let comentarios = a.comentarios || '-';
          let comentarioLines = doc.splitTextToSize(comentarios, cardW - 12);
          let comentarioH = Math.max(34, comentarioLines.length * 4.3 + 10);
          doc.setFillColor(248, 249, 250);
          doc.setDrawColor(222, 226, 230);
          doc.roundedRect(margin, y + 2, cardW, comentarioH + 10, 2, 2, 'FD');
          doc.setFontSize(8);
          doc.setTextColor(108, 117, 125);
          doc.setFont(undefined, 'bold');
          doc.text('Comentarios', margin + 6, y + 10);
          doc.setFontSize(10);
          doc.setTextColor(33, 37, 41);
          doc.setFont(undefined, 'normal');
          doc.text(comentarioLines, margin + 6, y + 17);

          // Footer
          doc.setFontSize(7);
          doc.setTextColor(150);
          doc.text('ARS', 14, ph - 8);
          doc.text(
            'Usuario: ' + usuario + '   Fecha: ' + fecha,
            pw - 14,
            ph - 8,
            {
              align: 'right',
            }
          );

          let ts = new Date().toISOString().slice(0, 10);
          doc.save('ficha_agente_' + (a.id || '') + '_' + ts + '.pdf');
        });
      };
    }

    let modalEl = document.getElementById('modalFichaAgente');
    if (!modalEl) return;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  };

  function bindEvents() {
    applyConsultaReadOnlyUi();
    let btnNuevoAgente = document.getElementById('btnAgregarNuevoAgente');
    if (btnNuevoAgente && !btnNuevoAgente.dataset.ttBound) {
      btnNuevoAgente.dataset.ttBound = '1';
      btnNuevoAgente.addEventListener('click', function () {
        if (guardReadOnlyAction()) return;
        if (typeof app.openAgenteModal === 'function') {
          app.openAgenteModal();
        } else {
          showAlert('El módulo de agentes no está disponible', 'warning');
        }
      });
    }

    // Cuando el modal de agente se cierra tras crear uno nuevo, recargar listado.
    let agenteModalEl = document.getElementById('agenteModal');
    if (agenteModalEl && !agenteModalEl.dataset.ttReloadBound) {
      agenteModalEl.dataset.ttReloadBound = '1';
      agenteModalEl.addEventListener('hidden.bs.modal', function () {
        // Solo recargamos si el modo era 'create' (se creó un agente nuevo).
        let wasCreate =
          app.agenteModalState && app.agenteModalState.mode === 'create';
        if (wasCreate && app.currentSection === 'agentes') {
          loadAgentesFromApi();
        }
      });
    }

    let btnCsv = document.getElementById('btnRecargarAgentesApi');
    if (btnCsv && !btnCsv.dataset.ttBound) {
      btnCsv.dataset.ttBound = '1';
      btnCsv.title = 'Recargar desde API de agentes';
      btnCsv.addEventListener('click', loadAgentesFromApi);
    }

    let btnSave = document.getElementById('btnSaveAllChangesAgente');
    if (btnSave && !btnSave.dataset.ttBound) {
      btnSave.dataset.ttBound = '1';
      btnSave.addEventListener('click', function () {
        if (guardReadOnlyAction()) return;
        saveAllChanges();
      });
    }

    let btnDiscard = document.getElementById('btnDiscardChangesAgente');
    if (btnDiscard && !btnDiscard.dataset.ttBound) {
      btnDiscard.dataset.ttBound = '1';
      btnDiscard.addEventListener('click', function () {
        if (guardReadOnlyAction()) return;
        discardPendingChanges();
        resetFilters();
      });
    }

    let btnExportBase = document.getElementById('btnExportExcelAgente');
    if (btnExportBase && !btnExportBase.dataset.ttBound) {
      btnExportBase.dataset.ttBound = '1';
      btnExportBase.addEventListener('click', exportExcel);
    }

    let btnExportVisible = document.getElementById('btnExportPdfAgente');
    if (btnExportVisible && !btnExportVisible.dataset.ttBound) {
      btnExportVisible.dataset.ttBound = '1';
      btnExportVisible.addEventListener('click', exportPdfVisible);
    }

    let detalleBtn = document.getElementById('btnAgenteAsignacionesDetalle');
    if (detalleBtn && !detalleBtn.dataset.ttBound) {
      detalleBtn.dataset.ttBound = '1';
      detalleBtn.addEventListener('click', function () {
        if (typeof app.openAgenteAsignacionesDetalle === 'function') {
          ensureAgenteDetalleModalVisibleHost();
          Promise.resolve(app.openAgenteAsignacionesDetalle()).catch(
            function (error) {
              showAlert(
                (error && error.message) ||
                  'No se pudo abrir la modal de cuadrante',
                'warning'
              );
            }
          );
        } else {
          showAlert('No está disponible el modal de cuadrante', 'warning');
        }
      });
    }
    updateAgenteAsignacionesDetalleButtonState();

    document
      .querySelectorAll('#agentesQuickFilterEstado .dropdown-item')
      .forEach(function (item) {
        // @ts-ignore
        if (!item.dataset.ttBound) {
          // @ts-ignore
          item.dataset.ttBound = '1';
          item.addEventListener('click', function (e) {
            e.preventDefault();
            state.quickFilterEstado =
              item.getAttribute('data-estado') || 'todos';
            let label = document.getElementById('agentesEstadoLabel');
            if (label) label.textContent = item.textContent.trim();
            updateQuickFilterActiveItem();
            applyEstadoFilter();
          });
        }
      });

    // Interceptar el guardado del modal de comentarios compartido.
    // Usamos fase de CAPTURA para ejecutar antes que el listener de dashboard-layout.js
    let btnSaveComentarios = document.getElementById(
      'btnSaveComentariosAgente'
    );
    if (btnSaveComentarios) {
      btnSaveComentarios.addEventListener(
        'click',
        function (e) {
          if (guardReadOnlyAction()) {
            e.stopPropagation();
            return;
          }
          if (!state._comentariosFromAgentes) return; // dejar actuar al listener original
          e.stopPropagation(); // impide que el listener de layout.js se ejecute
          state._comentariosFromAgentes = false;
          let id = state._comentariosFromAgentesId;
          state._comentariosFromAgentesId = null;
          let textarea = document.getElementById('comentariosAgenteTextarea');
          if (!id || !textarea) return;
          // @ts-ignore
          let comentarios = textarea.value.trim() || null;
          trackPendingField(Number(id), 'comentarios', comentarios);
          if (state.table) {
            let tRow = state.table.getRow(Number(id));
            if (tRow) tRow.update({ comentarios: comentarios });
          }
          let modalEl = document.getElementById('comentariosAgenteModal');
          if (modalEl) {
            let bsModal = bootstrap.Modal.getInstance(modalEl);
            if (bsModal) bsModal.hide();
          }
          showAlert('Comentario marcado como cambio pendiente', 'info');
        },
        true // captura: se ejecuta antes que los listeners en burbuja
      );
    }
  }

  app.initializeAgentesTabulator = async function initializeAgentesTabulator() {
    bindAvatarFallbackHandler();

    // Cargar lookups antes de buildColumns() para que los editorParams tengan datos
    if (typeof app.loadAgentesMeta === 'function') {
      try {
        await app.loadAgentesMeta();
      } catch (_e) {
        console.warn(
          '[Agentes] loadAgentesMeta falló en init, lookups pueden estar vacíos',
          _e
        );
      }
    }

    ensureTable();

    bindEvents();
    state.initialized = true;

    await loadAgentesFromApi();
  };
})();
