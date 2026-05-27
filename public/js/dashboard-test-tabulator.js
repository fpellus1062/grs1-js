(function () {
  var app = window.GRS1Dashboard;
  if (!app) return;

  var CSV_URL = '/data/tabulator-test.csv';

  var AGENTE_EDITABLE_FIELDS = [
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
    'fecha_baja',
  ];

  var state = {
    initialized: false,
    table: null,
    quickFilterEstado: 'todos',
    searchTerm: '',
    agentes: [],
    originalAgentes: [],
    cambiosPendientes: new Map(),
  };

  var TABULATOR_LANGS = {
    'es-es': {
      data: { loading: 'Cargando...', error: 'Error al cargar datos' },
      pagination: {
        page_size: 'Registros por página',
        first: '«',
        first_title: 'Primera',
        last: '»',
        last_title: 'Última',
        prev: '‹',
        prev_title: 'Anterior',
        next: '›',
        next_title: 'Siguiente',
        all: 'Todos',
        counter: {
          showing: 'Mostrando',
          of: 'de',
          rows: 'filas',
          pages: 'páginas',
        },
      },
      headerFilters: { default: 'Filtrar...' },
    },
  };

  function esc(value) {
    return app.escapeHtml(value == null ? '' : value);
  }

  function sameValue(left, right) {
    return (
      String(left == null ? '' : left) === String(right == null ? '' : right)
    );
  }

  function cloneRows(rows) {
    return JSON.parse(JSON.stringify(rows || []));
  }

  function setStatus(message, isError) {
    var el = document.getElementById('testTabulatorEstadoCarga');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('text-danger', !!isError);
  }

  function showAlert(message, type) {
    setAlert(message, type);
    if (!message) return;
    setTimeout(function () {
      setAlert('', 'info');
    }, 5000);
  }

  function setAlert(message, type) {
    var el = document.getElementById('testTabulatorAlert');
    if (!el) return;
    if (!message) {
      el.innerHTML = '';
      return;
    }
    var cls = type || 'info';
    el.innerHTML =
      '<div class="alert alert-' +
      esc(cls) +
      ' py-2 px-3 mb-0" role="alert" style="font-size:.82rem">' +
      esc(message) +
      '</div>';
  }

  function updateCounters() {
    var table = state.table;
    if (!table) return;
    var total = (table.getData() || []).length;
    var filtered = (table.getData('active') || []).length;
    var hidden = total - filtered;
    var totalEl = document.getElementById('testTabulatorTotalRecords');
    var filteredEl = document.getElementById('testTabulatorFilteredRecords');
    var hiddenEl = document.getElementById('testTabulatorHiddenRecords');
    if (totalEl) totalEl.textContent = String(total);
    if (filteredEl) filteredEl.textContent = String(filtered);
    if (hiddenEl) hiddenEl.textContent = String(hidden);
  }

  function syncPendingInfo(dataLength) {
    var el = document.getElementById('testTabulatorPendingCount');
    if (!el) return;
    el.textContent = String(dataLength || 0);
  }

  function syncSelectedAgentesForDetalle() {
    if (!state.table) {
      if (app.globalState) app.globalState.selectedAgenteIdsForBulk = [];
      if (app.agentesState) app.agentesState.selectedAgenteIdsVista = [];
      updateAgenteAsignacionesDetalleButtonStateTest();
      return;
    }

    var ids = state.table
      .getSelectedData()
      .map(function (row) {
        return Number(row.id);
      })
      .filter(function (id) {
        return Number.isFinite(id) && id > 0;
      });

    var uniqueIds = Array.from(new Set(ids));
    if (app.globalState) app.globalState.selectedAgenteIdsForBulk = uniqueIds;
    if (app.agentesState) app.agentesState.selectedAgenteIdsVista = uniqueIds;
    updateAgenteAsignacionesDetalleButtonStateTest();
  }

  function updateAgenteAsignacionesDetalleButtonStateTest() {
    var btn = document.getElementById('btnTestTabulatorAsignacionesDetalle');
    if (!btn) return;
    var selectedIds =
      app.agentesState && Array.isArray(app.agentesState.selectedAgenteIdsVista)
        ? app.agentesState.selectedAgenteIdsVista.filter(function (id) {
            return Number(id) > 0;
          })
        : [];
    var count = selectedIds.length;
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
    var modalEl = document.getElementById('modalAgenteAsignacionesDetalle');
    if (!modalEl) return;
    if (modalEl.parentElement !== document.body) {
      document.body.appendChild(modalEl);
    }
  }

  function applyEstadoFilter() {
    var table = state.table;
    if (!table) return;
    table.clearFilter(true);
    var search = String(state.searchTerm || '')
      .trim()
      .toLowerCase();
    var noQuickFilter = state.quickFilterEstado === 'todos';
    var noSearch = !search;

    if (noQuickFilter && noSearch) {
      updateCounters();
      return;
    }

    table.setFilter(function (rowData) {
      var hasFechaBaja = !!(rowData && rowData.fecha_baja);
      if (state.quickFilterEstado === 'activos') return !hasFechaBaja;
      if (state.quickFilterEstado === 'baja') return hasFechaBaja;

      if (!noSearch) {
        var haystack = [
          rowData && rowData.tip,
          rowData && rowData.nombre,
          rowData && rowData.apellido_1,
          rowData && rowData.apellido_2,
          rowData && rowData.email,
          rowData && rowData.nif,
          rowData && rowData.telefono,
          rowData && rowData.peloton_id,
          rowData && rowData.empleo_id,
          rowData && rowData.orden_gc,
          rowData && rowData.aptitudes,
          rowData && rowData.comentarios,
          rowData && rowData.poblacion,
          rowData && rowData.provincia,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.indexOf(search) !== -1;
      }

      return true;
    });
    updateCounters();
  }

  function updateQuickFilterActiveItem() {
    var selector = '#testTabulatorQuickFilterEstado .dropdown-item';
    var activeEstado = state.quickFilterEstado || 'todos';
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
    var label = document.getElementById('testTabulatorEstadoLabel');
    if (label) label.textContent = 'Todos';
    var search = document.getElementById('testTabulatorGlobalSearch');
    if (search) search.value = '';
    updateQuickFilterActiveItem();
    state.table.clearHeaderFilter();
    applyEstadoFilter();
    setStatus('Filtros limpiados');
  }

  function downloadVisibleCsv() {
    if (!state.table) return;
    state.table.download('csv', 'test-tabulator-visible.csv', { bom: true });
  }

  function exportExcel() {
    if (!state.table) return;
    var ts = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');
    state.table.download('xlsx', 'test-interno-agentes_' + ts + '.xlsx', {
      sheetName: 'Agentes',
    });
  }

  function exportPdfVisible() {
    if (!state.table) return;
    if (
      !window.jspdf ||
      !window.jspdf.jsPDF ||
      typeof window.jspdf.jsPDF !== 'function'
    ) {
      showAlert('No esta disponible jsPDF para exportar PDF', 'warning');
      return;
    }

    var cols = state.table.getColumns().filter(function (c) {
      var def = c.getDefinition();
      return !!def.title && !!def.field;
    });
    var head = [
      cols.map(function (c) {
        return c.getDefinition().title;
      }),
    ];
    var body = state.table.getData('active').map(function (row) {
      return cols.map(function (c) {
        var field = c.getDefinition().field;
        var val = row[field];
        if (field === 'fecha_baja') {
          return formatTimestampWithoutZone(val);
        }
        return val == null ? '' : String(val);
      });
    });

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'landscape' });
    doc.autoTable({
      head: head,
      body: body,
      startY: 18,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [52, 58, 64], fontSize: 7 },
      margin: { top: 18, bottom: 14 },
      didDrawPage: function () {
        var pw = doc.internal.pageSize.getWidth();
        var ph = doc.internal.pageSize.getHeight();
        var p = doc.internal.getCurrentPageInfo().pageNumber;
        var t = doc.internal.getNumberOfPages();
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.text('Listado de Agentes (Test Interno)', 14, 12);
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text('Pagina ' + p + ' de ' + t, pw - 14, ph - 5, {
          align: 'right',
        });
      },
    });
    var ts = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');
    doc.save('test-interno-agentes_' + ts + '.pdf');
  }

  function parseBoolean(v) {
    var t = String(v == null ? '' : v)
      .trim()
      .toLowerCase();
    return ['1', 'true', 'si', 'sí', 'y', 'yes'].indexOf(t) >= 0;
  }

  function splitCsvLine(line, delimiter) {
    var out = [];
    var value = '';
    var inQuotes = false;

    for (var i = 0; i < line.length; i += 1) {
      var ch = line[i];
      var next = line[i + 1];

      if (ch === '"') {
        if (inQuotes && next === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && ch === delimiter) {
        out.push(value);
        value = '';
        continue;
      }

      value += ch;
    }

    out.push(value);
    return out;
  }

  function detectDelimiter(text) {
    var sample = (text || '').split(/\r?\n/).slice(0, 4).join('\n');
    var commas = (sample.match(/,/g) || []).length;
    var semicolons = (sample.match(/;/g) || []).length;
    return semicolons > commas ? ';' : ',';
  }

  function parseCsv(text) {
    var cleanText = String(text || '').replace(/^\uFEFF/, '');
    var delimiter = detectDelimiter(cleanText);
    var lines = cleanText.split(/\r?\n/).filter(function (line) {
      return String(line || '').trim() !== '';
    });

    if (!lines.length) return [];

    var headers = splitCsvLine(lines[0], delimiter).map(function (h) {
      return String(h || '')
        .trim()
        .toLowerCase();
    });

    var indexByHeader = {};
    headers.forEach(function (h, idx) {
      indexByHeader[h] = idx;
    });

    function readCell(cells, names) {
      for (var i = 0; i < names.length; i += 1) {
        var key = names[i];
        if (Object.prototype.hasOwnProperty.call(indexByHeader, key)) {
          var val = cells[indexByHeader[key]];
          return val == null ? '' : String(val).trim();
        }
      }
      return '';
    }

    return lines.slice(1).map(function (line, idx) {
      var cells = splitCsvLine(line, delimiter);
      return {
        id: Number(readCell(cells, ['id', 'id_agente'])) || idx + 1,
        tip: readCell(cells, ['tip']),
        nombre: readCell(cells, ['nombre']),
        apellido_1: readCell(cells, ['apellido_1', 'apellido1']),
        apellido_2: readCell(cells, ['apellido_2', 'apellido2']),
        email: readCell(cells, ['email']),
        nif: readCell(cells, ['nif']),
        telefono: readCell(cells, ['telefono', 'teléfono']),
        peloton_id: readCell(cells, ['peloton_id']),
        empleo_id: readCell(cells, ['empleo_id']),
        orden_gc: readCell(cells, ['orden_gc']),
        fecha_ant_empleo: readCell(cells, ['fecha_ant_empleo']),
        fecha_baja: readCell(cells, ['fecha_baja']),
        domicilio: readCell(cells, ['domicilio']),
        codigo_postal: readCell(cells, ['codigo_postal', 'cp']),
        poblacion: readCell(cells, ['poblacion', 'población']),
        provincia: readCell(cells, ['provincia']),
        pei: parseBoolean(readCell(cells, ['pei'])),
        paef: parseBoolean(readCell(cells, ['paef'])),
        aptitudes: readCell(cells, ['aptitudes']),
        situacion_id: readCell(cells, ['situacion_id']),
        comentarios: readCell(cells, ['comentarios']),
      };
    });
  }

  function getEmpleoEscalaById(empleoId) {
    var empleos = (app.agentesState && app.agentesState.empleos) || [];
    var empleo = empleos.find(function (x) {
      return String(x.id_empleo) === String(empleoId);
    });
    return empleo ? String(empleo.escala || empleo.grupo || '') : '';
  }

  function hydrateAgente(row) {
    var next = Object.assign({}, row || {});
    next.__escala = getEmpleoEscalaById(next.empleo_id);
    return next;
  }

  function hydrateAgentes(rows) {
    return (rows || []).map(hydrateAgente);
  }

  function trackPendingField(id, field, newValue) {
    var original = state.originalAgentes.find(function (a) {
      return Number(a.id) === Number(id);
    });
    if (!original) {
      updatePendingChangesUi();
      return;
    }

    var currentPending = state.cambiosPendientes.get(Number(id));
    var originalValue = original[field];

    if (!currentPending && sameValue(originalValue, newValue)) {
      updatePendingChangesUi();
      return;
    }

    if (!currentPending) {
      state.cambiosPendientes.set(Number(id), Object.assign({}, original));
    }

    var pendingData = state.cambiosPendientes.get(Number(id));
    pendingData[field] = newValue;

    var hasDifferences = Object.keys(original).some(function (key) {
      return !sameValue(original[key], pendingData[key]);
    });

    if (!hasDifferences) {
      state.cambiosPendientes.delete(Number(id));
    }

    var agente = state.agentes.find(function (a) {
      return Number(a.id) === Number(id);
    });
    if (agente) {
      agente[field] = newValue;
      if (field === 'empleo_id') {
        agente.__escala = getEmpleoEscalaById(newValue);
      }
    }

    updatePendingChangesUi();
  }

  function buildChangesPayload(id, changes) {
    var original = state.originalAgentes.find(function (a) {
      return Number(a.id) === Number(id);
    });
    if (!original) return {};

    function normalizePayloadValue(field, value) {
      if (field === 'fecha_baja') {
        if (value === '' || value == null) return null;
        var raw = String(value).trim();
        var DateTime = window.luxon && window.luxon.DateTime;
        if (!DateTime) return raw;
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          var dtDateOnly = DateTime.fromISO(raw);
          if (dtDateOnly.isValid) {
            return dtDateOnly.toFormat('yyyy-LL-dd HH:mm:ss');
          }
        }
        var dtSql = DateTime.fromSQL(raw);
        if (dtSql.isValid) {
          return dtSql.toFormat('yyyy-LL-dd HH:mm:ss');
        }
        var dtIso = DateTime.fromISO(raw);
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
    var count = state.cambiosPendientes.size;
    var sectionEl = document.getElementById('testTabulatorSaveChangesSection');
    var saveBtn = document.getElementById('btnTestTabulatorSaveAll');
    var discardBtn = document.getElementById('btnTestTabulatorDiscard');
    syncPendingInfo(count);
    if (sectionEl) {
      sectionEl.classList.toggle('pending-changes-active', count > 0);
      sectionEl.classList.toggle('pending-changes-idle', count === 0);
    }
    if (saveBtn) saveBtn.disabled = count === 0;
    if (discardBtn) discardBtn.disabled = count === 0;
  }

  async function saveAllChanges() {
    if (state.cambiosPendientes.size === 0) {
      showAlert('No hay cambios pendientes', 'info');
      return;
    }

    var token = app.globalState && app.globalState.token;
    var headers = {
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = 'Bearer ' + token;

    var requests = [];
    state.cambiosPendientes.forEach(function (changes, id) {
      var payload = buildChangesPayload(id, changes);
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
      var responses = await Promise.all(requests);
      var failed = responses.filter(function (r) {
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
    state.cambiosPendientes.clear();
    state.agentes = hydrateAgentes(cloneRows(state.originalAgentes));
    if (state.table) {
      state.table.setData(state.agentes);
    }
    updatePendingChangesUi();
    showAlert('Cambios descartados', 'info');
  }

  function dateFormatter(cell) {
    var val = cell.getValue();
    if (!val) return '';
    var dt = window.luxon && window.luxon.DateTime.fromISO(String(val));
    return dt && dt.isValid
      ? dt.setLocale('es').toFormat('dd/MM/yyyy')
      : esc(val);
  }

  function parseTimestampWithoutZone(value) {
    var DateTime = window.luxon && window.luxon.DateTime;
    if (!DateTime || value == null) return null;
    var raw = String(value).trim();
    if (!raw) return null;
    var dtSql = DateTime.fromSQL(raw);
    if (dtSql.isValid) return dtSql;
    var dtIso = DateTime.fromISO(raw);
    if (dtIso.isValid) return dtIso;
    return null;
  }

  function formatTimestampWithoutZone(value) {
    var dt = parseTimestampWithoutZone(value);
    if (dt && dt.isValid) {
      return dt.setLocale('es').toFormat('dd/MM/yyyy HH:mm:ss');
    }
    return value == null ? '' : String(value);
  }

  function fechaBajaFormatter(cell) {
    var val = cell.getValue();
    if (!val) {
      return '<span class="badge bg-success-subtle text-success border border-success-subtle">Activa</span>';
    }
    return (
      '<span class="badge bg-danger-subtle text-danger border border-danger-subtle">' +
      esc(formatTimestampWithoutZone(val)) +
      '</span>'
    );
  }

  function boolFormatter(cell) {
    return cell.getValue() ? 'Si' : 'No';
  }

  // ── Helpers de avatar (igual que Lista Agentes) ──────────────────────────
  function ttGetInitials(row) {
    var nombre = String((row && row.nombre) || '').trim();
    var apellido1 = String((row && row.apellido_1) || '').trim();
    var first = nombre ? nombre.charAt(0) : '';
    var second = apellido1 ? apellido1.charAt(0) : '';
    return (first + second || '?').toUpperCase();
  }

  function ttAvatarBg(row) {
    var seed =
      (row && row.id ? String(row.id) : '') +
      '|' +
      ((row && row.nombre) || '') +
      '|' +
      ((row && row.apellido_1) || '');
    var hash = 0;
    for (var i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    var hue = Math.abs(hash) % 360;
    return 'hsl(' + hue + ' 55% 45%)';
  }

  function ttAvatarFormatter(cell) {
    var row = cell.getRow().getData();
    var initials = ttGetInitials(row);
    var bg = ttAvatarBg(row);
    var tip = row.tip || '';
    var url = tip ? '/avatars/' + encodeURIComponent(tip) + '.jpg' : '';
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
    var pelotones = (app.agentesState && app.agentesState.pelotones) || [];
    var empleos = (app.agentesState && app.agentesState.empleos) || [];
    var situaciones = (app.agentesState && app.agentesState.situaciones) || [];

    function pelotonLabel(id) {
      var p = pelotones.find(function (x) {
        return String(x.id_peloton) === String(id);
      });
      return p ? p.descripcion : id || '';
    }

    function empleoLabel(id) {
      var e = empleos.find(function (x) {
        return String(x.id_empleo) === String(id);
      });
      return e ? e.descripcion : id || '';
    }

    function situacionLabel(id) {
      var s = situaciones.find(function (x) {
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
        title: 'Peloton',
        field: 'peloton_id',
        headerFilter: 'input',
        formatter: function (cell) {
          var val = cell.getValue();
          if (!val) return '';
          var p = (app.agentesState.pelotones || []).find(function (x) {
            return String(x.id_peloton) === String(val);
          });
          if (!p) return esc(val);
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
        accessorDownload: function (value) {
          return pelotonLabel(value);
        },
        editor: 'list',
        editorParams: function () {
          var _pelotones =
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
          var val = cell.getValue();
          if (!val) return '';
          var e = (app.agentesState.empleos || []).find(function (x) {
            return String(x.id_empleo) === String(val);
          });
          if (!e) return esc(val);
          var color = e.color || '#6c757d';
          return (
            '<span class="badge" style="background-color:' +
            app.escapeHtml(color) +
            ';font-size:0.88em;padding:.4em .65em">' +
            app.escapeHtml(e.descripcion) +
            '</span>'
          );
        },
        accessorDownload: function (value) {
          return empleoLabel(value);
        },
        editor: 'list',
        editorParams: function () {
          var _empleos = (app.agentesState && app.agentesState.empleos) || [];
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
        title: 'Escala',
        field: '__escala',
        headerFilter: 'input',
        editable: false,
        formatter: function (cell) {
          var rowData = cell.getRow().getData();
          var empleo = (app.agentesState.empleos || []).find(function (x) {
            return String(x.id_empleo) === String(rowData.empleo_id);
          });
          var escala = getEmpleoEscalaById(rowData.empleo_id);
          if (!escala) return '';
          var color = (empleo && empleo.color) || '#6c757d';
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
          var _provincias =
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
          var val = String(cell.getValue() || '').trim();
          if (!val) return '';
          var found = (app.agentesState.provincias || []).find(function (p) {
            return p.value === val;
          });
          return found ? app.escapeHtml(found.label) : app.escapeHtml(val);
        },
        accessorDownload: function (value) {
          if (!value) return '';
          var found = (app.agentesState.provincias || []).find(function (p) {
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
        accessorDownload: function (value) {
          return value ? 'Sí' : 'No';
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
          var val = cell.getValue();
          if (!val) return '';
          var sit = (app.agentesState.situaciones || []).find(function (s) {
            return String(s.id_situacion) === String(val);
          });
          if (!sit) return esc(val);
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
        accessorDownload: function (value) {
          return situacionLabel(value);
        },
        editor: 'list',
        editorParams: function () {
          var _situaciones =
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
          var val = cell.getValue();
          var hasContent = val && String(val).trim().length > 0;
          if (hasContent) {
            return '<span class="badge bg-primary-subtle text-primary border border-primary-subtle" style="cursor:pointer">Ver</span>';
          }
          return '<span class="badge bg-success-subtle text-success border border-success-subtle" style="cursor:pointer">Crear</span>';
        },
        cellClick: function (e, cell) {
          var row = cell.getRow().getData();
          if (typeof app.openComentariosModal === 'function') {
            state._comentariosFromTest = true;
            state._comentariosFromTestId = row.id;
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
          var formatted = formatTimestampWithoutZone(value);
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
        formatter: function () {
          return '<button class="btn btn-sm btn-outline-danger" title="Eliminar" type="button"><i class="bi bi-trash"></i></button>';
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
    var container = document.getElementById('tabulatorAgentesCsvTest');
    if (!container || !state.table) return;
    var tabulatorRoot = container.querySelector('.tabulator');
    if (!tabulatorRoot) return;
    var headerEl = tabulatorRoot.querySelector('.tabulator-header');
    if (!headerEl) return;

    var existing = tabulatorRoot.querySelector('#testTabulatorSearchBand');
    if (existing) return;

    var band = document.createElement('div');
    band.id = 'testTabulatorSearchBand';
    band.className = 'px-2 py-1 border-bottom bg-white';
    band.style.cssText = 'position:sticky;top:0;z-index:5;';
    band.innerHTML =
      '<div class="input-group input-group-sm" style="max-width:520px;">' +
      '<span class="input-group-text" aria-hidden="true"><i class="bi bi-search"></i></span>' +
      '<input type="search" id="testTabulatorGlobalSearch" class="form-control form-control-sm" ' +
      'placeholder="Buscar contenido en la tabla" aria-label="Buscar en todos los campos" autocomplete="off">' +
      '<button type="button" id="testTabulatorLimpiarFiltros" class="btn btn-outline-secondary" ' +
      'title="Limpiar todos los filtros" aria-label="Limpiar todos los filtros">' +
      '<i class="bi bi-eraser"></i><span> Filtros</span></button>' +
      '</div>';

    tabulatorRoot.insertBefore(band, headerEl);

    var globalSearch = document.getElementById('testTabulatorGlobalSearch');
    if (globalSearch) {
      globalSearch.addEventListener('input', function () {
        state.searchTerm = this.value || '';
        applyEstadoFilter();
      });
    }

    var clearBtn = document.getElementById('testTabulatorLimpiarFiltros');
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
      var el = state.table.element;
      if (el && document.documentElement.contains(el)) {
        return state.table;
      }
      // El nodo fue eliminado externamente; limpiar referencia y recrear.
      state.table = null;
    }

    state.table = new Tabulator('#tabulatorAgentesCsvTest', {
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
      columns: buildColumns(),
    });

    // Reutiliza la lógica del modal de cuadrante de Lista Agentes
    app.tabulatorAgentes = state.table;

    state.table.on('cellEdited', function (cell) {
      var rowData = cell.getRow().getData();
      var id = Number(rowData.id);
      var field = cell.getField();
      var newValue = cell.getValue();
      trackPendingField(id, field, newValue);

      if (field === 'empleo_id') {
        cell.getRow().update({ __escala: getEmpleoEscalaById(newValue) });
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

  function setTableData(rows, sourceLabel) {
    var table = ensureTable();
    app.tabulatorAgentes = table;
    var hydrated = hydrateAgentes(rows || []);
    state.agentes = hydrated;
    state.originalAgentes = cloneRows(hydrated);
    state.cambiosPendientes.clear();
    table.replaceData(hydrated);
    if (table.getSelectedRows().length) {
      table.deselectRow();
    }
    syncSelectedAgentesForDetalle();
    var count = Array.isArray(rows) ? rows.length : 0;
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
      var token = app.globalState && app.globalState.token;
      var headers = token ? { Authorization: 'Bearer ' + token } : {};
      var res = await fetch('/api/agentes', {
        headers: headers,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('No se pudo cargar /api/agentes');
      var json = await res.json();
      var rows = Array.isArray(json.agentes) ? json.agentes : [];
      setTableData(rows, 'API Agentes');
      setStatus('Agentes cargados desde API: ' + rows.length);
    } catch (error) {
      setAlert(error.message || 'Error al cargar API', 'danger');
      setStatus(error.message || 'Error al cargar API', true);
    }
  }

  async function loadBaseCsv() {
    try {
      setAlert('', 'info');
      setStatus('Cargando CSV base...');
      var res = await fetch(CSV_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudo cargar ' + CSV_URL);
      var text = await res.text();
      var rows = parseCsv(text);
      setTableData(rows, 'CSV base');
      setStatus('CSV base cargado: ' + rows.length + ' filas');
    } catch (error) {
      setAlert(error.message || 'Error al cargar CSV base', 'danger');
      setStatus(error.message || 'Error al cargar CSV base', true);
    }
  }

  async function loadCsvFile(file) {
    if (!file) return;
    try {
      setAlert('', 'info');
      setStatus('Importando archivo ' + file.name + ' ...');
      var text = await file.text();
      var rows = parseCsv(text);
      setTableData(rows, 'CSV importado');
      setStatus('CSV importado: ' + rows.length + ' filas');
    } catch (error) {
      setAlert(error.message || 'Error al importar CSV', 'danger');
      setStatus(error.message || 'Error al importar CSV', true);
    }
  }

  function bindEvents() {
    var btnNuevoAgente = document.getElementById('btnTestTabulatorNuevoAgente');
    if (btnNuevoAgente && !btnNuevoAgente.dataset.ttBound) {
      btnNuevoAgente.dataset.ttBound = '1';
      btnNuevoAgente.addEventListener('click', function () {
        if (typeof app.openAgenteModal === 'function') {
          app.openAgenteModal();
        } else {
          showAlert('El módulo de agentes no está disponible', 'warning');
        }
      });
    }

    // Cuando el modal de agente se cierra tras crear uno nuevo, recargar Test.
    var agenteModalEl = document.getElementById('agenteModal');
    if (agenteModalEl && !agenteModalEl.dataset.ttReloadBound) {
      agenteModalEl.dataset.ttReloadBound = '1';
      agenteModalEl.addEventListener('hidden.bs.modal', function () {
        // Solo recargamos si el modo era 'create' (se creó un agente nuevo).
        var wasCreate =
          app.agenteModalState && app.agenteModalState.mode === 'create';
        if (wasCreate && app.currentSection === 'testTabulator') {
          loadAgentesFromApi();
        }
      });
    }

    var btnCsv = document.getElementById('btnTestTabulatorRecargarCsv');
    if (btnCsv && !btnCsv.dataset.ttBound) {
      btnCsv.dataset.ttBound = '1';
      btnCsv.title = 'Recargar desde API de agentes';
      btnCsv.addEventListener('click', loadAgentesFromApi);
    }

    var btnSave = document.getElementById('btnTestTabulatorSaveAll');
    if (btnSave && !btnSave.dataset.ttBound) {
      btnSave.dataset.ttBound = '1';
      btnSave.addEventListener('click', saveAllChanges);
    }

    var btnDiscard = document.getElementById('btnTestTabulatorDiscard');
    if (btnDiscard && !btnDiscard.dataset.ttBound) {
      btnDiscard.dataset.ttBound = '1';
      btnDiscard.addEventListener('click', function () {
        discardPendingChanges();
        resetFilters();
      });
    }

    var btnExportBase = document.getElementById('btnTestTabulatorExportBase');
    if (btnExportBase && !btnExportBase.dataset.ttBound) {
      btnExportBase.dataset.ttBound = '1';
      btnExportBase.addEventListener('click', exportExcel);
    }

    var btnExportVisible = document.getElementById(
      'btnTestTabulatorExportVisible'
    );
    if (btnExportVisible && !btnExportVisible.dataset.ttBound) {
      btnExportVisible.dataset.ttBound = '1';
      btnExportVisible.addEventListener('click', exportPdfVisible);
    }

    var detalleBtn = document.getElementById(
      'btnTestTabulatorAsignacionesDetalle'
    );
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
    updateAgenteAsignacionesDetalleButtonStateTest();

    document
      .querySelectorAll('#testTabulatorQuickFilterEstado .dropdown-item')
      .forEach(function (item) {
        if (!item.dataset.ttBound) {
          item.dataset.ttBound = '1';
          item.addEventListener('click', function (e) {
            e.preventDefault();
            state.quickFilterEstado =
              item.getAttribute('data-estado') || 'todos';
            var label = document.getElementById('testTabulatorEstadoLabel');
            if (label) label.textContent = item.textContent.trim();
            updateQuickFilterActiveItem();
            applyEstadoFilter();
          });
        }
      });

    var input = document.getElementById('testTabulatorCsvInput');
    if (input && !input.dataset.ttBound) {
      input.dataset.ttBound = '1';
      input.addEventListener('change', function (e) {
        var file =
          e.target.files && e.target.files[0] ? e.target.files[0] : null;
        loadCsvFile(file);
        e.target.value = '';
      });
    }

    // Interceptar el guardado del modal de comentarios compartido.
    // Usamos fase de CAPTURA para ejecutar antes que el listener de dashboard-layout.js
    var btnSaveComentarios = document.getElementById(
      'btnSaveComentariosAgente'
    );
    if (btnSaveComentarios) {
      btnSaveComentarios.addEventListener(
        'click',
        function (e) {
          if (!state._comentariosFromTest) return; // dejar actuar al listener original
          e.stopPropagation(); // impide que el listener de layout.js se ejecute
          state._comentariosFromTest = false;
          var id = state._comentariosFromTestId;
          state._comentariosFromTestId = null;
          var textarea = document.getElementById('comentariosAgenteTextarea');
          if (!id || !textarea) return;
          var comentarios = textarea.value.trim() || null;
          trackPendingField(Number(id), 'comentarios', comentarios);
          if (state.table) {
            var tRow = state.table.getRow(Number(id));
            if (tRow) tRow.update({ comentarios: comentarios });
          }
          var modalEl = document.getElementById('comentariosAgenteModal');
          if (modalEl) {
            var bsModal = bootstrap.Modal.getInstance(modalEl);
            if (bsModal) bsModal.hide();
          }
          showAlert('Comentario marcado como cambio pendiente', 'info');
        },
        true // captura: se ejecuta antes que los listeners en burbuja
      );
    }
  }

  app.initializeTestTabulator = async function initializeTestTabulator() {
    // Cargar lookups antes de buildColumns() para que los editorParams tengan datos
    if (typeof app.loadAgentesMeta === 'function') {
      try {
        await app.loadAgentesMeta();
      } catch (_e) {
        console.warn(
          '[TestTabulator] loadAgentesMeta falló en init, lookups pueden estar vacíos',
          _e
        );
      }
    }

    ensureTable();

    bindEvents();
    state.initialized = true;

    await loadAgentesFromApi();

    if (!Array.isArray(state.agentes) || state.agentes.length === 0) {
      try {
        await loadBaseCsv();
        showAlert(
          'API sin datos o no disponible. Mostrando CSV base como respaldo.',
          'warning'
        );
      } catch (_e) {
        // Si tambien falla CSV, ya se muestran alertas dentro de loadBaseCsv
      }
    }
  };
})();
