(function () {
  let app = window.GRS1Dashboard;
  if (!app) return;

  let state = {
    initialized: false,
    table: null,
    assignAgentesTable: null,
    plantillasTable: null,
    rows: [],
    plantillasCrudRows: [],
    selectedPeriodoId: 0,
    selectedPeriodoIds: [],
    selectedPlantillaKey: '',
    selectedRow: null,
    selectedRows: [],
    plantillaEditingId: 0,
    meta: {
      agentes: [],
      plantillas: [],
      empleos: [],
      pelotones: [],
    },
    plantillaObjetivosDraft: [],
    plantillaObjetivoEditingIndex: -1,
    quickEstado: 'todos',
    servicioFecha: '',
    reopenCrudAfterPlantilla: false,
  };

  // @ts-ignore
  let TABULATOR_LANGS = window.GRS1TabulatorLangs;
  let LEFT_PANEL_COLLAPSED_KEY = 'grs1:req:left-panel-collapsed';

  function esc(value) {
    if (app && typeof app.escapeHtml === 'function') return app.escapeHtml(value);
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function setAlert(message, type) {
    let el = document.getElementById('alertContainerAgentesRequisitos');
    if (!el) return;
    if (!message) {
      el.innerHTML = '';
      return;
    }
    let cls = type || 'info';
    el.innerHTML =
      '<div class="alert alert-' +
      esc(cls) +
      ' alert-dismissible fade show py-2 px-3 mb-0" role="alert" style="font-size:.82rem">' +
      '<span>' +
      esc(message) +
      '</span>' +
      '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Cerrar"></button>' +
      '</div>';
  }

  function ensureConfirmDeactivatePlantillaModal() {
    let existing = document.getElementById('reqConfirmDeactivateModal');
    if (existing) return existing;

    let html =
      '<div class="modal fade" id="reqConfirmDeactivateModal" tabindex="-1" aria-labelledby="reqConfirmDeactivateLabel" aria-hidden="true">' +
      '<div class="modal-dialog modal-dialog-centered">' +
      '<div class="modal-content modal-notion shadow-sm">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="reqConfirmDeactivateLabel"><i class="bi bi-exclamation-triangle me-2"></i>Confirmar desactivación</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>' +
      '</div>' +
      '<div class="modal-body">' +
      '<p class="mb-2" id="reqConfirmDeactivateText">¿Deseas desactivar esta plantilla?</p>' +
      '<p class="small text-muted mb-0">La plantilla quedará inactiva para nuevas asignaciones.</p>' +
      '</div>' +
      '<div class="modal-footer d-flex justify-content-between align-items-center">' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>' +
      '<button type="button" class="btn btn-outline-danger" id="btnReqConfirmDeactivate">Desactivar</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
    return document.getElementById('reqConfirmDeactivateModal');
  }

  function openConfirmDeactivatePlantillaModal(row, onConfirm) {
    let modalEl = ensureConfirmDeactivatePlantillaModal();
    if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) {
      onConfirm();
      return;
    }

    let textEl = document.getElementById('reqConfirmDeactivateText');
    let confirmBtn = document.getElementById('btnReqConfirmDeactivate');
    let nombre = String((row && row.nombre) || '').trim();
    if (textEl) {
      textEl.textContent = nombre
        ? '¿Deseas desactivar la plantilla "' + nombre + '"?'
        : '¿Deseas desactivar esta plantilla?';
    }

    if (confirmBtn) {
      confirmBtn.onclick = function () {
        onConfirm();
        window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      };
    }

    modalEl.addEventListener(
      'hidden.bs.modal',
      function cleanup() {
        if (confirmBtn) confirmBtn.onclick = null;
      },
      { once: true }
    );

    window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  function getHeaders(includeContentType) {
    if (typeof app.getHeaders === 'function') return app.getHeaders(includeContentType);
    let h = {};
    if (app.globalState && app.globalState.token) {
      h.Authorization = 'Bearer ' + app.globalState.token;
    }
    if (includeContentType) h['Content-Type'] = 'application/json';
    return h;
  }

  function formatIsoDateEs(value) {
    let DateTime = window.luxon && window.luxon.DateTime;
    if (!DateTime || !value) return String(value || '');
    let dt = DateTime.fromISO(String(value), { setZone: true });
    if (!dt.isValid) return String(value || '');
    return dt.setLocale('es').toFormat('dd/MM/yyyy');
  }

  function getControlEl(id) {
    let el = document.getElementById(id);
    if (
      el instanceof HTMLInputElement
      || el instanceof HTMLSelectElement
      || el instanceof HTMLTextAreaElement
      || el instanceof HTMLButtonElement
    ) {
      return el;
    }
    return null;
  }

  function getValue(id, fallback) {
    let el = getControlEl(id);
    if (!el) return fallback == null ? '' : String(fallback);
    return String(el.value || '');
  }

  function setDisabled(id, disabled) {
    let el = getControlEl(id);
    if (!el) return;
    el.disabled = !!disabled;
  }

  function getReqLayoutEls() {
    return {
      leftCol: document.getElementById('reqLeftCol'),
      rightCol: document.getElementById('reqRightCol'),
      toggleBtn: document.getElementById('btnReqToggleLeft'),
    };
  }

  function getSavedLeftPanelCollapsed() {
    try {
      return localStorage.getItem(LEFT_PANEL_COLLAPSED_KEY) === '1';
    } catch (_error) {
      return false;
    }
  }

  function saveLeftPanelCollapsed(collapsed) {
    try {
      localStorage.setItem(LEFT_PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (_error) {
      // noop: almacenamiento no disponible
    }
  }

  function updateLeftPanelToggleVisual(collapsed) {
    let els = getReqLayoutEls();
    let btn = els.toggleBtn;
    if (!(btn instanceof HTMLButtonElement)) return;

    btn.title = collapsed ? 'Mostrar panel de asignación' : 'Ocultar panel de asignación';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = collapsed
      ? '<i class="bi bi-layout-sidebar-inset"></i>'
      : '<i class="bi bi-layout-sidebar"></i>';
  }

  function applyLeftPanelCollapsed(collapsed, options) {
    let opts = options || {};
    let els = getReqLayoutEls();
    let leftCol = els.leftCol;
    let rightCol = els.rightCol;
    if (!(leftCol instanceof HTMLElement) || !(rightCol instanceof HTMLElement)) return;

    leftCol.classList.toggle('d-none', !!collapsed);
    rightCol.classList.toggle('col-xl-8', !collapsed);
    rightCol.classList.toggle('col-xl-12', !!collapsed);

    updateLeftPanelToggleVisual(!!collapsed);
    if (opts.persist !== false) {
      saveLeftPanelCollapsed(!!collapsed);
    }

    if (opts.redraw === false || !state.initialized) return;

    requestAnimationFrame(function () {
      if (state.table) state.table.redraw(true);
      if (!collapsed && state.assignAgentesTable) {
        state.assignAgentesTable.redraw(true);
      }
    });
  }

  function toggleLeftPanel() {
    let els = getReqLayoutEls();
    let leftCol = els.leftCol;
    if (!(leftCol instanceof HTMLElement)) return;
    let collapsed = !leftCol.classList.contains('d-none');
    applyLeftPanelCollapsed(collapsed, { persist: true, redraw: true });
  }

  function exportMainTableExcel() {
    if (!state.table) {
      setAlert('No hay tabla cargada para exportar.', 'warning');
      return;
    }
    let xlsx = window.XLSX;
    if (!xlsx || !xlsx.utils) {
      setAlert('No está disponible XLSX para exportar Excel.', 'warning');
      return;
    }

    let selectedRows = state.table.getSelectedRows();
    if (!Array.isArray(selectedRows) || !selectedRows.length) {
      setAlert('Marque al menos un registro en la tabla principal para exportar.', 'warning');
      return;
    }

    let visibleColumns = state.table.getColumns().filter(function (col) {
      let def = col.getDefinition() || {};
      if (!def || !def.field || !def.title) return false;
      if (def.visible === false) return false;
      return true;
    });
    if (!visibleColumns.length) {
      setAlert('No hay columnas visibles para exportar.', 'warning');
      return;
    }

    let headers = visibleColumns.map(function (col) {
      return String(col.getDefinition().title || '');
    });

    let rows = selectedRows.map(function (rowComp) {
      let row = rowComp && typeof rowComp.getData === 'function' ? rowComp.getData() : {};
      return visibleColumns.map(function (col) {
        let def = col.getDefinition() || {};
        let field = String(def.field || '');
        let value = row ? row[field] : '';

        if (field === 'periodo_inicio' || field === 'periodo_fin' || field === 'vencimiento') {
          return formatIsoDateEs(value);
        }
        if (field === 'progress_pct') {
          return String(row.completado_total || 0) + '/' + String(row.objetivo_total || 0) + ' (' + String(Number(row.progress_pct || 0)) + '%)';
        }
        if (field === 'subtipos_estado') {
          let items = Array.isArray(row.subtipos_estado) ? row.subtipos_estado : [];
          return items.map(function (it) {
            return String(it.subtipo || '') + ': ' + String(it.completado || 0) + '/' + String(it.objetivo || 0);
          }).join(' | ');
        }
        if (field === 'estado') {
          let e = String(value || '').replaceAll('_', ' ');
          if (!e) return '';
          return e.charAt(0).toUpperCase() + e.slice(1);
        }
        if (value == null) return '';
        return String(value);
      });
    });

    let ws = xlsx.utils.aoa_to_sheet([headers].concat(rows));
    let wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Requisitos');

    let ts = (window.luxon && window.luxon.DateTime)
      ? window.luxon.DateTime.now().toFormat('yyyyLLdd_HHmm')
      : String(Date.now());
    xlsx.writeFile(wb, 'requisitos_periodicos_marcados_' + ts + '.xlsx');
  }

  function statusBadge(cell) {
    let value = String(cell.getValue() || '').toLowerCase();
    if (value === 'cumplido') {
      return window.GRS1Utils.renderSemanticBadgeHtml('Cumplido', 'success', {
        escapeHtmlFn: esc,
      });
    }
    if (value === 'vencido') {
      return window.GRS1Utils.renderSemanticBadgeHtml('Vencido', 'warning', {
        escapeHtmlFn: esc,
      });
    }
    if (value === 'sancionado') {
      return window.GRS1Utils.renderSemanticBadgeHtml('Sancionado', 'danger', {
        escapeHtmlFn: esc,
      });
    }
    return window.GRS1Utils.renderSemanticBadgeHtml('En progreso', 'secondary', {
      escapeHtmlFn: esc,
    });
  }

  function subtiposBadge(cell) {
    let row = cell.getRow().getData();
    let items = Array.isArray(row.subtipos_estado) ? row.subtipos_estado : [];
    if (!items.length) return '<span class="text-muted">-</span>';
    return items
      .map(function (it) {
        let tone = it.cumple ? 'success' : 'warning';
        return window.GRS1Utils.renderSemanticBadgeHtml(
          String(it.subtipo || '') +
            ': ' +
            String(it.completado || 0) +
            '/' +
            String(it.objetivo || 0),
          tone,
          {
            escapeHtmlFn: esc,
            className: 'me-1',
          }
        );
      })
      .join('');
  }

  function servicioBadgeFormatter(cell) {
    let row = cell.getRow().getData() || {};
    let items = Array.isArray(row.servicio_asignaciones) ? row.servicio_asignaciones : [];
    if (!items.length) return '<span class="text-muted">-</span>';

    return items.map(function (svc) {
      let codigo = String((svc && svc.codigo) || '').trim();
      let nombre = String((svc && svc.nombre) || '').trim();
      let label = codigo || nombre || 'Servicio';
      let tooltip = nombre || label;
      let bg = String((svc && svc.color) || '').trim() || '#6c757d';
      return '<span title="' + esc(tooltip) + '">' + window.GRS1Utils.renderColorBadgeHtml(label, bg, {
        escapeHtmlFn: esc,
        className: 'badge me-1 mb-1',
        fontSize: '.60rem',
        padding: '.22em .45em',
        lineHeight: '1.1',
        contrastThreshold: 0.6,
      }) + '</span>';
    }).join('');
  }

  function safeBadgeColor(value, fallback) {
    let raw = String(value || '').trim();
    if (!raw) return String(fallback || '#6c757d');
    if (window.GRS1Utils && typeof window.GRS1Utils.normalizeHexColor === 'function') {
      return window.GRS1Utils.normalizeHexColor(raw) || String(fallback || '#6c757d');
    }
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
    return String(fallback || '#6c757d');
  }

  function empleoBadgeFormatter(cell) {
    let row = cell.getRow().getData() || {};
    let label = String(cell.getValue() || row.empleo_desc || row.empleo_id || '').trim();
    if (!label) return '<span class="text-muted">-</span>';
    let color = safeBadgeColor(row.color_empleo || row.empleo_color, '#6c757d');
    return window.GRS1Utils.renderColorBadgeHtml(label, color, {
      escapeHtmlFn: esc,
      className: 'badge',
      fontSize: '.60rem',
      padding: '.22em .45em',
      contrastThreshold: 0.6,
    });
  }

  function pelotonBadgeFormatter(cell) {
    let row = cell.getRow().getData() || {};
    let label = String(cell.getValue() || row.peloton_desc || row.peloton_id || '').trim();
    if (!label) return '<span class="text-muted">-</span>';
    let color = safeBadgeColor(row.color_peloton || row.peloton_color, '#6c757d');
    return window.GRS1Utils.renderColorBadgeHtml(label, color, {
      escapeHtmlFn: esc,
      className: 'badge',
      fontSize: '.60rem',
      padding: '.22em .45em',
      contrastThreshold: 0.6,
    });
  }

  function enrichAgentesWithMetaColors(agentes, empleos, pelotones) {
    let empleoById = new Map();
    let pelotonById = new Map();

    (Array.isArray(empleos) ? empleos : []).forEach(function (e) {
      empleoById.set(String(e && e.id_empleo || ''), e || {});
    });
    (Array.isArray(pelotones) ? pelotones : []).forEach(function (p) {
      pelotonById.set(String(p && p.id_peloton || ''), p || {});
    });

    return (Array.isArray(agentes) ? agentes : []).map(function (ag) {
      let row = Object.assign({}, ag);
      let empleo = empleoById.get(String(row.empleo_id || '')) || null;
      let peloton = pelotonById.get(String(row.peloton_id || '')) || null;

      if (!row.color_empleo && empleo && empleo.color) {
        row.color_empleo = String(empleo.color);
      }
      if (!row.empleo_nombre && empleo && empleo.descripcion) {
        row.empleo_nombre = String(empleo.descripcion);
      }
      if (!row.color_peloton && peloton && peloton.color) {
        row.color_peloton = String(peloton.color);
      }
      if (!row.peloton_nombre && peloton && peloton.descripcion) {
        row.peloton_nombre = String(peloton.descripcion);
      }

      return row;
    });
  }

  function avatarGetInitials(row) {
    let nombre = String((row && row.nombre) || '').trim();
    let apellido1 = String((row && row.apellido_1) || '').trim();
    let first = nombre ? nombre.charAt(0) : '';
    let second = apellido1 ? apellido1.charAt(0) : '';
    return (first + second || '?').toUpperCase();
  }

  function avatarBg(row) {
    let seed = (row && row.agente_id ? String(row.agente_id) : '') + '|' + ((row && row.nombre) || '') + '|' + ((row && row.apellido_1) || '');
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    let hue = Math.abs(hash) % 360;
    return 'hsl(' + hue + ' 55% 45%)';
  }

  function avatarFormatter(cell) {
    let row = cell.getRow().getData();
    let initials = avatarGetInitials(row);
    let bg = avatarBg(row);
    let tip = row.tip || '';
    let url = tip ? '/avatars/' + encodeURIComponent(tip) + '.jpg' : '';
    if (!url) {
      return '<div class="grs-avatar" style="--avatar-bg:' + bg + ';"><span class="grs-avatar__fallback">' + esc(initials) + '</span></div>';
    }
    return '<div class="grs-avatar" style="--avatar-bg:' + bg + ';">' +
      '<img class="grs-avatar__img" src="' + url + '" alt="' + esc(initials) + '" loading="lazy">' +
      '<span class="grs-avatar__fallback" style="display:none;">' + esc(initials) + '</span>' +
      '</div>';
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
        if (fallback instanceof HTMLElement && fallback.classList.contains('grs-avatar__fallback')) {
          img.style.display = 'none';
          fallback.style.display = 'inline-flex';
        }
      },
      true
    );

    app._agentesAvatarFallbackBound = true;
  }

  function applyEstadoQuickFilter() {
    if (!state.table) return;
    let selected = String(state.quickEstado || 'todos').toLowerCase();
    state.table.setFilter(function (rowData) {
      let estado = String((rowData && rowData.estado) || '').toLowerCase();
      if (selected === 'todos') return true;
      return estado === selected;
    });
  }

  function buildColumns() {
    return [
      { formatter: 'rowSelection', titleFormatter: 'rowSelection', width: 40, hozAlign: 'center',headerSort: false,frozen: true, },
      { title: 'Avatar', field: 'tip', width: 74, hozAlign: 'center',  headerSort: false,frozen: true, formatter: avatarFormatter, visible: false },
      { title: 'TIP', field: 'tip', width: 110, frozen: true, headerFilter: 'input' },
      { title: 'Agente', field: 'nombre', minWidth: 180, frozen: true, headerFilter: 'input', formatter: function (cell) {
        let row = cell.getRow().getData();
        return esc([row.nombre, row.apellido_1, row.apellido_2].filter(Boolean).join(' '));
      } },
      { title: 'Empleo', field: 'empleo_nombre', minWidth: 140, frozen: true, headerFilter: 'input', formatter: empleoBadgeFormatter },
      { title: 'Escalafón', field: 'escalafon', width: 110, headerFilter: 'input', visible: false },
      { title: 'Pelotón', field: 'peloton_nombre', minWidth: 130, headerFilter: 'input', formatter: pelotonBadgeFormatter },
      { title: 'Plantilla', field: 'plantilla_nombre', minWidth: 170, headerFilter: 'input' },
      { title: 'Servicio', field: 'servicio_labels', minWidth: 80, headerFilter: 'input', formatter: servicioBadgeFormatter },
      {
        title: 'Progreso',
        field: 'progress_pct',
        width: 140,
        hozAlign: 'left',
        formatter: 'progress',
        formatterParams: {
          color: ['red', 'orange', 'green'],
          legend: true,
          legendColor: '#ddd9d9',
          legendAlign: 'left',
        },
      },
      { title: 'Subtipos', field: 'subtipos_estado', minWidth: 260, formatter: subtiposBadge },
      { title: 'Estado', field: 'estado', width: 130, hozAlign: 'center', formatter: statusBadge },
      { title: 'Tipo', field: 'tipo_requisito', minWidth: 120, headerFilter: 'input' },
      { title: 'Periodicidad', field: 'periodicidad', width: 110, headerFilter: 'input' },
      { title: 'Periodo Inicio', field: 'periodo_inicio', width: 125, formatter: function (cell) { return esc(formatIsoDateEs(cell.getValue())); } },
      { title: 'Periodo Fin', field: 'periodo_fin', width: 125, formatter: function (cell) { return esc(formatIsoDateEs(cell.getValue())); } },
      { title: 'Deadline', field: 'vencimiento', width: 130, formatter: function (cell) { return esc(formatIsoDateEs(cell.getValue())); } },

    ];
  }

  function getPlantillaKey(row) {
    if (!row || typeof row !== 'object') return '';
    let plantillaId = Number(row.plantilla_id || 0);
    if (plantillaId > 0) return 'id:' + String(plantillaId);
    return 'nombre:' + String(row.plantilla_nombre || '').trim().toLowerCase();
  }

  function isSelectableByPlantilla(rowData) {
    let lockedKey = String(state.selectedPlantillaKey || '');
    if (!lockedKey) return true;
    return getPlantillaKey(rowData) === lockedKey;
  }

  function refreshCounters() {
    let rows = state.rows || [];
    let total = rows.length;
    let cumplidos = rows.filter(function (r) { return String(r.estado || '') === 'cumplido'; }).length;
    let vencidos = rows.filter(function (r) { return String(r.estado || '') === 'vencido' || String(r.estado || '') === 'sancionado'; }).length;
    let totalEl = document.getElementById('reqTotal');
    let cumplidosEl = document.getElementById('reqCumplidos');
    let vencidosEl = document.getElementById('reqVencidos');
    if (totalEl) totalEl.textContent = String(total);
    if (cumplidosEl) cumplidosEl.textContent = String(cumplidos);
    if (vencidosEl) vencidosEl.textContent = String(vencidos);
  }

  function refreshSelectedActions() {
    let btnReg = document.getElementById('btnReqRegistrar');
    let btnSan = document.getElementById('btnReqSancionar');
    let selectedCount = Array.isArray(state.selectedPeriodoIds) ? state.selectedPeriodoIds.length : 0;
    if (btnReg) {
      setDisabled('btnReqRegistrar', selectedCount < 1);
      btnReg.title = selectedCount > 1 ? ('Registrar prueba (' + selectedCount + ')') : 'Registrar prueba';
    }
    if (btnSan) {
      setDisabled('btnReqSancionar', selectedCount !== 1);
      btnSan.title = selectedCount === 1 ? 'Sancionar' : 'Sancionar (seleccione 1)';
    }
  }

  function refreshMainSelCount() {
    let el = document.getElementById('reqMainSelCount');
    if (!el) return;
    let count = Array.isArray(state.selectedPeriodoIds) ? state.selectedPeriodoIds.length : 0;
    el.textContent = String(count);
  }

  function parseObjetivosLines(raw) {
    let lines = String(raw || '')
      .split(/\r?\n/)
      .map(function (line) {
        return String(line || '').trim();
      })
      .filter(Boolean);

    let parsed = [];
    lines.forEach(function (line, idx) {
      let parts = line.split(':');
      if (parts.length < 2) return;
      let subtipo = String(parts[0] || '').trim();
      let objetivo = Number(String(parts.slice(1).join(':') || '').trim());
      if (!subtipo || !Number.isFinite(objetivo) || objetivo <= 0) return;
      parsed.push({ subtipo: subtipo, objetivo: Math.floor(objetivo), orden: idx });
    });
    return parsed;
  }

  function syncPlantillaObjetivosRawFromDraft() {
    let rawEl = getControlEl('reqPlantillaObjetivosRaw');
    if (!rawEl) return;
    let draft = Array.isArray(state.plantillaObjetivosDraft)
      ? state.plantillaObjetivosDraft
      : [];
    rawEl.value = draft
      .map(function (it) {
        return String(it.subtipo || '').trim() + ':' + String(Number(it.objetivo || 0));
      })
      .join('\n');
  }

  function setPlantillaObjetivosDraft(items) {
    let source = Array.isArray(items) ? items : [];
    state.plantillaObjetivosDraft = source
      .map(function (it, idx) {
        let subtipo = String((it && it.subtipo) || '').trim();
        let objetivo = Number((it && it.objetivo) || 0);
        if (!subtipo || !Number.isFinite(objetivo) || objetivo <= 0) return null;
        return {
          subtipo: subtipo,
          objetivo: Math.floor(objetivo),
          orden: idx,
        };
      })
      .filter(Boolean);
    state.plantillaObjetivoEditingIndex = -1;
    syncPlantillaObjetivosRawFromDraft();
    renderPlantillaObjetivosList();
  }

  function clearPlantillaObjetivoInputs() {
    let subtipoEl = getControlEl('reqPlantillaSubtipo');
    let objetivoEl = getControlEl('reqPlantillaObjetivoSubtipo');
    if (subtipoEl) subtipoEl.value = '';
    if (objetivoEl) objetivoEl.value = '';
    state.plantillaObjetivoEditingIndex = -1;
    let hintEl = document.getElementById('reqPlantillaObjetivoHint');
    if (hintEl) hintEl.textContent = 'Seleccione un subtipo de la lista para editar.';
    renderPlantillaObjetivosList();
  }

  function selectPlantillaObjetivoAt(index) {
    let idx = Number(index);
    let draft = Array.isArray(state.plantillaObjetivosDraft)
      ? state.plantillaObjetivosDraft
      : [];
    if (!Number.isInteger(idx) || idx < 0 || idx >= draft.length) return;
    let item = draft[idx];
    let subtipoEl = getControlEl('reqPlantillaSubtipo');
    let objetivoEl = getControlEl('reqPlantillaObjetivoSubtipo');
    if (subtipoEl) subtipoEl.value = String(item.subtipo || '');
    if (objetivoEl) objetivoEl.value = String(Number(item.objetivo || 1));
    state.plantillaObjetivoEditingIndex = idx;
    let hintEl = document.getElementById('reqPlantillaObjetivoHint');
    if (hintEl) hintEl.textContent = 'Editando: ' + String(item.subtipo || '');
    renderPlantillaObjetivosList();
  }

  function removePlantillaObjetivoAt(index) {
    let idx = Number(index);
    let draft = Array.isArray(state.plantillaObjetivosDraft)
      ? state.plantillaObjetivosDraft
      : [];
    if (!Number.isInteger(idx) || idx < 0 || idx >= draft.length) return;

    draft.splice(idx, 1);
    state.plantillaObjetivosDraft = draft.map(function (it, i) {
      return {
        subtipo: it.subtipo,
        objetivo: it.objetivo,
        orden: i,
      };
    });

    if (state.plantillaObjetivoEditingIndex === idx) {
      clearPlantillaObjetivoInputs();
      return;
    }
    if (state.plantillaObjetivoEditingIndex > idx) {
      state.plantillaObjetivoEditingIndex -= 1;
    }

    syncPlantillaObjetivosRawFromDraft();
    renderPlantillaObjetivosList();
  }

  function renderPlantillaObjetivosList() {
    let listEl = document.getElementById('reqPlantillaObjetivosList');
    let emptyEl = document.getElementById('reqPlantillaObjetivosEmpty');
    if (!listEl) return;

    let draft = Array.isArray(state.plantillaObjetivosDraft)
      ? state.plantillaObjetivosDraft
      : [];

    if (!draft.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('d-none');
      return;
    }

    if (emptyEl) emptyEl.classList.add('d-none');
    listEl.innerHTML = draft
      .map(function (it, idx) {
        let active = idx === state.plantillaObjetivoEditingIndex;
        return (
          '<button type="button" class="list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-2 py-2 ' +
          (active ? 'active' : '') +
          '" data-req-obj-index="' +
          esc(String(idx)) +
          '">' +
          '<span class="small text-truncate"><strong>' +
          esc(String(it.subtipo || '')) +
          '</strong> · objetivo ' +
          esc(String(it.objetivo || 0)) +
          '</span>' +
          '<span class="d-inline-flex align-items-center gap-1" role="group" aria-label="acciones subtipo">' +
          '<i class="bi bi-pencil-square"></i>' +
          '<i class="bi bi-trash text-danger" data-req-obj-delete="' +
          esc(String(idx)) +
          '" title="Eliminar"></i>' +
          '</span>' +
          '</button>'
        );
      })
      .join('');
  }

  function upsertPlantillaObjetivoFromInputs() {
    let subtipo = String(getValue('reqPlantillaSubtipo', '') || '').trim();
    let objetivo = Number(getValue('reqPlantillaObjetivoSubtipo', '0') || 0);
    if (!subtipo) {
      throw new Error('Indique el subtipo.');
    }
    if (!Number.isFinite(objetivo) || objetivo <= 0) {
      throw new Error('El objetivo por subtipo debe ser mayor que 0.');
    }

    let draft = Array.isArray(state.plantillaObjetivosDraft)
      ? state.plantillaObjetivosDraft.slice()
      : [];
    let normalized = subtipo.toLowerCase();
    let existingIdx = draft.findIndex(function (it) {
      return String(it.subtipo || '').trim().toLowerCase() === normalized;
    });

    if (state.plantillaObjetivoEditingIndex >= 0) {
      let editingItem = draft[state.plantillaObjetivoEditingIndex] || null;
      let editingNorm = editingItem
        ? String(editingItem.subtipo || '').trim().toLowerCase()
        : '';

      // Solo forzamos actualización por índice cuando seguimos editando
      // el mismo subtipo; si cambió el subtipo, se inserta/actualiza por clave.
      if (editingNorm && editingNorm === normalized) {
        existingIdx = state.plantillaObjetivoEditingIndex;
      }
    }

    if (existingIdx >= 0) {
      draft[existingIdx] = {
        subtipo: subtipo,
        objetivo: Math.floor(objetivo),
        orden: existingIdx,
      };
      state.plantillaObjetivoEditingIndex = existingIdx;
    } else {
      draft.push({
        subtipo: subtipo,
        objetivo: Math.floor(objetivo),
        orden: draft.length,
      });
      state.plantillaObjetivoEditingIndex = draft.length - 1;
    }

    state.plantillaObjetivosDraft = draft.map(function (it, idx) {
      return {
        subtipo: it.subtipo,
        objetivo: it.objetivo,
        orden: idx,
      };
    });
    syncPlantillaObjetivosRawFromDraft();
    renderPlantillaObjetivosList();
    selectPlantillaObjetivoAt(state.plantillaObjetivoEditingIndex);
  }

  function parseObjetivosRaw() {
    let fromDraft = Array.isArray(state.plantillaObjetivosDraft)
      ? state.plantillaObjetivosDraft
          .map(function (it, idx) {
            let subtipo = String((it && it.subtipo) || '').trim();
            let objetivo = Number((it && it.objetivo) || 0);
            if (!subtipo || !Number.isFinite(objetivo) || objetivo <= 0) return null;
            return { subtipo: subtipo, objetivo: Math.floor(objetivo), orden: idx };
          })
          .filter(Boolean)
      : [];
    if (fromDraft.length) return fromDraft;

    let raw = getValue('reqPlantillaObjetivosRaw', '');
    let parsed = parseObjetivosLines(raw);
    if (parsed.length) return parsed;
    return [];
  }

  function buildEjecucionSubobjetivosTable() {
    let body = document.getElementById('reqEjecSubobjetivosBody');
    if (!body) return;

    let rows = Array.isArray(state.selectedRows) ? state.selectedRows : [];
    if (!rows.length) rows = state.selectedRow ? [state.selectedRow] : [];

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-2">Seleccione al menos un período.</td></tr>';
      return;
    }

    // En multi-selección usamos solo subtipos comunes para evitar errores de registro,
    // y mostramos cantidades base por prueba (sin sumar entre agentes/períodos).
    let rowMaps = rows.map(function (row) {
      let m = new Map();
      let items = Array.isArray(row.subtipos_estado) ? row.subtipos_estado : [];
      items.forEach(function (it) {
        let subtipo = String((it && it.subtipo) || '').trim();
        if (!subtipo) return;
        m.set(subtipo, {
          subtipo: subtipo,
          objetivo: Number((it && it.objetivo) || 0),
          completado: Number((it && it.completado) || 0),
        });
      });
      return m;
    });

    let commonSubtipos = Array.from(rowMaps[0].keys());
    for (let i = 1; i < rowMaps.length; i += 1) {
      let current = rowMaps[i];
      commonSubtipos = commonSubtipos.filter(function (subtipo) {
        return current.has(subtipo);
      });
    }

    let data = commonSubtipos
      .map(function (subtipo) {
        return rowMaps[0].get(subtipo);
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return String(a.subtipo).localeCompare(String(b.subtipo), 'es');
      });

    if (!data.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-2">No hay subobjetivos comunes entre la selección.</td></tr>';
      return;
    }

    body.innerHTML = data.map(function (it) {
      let pendiente = Math.max(0, Number(it.objetivo) - Number(it.completado));
      return (
        '<tr data-subtipo="' + esc(it.subtipo) + '">' +
          '<td><span class="fw-semibold">' + esc(it.subtipo) + '</span></td>' +
          '<td class="text-end">' + esc(String(it.objetivo)) + '</td>' +
          '<td class="text-end">' + esc(String(it.completado)) + '</td>' +
          '<td class="text-end">' + esc(String(pendiente)) + '</td>' +
          '<td>' +
            '<input class="form-control form-control-sm req-ejec-cantidad" type="number" min="0" max="' + esc(String(pendiente)) + '" step="1" value="0" data-max="' + esc(String(pendiente)) + '" data-subtipo="' + esc(it.subtipo) + '" ' + (pendiente <= 0 ? 'disabled' : '') + '>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function setAsignarSelCount() {
    let el = document.getElementById('reqAsignarSelCount');
    if (!el) return;
    let selected = state.assignAgentesTable ? state.assignAgentesTable.getSelectedData() : [];
    el.textContent = String(Array.isArray(selected) ? selected.length : 0);
  }

  function derivePeriodicidadFromRange(inicioIso, finIso) {
    let DateTime = window.luxon && window.luxon.DateTime;
    if (!DateTime) return { periodicidad: 'anual', dias: 365 };

    let inicio = DateTime.fromISO(String(inicioIso || ''), { zone: 'utc' }).startOf('day');
    let fin = DateTime.fromISO(String(finIso || ''), { zone: 'utc' }).startOf('day');
    if (!inicio.isValid || !fin.isValid || fin < inicio) {
      return { periodicidad: 'anual', dias: 365 };
    }

    let dias = Math.floor(fin.diff(inicio, 'days').days) + 1;
    let isAnnual = inicio.hasSame(fin, 'year') && inicio.ordinal === 1 && fin.ordinal === fin.daysInYear;
    let isMonthly = inicio.hasSame(fin, 'year') && inicio.hasSame(fin, 'month') && inicio.day === 1 && fin.day === fin.daysInMonth;
    let isFirstHalf = inicio.hasSame(fin, 'year') && inicio.month === 1 && inicio.day === 1 && fin.month === 6 && fin.day === 30;
    let isSecondHalf = inicio.hasSame(fin, 'year') && inicio.month === 7 && inicio.day === 1 && fin.month === 12 && fin.day === 31;

    if (isAnnual) return { periodicidad: 'anual', dias: dias };
    if (isMonthly) return { periodicidad: 'mensual', dias: dias };
    if (isFirstHalf || isSecondHalf) return { periodicidad: 'semestral', dias: dias };

    if (dias <= 31) return { periodicidad: 'mensual', dias: dias };
    if (dias <= 184) return { periodicidad: 'semestral', dias: dias };
    return { periodicidad: 'anual', dias: dias };
  }

  function syncPlantillaPeriodoCalculado() {
    let inicioEl = getControlEl('reqPlantillaPeriodoInicio');
    let finEl = getControlEl('reqPlantillaPeriodoFin');
    let periodicidadEl = getControlEl('reqPlantillaPeriodicidad');
    let diasEl = getControlEl('reqPlantillaPlazoDias');
    if (!periodicidadEl || !diasEl) return;

    let inicio = inicioEl ? String(inicioEl.value || '') : '';
    let fin = finEl ? String(finEl.value || '') : '';
    let info = derivePeriodicidadFromRange(inicio, fin);
    periodicidadEl.value = String(info.periodicidad || 'anual');
    diasEl.value = Number.isFinite(info.dias) && info.dias > 0 ? String(info.dias) : '365';
  }

  function ensureAssignAgentesTable() {
    if (state.assignAgentesTable && state.assignAgentesTable.element && document.documentElement.contains(state.assignAgentesTable.element)) {
      return state.assignAgentesTable;
    }

    // @ts-ignore
    state.assignAgentesTable = new Tabulator('#tabulatorReqAsignarAgentes', {
      locale: 'es-es',
      langs: TABULATOR_LANGS,
      layout: 'fitColumns',
      reactiveData: false,
      selectableRows: true,
      rowHeight: 20,
      placeholder: 'Sin agentes disponibles',
      columnDefaults: { headerSort: true, resizable: true, headerFilterPlaceholder: 'Filtrar...' },
      columns: [
        { formatter: 'rowSelection', titleFormatter: 'rowSelection', titleFormatterParams: { rowRange: 'active' }, width: 40, headerSort: false, hozAlign: 'center' },
        { title: 'TIP', field: 'tip', width: 110, headerFilter: 'input' },
        {
          title: 'Nombre',
          field: 'nombre',
          minWidth: 220,
          headerFilter: 'input',
          formatter: function (cell) {
            let row = cell.getRow().getData();
            return esc([row.nombre, row.apellido_1, row.apellido_2].filter(Boolean).join(' '));
          },
        },
        { title: 'Empleo', field: 'empleo_nombre', minWidth: 140, headerFilter: 'input', formatter: empleoBadgeFormatter },
        { title: 'Pelotón', field: 'peloton_nombre', minWidth: 130, headerFilter: 'input', formatter: pelotonBadgeFormatter },
        { title: 'Escalafón', field: 'escalafon', width: 110, headerFilter: 'input', visible: false },
      ],
      data: state.meta.agentes || [],
      initialSort: [{ column: 'escalafon', dir: 'asc' }],
    });

    state.assignAgentesTable.on('rowSelectionChanged', function () {
      setAsignarSelCount();
    });

    return state.assignAgentesTable;
  }

  function plantillaObjetivosToRaw(plantilla) {
    let objetivos = Array.isArray(plantilla && plantilla.objetivos) ? plantilla.objetivos : [];
    if (!objetivos.length) return '';
    return objetivos
      .map(function (it) {
        return String(it.subtipo || '').trim() + ':' + String(Number(it.objetivo || 0));
      })
      .join('\n');
  }

  function fillPlantillaForm(plantilla) {
    let idEl = getControlEl('reqPlantillaId');
    let titleEl = document.querySelector('#reqPlantillaModal .modal-title');
    if (idEl) idEl.value = String(plantilla && plantilla.id ? plantilla.id : '');
    state.plantillaEditingId = Number((plantilla && plantilla.id) || 0);
    if (titleEl) titleEl.textContent = state.plantillaEditingId > 0 ? 'Editar plantilla de requisito' : 'Nueva plantilla de requisito';

    let nombreEl = getControlEl('reqPlantillaNombre');
    let periodicidadEl = getControlEl('reqPlantillaPeriodicidad');
    let totalEl = getControlEl('reqPlantillaObjetivoTotal');
    let plazoEl = getControlEl('reqPlantillaPlazoDias');
    let tipoEl = getControlEl('reqPlantillaTipo');
    let rawEl = getControlEl('reqPlantillaObjetivosRaw');
    let descEl = getControlEl('reqPlantillaDescripcion');
    let inicioEl = getControlEl('reqPlantillaPeriodoInicio');
    let finEl = getControlEl('reqPlantillaPeriodoFin');

    if (nombreEl) nombreEl.value = String((plantilla && plantilla.nombre) || '');
    if (periodicidadEl) periodicidadEl.value = String((plantilla && plantilla.periodicidad) || 'anual');
    if (totalEl) totalEl.value = String(Number((plantilla && plantilla.objetivo_total) || 1));
    if (plazoEl) {
      let plazoValue = Number((plantilla && plantilla.plazo_dias) || 0);
      plazoEl.value = plazoValue > 0 ? String(plazoValue) : '';
    }
    if (inicioEl) inicioEl.value = String((plantilla && plantilla.fecha_inicio_manual) || '');
    if (finEl) finEl.value = String((plantilla && plantilla.fecha_fin_manual) || '');
    if (tipoEl) tipoEl.value = String((plantilla && plantilla.tipo_requisito) || '');
    if (rawEl) rawEl.value = plantillaObjetivosToRaw(plantilla);
    if (descEl) descEl.value = String((plantilla && plantilla.descripcion) || '');

    setPlantillaObjetivosDraft(
      Array.isArray(plantilla && plantilla.objetivos) && plantilla.objetivos.length
        ? plantilla.objetivos
        : parseObjetivosLines(rawEl ? rawEl.value : '')
    );
    clearPlantillaObjetivoInputs();

    if (!plantilla && inicioEl && finEl) {
      let dt = window.luxon && window.luxon.DateTime;
      if (dt) {
        let now = dt.now();
        inicioEl.value = now.startOf('year').toISODate();
        finEl.value = now.endOf('year').toISODate();
      }
    }
    syncPlantillaPeriodoCalculado();
  }

  async function loadPlantillasCrud() {
    let res = await fetch('/api/agentes/requisitos/plantillas?include_inactive=1', { headers: getHeaders(false), cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar el CRUD de plantillas.');
    let json = await res.json();
    state.plantillasCrudRows = Array.isArray(json.plantillas) ? json.plantillas : [];
    if (state.plantillasTable) state.plantillasTable.replaceData(state.plantillasCrudRows);
  }

  function ensurePlantillasTable() {
    if (state.plantillasTable && state.plantillasTable.element && document.documentElement.contains(state.plantillasTable.element)) {
      return state.plantillasTable;
    }

    // @ts-ignore
    state.plantillasTable = new Tabulator('#tabulatorReqPlantillas', {
      locale: 'es-es',
      langs: TABULATOR_LANGS,
      layout: 'fitColumns',
      reactiveData: false,
      selectableRows: 1,
      rowHeight: 24,
      placeholder: 'Sin plantillas',
      columnDefaults: { headerSort: true, resizable: true },
      columns: [
        { formatter: 'rowSelection', titleFormatter: 'rowSelection', width: 40, headerSort: false, hozAlign: 'center' },
        { title: 'Nombre', field: 'nombre', minWidth: 170 },
        { title: 'Tipo', field: 'tipo_requisito', minWidth: 90 },
        { title: 'Periodo inicio', field: 'fecha_inicio_manual', minWidth: 110, formatter: function (cell) { return esc(formatIsoDateEs(cell.getValue())); } },
        { title: 'Periodo fin', field: 'fecha_fin_manual', minWidth: 110, formatter: function (cell) { return esc(formatIsoDateEs(cell.getValue())); } },
        { title: 'Periodicidad', field: 'periodicidad', width: 100 },
        { title: 'Objetivo total', field: 'objetivo_total', width: 100, hozAlign: 'right' },
        { title: 'Días', field: 'plazo_dias', width: 90, hozAlign: 'right' },
        {
          title: 'Activo',
          field: 'activo',
          width: 85,
          hozAlign: 'center',
          formatter: function (cell) {
            return cell.getValue()
              ? window.GRS1Utils.renderSemanticBadgeHtml('Sí', 'success', {
                  escapeHtmlFn: esc,
                })
              : window.GRS1Utils.renderSemanticBadgeHtml('No', 'secondary', {
                  escapeHtmlFn: esc,
                });
          },
        },
      ],
      data: state.plantillasCrudRows || [],
    });

    let crudModalEl = document.getElementById('reqPlantillasCrudModal');
    if (crudModalEl && !crudModalEl.dataset.tableBound) {
      crudModalEl.dataset.tableBound = '1';
      crudModalEl.addEventListener('shown.bs.modal', function () {
        if (!state.plantillasTable) return;
        state.plantillasTable.redraw(true);
      });
    }

    return state.plantillasTable;
  }

  function openPlantillaModal(options) {
    let opts = options || {};
    state.reopenCrudAfterPlantilla = !!opts.fromCrud;
    let plantillaModalEl = document.getElementById('reqPlantillaModal');
    let crudModalEl = document.getElementById('reqPlantillasCrudModal');
    if (!plantillaModalEl) return;

    let showPlantilla = function () {
      bootstrap.Modal.getOrCreateInstance(plantillaModalEl).show();
    };

    if (state.reopenCrudAfterPlantilla && crudModalEl && crudModalEl.classList.contains('show')) {
      crudModalEl.addEventListener('hidden.bs.modal', function onHidden() {
        crudModalEl.removeEventListener('hidden.bs.modal', onHidden);
        showPlantilla();
      });
      bootstrap.Modal.getOrCreateInstance(crudModalEl).hide();
      return;
    }

    showPlantilla();
  }

  function getSelectedPlantillaCrud() {
    if (!state.plantillasTable) return null;
    let data = state.plantillasTable.getSelectedData();
    return Array.isArray(data) && data.length ? data[0] : null;
  }

  async function loadMeta() {
    let res = await fetch('/api/agentes/requisitos/meta', { headers: getHeaders(false), cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar metadatos de requisitos.');
    let json = await res.json();
    state.meta.empleos = Array.isArray(json.empleos) ? json.empleos : [];
    state.meta.pelotones = Array.isArray(json.pelotones) ? json.pelotones : [];
    state.meta.agentes = enrichAgentesWithMetaColors(
      Array.isArray(json.agentes) ? json.agentes : [],
      state.meta.empleos,
      state.meta.pelotones
    );
    state.meta.plantillas = Array.isArray(json.plantillas) ? json.plantillas : [];

    let plantillaSel = document.getElementById('reqAsignarPlantilla');
    if (plantillaSel) {
      plantillaSel.innerHTML = state.meta.plantillas.map(function (p) {
        return '<option value="' + esc(String(p.id)) + '">' + esc(String(p.nombre)) + '</option>';
      }).join('');
    }

    if (state.assignAgentesTable) {
      state.assignAgentesTable.replaceData(state.meta.agentes || []);
      state.assignAgentesTable.deselectRow();
      setAsignarSelCount();
    }
  }

  async function loadRows() {
    let query = new URLSearchParams();
    let fechaServicio = String(state.servicioFecha || '').trim();
    if (fechaServicio) {
      query.set('fecha_servicio', fechaServicio);
    }
    let url = '/api/agentes/requisitos' + (query.toString() ? ('?' + query.toString()) : '');
    let res = await fetch(url, { headers: getHeaders(false), cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar requisitos periódicos.');
    let json = await res.json();
    state.rows = Array.isArray(json.requisitos) ? json.requisitos : [];
    if (state.table) {
      state.table.replaceData(state.rows);
      applyEstadoQuickFilter();
    }
    refreshCounters();
  }

  function ensureTable() {
    if (state.table && state.table.element && document.documentElement.contains(state.table.element)) {
      return state.table;
    }

    // @ts-ignore
    state.table = new Tabulator('#tabulatorAgentesRequisitos', {
      locale: 'es-es',
      langs: TABULATOR_LANGS,
      height: 'calc(100vh - 330px)',
      layout: 'fitData',
      reactiveData: false,
      selectableRows: true,
      selectableRowsCheck: function (row) {
        let data = row && typeof row.getData === 'function' ? row.getData() : null;
        return isSelectableByPlantilla(data);
      },
      rowHeight: 24,
      placeholder: 'Sin requisitos periódicos',
      columnDefaults: { headerSort: true, resizable: true, headerFilterPlaceholder: 'Filtrar...' },
      columns: buildColumns(),
      data: state.rows,
      initialSort: [{ column: 'escalafon', dir: 'asc' }],
      rowFormatter: function (row) {
        let el = row && typeof row.getElement === 'function' ? row.getElement() : null;
        let data = row && typeof row.getData === 'function' ? row.getData() : null;
        if (!el) return;
        let blocked = !isSelectableByPlantilla(data);
        el.style.opacity = blocked ? '0.55' : '';
      },
    });

    state.table.on('rowSelectionChanged', function (data) {
      let selected = Array.isArray(data) ? data : [];
      if (selected.length > 1) {
        let firstKey = getPlantillaKey(selected[0]);
        let mixed = selected.filter(function (row) {
          return getPlantillaKey(row) !== firstKey;
        });
        if (mixed.length && state.table) {
          let mixedIds = mixed
            .map(function (row) { return Number(row.id || 0); })
            .filter(function (id) { return id > 0; });
          if (mixedIds.length) state.table.deselectRow(mixedIds);
          selected = selected.filter(function (row) {
            return getPlantillaKey(row) === firstKey;
          });
          setAlert('Selección bloqueada a una sola plantilla. Limpie la selección para cambiar de plantilla.', 'warning');
        }
      }

      let first = selected.length ? selected[0] : null;
      state.selectedRows = selected;
      state.selectedPeriodoIds = selected.map(function (row) { return Number(row.id || 0); }).filter(function (id) { return id > 0; });
      state.selectedRow = first || null;
      state.selectedPeriodoId = first ? Number(first.id || 0) : 0;
      state.selectedPlantillaKey = first ? getPlantillaKey(first) : '';
      buildEjecucionSubobjetivosTable();
      refreshSelectedActions();
      refreshMainSelCount();
      if (state.table) state.table.redraw(true);
    });

    return state.table;
  }

  async function crearPlantilla() {
    let objetivoTotal = Number(getValue('reqPlantillaObjetivoTotal', '0') || 0);
    let plazoDiasRaw = Number(getValue('reqPlantillaPlazoDias', '0') || 0);
    let periodoInicioManual = getValue('reqPlantillaPeriodoInicio', '');
    let periodoFinManual = getValue('reqPlantillaPeriodoFin', '');
    let objetivos = parseObjetivosRaw();
    if (!Array.isArray(objetivos) || !objetivos.length) {
      throw new Error('Agregue al menos un subtipo con su objetivo.');
    }
    let payload = {
      nombre: getValue('reqPlantillaNombre', ''),
      descripcion: getValue('reqPlantillaDescripcion', ''),
      periodicidad: getValue('reqPlantillaPeriodicidad', 'anual'),
      tipo_requisito: getValue('reqPlantillaTipo', ''),
      objetivo_total: objetivoTotal,
      requiere_aprobacion: false,
      plazo_dias: plazoDiasRaw > 0 ? plazoDiasRaw : null,
      fecha_inicio_manual: periodoInicioManual || null,
      fecha_fin_manual: periodoFinManual || null,
      activo: true,
      objetivos: objetivos,
    };

    let plantillaId = Number(getValue('reqPlantillaId', '0') || 0);
    let isEdit = plantillaId > 0;

    let res = await fetch(isEdit ? ('/api/agentes/requisitos/plantillas/' + encodeURIComponent(String(plantillaId))) : '/api/agentes/requisitos/plantillas', {
      method: isEdit ? 'PUT' : 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(payload),
    });
    let json = await res.json().catch(function () { return {}; });
    if (!res.ok || !json.ok) {
      throw new Error((json && (json.message || json.error)) || 'No se pudo guardar plantilla.');
    }

    bootstrap.Modal.getInstance(document.getElementById('reqPlantillaModal')).hide();
    setAlert(isEdit ? 'Plantilla actualizada correctamente.' : 'Plantilla creada correctamente.', 'success');
    await loadMeta();
    await loadPlantillasCrud().catch(function () {});

    if (state.reopenCrudAfterPlantilla) {
      let crudModalEl = document.getElementById('reqPlantillasCrudModal');
      if (crudModalEl) {
        bootstrap.Modal.getOrCreateInstance(crudModalEl).show();
      }
    }
  }

  async function asignarPlantilla() {
    let selected = state.assignAgentesTable ? state.assignAgentesTable.getSelectedData() : [];
    let agenteIds = (Array.isArray(selected) ? selected : []).map(function (row) {
      return Number(row.id || 0);
    }).filter(function (id) { return id > 0; });
    if (!agenteIds.length) {
      throw new Error('Seleccione al menos un agente para asignar la plantilla.');
    }

    let plantillaId = Number(getValue('reqAsignarPlantilla', '0') || 0);
    let fechaRef = getValue('reqAsignarFechaRef', '');

    let res = await fetch('/api/agentes/requisitos/asignaciones', {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({
        plantilla_id: plantillaId,
        agente_ids: agenteIds,
        fecha_referencia: fechaRef,
      }),
    });
    let json = await res.json().catch(function () { return {}; });
    if (!res.ok || !json.ok) {
      throw new Error((json && (json.message || json.error)) || 'No se pudo asignar plantilla.');
    }

    let result = json && json.result ? json.result : {};
    setAlert('Asignación masiva completada. Creados: ' + String(result.created || 0) + ', omitidos: ' + String(result.skipped || 0) + '.', 'success');
    if (state.assignAgentesTable) {
      state.assignAgentesTable.deselectRow();
      setAsignarSelCount();
    }
    await loadRows();
  }

  async function registrarEjecucion() {
    let periodoIds = Array.isArray(state.selectedPeriodoIds) ? state.selectedPeriodoIds : [];
    if (!periodoIds.length) {
      throw new Error('Seleccione al menos un período en la tabla.');
    }

    let inputs = Array.from(document.querySelectorAll('#reqEjecSubobjetivosBody .req-ejec-cantidad'));
    let items = [];
    for (let i = 0; i < inputs.length; i += 1) {
      let input = inputs[i];
      let ctrl = input instanceof HTMLInputElement ? input : null;
      let qty = Number(ctrl ? ctrl.value : 0);
      let subtipo = String(ctrl ? ctrl.getAttribute('data-subtipo') : '').trim();
      let maxQty = Number(ctrl ? ctrl.getAttribute('data-max') : 0);
      let cantidad = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0;

      if (!subtipo || cantidad <= 0) continue;

      if (!Number.isFinite(maxQty) || maxQty < 0) {
        throw new Error('No se pudo validar el máximo permitido para el subtipo ' + subtipo + '.');
      }
      if (cantidad > maxQty) {
        throw new Error(
          'La cantidad para el subtipo ' + subtipo +
            ' no puede superar el pendiente (' + String(maxQty) + ').'
        );
      }

      items.push({ subtipo: subtipo, cantidad: cantidad });
    }

    if (!items.length) {
      throw new Error('Indique cantidad mayor que 0 en al menos un subobjetivo.');
    }

    let res = await fetch('/api/agentes/requisitos/ejecuciones/multi', {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({
        periodo_ids: periodoIds,
        items: items,
        fecha_prueba: getValue('reqEjecFecha', '') || null,
        resultado: getValue('reqEjecResultado', 'aprobado'),
        observaciones: getValue('reqEjecObservaciones', ''),
      }),
    });
    let json = await res.json().catch(function () { return {}; });
    if (!res.ok || !json.ok) {
      throw new Error((json && (json.message || json.error)) || 'No se pudo registrar pruebas.');
    }

    let result = json && json.result ? json.result : {};
    let createdCount = Number(result.created || 0);
    let skippedCount = Number(result.skipped || 0);
    let errors = Array.isArray(result.errors) ? result.errors : [];

    if (createdCount < 1) {
      let firstError = errors.length ? String((errors[0] && errors[0].error) || '').trim() : '';
      let details = firstError ? ('. Detalle: ' + firstError) : '';
      throw new Error('No se registró ninguna prueba en el lote' + details);
    }

    bootstrap.Modal.getInstance(document.getElementById('reqEjecucionModal')).hide();
    setAlert(
      'Registro masivo completado. Creados: ' + String(createdCount) + ', omitidos: ' + String(skippedCount) + '.',
      createdCount > 0 ? 'success' : 'warning'
    );

    state.selectedRows = [];
    state.selectedRow = null;
    state.selectedPeriodoId = 0;
    state.selectedPeriodoIds = [];
    state.selectedPlantillaKey = '';
    if (state.table) state.table.deselectRow();
    refreshSelectedActions();
    refreshMainSelCount();
    buildEjecucionSubobjetivosTable();

    await loadRows();
    if (state.table) state.table.redraw(true);
  }

  async function sancionarPeriodo() {
    if (!state.selectedPeriodoId) {
      throw new Error('Seleccione un período en la tabla.');
    }

    let notas = getValue('reqSancionNotas', '');
    let res = await fetch('/api/agentes/requisitos/sanciones', {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify({
        periodo_id: state.selectedPeriodoId,
        sancion_notas: notas,
      }),
    });
    let json = await res.json().catch(function () { return {}; });
    if (!res.ok || !json.ok) {
      throw new Error((json && (json.message || json.error)) || 'No se pudo registrar sanción.');
    }

    bootstrap.Modal.getInstance(document.getElementById('reqSancionModal')).hide();
    setAlert('Sanción registrada correctamente.', 'success');
    await loadRows();
  }

  function bindEvents() {
    let dt = window.luxon && window.luxon.DateTime;
    let todayIso = dt ? dt.now().toISODate() : '';
    let fechaRef = getControlEl('reqAsignarFechaRef');
    let fechaPrueba = getControlEl('reqEjecFecha');
    let fechaServicio = getControlEl('reqServicioFecha');
    let btnToggleLeft = document.getElementById('btnReqToggleLeft');
    if (fechaRef && !fechaRef.value) fechaRef.value = todayIso;
    if (fechaPrueba && !fechaPrueba.value) fechaPrueba.value = todayIso;
    if (fechaServicio && !fechaServicio.value) fechaServicio.value = todayIso;
    state.servicioFecha = fechaServicio ? String(fechaServicio.value || '').trim() : '';

    if (btnToggleLeft && !btnToggleLeft.dataset.bound) {
      btnToggleLeft.dataset.bound = '1';
      btnToggleLeft.addEventListener('click', function () {
        toggleLeftPanel();
      });
    }

    if (fechaServicio && !fechaServicio.dataset.bound) {
      fechaServicio.dataset.bound = '1';
      fechaServicio.addEventListener('change', function () {
        state.servicioFecha = String(fechaServicio.value || '').trim();
        loadRows().catch(function (error) {
          setAlert(error.message || 'No se pudo recargar servicios por fecha.', 'danger');
        });
      });
    }

    let periodoInicioEl = getControlEl('reqPlantillaPeriodoInicio');
    let periodoFinEl = getControlEl('reqPlantillaPeriodoFin');
    if (periodoInicioEl && !periodoInicioEl.dataset.bound) {
      periodoInicioEl.dataset.bound = '1';
      periodoInicioEl.addEventListener('change', syncPlantillaPeriodoCalculado);
    }
    if (periodoFinEl && !periodoFinEl.dataset.bound) {
      periodoFinEl.dataset.bound = '1';
      periodoFinEl.addEventListener('change', syncPlantillaPeriodoCalculado);
    }

    let btnNuevaPlantilla = document.getElementById('btnReqNuevaPlantilla');
    if (btnNuevaPlantilla && !btnNuevaPlantilla.dataset.bound) {
      btnNuevaPlantilla.dataset.bound = '1';
      btnNuevaPlantilla.addEventListener('click', function () {
        fillPlantillaForm(null);
        openPlantillaModal({ fromCrud: false });
      });
    }

    let btnCrudPlantillas = document.getElementById('btnReqPlantillasCrud');
    if (btnCrudPlantillas && !btnCrudPlantillas.dataset.bound) {
      btnCrudPlantillas.dataset.bound = '1';
      btnCrudPlantillas.addEventListener('click', function () {
        ensurePlantillasTable();
        loadPlantillasCrud().catch(function (error) {
          setAlert(error.message || 'No se pudo cargar plantillas.', 'danger');
        });
        bootstrap.Modal.getOrCreateInstance(document.getElementById('reqPlantillasCrudModal')).show();
      });
    }

    let quickFilter = document.getElementById('reqQuickFilterEstado');
    if (quickFilter && !quickFilter.dataset.bound) {
      quickFilter.dataset.bound = '1';
      quickFilter.addEventListener('click', function (event) {
        let target = event.target;
        if (!(target instanceof Element)) return;
        let item = target.closest('[data-estado]');
        if (!item) return;
        event.preventDefault();

        let estado = String(item.getAttribute('data-estado') || 'todos').toLowerCase();
        state.quickEstado = estado;

        let labelEl = document.getElementById('reqEstadoLabel');
        if (labelEl) {
          labelEl.textContent = estado === 'en_progreso'
            ? 'En progreso'
            : (estado.charAt(0).toUpperCase() + estado.slice(1));
        }

        let items = quickFilter.querySelectorAll('.dropdown-item[data-estado]');
        items.forEach(function (el) {
          if (!(el instanceof HTMLElement)) return;
          el.classList.toggle('active', el === item);
        });

        applyEstadoQuickFilter();
      });
    }

    let btnAsignar = document.getElementById('btnReqAsignar');
    if (btnAsignar && !btnAsignar.dataset.bound) {
      btnAsignar.dataset.bound = '1';
      btnAsignar.addEventListener('click', function () {
        asignarPlantilla().catch(function (error) {
          setAlert(error.message || 'No se pudo asignar plantilla.', 'danger');
        });
      });
    }

    let btnAsignarAplicar = document.getElementById('btnReqAsignarAplicar');
    if (btnAsignarAplicar && !btnAsignarAplicar.dataset.bound) {
      btnAsignarAplicar.dataset.bound = '1';
      btnAsignarAplicar.addEventListener('click', function () {
        asignarPlantilla().catch(function (error) {
          setAlert(error.message || 'No se pudo asignar plantilla.', 'danger');
        });
      });
    }

    let btnRegistrar = document.getElementById('btnReqRegistrar');
    if (btnRegistrar && !btnRegistrar.dataset.bound) {
      btnRegistrar.dataset.bound = '1';
      btnRegistrar.addEventListener('click', function () {
        buildEjecucionSubobjetivosTable();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('reqEjecucionModal')).show();
      });
    }

    let btnPresetTiro = document.getElementById('btnReqPresetTiro');
    if (btnPresetTiro && !btnPresetTiro.dataset.bound) {
      btnPresetTiro.dataset.bound = '1';
      btnPresetTiro.addEventListener('click', function () {
        let nombreEl = getControlEl('reqPlantillaNombre');
        let tipoEl = getControlEl('reqPlantillaTipo');
        let totalEl = getControlEl('reqPlantillaObjetivoTotal');
        let plazoEl = getControlEl('reqPlantillaPlazoDias');
        let periodicidadEl = getControlEl('reqPlantillaPeriodicidad');
        let rawEl = getControlEl('reqPlantillaObjetivosRaw');
        let descEl = getControlEl('reqPlantillaDescripcion');

        if (nombreEl) nombreEl.value = 'Tiro anual obligatorio';
        if (tipoEl) tipoEl.value = 'tiro';
        if (totalEl) totalEl.value = '6';
        let dt = window.luxon && window.luxon.DateTime;
        let inicioEl = getControlEl('reqPlantillaPeriodoInicio');
        let finEl = getControlEl('reqPlantillaPeriodoFin');
        if (dt && inicioEl && finEl) {
          let now = dt.now();
          inicioEl.value = now.startOf('year').toISODate();
          finEl.value = now.endOf('year').toISODate();
          syncPlantillaPeriodoCalculado();
        } else {
          if (plazoEl) plazoEl.value = '365';
          if (periodicidadEl) periodicidadEl.value = 'anual';
        }
        if (rawEl) rawEl.value = 'arma_corta:4\narma_larga:2';
        setPlantillaObjetivosDraft([
          { subtipo: 'arma_corta', objetivo: 4, orden: 0 },
          { subtipo: 'arma_larga', objetivo: 2, orden: 1 },
        ]);
        clearPlantillaObjetivoInputs();
        if (descEl && !String(descEl.value || '').trim()) {
          descEl.value = 'Ejemplo: 6 actividades de tiro por año (4 arma corta y 2 arma larga).';
        }
      });
    }

    let btnObjetivoAdd = document.getElementById('btnReqPlantillaObjetivoAdd');
    if (btnObjetivoAdd && !btnObjetivoAdd.dataset.bound) {
      btnObjetivoAdd.dataset.bound = '1';
      btnObjetivoAdd.addEventListener('click', function () {
        try {
          upsertPlantillaObjetivoFromInputs();
          setAlert('Subtipo agregado/actualizado en la lista.', 'success');
        } catch (error) {
          setAlert(error && error.message ? error.message : 'No se pudo agregar subtipo.', 'danger');
        }
      });
    }

    let btnObjetivoClear = document.getElementById('btnReqPlantillaObjetivoClear');
    if (btnObjetivoClear && !btnObjetivoClear.dataset.bound) {
      btnObjetivoClear.dataset.bound = '1';
      btnObjetivoClear.addEventListener('click', function () {
        clearPlantillaObjetivoInputs();
      });
    }

    let objetivosListEl = document.getElementById('reqPlantillaObjetivosList');
    if (objetivosListEl && !objetivosListEl.dataset.bound) {
      objetivosListEl.dataset.bound = '1';
      objetivosListEl.addEventListener('click', function (event) {
        let target = event.target;
        if (!(target instanceof Element)) return;

        let deleteEl = target.closest('[data-req-obj-delete]');
        if (deleteEl) {
          let idx = Number(deleteEl.getAttribute('data-req-obj-delete'));
          removePlantillaObjetivoAt(idx);
          setAlert('Subtipo eliminado de la lista.', 'warning');
          return;
        }

        let rowEl = target.closest('[data-req-obj-index]');
        if (!rowEl) return;
        let idx = Number(rowEl.getAttribute('data-req-obj-index'));
        selectPlantillaObjetivoAt(idx);
      });
    }

    let btnCrudNueva = document.getElementById('btnReqCrudNueva');
    if (btnCrudNueva && !btnCrudNueva.dataset.bound) {
      btnCrudNueva.dataset.bound = '1';
      btnCrudNueva.addEventListener('click', function () {
        fillPlantillaForm(null);
        openPlantillaModal({ fromCrud: true });
      });
    }

    let btnCrudEditar = document.getElementById('btnReqCrudEditar');
    if (btnCrudEditar && !btnCrudEditar.dataset.bound) {
      btnCrudEditar.dataset.bound = '1';
      btnCrudEditar.addEventListener('click', function () {
        let row = getSelectedPlantillaCrud();
        if (!row) {
          setAlert('Seleccione una plantilla para editar.', 'warning');
          return;
        }
        fillPlantillaForm(row);
        openPlantillaModal({ fromCrud: true });
      });
    }

    let btnCrudEliminar = document.getElementById('btnReqCrudEliminar');
    if (btnCrudEliminar && !btnCrudEliminar.dataset.bound) {
      btnCrudEliminar.dataset.bound = '1';
      btnCrudEliminar.addEventListener('click', function () {
        let row = getSelectedPlantillaCrud();
        if (!row || !row.id) {
          setAlert('Seleccione una plantilla para desactivar.', 'warning');
          return;
        }

        openConfirmDeactivatePlantillaModal(row, function () {
          fetch('/api/agentes/requisitos/plantillas/' + encodeURIComponent(String(row.id)), {
            method: 'DELETE',
            headers: getHeaders(true),
          })
            .then(function (res) {
              return res.json().catch(function () { return {}; }).then(function (json) {
                if (!res.ok || !json.ok) {
                  throw new Error((json && (json.message || json.error)) || 'No se pudo desactivar plantilla.');
                }
                return json;
              });
            })
            .then(function () {
              setAlert('Plantilla desactivada correctamente.', 'success');
              return Promise.all([loadMeta(), loadPlantillasCrud()]);
            })
            .catch(function (error) {
              setAlert(error.message || 'No se pudo desactivar plantilla.', 'danger');
            });
          });
      });
    }

    let btnSancionar = document.getElementById('btnReqSancionar');
    if (btnSancionar && !btnSancionar.dataset.bound) {
      btnSancionar.dataset.bound = '1';
      btnSancionar.addEventListener('click', function () {
        bootstrap.Modal.getOrCreateInstance(document.getElementById('reqSancionModal')).show();
      });
    }

    let btnReload = document.getElementById('btnReqReload');
    if (btnReload && !btnReload.dataset.bound) {
      btnReload.dataset.bound = '1';
      btnReload.addEventListener('click', function () {
        loadRows().catch(function (error) {
          setAlert(error.message || 'No se pudo recargar requisitos periódicos.', 'danger');
        });
      });
    }

    let btnGuardarPlantilla = document.getElementById('btnReqPlantillaGuardar');
    if (btnGuardarPlantilla && !btnGuardarPlantilla.dataset.bound) {
      btnGuardarPlantilla.dataset.bound = '1';
      btnGuardarPlantilla.addEventListener('click', function () {
        crearPlantilla().catch(function (error) {
          setAlert(error.message || 'No se pudo crear plantilla.', 'danger');
        });
      });
    }

    let btnGuardarEjec = document.getElementById('btnReqEjecGuardar');
    if (btnGuardarEjec && !btnGuardarEjec.dataset.bound) {
      btnGuardarEjec.dataset.bound = '1';
      btnGuardarEjec.addEventListener('click', function () {
        registrarEjecucion().catch(function (error) {
          setAlert(error.message || 'No se pudo registrar prueba.', 'danger');
        });
      });
    }

    let btnGuardarSancion = document.getElementById('btnReqSancionGuardar');
    if (btnGuardarSancion && !btnGuardarSancion.dataset.bound) {
      btnGuardarSancion.dataset.bound = '1';
      btnGuardarSancion.addEventListener('click', function () {
        sancionarPeriodo().catch(function (error) {
          setAlert(error.message || 'No se pudo sancionar período.', 'danger');
        });
      });
    }

    let btnExportExcel = document.getElementById('btnReqExportExcel');
    if (btnExportExcel && !btnExportExcel.dataset.bound) {
      btnExportExcel.dataset.bound = '1';
      btnExportExcel.addEventListener('click', function () {
        exportMainTableExcel();
      });
    }
  }

  app.initializeAgentesRequisitosSection = async function initializeAgentesRequisitosSection() {
    bindAvatarFallbackHandler();
    ensureTable();
    ensureAssignAgentesTable();
    ensurePlantillasTable();
    bindEvents();
    applyLeftPanelCollapsed(getSavedLeftPanelCollapsed(), { persist: false, redraw: false });
    await loadMeta();
    await loadPlantillasCrud().catch(function () {});
    await loadRows();
    state.initialized = true;
  };
})();
