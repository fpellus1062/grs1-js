(function () {
  const app = window.GRS1Dashboard;
  const qbe = window.GRS1TabulatorQbe || null;
  const utils = window['GRS1Utils'] || {};

  const agenteEditableFields = [
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
    'pei',
    'paef',
    'fecha_ant_empleo',
    'domicilio',
    'codigo_postal',
    'poblacion',
    'provincia',
  ];

  let TABULATOR_LANGS = window.GRS1TabulatorLangs;
  let sameValue = window.GRS1Utils.sameValue;
  let normalizeCssColor =
    typeof utils.normalizeHexColor === 'function'
      ? utils.normalizeHexColor
      : function () {
          return '';
        };

  function updateAgentesCounters() {
    let totalEl = document.getElementById('totalRecordsAgente');
    let filteredEl = document.getElementById('filteredRecordsAgente');
    let shownEl = document.getElementById('shownRecordsAgente');
    if (!app.tabulatorAgentes) return;
    let total = app.tabulatorAgentes.getData().length;
    let filtered = app.tabulatorAgentes.getData('active').length;
    if (totalEl) totalEl.textContent = total;
    if (filteredEl) filteredEl.textContent = filtered;
    if (shownEl) shownEl.textContent = total - filtered;
  }

  function normalizeSortText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function getAgentesQbeDefaults() {
    return {
      nombre: '',
      apellido_1: '',
      apellido_2: '',
      email: '',
      peloton_id: '',
      tip: '',
      orden_gc: '',
      aptitudes: '',
      pei: '',
      paef: '',
    };
  }

  function normalizeAgentesQbeState(raw) {
    let defaults = getAgentesQbeDefaults();
    let src = raw && typeof raw === 'object' ? raw : {};
    Object.keys(defaults).forEach(function (k) {
      if (k === 'pei' || k === 'paef') {
        let v = src[k];
        if (v === true || v === false) {
          defaults[k] = v;
          return;
        }
        if (v === 'true' || v === '1' || v === 1) {
          defaults[k] = true;
          return;
        }
        if (v === 'false' || v === '0' || v === 0) {
          defaults[k] = false;
          return;
        }
        defaults[k] = '';
        return;
      }
      defaults[k] = String(src[k] || '').trim();
    });
    return defaults;
  }

  function ensureAgentesQbeState() {
    app.agentesState.qbeFilters = normalizeAgentesQbeState(
      app.agentesState.qbeFilters
    );
    return app.agentesState.qbeFilters;
  }

  function parseAgentesQbeExpression(rawValue) {
    if (qbe && typeof qbe.parseExpression === 'function') {
      return qbe.parseExpression(rawValue);
    }
    let v = String(rawValue || '').trim();
    return v ? { op: 'contains', value: v } : null;
  }

  function matchAgentesTextQbe(rowValue, expression) {
    if (qbe && typeof qbe.matchesText === 'function') {
      return qbe.matchesText(rowValue, expression, normalizeSortText);
    }
    if (!expression || !expression.value) return true;
    return (
      normalizeSortText(rowValue).indexOf(
        normalizeSortText(expression.value)
      ) !== -1
    );
  }

  function matchAgentesNumberQbe(rowValue, expression) {
    if (qbe && typeof qbe.matchesNumber === 'function') {
      return qbe.matchesNumber(rowValue, expression);
    }
    if (!expression || !expression.value) return true;
    let left = Number(rowValue);
    let right = Number(expression.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return left === right;
  }

  function doesAgenteMatchQbe(rowData, filters) {
    let textFields = ['nombre', 'apellido_1', 'apellido_2', 'email', 'tip'];
    for (let i = 0; i < textFields.length; i += 1) {
      let key = textFields[i];
      if (
        !matchAgentesTextQbe(
          rowData && rowData[key],
          parseAgentesQbeExpression(filters[key])
        )
      )
        return false;
    }

    let peloton = (app.agentesState.pelotones || []).find(function (x) {
      return String(x.id_peloton) === String(rowData && rowData.peloton_id);
    });
    let pelotonLabel = peloton
      ? peloton.descripcion
      : rowData && rowData.peloton_id;
    if (
      !matchAgentesTextQbe(
        pelotonLabel,
        parseAgentesQbeExpression(filters.peloton_id)
      )
    )
      return false;

    if (
      !matchAgentesTextQbe(
        aptitudesToText(rowData && rowData.aptitudes),
        parseAgentesQbeExpression(filters.aptitudes)
      )
    )
      return false;

    let ordenExpr = parseAgentesQbeExpression(filters.orden_gc);
    if (!matchAgentesNumberQbe(rowData && rowData.orden_gc, ordenExpr)) {
      if (!matchAgentesTextQbe(rowData && rowData.orden_gc, ordenExpr))
        return false;
    }

    if (filters.pei !== '' && !!(rowData && rowData.pei) !== !!filters.pei)
      return false;
    if (filters.paef !== '' && !!(rowData && rowData.paef) !== !!filters.paef)
      return false;

    return true;
  }

  function buildAgentesRowSearchableText(rowData) {
    if (!rowData) return '';
    let peloton = (app.agentesState.pelotones || []).find(function (p) {
      return String(p.id_peloton) === String(rowData.peloton_id);
    });
    return [
      rowData.tip,
      rowData.nombre,
      rowData.apellido_1,
      rowData.apellido_2,
      rowData.email,
      peloton ? peloton.descripcion || peloton.codigo || '' : '',
      String(rowData.orden_gc || ''),
      aptitudesToText(rowData.aptitudes),
      rowData.situacion_nombre || rowData.situacion || '',
      rowData.empleo_nombre || '',
      rowData.poblacion || '',
      rowData.provincia || '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  function applyAgentesAdvancedFilters() {
    if (!app.tabulatorAgentes) return;
    let filters = ensureAgentesQbeState();
    let hasQbe = Object.keys(filters).some(function (k) {
      return filters[k] !== '';
    });
    let quickEstado = String(app.agentesState.quickFilterEstado || 'todos');
    let hasQuickEstado = quickEstado === 'activos' || quickEstado === 'baja';
    let rawSearch = String(app.agentesState.searchTerm || '').trim();
    let searchTerm =
      qbe && typeof qbe.normalizeText === 'function'
        ? qbe.normalizeText(rawSearch)
        : rawSearch.toLowerCase();

    if (!hasQbe && !searchTerm && !hasQuickEstado) {
      app.tabulatorAgentes.clearFilter();
      return;
    }

    app.tabulatorAgentes.setFilter(function (rowData) {
      let hasFechaBaja = !!(rowData && rowData.fecha_baja);
      if (quickEstado === 'activos' && hasFechaBaja) return false;
      if (quickEstado === 'baja' && !hasFechaBaja) return false;
      if (hasQbe && !doesAgenteMatchQbe(rowData, filters)) return false;
      if (!searchTerm) return true;
      let text =
        qbe && typeof qbe.normalizeText === 'function'
          ? qbe.normalizeText(buildAgentesRowSearchableText(rowData))
          : buildAgentesRowSearchableText(rowData).toLowerCase();
      return text.indexOf(searchTerm) !== -1;
    });
  }

  function syncAgentesQbeFromHeader() {
    if (
      !app.tabulatorAgentes ||
      typeof app.tabulatorAgentes.getHeaderFilters !== 'function'
    )
      return;
    let next = getAgentesQbeDefaults();
    let headerFilters = app.tabulatorAgentes.getHeaderFilters() || [];
    headerFilters.forEach(function (f) {
      if (!f || !Object.prototype.hasOwnProperty.call(next, f.field)) return;
      if (f.field === 'pei' || f.field === 'paef') {
        if (f.value === true || f.value === false) {
          next[f.field] = f.value;
          return;
        }
        if (f.value === 'true' || f.value === '1' || f.value === 1) {
          next[f.field] = true;
          return;
        }
        if (f.value === 'false' || f.value === '0' || f.value === 0) {
          next[f.field] = false;
          return;
        }
        next[f.field] = '';
        return;
      }
      next[f.field] = String(f.value || '').trim();
    });
    app.agentesState.qbeFilters = next;
  }

  function restoreAgentesQbeHeaderFilters() {
    if (
      !app.tabulatorAgentes ||
      typeof app.tabulatorAgentes.setHeaderFilterValue !== 'function'
    )
      return;
    let filters = ensureAgentesQbeState();
    Object.keys(filters).forEach(function (field) {
      let value = filters[field];
      app.tabulatorAgentes.setHeaderFilterValue(
        field,
        value === '' ? '' : value
      );
    });
  }

  function enhanceAgentesHeaderQbeHelp(container) {
    if (!container || !app.tabulatorAgentes) return;
  }

  function insertAgentesSearchBand(container) {
    if (!container || !app.tabulatorAgentes) return;
    let headerEl = container.querySelector('.tabulator-header');
    if (!headerEl) return;
    let anchorEl = headerEl;

    let bandId = 'agentesSearchBand';
    let existing = container.querySelector('#' + bandId);
    if (existing) {
      if (existing.nextSibling !== anchorEl) {
        container.insertBefore(existing, anchorEl);
      }
      return;
    }

    let band = document.createElement('div');
    band.id = bandId;
    band.className = 'px-2 py-1 border-bottom bg-white';
    band.style.cssText = 'position:sticky;top:0;z-index:5;';
    band.innerHTML =
      '<div class="input-group input-group-sm" style="max-width:520px;">' +
      '<span class="input-group-text" aria-hidden="true"><i class="bi bi-search"></i></span>' +
      '<input type="search" id="agentesGlobalSearch" class="form-control form-control-sm" ' +
      'placeholder="Buscar contenido en la tabla" aria-label="Buscar en todos los campos" autocomplete="off" ' +
      'value="' +
      app.escapeHtml(app.agentesState.searchTerm || '') +
      '">' +
      '<button type="button" id="agentesLimpiarFiltros" class="btn btn-outline-secondary" ' +
      'title="Limpiar todos los filtros" aria-label="Limpiar todos los filtros">' +
      '<i class="bi bi-eraser"></i><span> Filtros</span></button>' +
      '</div>';

    // La banda de búsqueda va encima de la ayuda QBE (si existe).
    container.insertBefore(band, anchorEl);

    document
      .getElementById('agentesGlobalSearch')
      .addEventListener('input', function () {
        app.agentesState.searchTerm = this.value;
        applyAgentesAdvancedFilters();
      });

    document
      .getElementById('agentesLimpiarFiltros')
      .addEventListener('click', function () {
        app.agentesState.searchTerm = '';
        app.agentesState.qbeFilters = {
          nombre: '',
          apellido_1: '',
          apellido_2: '',
          email: '',
          peloton_id: '',
          tip: '',
          orden_gc: '',
          aptitudes: '',
          pei: '',
          paef: '',
        };
        let searchEl = document.getElementById('agentesGlobalSearch');
        if (searchEl) searchEl.value = '';
        if (app.tabulatorAgentes) {
          Object.keys(app.agentesState.qbeFilters).forEach(function (field) {
            app.tabulatorAgentes.setHeaderFilterValue(field, '');
          });
        }
        applyAgentesAdvancedFilters();
      });
  }

  function getEmpleoEscalaById(empleoId) {
    let empleo = (app.agentesState.empleos || []).find(function (x) {
      return String(x.id_empleo) === String(empleoId);
    });
    return empleo ? String(empleo.escala || empleo.grupo || '') : '';
  }

  function aptitudesToText(value) {
    if (Array.isArray(value)) return value.join(', ');
    return String(value == null ? '' : value);
  }

  function hydrateAgenteEscala(row) {
    let next = Object.assign({}, row);
    next.__escala = getEmpleoEscalaById(next.empleo_id);
    return next;
  }

  function hydrateAgentesEscala(rows) {
    return (rows || []).map(hydrateAgenteEscala);
  }

  function trackPendingAgenteField(id, field, newValue) {
    const original = app.agentesState.originalAgentes.find(
      (a) => Number(a.id) === id
    );
    if (!original) {
      app.updatePendingChangesAgente();
      return;
    }

    const currentPending = app.agentesState.cambiosPendientes.get(id);
    const originalValue = original[field];

    if (!currentPending && sameValue(originalValue, newValue)) {
      app.updatePendingChangesAgente();
      return;
    }

    if (!currentPending) {
      app.agentesState.cambiosPendientes.set(id, { ...original });
    }

    const pendingData = app.agentesState.cambiosPendientes.get(id);
    pendingData[field] = newValue;

    const hasDifferences = Object.keys(original).some(
      (key) => !sameValue(original[key], pendingData[key])
    );
    if (!hasDifferences) {
      app.agentesState.cambiosPendientes.delete(id);
    }

    const agente = app.agentesState.agentes.find((a) => Number(a.id) === id);
    if (agente) {
      agente[field] = newValue;
    }

    app.updatePendingChangesAgente();
  }

  function buildAgenteChangesPayload(id, changes) {
    const original = app.agentesState.originalAgentes.find(
      (a) => Number(a.id) === Number(id)
    );
    if (!original) {
      return {};
    }

    return agenteEditableFields.reduce((payload, field) => {
      if (
        Object.hasOwn(changes, field) &&
        !sameValue(original[field], changes[field])
      ) {
        payload[field] = changes[field];
      }
      return payload;
    }, {});
  }

  function getAgenteInitials(agente) {
    const nombre = String(agente?.nombre || '').trim();
    const apellido1 = String(agente?.apellido_1 || '').trim();
    const first = nombre ? nombre.charAt(0) : '';
    const second = apellido1 ? apellido1.charAt(0) : '';
    return (first + second || '?').toUpperCase();
  }

  function avatarUrlByTip(tip) {
    if (!tip) return '';
    return `/avatars/${encodeURIComponent(tip)}.jpg`;
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function avatarBgColor(agente) {
    const seed = `${agente?.id || ''}|${agente?.nombre || ''}|${agente?.apellido_1 || ''}`;
    const hue = hashString(seed) % 360;
    return `hsl(${hue} 55% 45%)`;
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
          fallback.style.display = 'flex';
        }
      },
      true
    );

    app._agentesAvatarFallbackBound = true;
  }

  bindAvatarFallbackHandler();

  function avatarFormatter(cell) {
    const row = cell.getRow().getData();
    const initials = getAgenteInitials(row);
    const bg = avatarBgColor(row);
    const tip = row.tip || row.agente_tip || '';
    const url = avatarUrlByTip(tip);

    if (!url) {
      return (
        `<div class="grs-avatar" style="--avatar-bg:${bg};">` +
        `<span class="grs-avatar__fallback">${initials}</span>` +
        '</div>'
      );
    }

    return (
      `<div class="grs-avatar" style="--avatar-bg:${bg};">` +
      `<img class="grs-avatar__img" src="${url}" alt="${initials}" loading="lazy">` +
      `<span class="grs-avatar__fallback" style="display:none;">${initials}</span>` +
      '</div>'
    );
  }

  function syncSelectedAgentesForBulk() {
    if (!app.tabulatorAgentes) {
      app.globalState.selectedAgenteIdsForBulk = [];
      app.agentesState.selectedAgenteIdsVista = [];
      updateAgenteAsignacionesDetalleButtonState();
      return;
    }

    const ids = app.tabulatorAgentes
      .getSelectedData()
      .map(function (row) {
        return Number(row.id);
      })
      .filter(function (id) {
        return Number.isFinite(id) && id > 0;
      });

    app.globalState.selectedAgenteIdsForBulk = Array.from(new Set(ids));
    app.agentesState.selectedAgenteIdsVista = Array.from(new Set(ids));
    updateAgenteAsignacionesDetalleButtonState();
  }

  function getSelectedAgenteRows() {
    if (!app.tabulatorAgentes) return [];
    let selectedIds = Array.isArray(app.agentesState.selectedAgenteIdsVista)
      ? app.agentesState.selectedAgenteIdsVista
          .map(Number)
          .filter(function (id) {
            return Number.isFinite(id) && id > 0;
          })
      : [];
    if (!selectedIds.length) return [];
    let selectedSet = new Set(selectedIds);
    return (app.tabulatorAgentes.getData() || []).filter(function (row) {
      return selectedSet.has(Number(row && row.id));
    });
  }

  function updateAgenteAsignacionesDetalleButtonState() {
    let btn = document.getElementById('btnAgenteAsignacionesDetalle');
    if (!btn) return;
    let selectedIds = Array.isArray(app.agentesState.selectedAgenteIdsVista)
      ? app.agentesState.selectedAgenteIdsVista.filter(function (id) {
          return Number(id) > 0;
        })
      : [];
    let count = selectedIds.length;
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
      // Fallback solo en caso de error de red/servidor, no si el endpoint devolvió vacío
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
      throw new Error(
        'No se pudo cargar el cuadrante del período seleccionado.'
      );
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
      let statePeriod = resolveAsignacionesPeriodoFromState();
      if (
        statePeriod.cuadrante &&
        Number(statePeriod.anio) === overrideAnio &&
        Number(statePeriod.mes) === overrideMes
      ) {
        return statePeriod;
      }

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
    let cuadrantes = Array.isArray(cuadrantesJson.data)
      ? cuadrantesJson.data
      : [];
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
      throw new Error(
        'No se pudo cargar el cuadrante disponible para el agente.'
      );
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
          labelDate:
            String(dt.day).padStart(2, '0') +
            '/' +
            String(dt.month).padStart(2, '0'),
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

  function resolveCatalogDescripcion(
    items,
    idField,
    value,
    fallbackFields,
    rowData
  ) {
    let found = (items || []).find(function (item) {
      return (
        String(item && item[idField]) === String(value == null ? '' : value)
      );
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
      '' +
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

  function renderAgenteAsignacionesCalendarHtml(
    planningDays,
    assignmentsByDate,
    actividadStyleMap
  ) {
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
      cells.push(
        '<div class="agente-asig-calendar-cell is-empty" aria-hidden="true"></div>'
      );
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
              '' +
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
        '' +
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
      '' +
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

  function setAgenteAsignacionesDetalleState(message, subtitle) {
    let subtitleEl = document.getElementById(
      'agenteAsignacionesDetalleSubtitulo'
    );
    let containerEl = document.getElementById(
      'agenteAsignacionesDetalleGridContainer'
    );
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
    if (payload && payload.data && Array.isArray(payload.data))
      return payload.data;
    return [];
  }

  function buildAgenteDetalleCuadranteUrl(periodo, borradorId, fuente) {
    let base =
      '/api/asignaciones/cuadrante/' + periodo.anio + '/' + periodo.mes;
    if (!borradorId) {
      if (String(fuente || '').toLowerCase() === 'definitivo') {
        return base + '?source=definitivo';
      }
      return base;
    }
    return base + '?borrador_id=' + encodeURIComponent(String(borradorId));
  }

  async function fetchAgenteDetalleCuadranteData(
    periodo,
    borradorId,
    fuente,
    headers
  ) {
    let res = await fetch(
      buildAgenteDetalleCuadranteUrl(periodo, borradorId, fuente),
      {
        headers: headers,
        cache: 'no-store',
      }
    );
    if (!res.ok) {
      throw new Error('No se pudo cargar el cuadrante del agente.');
    }
    return res.json();
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
      throw new Error(
        'No se pudo resolver un cuadrante válido para el agente.'
      );
    }

    let headers =
      typeof app.getHeaders === 'function'
        ? app.getHeaders(false)
        : { Authorization: 'Bearer ' + app.globalState.token };
    let fuente = opts.fuente || getAgenteDetalleFuente();
    let periodoKey =
      String(Number(periodo.anio) || 0) +
      '-' +
      String(Number(periodo.mes) || 0);
    let cachedPeriodoKey =
      app.agentesState && app.agentesState._detalleBorradoresPeriodoKey
        ? String(app.agentesState._detalleBorradoresPeriodoKey)
        : '';
    let shouldReloadBorradores = cachedPeriodoKey !== periodoKey;
    let borradores = normalizeBorradoresPayload(
      app.asignacionesState.borradores
    ).slice();

    if (!borradores.length || shouldReloadBorradores) {
      let borradoresRes = await fetch(
        '/api/asignaciones/borradores/' +
          periodo.anio +
          '/' +
          periodo.mes +
          '?_ts=' +
          encodeURIComponent(String(Date.now())),
        {
          headers: headers,
          cache: 'no-store',
        }
      );
      if (!borradoresRes.ok)
        throw new Error(
          'No se pudieron cargar los borradores de asignaciones.'
        );
      let borradoresJson = await borradoresRes.json();
      borradores = normalizeBorradoresPayload(borradoresJson);
      app.asignacionesState.borradores = borradores.slice();
      if (app.agentesState) {
        app.agentesState._detalleBorradoresPeriodoKey = periodoKey;
      }
    }

    let borradorId = null;
    if (fuente === 'borrador') {
      borradorId = Number(
        opts.borradorId || app.asignacionesState.borradorId || 0
      );
      if (
        !borradorId ||
        !borradores.some(function (item) {
          return Number(item.id) === borradorId;
        })
      ) {
        let preferido =
          borradores.find(function (item) {
            return (
              item &&
              (item.estado === 'validado' || item.estado === 'modificado')
            );
          }) || borradores[0];
        borradorId = Number(preferido && preferido.id);
      }
      if (!borradorId)
        throw new Error('No hay borrador disponible para el cuadrante activo.');
    }

    let cuadranteData = await fetchAgenteDetalleCuadranteData(
      periodo,
      borradorId,
      fuente,
      headers
    );
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
    populateAgenteDetalleBorradoresSelect(
      context.borradores,
      context.borradorId
    );

    let agente = context.agente;
    let periodo = context.periodo;
    let borrador = (context.borradores || []).find(function (item) {
      return Number(item.id) === Number(context.borradorId);
    });
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

    let modalEl = document.getElementById('modalAgenteAsignacionesDetalle');
    let subtitleEl = document.getElementById(
      'agenteAsignacionesDetalleSubtitulo'
    );
    let containerEl = document.getElementById(
      'agenteAsignacionesDetalleGridContainer'
    );
    if (!modalEl || !subtitleEl || !containerEl)
      throw new Error('No se pudo preparar la modal de cuadrante del agente.');

    syncAgenteDetallePeriodoControls(periodo);

    let meses =
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
      String(meses[Number(periodo.mes) - 1] || periodo.mes) +
      ' ' +
      String(periodo.anio) +
      ' · Ventana: ' +
      ventanaInicio +
      ' - ' +
      ventanaFin +
      ' · Fuente: ' +
      (context.fuente === 'definitivo'
        ? 'Definitivo'
        : 'Borrador · ' +
          String(
            (borrador && (borrador.nombre || 'Borrador')) ||
              'Borrador #' + String(context.borradorId)
          ));

    let calendarHtml = renderAgenteAsignacionesCalendarHtml(
      planningDays,
      assignmentsByDate,
      actividadStyleMap
    );

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
      '' +
      renderAgenteInfoCardHtml({
        tip: agente.tip || '',
        nombre: agenteNombre,
        peloton: pelotonNombre,
        empleo: empleoNombre,
      }) +
      calendarHtml;

    return context;
  }

  app.openAgenteAsignacionesDetalle =
    async function openAgenteAsignacionesDetalle() {
      try {
        let modalEl = document.getElementById('modalAgenteAsignacionesDetalle');
        let fuenteEl = document.getElementById('agenteAsigDetalleFuente');
        let borradorEl = document.getElementById('agenteAsigDetalleBorrador');
        let mesEl = document.getElementById('agenteAsigDetalleMes');
        let anioEl = document.getElementById('agenteAsigDetalleAnio');

        // Cargar periodos efectivos disponibles y poblar selectores de año/mes
        let headers =
          typeof app.getHeaders === 'function'
            ? app.getHeaders(false)
            : { Authorization: 'Bearer ' + app.globalState.token };

        await cargarPeriodosDisponiblesAgenteDetalle(headers);

        let estadoAnio = getAgenteDetalleAnioActual();
        let estadoMes = getAgenteDetalleMesSeleccionado();
        // Usar el período activo del estado global si no hay selección previa
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
            // Al cambiar año: refiltrar meses disponibles y re-renderizar
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
              app.showAlertAgente(
                error.message || 'No se pudo recargar el cuadrante del agente.',
                'warning'
              );
            });
          });
        }
        if (fuenteEl && !fuenteEl.dataset.bound) {
          fuenteEl.dataset.bound = '1';
          fuenteEl.addEventListener('change', function () {
            let anioActual = getAgenteDetalleAnioActual();
            let mesActual = getAgenteDetalleMesSeleccionado();
            // Limpiar grid inmediatamente para evitar que persista contenido de la fuente anterior
            setAgenteAsignacionesDetalleState('Cargando...');
            populateAgenteDetalleBorradoresSelect([], null);
            cargarPeriodosDisponiblesAgenteDetalle(headers)
              .then(function () {
                populateAgenteDetallePeriodoSelects(
                  app.agentesState._detallePeriodosDisponibles || [],
                  anioActual,
                  mesActual
                );
                let anioTras = getAgenteDetalleAnioActual();
                let mesTras = getAgenteDetalleMesSeleccionado();
                if (!anioTras || !mesTras) {
                  // Sin períodos para la fuente seleccionada: limpiar borradores y mostrar estado vacío
                  populateAgenteDetalleBorradoresSelect([], null);
                  setAgenteAsignacionesDetalleState(
                    'No hay datos disponibles para la fuente seleccionada.'
                  );
                  return;
                }
                return renderAgenteAsignacionesDetalle({
                  fuente: getAgenteDetalleFuente(),
                  anio: anioTras,
                  mes: mesTras,
                });
              })
              .catch(function (error) {
                setAgenteAsignacionesDetalleState(
                  error.message || 'No hay datos para el período seleccionado.'
                );
                app.showAlertAgente(
                  error.message ||
                    'No se pudo recargar el cuadrante del agente.',
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
              app.showAlertAgente(
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
              app.showAlertAgente(
                error.message || 'No se pudo recargar el cuadrante del agente.',
                'warning'
              );
            });
          });
        }

        let initialFuente = getAgenteDetalleFuente();
        await renderAgenteAsignacionesDetalle({
          fuente: initialFuente,
          anio: getAgenteDetalleAnioActual(),
          mes: getAgenteDetalleMesSeleccionado(),
        });

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
      } catch (error) {
        setAgenteAsignacionesDetalleState(
          error.message || 'No hay datos para el período seleccionado.'
        );
        app.showAlertAgente(
          error.message || 'No se pudo abrir el cuadrante del agente.',
          'warning'
        );
      }
    };

  app.loadAgentesMeta = async function loadAgentesMeta() {
    const response = await fetch('/api/agentes/meta', {
      headers: { Authorization: `Bearer ${app.globalState.token}` },
    });

    if (!response.ok) {
      throw new Error('Error al cargar metadatos de agentes');
    }

    const data = await response.json();
    app.agentesState.situaciones = Array.isArray(data.situaciones)
      ? data.situaciones
      : [];
    app.agentesState.pelotones = Array.isArray(data.pelotones)
      ? data.pelotones
      : [];
    app.agentesState.empleos = Array.isArray(data.empleos) ? data.empleos : [];

    // Load provincias
    try {
      let provRes = await fetch('/api/config/provincias', {
        headers: { Authorization: 'Bearer ' + app.globalState.token },
      });
      if (provRes.ok) {
        let provJson = await provRes.json();
        app.agentesState.provincias = (provJson.data || []).map(function (p) {
          return { value: String(p.id), label: p.id + ' - ' + p.nombre };
        });
      }
    } catch (_) {
      /* ignore */
    }

    app.populateAgenteSituacionSelect();
    app.populateAgentePelotonSelect();
    app.populateAgenteEmpleoSelect();
    app.populateAgenteProvinciaSelect();
    _initBoolToggles();
  };

  // ── Badge dropdown helper (pelotón, empleo, situación) ──────────

  function _badgeHtml(color, label) {
    if (!color) return '<span>' + app.escapeHtml(label) + '</span>';
    return (
      '<span class="badge me-1" style="background:' +
      app.escapeHtml(color) +
      ';font-size:.82em;padding:.35em .55em">' +
      app.escapeHtml(label) +
      '</span>'
    );
  }

  function _populateBadgeDropdown(menuId, btnId, inputId, emptyLabel, items) {
    let menu = document.getElementById(menuId);
    let btn = document.getElementById(btnId);
    let input = document.getElementById(inputId);
    if (!menu || !btn || !input) return;

    let html =
      '<li><a class="dropdown-item" href="#" data-value="" data-label="" data-color="">' +
      '<span class="text-muted">' +
      app.escapeHtml(emptyLabel) +
      '</span></a></li>';
    items.forEach(function (item) {
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
        _badgeHtml(item.color, item.label) +
        '</a></li>';
    });
    menu.innerHTML = html;

    // Restore current value visually
    let cur = input.value;
    if (cur) {
      let found = items.find(function (i) {
        return String(i.value) === cur;
      });
      if (found) {
        btn.innerHTML = _badgeHtml(found.color, found.label);
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
          btn.innerHTML = _badgeHtml(color, label);
        }
      });
    });
  }

  // ── Bool toggle helper (PEI / PAEF) ────────────────────────────

  function _updateBoolVisual(toggle) {
    let input = toggle.querySelector('input[type="hidden"]');
    let val = input ? input.value : '';
    let label = toggle.querySelector('.notion-bool-label');

    toggle.classList.remove('is-true', 'is-false', 'is-null');
    if (val === 'true') {
      toggle.classList.add('is-true');
      if (label) label.textContent = 'Sí';
    } else if (val === 'false') {
      toggle.classList.add('is-false');
      if (label) label.textContent = 'No';
    } else {
      toggle.classList.add('is-null');
      if (label) label.textContent = '—';
    }
  }

  function _cycleBool(toggle) {
    let input = toggle.querySelector('input[type="hidden"]');
    if (!input) return;
    let cur = input.value;
    // cycle: '' → true → false → ''
    if (cur === '' || cur == null) input.value = 'true';
    else if (cur === 'true') input.value = 'false';
    else input.value = '';
    _updateBoolVisual(toggle);
  }

  function _initBoolToggles() {
    document
      .querySelectorAll('#agenteModal .notion-bool-toggle')
      .forEach(function (toggle) {
        _updateBoolVisual(toggle);
        toggle.addEventListener('click', function () {
          _cycleBool(toggle);
        });
        toggle.addEventListener('keydown', function (e) {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            _cycleBool(toggle);
          }
        });
      });
  }

  app.populateAgenteSituacionSelect = function populateAgenteSituacionSelect() {
    _populateBadgeDropdown(
      'menuSituacion',
      'btnDropdownSituacion',
      'agenteSituacionId',
      '-- Sin situación --',
      app.agentesState.situaciones.map(function (s) {
        return { value: s.id_situacion, label: s.descripcion, color: s.color };
      })
    );
  };

  app.populateAgentePelotonSelect = function populateAgentePelotonSelect() {
    _populateBadgeDropdown(
      'menuPeloton',
      'btnDropdownPeloton',
      'agentePelotonId',
      '-- Sin pelotón --',
      app.agentesState.pelotones.map(function (p) {
        return { value: p.id_peloton, label: p.descripcion, color: p.color };
      })
    );
  };

  app.populateAgenteEmpleoSelect = function populateAgenteEmpleoSelect() {
    _populateBadgeDropdown(
      'menuEmpleo',
      'btnDropdownEmpleo',
      'agenteEmpleoId',
      '-- Sin empleo --',
      app.agentesState.empleos.map(function (e) {
        return { value: e.id_empleo, label: e.descripcion, color: e.color };
      })
    );
  };

  app.populateAgenteProvinciaSelect = function populateAgenteProvinciaSelect() {
    const sel = document.getElementById('agenteProvincia');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Sin provincia --</option>';
    (app.agentesState.provincias || []).forEach(function (p) {
      const opt = document.createElement('option');
      opt.value = p.value;
      opt.textContent = p.label;
      sel.appendChild(opt);
    });
    sel.value = current;
  };

  app.initTabulatorAgentes = function initTabulatorAgentes() {
    if (app.tabulatorAgentes) {
      try {
        app.tabulatorAgentes.destroy();
      } catch (e) {
        // noop
      }
      app.tabulatorAgentes = null;
    }
    let qbeTextFields = {
      nombre: true,
      apellido_1: true,
      apellido_2: true,
      email: true,
      peloton_id: true,
      tip: true,
      aptitudes: true,
    };
    function textCol(title, field) {
      let isQbe = !!qbeTextFields[field];
      return {
        title,
        field,
        editor: 'input',
        headerFilter: 'input',
        headerFilterPlaceholder: isQbe
          ? 'Filtrar (~,=,!=,^,$,!,&&,||)...'
          : 'Filtrar...',
        headerFilterLiveFilter: isQbe ? false : true,
        headerFilterFunc: isQbe
          ? function () {
              return true;
            }
          : undefined,
      };
    }

    function dateCol(title, field) {
      return {
        title,
        field,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar...',
        formatter: function (cell) {
          let val = cell.getValue();
          if (!val) return '';
          let dt = luxon.DateTime.fromISO(String(val));
          return dt.isValid
            ? dt.setLocale('es').toFormat('dd/MM/yyyy')
            : String(val);
        },
        accessorDownload: function (value) {
          if (!value) return '';
          let dt = luxon.DateTime.fromISO(String(value));
          return dt.isValid
            ? dt.setLocale('es').toFormat('dd/MM/yyyy')
            : String(value);
        },
        editor: 'date',
      };
    }

    app.tabulatorAgentes = new Tabulator('#tabulatorAgentes', {
      locale: 'es-es',
      langs: TABULATOR_LANGS,
      height: 'calc(100vh - 330px)',
      layout: 'fitData',
      selectableRows: true,
      pagination: true,
      paginationSize: 100,
      paginationSizeSelector: [25, 50, 100, 250, true],
      reactiveData: false,
      headerVisible: true,
      placeholder: 'No hay datos cargados',
      columnDefaults: {
        resizable: true,
        headerFilterPlaceholder: 'Filtrar...',
      },
      columns: [
        {
          formatter: 'rowSelection',
          titleFormatter: 'rowSelection',
          headerSort: false,
          width: 40,
          frozen: true,
          hozAlign: 'center',
          headerHozAlign: 'center',
          editable: false,
          cellClick: function (e, cell) {
            cell.getRow().toggleSelect();
          },
        },
        {
          title: '',
          field: '__avatar',
          width: 56,
          frozen: true,
          headerSort: false,
          hozAlign: 'center',
          headerHozAlign: 'center',
          editable: false,
          download: false,
          formatter: avatarFormatter,
        },
        {
          title: 'ID',
          field: 'id',
          width: 60,
          frozen: true,
          editable: false,
          sorter: 'number',
          visible: false,
        },
        Object.assign(textCol('Nombre', 'nombre'), { frozen: true }),
        Object.assign(textCol('Apellido 1', 'apellido_1'), { frozen: true }),
        Object.assign(textCol('Apellido 2', 'apellido_2'), { frozen: true }),
        Object.assign(textCol('TIP', 'tip'), { frozen: true }),
        textCol('Email', 'email'),
        textCol('NIF', 'nif'),
        textCol('Teléfono', 'telefono'),
        {
          title: 'Pelotón',
          field: 'peloton_id',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar (~,=,!=,^,$,!,&&,||)...',
          headerFilterLiveFilter: false,
          headerFilterFunc: function () {
            return true;
          },
          formatter: function (cell) {
            const val = cell.getValue();
            if (!val) return '';
            const p = app.agentesState.pelotones.find(function (x) {
              return x.id_peloton === val;
            });
            if (!p) return val;
            if (p.color) {
              return (
                '<span class="badge" style="background-color:' +
                app.escapeHtml(p.color) +
                ';font-size:0.88em;padding:.4em .65em">' +
                app.escapeHtml(p.descripcion) +
                '</span>'
              );
            }
            return app.escapeHtml(p.descripcion);
          },
          editor: function (cell, onRendered, success, cancel) {
            const select = document.createElement('select');
            select.style.cssText =
              'width:100%;height:100%;border:none;padding:0 2px;font-size:0.72rem;background:transparent;cursor:pointer;';
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '-- Sin pelotón --';
            select.appendChild(empty);
            app.agentesState.pelotones.forEach(function (p) {
              const opt = document.createElement('option');
              opt.value = p.id_peloton;
              opt.textContent = p.descripcion;
              select.appendChild(opt);
            });
            select.value = cell.getValue() || '';
            onRendered(function () {
              select.focus();
            });
            select.addEventListener('change', function () {
              success(select.value || null);
            });
            select.addEventListener('blur', function () {
              cancel();
            });
            return select;
          },
          accessorDownload: function (value) {
            let p = app.agentesState.pelotones.find(function (x) {
              return x.id_peloton === value;
            });
            return p ? p.descripcion : value || '';
          },
        },
        {
          title: 'Empleo',
          field: 'empleo_id',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            const val = cell.getValue();
            if (!val) return '';
            const e = app.agentesState.empleos.find(function (x) {
              return x.id_empleo === val;
            });
            if (!e) return val;
            let color = e.color || '#6c757d';
            return (
              '<span class="badge" style="background-color:' +
              app.escapeHtml(color) +
              ';font-size:0.88em;padding:.4em .65em">' +
              app.escapeHtml(e.descripcion) +
              '</span>'
            );
          },
          editor: function (cell, onRendered, success, cancel) {
            const select = document.createElement('select');
            select.style.cssText =
              'width:100%;height:100%;border:none;padding:0 2px;font-size:0.72rem;background:transparent;cursor:pointer;';
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '-- Sin empleo --';
            select.appendChild(empty);
            app.agentesState.empleos.forEach(function (e) {
              const opt = document.createElement('option');
              opt.value = e.id_empleo;
              opt.textContent = e.descripcion;
              select.appendChild(opt);
            });
            select.value = cell.getValue() || '';
            onRendered(function () {
              select.focus();
            });
            select.addEventListener('change', function () {
              success(select.value || null);
            });
            select.addEventListener('blur', function () {
              cancel();
            });
            return select;
          },
          accessorDownload: function (value) {
            let e = app.agentesState.empleos.find(function (x) {
              return x.id_empleo === value;
            });
            return e ? e.descripcion : value || '';
          },
        },
        {
          title: 'Escala',
          field: '__escala',
          editable: false,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          headerFilterFunc: function (headerValue, rowValue, rowData) {
            let escala = normalizeSortText(
              getEmpleoEscalaById(rowData.empleo_id)
            );
            return escala.indexOf(normalizeSortText(headerValue)) !== -1;
          },
          sorter: function (a, b, aRow, bRow) {
            let aEscala = normalizeSortText(
              getEmpleoEscalaById(aRow.getData().empleo_id)
            );
            let bEscala = normalizeSortText(
              getEmpleoEscalaById(bRow.getData().empleo_id)
            );
            return aEscala.localeCompare(bEscala, 'es', {
              sensitivity: 'base',
            });
          },
          formatter: function (cell) {
            let rowData = cell.getRow().getData();
            let empleo = app.agentesState.empleos.find(function (x) {
              return x.id_empleo === rowData.empleo_id;
            });
            let escala = getEmpleoEscalaById(rowData.empleo_id);
            if (!escala) return '';
            let color = empleo.color || '#6c757d';
            return (
              '<span class="badge" style="background-color:' +
              app.escapeHtml(color) +
              ';font-size:0.82em">' +
              app.escapeHtml(escala) +
              '</span>'
            );
          },
        },
        {
          title: 'Orden',
          field: 'orden_gc',
          editor: 'input',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar (>,>=,<,<=,=,!=,&&,||)...',
          headerFilterLiveFilter: false,
          headerFilterFunc: function () {
            return true;
          },
        },
        dateCol('Ant. Empleo', 'fecha_ant_empleo'),
        Object.assign(textCol('Domicilio', 'domicilio'), { visible: false }),
        Object.assign(textCol('C.P.', 'codigo_postal'), { visible: false }),
        Object.assign(textCol('Población', 'poblacion'), { visible: false }),
        {
          title: 'Provincia',
          field: 'provincia',
          visible: false,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          width: 150,
          editor: function (cell, onRendered, success) {
            let select = document.createElement('select');
            select.style.cssText =
              'width:100%;font-size:.72rem;padding:1px 2px;';
            select.innerHTML = '<option value="">—</option>';
            let currentVal = String(cell.getValue() || '');
            (app.agentesState.provincias || []).forEach(function (p) {
              let opt = document.createElement('option');
              opt.value = p.value;
              opt.textContent = p.label;
              if (p.value === currentVal) opt.selected = true;
              select.appendChild(opt);
            });
            select.addEventListener('change', function () {
              success(select.value);
            });
            select.addEventListener('blur', function () {
              setTimeout(function () {
                success(select.value);
              }, 150);
            });
            onRendered(function () {
              select.focus();
            });
            return select;
          },
          formatter: function (cell) {
            let val = String(cell.getValue() || '').trim();
            if (!val) return '';
            let found = (app.agentesState.provincias || []).find(function (p) {
              return p.value === val;
            });
            return found ? app.escapeHtml(found.label) : app.escapeHtml(val);
          },
          headerFilterFunc: function (headerValue, rowValue, rowData) {
            let val = String(rowData.provincia || '');
            let found = (app.agentesState.provincias || []).find(function (p) {
              return p.value === val;
            });
            let label = found ? found.label : val;
            return label.toLowerCase().indexOf(headerValue.toLowerCase()) >= 0;
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
          title: 'PEI',
          field: 'pei',
          width: 60,
          hozAlign: 'center',
          headerHozAlign: 'center',
          formatter: 'tickCross',
          formatterParams: { allowTruthy: true },
          editor: 'tickCross',
          headerFilter: 'tickCross',
          headerFilterParams: { tristate: true },
          headerFilterEmptyCheck: function (v) {
            return v === null || v === undefined;
          },
          headerFilterFunc: function () {
            return true;
          },
          accessorDownload: function (value) {
            return value ? 'Sí' : 'No';
          },
        },
        {
          title: 'PAEF',
          field: 'paef',
          width: 70,
          hozAlign: 'center',
          headerHozAlign: 'center',
          formatter: 'tickCross',
          formatterParams: { allowTruthy: true },
          editor: 'tickCross',
          headerFilter: 'tickCross',
          headerFilterParams: { tristate: true },
          headerFilterEmptyCheck: function (v) {
            return v === null || v === undefined;
          },
          headerFilterFunc: function () {
            return true;
          },
          accessorDownload: function (value) {
            return value ? 'Sí' : 'No';
          },
        },
        {
          title: 'Aptitudes',
          field: 'aptitudes',
          editor: 'input',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar (~,=,!=,^,$,!,&&,||)...',
          headerFilterLiveFilter: false,
          headerFilterFunc: function () {
            return true;
          },
          sorter: function (a, b) {
            let left = normalizeSortText(aptitudesToText(a));
            let right = normalizeSortText(aptitudesToText(b));
            return left.localeCompare(right, 'es', { sensitivity: 'base' });
          },
        },
        {
          title: 'Situación',
          field: 'situacion_id',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            const val = cell.getValue();
            if (!val) return '';
            const sit = app.agentesState.situaciones.find(function (s) {
              return String(s.id_situacion) === String(val);
            });
            if (!sit) return val;
            if (sit.color) {
              return (
                '<span class="badge" style="background-color:' +
                app.escapeHtml(sit.color) +
                ';font-size:0.82em">' +
                app.escapeHtml(sit.descripcion) +
                '</span>'
              );
            }
            return app.escapeHtml(sit.descripcion);
          },
          editor: function (cell, onRendered, success, cancel) {
            const select = document.createElement('select');
            select.style.cssText =
              'width:100%;height:100%;border:none;padding:0 2px;font-size:0.72rem;background:transparent;cursor:pointer;';
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '-- Sin situación --';
            select.appendChild(emptyOpt);
            app.agentesState.situaciones.forEach(function (s) {
              const opt = document.createElement('option');
              opt.value = s.id_situacion;
              opt.textContent = s.descripcion;
              select.appendChild(opt);
            });
            select.value = cell.getValue() || '';
            onRendered(function () {
              select.focus();
            });
            select.addEventListener('change', function () {
              success(select.value || null);
            });
            select.addEventListener('blur', function () {
              cancel();
            });
            return select;
          },
          accessorDownload: function (value) {
            let s = app.agentesState.situaciones.find(function (x) {
              return String(x.id_situacion) === String(value);
            });
            return s ? s.descripcion : value || '';
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
            const val = cell.getValue();
            const hasContent = val && String(val).trim().length > 0;
            const cls = hasContent
              ? 'btn btn-sm btn-success'
              : 'btn btn-sm btn-primary';
            const label = hasContent ? 'Ver' : 'Crear';
            return `<button class="${cls}" type="button">${label}</button>`;
          },
          cellClick: function (e, cell) {
            if (e.target.closest('button')) {
              const row = cell.getRow().getData();
              app.openComentariosModal(row.id, row.comentarios);
            }
          },
        },
        {
          title: 'Fecha Baja',
          field: 'fecha_baja',
          editable: false,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let val = cell.getValue();
            if (!val) return '';
            let dt =
              window.luxon &&
              window.luxon.DateTime.fromISO(String(val), { setZone: true });
            return dt && dt.isValid
              ? dt.setLocale('es').toFormat('dd/MM/yyyy HH:mm')
              : String(val);
          },
          accessorDownload: function (value) {
            if (!value) return '';
            let dt =
              window.luxon &&
              window.luxon.DateTime.fromISO(String(value), { setZone: true });
            return dt && dt.isValid
              ? dt.setLocale('es').toFormat('dd/MM/yyyy HH:mm')
              : String(value);
          },
        },
        {
          title: '',
          width: 52,
          headerSort: false,
          editable: false,
          formatter: function () {
            return '<button class="btn btn-outline-info" title="Ver ficha" type="button"><i class="bi bi-person-badge"></i></button>';
          },
          cellClick: function (e, cell) {
            if (e.target.closest('button')) {
              app.openFichaAgente(cell.getRow().getData());
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
              '<button class="btn btn-outline-danger" title="' +
              app.escapeHtml(actionTitle) +
              '" type="button"><i class="' +
              actionIconClass +
              '"></i></button>'
            );
          },
          cellClick: function (e, cell) {
            if (e.target.closest('button')) {
              app.openAgenteDeleteModal(cell.getRow().getData().id);
            }
          },
        },
      ],
    });

    restoreAgentesQbeHeaderFilters();
    applyAgentesAdvancedFilters();

    let agentesContainer = document.getElementById('tabulatorAgentes');
    enhanceAgentesHeaderQbeHelp(agentesContainer);
    insertAgentesSearchBand(agentesContainer);

    let triggerAgentesHeaderQbeSync = function () {
      if (app.agentesState._headerQbeSyncTimer)
        clearTimeout(app.agentesState._headerQbeSyncTimer);
      app.agentesState._headerQbeSyncTimer = setTimeout(function () {
        syncAgentesQbeFromHeader();
        applyAgentesAdvancedFilters();
      }, 0);
    };

    if (agentesContainer && !agentesContainer.dataset.qbeDelegated) {
      agentesContainer.dataset.qbeDelegated = '1';
      agentesContainer.addEventListener('input', function (e) {
        let target = e.target;
        if (
          !target ||
          !target.closest ||
          !target.closest('.tabulator-header-filter')
        )
          return;
        triggerAgentesHeaderQbeSync();
      });
      agentesContainer.addEventListener('change', function (e) {
        let target = e.target;
        if (
          !target ||
          !target.closest ||
          !target.closest('.tabulator-header-filter')
        )
          return;
        triggerAgentesHeaderQbeSync();
      });
    }

    app.tabulatorAgentes.on('cellEdited', function (cell) {
      const rowData = cell.getRow().getData();
      const id = Number(rowData.id);
      const field = cell.getField();
      const newValue = cell.getValue();

      trackPendingAgenteField(id, field, newValue);

      if (field === 'empleo_id') {
        cell.getRow().update({ __escala: getEmpleoEscalaById(newValue) });
        cell.getRow().reformat();
      }
    });

    app.tabulatorAgentes.on('rowSelected', syncSelectedAgentesForBulk);
    app.tabulatorAgentes.on('rowDeselected', syncSelectedAgentesForBulk);
    app.tabulatorAgentes.on('dataFiltered', updateAgentesCounters);
    app.tabulatorAgentes.on('renderComplete', updateAgentesCounters);
    app.tabulatorAgentes.on('renderComplete', syncSelectedAgentesForBulk);
    app.tabulatorAgentes.on('renderComplete', function () {
      enhanceAgentesHeaderQbeHelp(agentesContainer);
      insertAgentesSearchBand(agentesContainer);
    });
  };

  app.loadAgentes = async function loadAgentes() {
    try {
      const response = await fetch('/api/agentes', {
        headers: { Authorization: `Bearer ${app.globalState.token}` },
      });

      if (!response.ok) {
        throw new Error('Error al cargar agentes');
      }

      const data = await response.json();

      if (!Array.isArray(data.agentes)) {
        throw new Error('La respuesta de la API no es un array válido');
      }

      app.agentesState.agentes = hydrateAgentesEscala(
        app.cloneRecords(data.agentes)
      );
      app.agentesState.originalAgentes = hydrateAgentesEscala(
        app.cloneRecords(data.agentes)
      );
      app.agentesState.cambiosPendientes.clear();

      if (app.tabulatorAgentes) {
        await app.tabulatorAgentes.setData(app.agentesState.agentes);
        updateAgentesCounters();
        syncSelectedAgentesForBulk();
      }

      app.updatePendingChangesAgente();
    } catch (error) {
      console.error('Error loading agentes:', error);
      app.showAlertAgente('Error al cargar los agentes', 'danger');
    }
  };

  app.setupAgentesEventListeners = function setupAgentesEventListeners() {
    let guard = document.getElementById('btnAgregarNuevoAgente');
    if (!guard || guard.dataset.bound === '1') return;
    guard.dataset.bound = '1';

    guard.addEventListener('click', () => app.openAgenteModal());
    document
      .getElementById('btnSaveAllChangesAgente')
      .addEventListener('click', app.saveAllChangesAgente);
    document
      .getElementById('btnDiscardChangesAgente')
      .addEventListener('click', app.discardChangesAgente);
    document
      .getElementById('btnExportExcelAgente')
      .addEventListener('click', function () {
        const ts = new Date()
          .toISOString()
          .slice(0, 19)
          .replace('T', '_')
          .replace(/:/g, '-');
        app.tabulatorAgentes.download('xlsx', 'agentes_' + ts + '.xlsx', {
          sheetName: 'Agentes',
        });
      });
    document
      .getElementById('btnExportPdfAgente')
      .addEventListener('click', function () {
        const usuario = app.globalState.userName || '';
        const fecha = new Date().toLocaleString('es-ES');
        const ts = new Date()
          .toISOString()
          .slice(0, 19)
          .replace('T', '_')
          .replace(/:/g, '-');
        const cols = app.tabulatorAgentes.getColumns().filter(function (c) {
          const def = c.getDefinition();
          return def.title && def.field && def.field !== '__avatar';
        });
        const head = [
          cols.map(function (c) {
            return c.getDefinition().title;
          }),
        ];
        const body = app.tabulatorAgentes.getData('active').map(function (row) {
          return cols.map(function (c) {
            return row[c.getDefinition().field] ?? '';
          });
        });
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });
        doc.autoTable({
          head: head,
          body: body,
          startY: 18,
          styles: { fontSize: 7, cellPadding: 2 },
          headStyles: { fillColor: [52, 58, 64], fontSize: 7 },
          margin: { top: 18, bottom: 14 },
          didDrawPage: function () {
            const pw = doc.internal.pageSize.getWidth();
            const ph = doc.internal.pageSize.getHeight();
            const p = doc.internal.getCurrentPageInfo().pageNumber;
            const t = doc.internal.getNumberOfPages();
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text('Listado de Agentes', 14, 12);
            doc.setFontSize(7);
            doc.setTextColor(120);
            doc.text('Usuario: ' + usuario + '   Fecha: ' + fecha, 14, ph - 5);
            doc.text('P\u00e1gina ' + p + ' de ' + t, pw - 14, ph - 5, {
              align: 'right',
            });
          },
        });
        doc.save('agentes_' + ts + '.pdf');
      });

    let quickEstadoEl = document.getElementById('agentesQuickFilterEstado');
    if (quickEstadoEl) {
      let currentQuickEstado = String(
        app.agentesState.quickFilterEstado || 'todos'
      );
      let quickItems = quickEstadoEl.querySelectorAll('a[data-estado]');
      let labelEl = document.getElementById('agentesEstadoLabel');

      // Marcar item activo inicial
      quickItems.forEach(function (item) {
        item.classList.toggle(
          'active',
          String(item.dataset.estado || 'todos') === currentQuickEstado
        );
      });

      quickItems.forEach(function (item) {
        item.addEventListener('click', function (e) {
          e.preventDefault();
          let estado = String(item.dataset.estado || 'todos');
          app.agentesState.quickFilterEstado = estado;
          quickItems.forEach(function (i) {
            i.classList.toggle('active', i === item);
          });
          if (labelEl) {
            labelEl.textContent = item.textContent.trim();
          }
          applyAgentesAdvancedFilters();
        });
      });
    }

    let detalleBtn = document.getElementById('btnAgenteAsignacionesDetalle');
    if (detalleBtn) {
      detalleBtn.addEventListener('click', app.openAgenteAsignacionesDetalle);
    }
    updateAgenteAsignacionesDetalleButtonState();
  };

  app.updatePendingChangesAgente = function updatePendingChangesAgente() {
    const count = app.agentesState.cambiosPendientes.size;
    const countEl = document.getElementById('pendingChangesCountAgente');
    const sectionEl = document.getElementById('saveChangesSectionAgente');
    const saveBtn = document.getElementById('btnSaveAllChangesAgente');
    const discardBtn = document.getElementById('btnDiscardChangesAgente');
    if (countEl) countEl.textContent = count;
    if (sectionEl) {
      sectionEl.classList.toggle('pending-changes-active', count > 0);
      sectionEl.classList.toggle('pending-changes-idle', count === 0);
    }
    if (saveBtn) saveBtn.disabled = count === 0;
    if (discardBtn) discardBtn.disabled = count === 0;
  };

  app.saveAllChangesAgente = async function saveAllChangesAgente() {
    const promises = [];

    for (const [id, changes] of app.agentesState.cambiosPendientes) {
      const payload = buildAgenteChangesPayload(id, changes);
      if (Object.keys(payload).length === 0) {
        continue;
      }

      promises.push(
        fetch(`/api/agentes/${id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${app.globalState.token}`,
          },
          body: JSON.stringify(payload),
        })
      );
    }

    try {
      const responses = await Promise.all(promises);
      const failed = responses.filter((r) => !r.ok).length;

      if (failed === 0) {
        app.showAlertAgente(
          'Todos los cambios guardados correctamente',
          'success'
        );
        await app.loadAgentes();
        return;
      }

      app.showAlertAgente(
        `${failed} cambios fallaron. Revisa los datos.`,
        'warning'
      );
    } catch (error) {
      console.error('Error saving changes:', error);
      app.showAlertAgente('Error al guardar los cambios', 'danger');
    }
  };

  app.discardChangesAgente = function discardChangesAgente() {
    app.agentesState.cambiosPendientes.clear();
    app.agentesState.agentes = hydrateAgentesEscala(
      app.cloneRecords(app.agentesState.originalAgentes)
    );

    if (app.tabulatorAgentes) {
      app.tabulatorAgentes.setData(app.agentesState.agentes);
    }

    app.updatePendingChangesAgente();
    app.showAlertAgente('Cambios descartados', 'info');
  };

  app.openAgenteDeleteModal = function openAgenteDeleteModal(id) {
    app.agenteIdToDelete = id;

    const agente = app.agentesState.agentes.find((item) => item.id === id);
    const isBaja = !!(agente && agente.fecha_baja);
    const agenteNombre = [
      agente?.nombre,
      agente?.apellido_1,
      agente?.apellido_2,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    const label = document.getElementById('deleteAgenteNombre');
    if (label) {
      label.textContent = agenteNombre || `#${id}`;
    }

    const titleEl = document.getElementById('confirmAgenteDeleteTitle');
    const textEl = document.getElementById('confirmAgenteDeleteText');
    const hintEl = document.getElementById('confirmAgenteDeleteHint');
    const confirmBtn = document.getElementById('confirmAgenteDeleteBtn');

    if (titleEl)
      titleEl.textContent = isBaja
        ? 'Confirmar reactivación'
        : 'Confirmar baja';
    if (textEl)
      textEl.innerHTML = isBaja
        ? '¿Está seguro de que desea reactivar al agente <strong id="deleteAgenteNombre">' +
          app.escapeHtml(agenteNombre || `#${id}`) +
          '</strong>?'
        : '¿Está seguro de que desea dar de baja al agente <strong id="deleteAgenteNombre">' +
          app.escapeHtml(agenteNombre || `#${id}`) +
          '</strong>?';
    if (hintEl)
      hintEl.innerHTML = isBaja
        ? '<i class="bi bi-arrow-counterclockwise"></i> <small>Se reactivará el agente y fecha_baja pasará a null.</small>'
        : '<i class="bi bi-exclamation-triangle-fill"></i> <small>Se registrará fecha_baja y el agente quedará inactivo en cuadrantes activos.</small>';
    if (confirmBtn)
      confirmBtn.textContent = isBaja ? 'Reactivar' : 'Dar de baja';

    const modal = new bootstrap.Modal(
      document.getElementById('confirmAgenteDeleteModal')
    );
    modal.show();
  };

  app.confirmDeleteAgente = async function confirmDeleteAgente() {
    if (app.agenteIdToDelete === null) {
      return;
    }

    try {
      const response = await fetch(`/api/agentes/${app.agenteIdToDelete}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${app.globalState.token}`,
        },
      });

      if (!response.ok) {
        const errJson = await response.json().catch(function () {
          return null;
        });
        throw new Error(
          (errJson && errJson.message) || 'Error al cambiar estado del agente'
        );
      }

      const payload = await response.json().catch(function () {
        return null;
      });

      app.showAlertAgente(
        (payload && payload.message) || 'Estado del agente actualizado',
        'success'
      );
      app.agenteIdToDelete = null;

      const modalElement = document.getElementById('confirmAgenteDeleteModal');
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) {
        modal.hide();
      }

      await app.loadAgentes();
    } catch (error) {
      console.error('Error deleting agente:', error);
      app.showAlertAgente(
        error.message || 'Error al cambiar estado del agente',
        'danger'
      );
    }
  };

  app.openAgenteModal = function openAgenteModal(agente = null) {
    const modal = bootstrap.Modal.getOrCreateInstance(
      document.getElementById('agenteModal')
    );
    const title = document.getElementById('agenteModalTitle');

    if (agente) {
      app.agenteModalState.mode = 'edit';
      app.agenteModalState.id = agente.id;
      title.textContent = 'Editar Agente';
      app.fillAgenteForm(agente);
    } else {
      app.agenteModalState.mode = 'create';
      app.agenteModalState.id = null;
      app.resetAgenteForm();
    }

    modal.show();
  };

  app.handleAgenteSaveClick = function handleAgenteSaveClick() {
    if (!app.validateAgenteForm()) {
      return;
    }

    if (
      app.agenteModalState.mode === 'edit' &&
      app.agenteModalState.id !== null
    ) {
      app.updateAgente(app.agenteModalState.id);
      return;
    }

    app.createAgente();
  };

  app.resetAgenteModalState = function resetAgenteModalState() {
    app.agenteModalState.mode = 'create';
    app.agenteModalState.id = null;
    app.resetAgenteForm();
  };

  app.createAgente = async function createAgente() {
    const agenteData = app.getAgenteFormData();

    try {
      const response = await fetch('/api/agentes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${app.globalState.token}`,
        },
        body: JSON.stringify(agenteData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Error al crear agente');
      }

      app.hideAgenteModal();
      app.showAlertAgente('Agente creado correctamente', 'success');
      await app.loadAgentes();
    } catch (error) {
      console.error('Error creating agente:', error);
      app.showAlertAgente(error.message, 'danger');
    }
  };

  app.updateAgente = async function updateAgente(id) {
    const agenteData = app.getAgenteFormData();

    try {
      const response = await fetch(`/api/agentes/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${app.globalState.token}`,
        },
        body: JSON.stringify(agenteData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Error al actualizar agente');
      }

      app.hideAgenteModal();
      app.showAlertAgente('Agente actualizado correctamente', 'success');
      await app.loadAgentes();
    } catch (error) {
      console.error('Error updating agente:', error);
      app.showAlertAgente(error.message, 'danger');
    }
  };

  app.showAlertAgente = function showAlertAgente(message, type) {
    const container = document.getElementById('alertContainerAgente');
    if (!container) {
      return;
    }

    container.innerHTML = app.agentesTemplates.alert(message, type);
    setTimeout(() => {
      container.innerHTML = '';
    }, 5000);
  };

  app.openComentariosModal = function openComentariosModal(id, currentText) {
    app.agentesState._comentariosId = id;
    const textarea = document.getElementById('comentariosAgenteTextarea');
    if (textarea) {
      textarea.value = currentText || '';
    }
    const modalEl = document.getElementById('comentariosAgenteModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalEl.addEventListener('shown.bs.modal', function focusTA() {
      if (textarea) textarea.focus();
      modalEl.removeEventListener('shown.bs.modal', focusTA);
    });
    modal.show();
  };

  app.saveComentariosAgente = function saveComentariosAgente() {
    const id = app.agentesState._comentariosId;
    const textarea = document.getElementById('comentariosAgenteTextarea');
    if (!id || !textarea) return;
    const comentarios = textarea.value.trim() || null;

    trackPendingAgenteField(Number(id), 'comentarios', comentarios);

    if (app.tabulatorAgentes) {
      const row = app.tabulatorAgentes.getRow(Number(id));
      if (row) {
        row.update({ comentarios });
      }
    }

    const modalEl = document.getElementById('comentariosAgenteModal');
    bootstrap.Modal.getInstance(modalEl)?.hide();
    app.showAlertAgente('Comentario marcado como cambio pendiente', 'info');
  };

  // ─── Ficha completa de Agente ────────────────────────────────────────────────

  function fichaBadge(text, color) {
    if (!text) return '-';
    let safeText = app.escapeHtml(String(text));
    if (color) {
      let hex = String(color).replace('#', '');
      if (hex.length === 3)
        hex = hex
          .split('')
          .map(function (c) {
            return c + c;
          })
          .join('');
      let textCol = '#fff';
      if (/^[0-9a-f]{6}$/i.test(hex)) {
        let r = parseInt(hex.slice(0, 2), 16);
        let g = parseInt(hex.slice(2, 4), 16);
        let b = parseInt(hex.slice(4, 6), 16);
        if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6) {
          textCol = '#212529';
        }
      }
      return (
        '<span class="badge" style="background:' +
        app.escapeHtml(color) +
        ';color:' +
        textCol +
        ';font-size:.9em;padding:.35em .6em;max-width:100%;white-space:normal;overflow-wrap:anywhere;line-height:1.2;">' +
        safeText +
        '</span>'
      );
    }
    return (
      '<span class="badge bg-secondary" style="font-size:.9em;max-width:100%;white-space:normal;overflow-wrap:anywhere;line-height:1.2;">' +
      safeText +
      '</span>'
    );
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
    return new Promise(function (resolve) {
      let img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        let canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        try {
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg'));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = src;
    });
  }

  let FICHA_AVATAR_SIZE_PX = 80;
  let MM_PER_PX = 0.264583;
  let FICHA_AVATAR_SIZE_PDF = Number(
    (FICHA_AVATAR_SIZE_PX * MM_PER_PX).toFixed(2)
  );

  app.openFichaAgente = function openFichaAgente(data) {
    let a = data;
    let empleo = app.agentesState.empleos.find(function (x) {
      return x.id_empleo === a.empleo_id;
    });
    let peloton = app.agentesState.pelotones.find(function (x) {
      return x.id_peloton === a.peloton_id;
    });
    let situacion = app.agentesState.situaciones.find(function (x) {
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

    let initials = getAgenteInitials(a);
    let bg = avatarBgColor(a);
    let avatarUrl = avatarUrlByTip(a.tip);
    let nombreCompleto = [a.nombre, a.apellido_1, a.apellido_2]
      .filter(Boolean)
      .join(' ');
    let peiHtml = a.pei
      ? '<i class="bi bi-check-circle-fill text-success me-1"></i>Sí'
      : '<i class="bi bi-x-circle-fill text-danger me-1"></i>No';
    let paefHtml = a.paef
      ? '<i class="bi bi-check-circle-fill text-success me-1"></i>Sí'
      : '<i class="bi bi-x-circle-fill text-danger me-1"></i>No';
    let provinciaObjM = (app.agentesState.provincias || []).find(function (p) {
      return p.value === String(a.provincia || '');
    });
    let provinciaNombreM = provinciaObjM
      ? provinciaObjM.label
      : a.provincia || '';
    let fechaAntM = '';
    if (a.fecha_ant_empleo) {
      let dtAntM =
        window.luxon &&
        window.luxon.DateTime.fromISO(String(a.fecha_ant_empleo));
      fechaAntM =
        dtAntM && dtAntM.isValid
          ? dtAntM.toFormat('dd/MM/yyyy')
          : String(a.fecha_ant_empleo);
    }

    let html =
      '<div class="d-flex align-items-start gap-3 border-bottom pb-3 mb-3">' +
      '<div class="grs-avatar flex-shrink-0" style="--avatar-bg:' +
      bg +
      ';width:' +
      FICHA_AVATAR_SIZE_PX +
      'px;height:' +
      FICHA_AVATAR_SIZE_PX +
      'px;font-size:.82rem;">' +
      (avatarUrl
        ? '<img class="grs-avatar__img" src="' +
          avatarUrl +
          '" alt="' +
          app.escapeHtml(initials) +
          '">' +
          '<span class="grs-avatar__fallback" style="display:none">' +
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
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="row g-2">' +
      fichaField('NIF', app.escapeHtml(a.nif || '')) +
      fichaField('TIP', app.escapeHtml(a.tip || '')) +
      fichaField('Orden', app.escapeHtml(a.orden_gc || '')) +
      fichaField('Teléfono', app.escapeHtml(a.telefono || '')) +
      fichaField('Email', app.escapeHtml(a.email || '')) +
      fichaField('Pelotón', fichaBadge(pelotonNombre, pelotonColor)) +
      fichaField('Situación', fichaBadge(situacionNombre, situacionColor)) +
      fichaField('PEI', peiHtml) +
      fichaField('PAEF', paefHtml) +
      fichaField('Aptitudes', app.escapeHtml(a.aptitudes || '')) +
      fichaField('Antigüedad Empleo', app.escapeHtml(fechaAntM || '')) +
      fichaField('Domicilio', app.escapeHtml(a.domicilio || '')) +
      fichaField('Población', app.escapeHtml(a.poblacion || '')) +
      fichaField('C.P.', app.escapeHtml(a.codigo_postal || '')) +
      fichaField('Provincia', app.escapeHtml(provinciaNombreM || '')) +
      '</div>' +
      // Comentarios full width
      '<div class="col-12 mt-3 border-top pt-3">' +
      '<div class="text-muted mb-1" style="font-size:.75rem">Comentarios</div>' +
      '<div class="border rounded p-2 bg-light" style="white-space:pre-wrap;min-height:60px;font-size:.9rem">' +
      app.escapeHtml(a.comentarios || '') +
      '</div>' +
      '</div>' +
      '';

    document.getElementById('fichaAgenteBody').innerHTML = html;
    document.getElementById('modalFichaAgenteLabel').textContent =
      'Ficha Completa del Agente - ' + (nombreCompleto || '');

    document.getElementById('btnExportFichaAgentePDF').onclick = function () {
      exportFichaAgentePDF(
        a,
        empleo,
        peloton,
        situacion,
        avatarUrl,
        nombreCompleto
      );
    };

    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('modalFichaAgente')
    ).show();
  };

  function exportFichaAgentePDF(
    a,
    empleo,
    peloton,
    situacion,
    avatarUrl,
    nombreCompleto
  ) {
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
      let empleoNombre = empleo ? empleo.descripcion : a.empleo_id || '-';
      let pelotonNombre = peloton ? peloton.descripcion : a.peloton_id || '-';
      let escalaNombre = empleo ? empleo.escala || empleo.grupo || '-' : '-';
      let situacionNombre = situacion
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
      let empleoLines = doc.splitTextToSize('Empleo: ' + empleoNombre, textW);
      let escalaLines = doc.splitTextToSize('Escala: ' + escalaNombre, textW);
      let headerTextH =
        nombreLines.length * 5.2 +
        empleoLines.length * 4.3 +
        escalaLines.length * 4.3 +
        6;
      let headerCardH = Math.max(FICHA_AVATAR_SIZE_PDF + 16, headerTextH + 12);

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
        } catch (e) {
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
        ['Email', a.email || '-', 'Empleo', empleoNombre],
        ['Pelotón', pelotonNombre, 'Escala', escalaNombre],
        ['Situación', situacionNombre, 'PEI', a.pei ? 'Sí' : 'No'],
        ['PAEF', a.paef ? 'Sí' : 'No', 'Aptitudes', a.aptitudes || '-'],
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
        if (row[2])
          drawPair(rightX, lineY, row[2], String(row[3] || '-'), colW);
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
      doc.text('GRS1 Dashboard', 14, ph - 8);
      doc.text('Usuario: ' + usuario + '   Fecha: ' + fecha, pw - 14, ph - 8, {
        align: 'right',
      });

      let ts = new Date().toISOString().slice(0, 10);
      doc.save('ficha_agente_' + (a.id || '') + '_' + ts + '.pdf');
    });
  }
})();
