(function () {
  let app = window.GRS1Dashboard;
  if (!app) return;

  let state = {
    initialized: false,
    isProcessing: false,
    gridMode: 'idle',
    altasRows: [],
    bajasTipsRows: [],
    resultRows: [],
    lastExecutionDetail: [],
    mainTable: null,
    seleccionLoaded: false,
    forceReloadAgentesList: false,
  };

  // @ts-ignore
  let TABULATOR_LANGS = window.GRS1TabulatorLangs;

  function esc(value) {
    if (app && typeof app.escapeHtml === 'function') {
      return app.escapeHtml(value);
    }
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function setAlert(message, type) {
    let el = document.getElementById('alertContainerAgentesAcciones');
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

  function setStatus(message, isError) {
    let el = document.getElementById('estadoCargaAgentesAcciones');
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.className = isError
        ? 'px-3 pb-1 text-danger small'
        : 'px-3 pb-1 text-muted small';
      return;
    }
    el.textContent = '';
    el.className = 'd-none';
  }

  function showAlert(message, type) {
    setAlert(message, type);
    if (!message) return;
    setTimeout(function () {
      setAlert('', 'info');
    }, 6000);
  }

  function getAuthHeaders(includeContentType) {
    if (typeof app.getHeaders === 'function') {
      return app.getHeaders(includeContentType);
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

  function parseBoolean(v) {
    let t = String(v == null ? '' : v)
      .trim()
      .toLowerCase();
    return ['1', 'true', 'si', 'si\u0301', 'y', 'yes'].indexOf(t) >= 0;
  }

  function normalizeCsvDate(value) {
    let raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) return raw.replace(/\//g, '-');
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      let p = raw.split('/');
      return p[2] + '-' + p[1] + '-' + p[0];
    }
    return raw;
  }

  function splitCsvLine(line, delimiter) {
    let out = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      let ch = line[i];
      let next = line[i + 1];

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
    let sample = (text || '').split(/\r?\n/).slice(0, 4).join('\n');
    let commas = (sample.match(/,/g) || []).length;
    let semicolons = (sample.match(/;/g) || []).length;
    return semicolons > commas ? ';' : ',';
  }

  function normalizeHeaderName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function parseCsvRows(text) {
    let cleanText = String(text || '').replace(/^\uFEFF/, '');
    let delimiter = detectDelimiter(cleanText);
    let lines = cleanText.split(/\r?\n/).filter(function (line) {
      return String(line || '').trim() !== '';
    });

    if (!lines.length) {
      return { headers: [], unknownHeaders: [], rows: [] };
    }

    let rawHeaders = splitCsvLine(lines[0], delimiter).map(function (h) {
      return String(h || '').trim();
    });
    let headers = rawHeaders.map(normalizeHeaderName);

    let allowedHeaders = new Set([
      'id',
      'id_agente',
      'tip',
      'nombre',
      'apellido_1',
      'apellido1',
      'apellido_2',
      'apellido2',
      'email',
      'nif',
      'telefono',
      'peloton_id',
      'peloton',
      'empleo_id',
      'empleo',
      'orden_gc',
      'orden',
      'fecha_ant_empleo',
      'ant_empleo',
      'domicilio',
      'codigo_postal',
      'cp',
      'c_p',
      'poblacion',
      'provincia',
      'pei',
      'paef',
      'aptitudes',
      'situacion_id',
      'situacion',
      'comentarios',
      // Columnas adicionales del DDL de agentes permitidas en importación full
      'created_at',
      'created_user',
      'ars_unidad_id',
      'agrupacion_id',
      'fecha_baja',
      'escalafon',
    ]);

    let unknownHeaders = [];
    rawHeaders.forEach(function (raw, idx) {
      if (!allowedHeaders.has(headers[idx])) {
        unknownHeaders.push(raw);
      }
    });

    let indexByHeader = {};
    headers.forEach(function (h, idx) {
      indexByHeader[h] = idx;
    });

    function readCell(cells, names) {
      for (let i = 0; i < names.length; i += 1) {
        let key = normalizeHeaderName(names[i]);
        if (Object.prototype.hasOwnProperty.call(indexByHeader, key)) {
          let val = cells[indexByHeader[key]];
          return val == null ? '' : String(val).trim();
        }
      }
      return '';
    }

    let rows = lines.slice(1).map(function (line, idx) {
      let cells = splitCsvLine(line, delimiter);
      return {
        _line: idx + 2,
        id: Number(readCell(cells, ['id', 'id_agente'])) || null,
        tip: readCell(cells, ['tip']).toUpperCase(),
        nombre: readCell(cells, ['nombre']),
        apellido_1: readCell(cells, ['apellido_1', 'apellido1', 'apellido 1']),
        apellido_2: readCell(cells, ['apellido_2', 'apellido2', 'apellido 2']),
        email: readCell(cells, ['email']),
        nif: readCell(cells, ['nif']),
        telefono: readCell(cells, ['telefono', 'tel\u00e9fono']),
        peloton_id: readCell(cells, ['peloton_id', 'peloton id', 'peloton']),
        empleo_id: readCell(cells, ['empleo_id', 'empleo id', 'empleo']),
        orden_gc: readCell(cells, ['orden_gc', 'orden']),
        fecha_ant_empleo: normalizeCsvDate(readCell(cells, ['fecha_ant_empleo', 'fecha nombramiento', 'ant. empleo', 'ant empleo', 'ant_empleo'])),
        domicilio: readCell(cells, ['domicilio']),
        codigo_postal: readCell(cells, ['codigo_postal', 'cp', 'c.p.', 'c p']),
        poblacion: readCell(cells, ['poblacion', 'población']),
        provincia: readCell(cells, ['provincia']),
        pei: parseBoolean(readCell(cells, ['pei'])),
        paef: parseBoolean(readCell(cells, ['paef'])),
        aptitudes: readCell(cells, ['aptitudes']),
        situacion_id: readCell(cells, ['situacion_id', 'situacion id', 'situacion']),
        comentarios: readCell(cells, ['comentarios']),
        // Se aceptan en CSV full para compatibilidad con export de DDL,
        // pero el alta nueva reutiliza el mecanismo manual y no persiste estos campos de sistema.
        created_at: readCell(cells, ['created_at', 'created at']),
        created_user: readCell(cells, ['created_user', 'created user']),
        ars_unidad_id: readCell(cells, ['ars_unidad_id', 'ars unidad id', 'agrupacion id', 'agrupación id']),
        fecha_baja: normalizeCsvDate(readCell(cells, ['fecha_baja', 'fecha baja'])),
        escalafon: readCell(cells, ['escalafon']),
      };
    });

    return { headers: rawHeaders, unknownHeaders: unknownHeaders, rows: rows };
  }

  function prevalidateAltasRows(rows) {
    (rows || []).forEach(function (row) {
      let tip = String(row.tip || '').trim();
      let requiredForCreate = [
        String(row.nombre || '').trim(),
        String(row.apellido_1 || '').trim(),
        String(row.apellido_2 || '').trim(),
        String(row.email || '').trim(),
        String(row.peloton_id || '').trim(),
        String(row.empleo_id || '').trim(),
        String(row.orden_gc || '').trim(),
        String(row.nif || '').trim(),
        String(row.telefono || '').trim(),
        String(row.situacion_id || '').trim(),
      ];
      let missingCreateRequired = requiredForCreate.some(function (v) {
        return !v;
      });
      if (!tip) {
        row._warn = 'error';
        row._warnMsg = 'Sin TIP';
      } else if (missingCreateRequired) {
        row._warn = 'error';
        row._warnMsg = 'Faltan obligatorios DDL para alta nueva';
      } else {
        row._warn = '';
        row._warnMsg = '';
      }
    });
  }

  // --- Badge del grid ---

  function updateGridBadge(text, variant) {
    let el = document.getElementById('agentesAccionesGridBadge');
    if (!el) return;
    let v = variant || 'secondary';
    el.className = 'badge bg-' + v + '-subtle text-' + v + ' border border-' + v + '-subtle';
    el.style.fontSize = '.68rem';
    el.textContent = text || '';
  }

  // --- Resumen altas ---

  function refreshResumenAltas() {
    let btn = document.getElementById('btnAgentesAltasEjecutar');
    let msgWrap = document.getElementById('agentesAltasPrevalidMsg');
    let msgText = document.getElementById('agentesAltasPrevalidText');
    let total = state.altasRows.length;
    let errors = state.altasRows.filter(function (r) { return r._warn === 'error'; }).length;
    let warns  = state.altasRows.filter(function (r) { return r._warn === 'warn'; }).length;
    if (state.gridMode === 'altas') {
      updateGridBadge(
        total
          ? total + ' filas' + (errors ? ' \u00b7 ' + errors + ' error(es)' : '') + (warns ? ' \u00b7 \u26a0 ' + warns : '')
          : 'Sin CSV',
        errors ? 'danger' : warns ? 'warning' : total ? 'primary' : 'secondary'
      );
    }
    if (btn) {
      // @ts-ignore
      btn.disabled = !total || errors === total || state.isProcessing;
    }
    if (msgWrap && msgText) {
      if ((warns > 0 || errors > 0) && !state.isProcessing) {
        msgText.textContent =
          errors + ' fila(s) con error de validaci\u00f3n y ' + warns + ' advertencia(s)';
        msgWrap.style.display = '';
      } else {
        msgWrap.style.display = 'none';
      }
    }
  }

  // --- Resumen bajas ---

  function getSeleccionCheckedCount() {
    if (state.gridMode !== 'bajas-seleccion' || !state.mainTable) return 0;
    return (state.mainTable.getSelectedData() || []).length;
  }

  function refreshResumenBajas() {
    let btnCsv = document.getElementById('btnAgentesBajasCsvEjecutar');
    let btnSel = document.getElementById('btnAgentesBajasSeleccionEjecutar');
    let csvCount = state.bajasTipsRows.length;
    let selCount = getSeleccionCheckedCount();
    if (state.gridMode === 'bajas-csv') {
      updateGridBadge(csvCount ? csvCount + ' TIPs' : 'Sin datos', csvCount ? 'danger' : 'secondary');
    } else if (state.gridMode === 'bajas-seleccion') {
      let total = state.mainTable ? (state.mainTable.getData() || []).length : 0;
      updateGridBadge(
        total + ' agentes' + (selCount ? ' \u00b7 ' + selCount + ' marcados' : ''),
        selCount ? 'danger' : 'secondary'
      );
    }
    if (btnCsv) {
      // @ts-ignore
      btnCsv.disabled = !csvCount || state.isProcessing;
    }
    if (btnSel) {
      // @ts-ignore
      btnSel.disabled = !selCount || state.isProcessing;
    }
  }

  // --- Formatters / status ---

  function safeBadgeColor(value) {
    let raw = String(value || '').trim();
    if (!raw) return '#6c757d';
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
    return '#6c757d';
  }

  function formatEmpleoColorBadge(cell) {
    let empleoName = String(cell.getValue() || '');
    let row = cell.getRow().getData();
    if (!empleoName) {
      empleoName = String(row.empleo_display || row.empleo_nombre || row.empleo_id || row.empleo || '');
    }
    let color = row.empleo_color ? safeBadgeColor(row.empleo_color) : '#6c757d';
    let textColor = '#fff';
    if (!empleoName) return '';
    return '<span class="badge" style="background-color:' + esc(color) + ';color:' + esc(textColor) + '">' + esc(empleoName) + '</span>';
  }

  function formatPelotonColorBadge(cell) {
    let name = String(cell.getValue() || '');
    let row = cell.getRow().getData();
    if (!name) name = String(row.peloton_display || row.peloton_id || '');
    let color = row.peloton_color ? safeBadgeColor(row.peloton_color) : '#6c757d';
    if (!name) return '';
    return '<span class="badge" style="background-color:' + esc(color) + ';color:#fff">' + esc(name) + '</span>';
  }

  function formatSituacionColorBadge(cell) {
    let name = String(cell.getValue() || '');
    let row = cell.getRow().getData();
    if (!name) name = String(row.situacion_display || row.situacion_id || '');
    let color = row.situacion_color ? safeBadgeColor(row.situacion_color) : '#6c757d';
    if (!name) return '';
    return '<span class="badge" style="background-color:' + esc(color) + ';color:#fff">' + esc(name) + '</span>';
  }

  function getEmpleosCatalog() {
    return app && app.agentesState && Array.isArray(app.agentesState.empleos)
      ? app.agentesState.empleos
      : [];
  }

  function getPelotonesCatalog() {
    return app && app.agentesState && Array.isArray(app.agentesState.pelotones)
      ? app.agentesState.pelotones
      : [];
  }

  function getSituacionesCatalog() {
    return app && app.agentesState && Array.isArray(app.agentesState.situaciones)
      ? app.agentesState.situaciones
      : [];
  }

  function normalizeLookupText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s_-]+/g, ' ');
  }

  function buildEmpleoLookup() {
    let byId = new Map();
    let byDesc = new Map();
    getEmpleosCatalog().forEach(function (e) {
      let id = String((e && e.id_empleo) || '').trim();
      let desc = String((e && e.descripcion) || '').trim();
      let color = String((e && e.color) || '#6c757d').trim();
      if (id) {
        byId.set(id, { descripcion: desc || id, color: color || '#6c757d' });
      }
      if (desc) {
        byDesc.set(normalizeLookupText(desc), {
          descripcion: desc,
          color: color || '#6c757d',
          id: id,
        });
      }
    });
    return { byId: byId, byDesc: byDesc };
  }

  function buildPelotonLookup() {
    let byId = new Map();
    let byDesc = new Map();
    getPelotonesCatalog().forEach(function (e) {
      let id = String((e && e.id_peloton) || '').trim();
      let desc = String((e && e.descripcion) || '').trim();
      let color = String((e && e.color) || '#6c757d').trim();
      if (id) {
        byId.set(id, { descripcion: desc || id, color: color || '#6c757d' });
      }
      if (desc) {
        byDesc.set(normalizeLookupText(desc), {
          descripcion: desc,
          color: color || '#6c757d',
          id: id,
        });
      }
    });
    return { byId: byId, byDesc: byDesc };
  }

  function buildSituacionLookup() {
    let byId = new Map();
    let byDesc = new Map();
    getSituacionesCatalog().forEach(function (e) {
      let id = String((e && e.id_situacion) || '').trim();
      let desc = String((e && e.descripcion) || '').trim();
      let color = String((e && e.color) || '#6c757d').trim();
      if (id) {
        byId.set(id, { descripcion: desc || id, color: color || '#6c757d' });
      }
      if (desc) {
        byDesc.set(normalizeLookupText(desc), {
          descripcion: desc,
          color: color || '#6c757d',
          id: id,
        });
      }
    });
    return { byId: byId, byDesc: byDesc };
  }

  function resolveEmpleoPresentation(value, lookup) {
    let raw = String(value || '').trim();
    if (!raw) return { empleo_display: '', empleo_color: '#6c757d', empleo_nombre: '' };

    if (lookup.byId.has(raw)) {
      let foundById = lookup.byId.get(raw);
      return {
        empleo_display: String(foundById.descripcion || raw),
        empleo_color: String(foundById.color || '#6c757d'),
        empleo_nombre: String(foundById.descripcion || raw),
      };
    }

    let key = normalizeLookupText(raw);
    if (lookup.byDesc.has(key)) {
      let foundByDesc = lookup.byDesc.get(key);
      return {
        empleo_display: String(foundByDesc.descripcion || raw),
        empleo_color: String(foundByDesc.color || '#6c757d'),
        empleo_nombre: String(foundByDesc.descripcion || raw),
      };
    }

    return { empleo_display: raw, empleo_color: '#6c757d', empleo_nombre: raw };
  }

  function resolvePelotonPresentation(value, lookup) {
    let raw = String(value || '').trim();
    if (!raw) return { peloton_display: '', peloton_color: '#6c757d' };
    if (lookup.byId.has(raw)) {
      let foundById = lookup.byId.get(raw);
      return {
        peloton_display: String(foundById.descripcion || raw),
        peloton_color: String(foundById.color || '#6c757d'),
      };
    }
    let key = normalizeLookupText(raw);
    if (lookup.byDesc.has(key)) {
      let foundByDesc = lookup.byDesc.get(key);
      return {
        peloton_display: String(foundByDesc.descripcion || raw),
        peloton_color: String(foundByDesc.color || '#6c757d'),
      };
    }
    return { peloton_display: raw, peloton_color: '#6c757d' };
  }

  function resolveSituacionPresentation(value, lookup) {
    let raw = String(value || '').trim();
    if (!raw) return { situacion_display: '', situacion_color: '#6c757d' };
    if (lookup.byId.has(raw)) {
      let foundById = lookup.byId.get(raw);
      return {
        situacion_display: String(foundById.descripcion || raw),
        situacion_color: String(foundById.color || '#6c757d'),
      };
    }
    let key = normalizeLookupText(raw);
    if (lookup.byDesc.has(key)) {
      let foundByDesc = lookup.byDesc.get(key);
      return {
        situacion_display: String(foundByDesc.descripcion || raw),
        situacion_color: String(foundByDesc.color || '#6c757d'),
      };
    }
    return { situacion_display: raw, situacion_color: '#6c757d' };
  }

  function resolveLookupId(rawValue, lookup) {
    let raw = String(rawValue || '').trim();
    if (!raw) return '';
    if (lookup.byId.has(raw)) return raw;
    let key = normalizeLookupText(raw);
    if (lookup.byDesc.has(key)) {
      let found = lookup.byDesc.get(key);
      if (found && found.id) return String(found.id);
    }
    return raw;
  }

  function normalizeNullableBoolean(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'boolean') return value;
    return parseBoolean(value);
  }

  function buildAltasPayloadRows(rows) {
    let empleoLookup = buildEmpleoLookup();
    let pelotonLookup = buildPelotonLookup();
    let situacionLookup = buildSituacionLookup();

    return (rows || []).map(function (row) {
      let empleoId = resolveLookupId(
        row.empleo_id || row.empleo_display || row.empleo_nombre || row.empleo || '',
        empleoLookup
      );
      let pelotonId = resolveLookupId(
        row.peloton_id || row.peloton_display || row.peloton || '',
        pelotonLookup
      );
      let situacionId = resolveLookupId(
        row.situacion_id || row.situacion_display || row.situacion || '',
        situacionLookup
      );

      return {
        _line: Number(row._line || 0) || null,
        id: row.id == null || row.id === '' ? null : Number(row.id),
        tip: String(row.tip || '').trim().toUpperCase(),
        nombre: String(row.nombre || '').trim(),
        apellido_1: String(row.apellido_1 || '').trim(),
        apellido_2: String(row.apellido_2 || '').trim(),
        email: String(row.email || '').trim(),
        nif: String(row.nif || '').trim().toUpperCase(),
        telefono: String(row.telefono || '').trim(),
        peloton_id: pelotonId,
        empleo_id: empleoId,
        orden_gc: row.orden_gc,
        situacion_id: situacionId,
        fecha_ant_empleo: String(row.fecha_ant_empleo || '').trim(),
        domicilio: String(row.domicilio || '').trim(),
        codigo_postal: String(row.codigo_postal || '').trim(),
        poblacion: String(row.poblacion || '').trim(),
        provincia: String(row.provincia || '').trim(),
        pei: normalizeNullableBoolean(row.pei),
        paef: normalizeNullableBoolean(row.paef),
        aptitudes: String(row.aptitudes || '').trim(),
        comentarios: String(row.comentarios || '').trim(),
        created_at: String(row.created_at || '').trim(),
        created_user: String(row.created_user || '').trim(),
        ars_unidad_id: String(row.ars_unidad_id || '').trim(),
        fecha_baja: String(row.fecha_baja || '').trim(),
        escalafon: String(row.escalafon || '').trim(),
      };
    });
  }

  function getLoadColumns() {
    return [
      { title: '#', field: '_line', width: 48, hozAlign: 'center', frozen: true },
      { title: '', field: '_warn', width: 60, hozAlign: 'center', frozen: true, formatter: warnFormatter },
      { title: 'Avatar', field: 'tip', width: 74, hozAlign: 'center', frozen: true, headerSort: false, formatter: avatarFormatter },
      { title: 'TIP', field: 'tip', width: 110, frozen: true },
      { title: 'Nombre', field: 'nombre', minWidth: 120, frozen: true },
      { title: 'Apellido 1', field: 'apellido_1', minWidth: 120, frozen: true },
      { title: 'Apellido 2', field: 'apellido_2', minWidth: 120, frozen: true },
      { title: 'Email', field: 'email', minWidth: 170, frozen: true },
      { title: 'NIF', field: 'nif', width: 105, frozen: true },
      { title: 'Telefono', field: 'telefono', minWidth: 130, frozen: true },
      { title: 'Pelotón', field: 'peloton_display', minWidth: 140, formatter: formatPelotonColorBadge },
      { title: 'Empleo', field: 'empleo_display', minWidth: 140, formatter: formatEmpleoColorBadge },
      { title: 'Escalafón', field: 'escalafon', minWidth: 150 },
      { title: 'Orden', field: 'orden_gc', width: 80, hozAlign: 'center' },
      { title: 'Ant. Empleo', field: 'fecha_ant_empleo', width: 130, hozAlign: 'center' },
      { title: 'Domicilio', field: 'domicilio', minWidth: 160 },
      { title: 'C.P.', field: 'codigo_postal', width: 95, hozAlign: 'center' },
      { title: 'Poblacion', field: 'poblacion', minWidth: 120 },
      { title: 'Provincia', field: 'provincia', width: 95, hozAlign: 'center' },
      { title: 'PEI', field: 'pei', width: 64, hozAlign: 'center', formatter: 'tickCross', formatterParams: { allowTruthy: true } },
      { title: 'PAEF', field: 'paef', width: 72, hozAlign: 'center', formatter: 'tickCross', formatterParams: { allowTruthy: true } },
      { title: 'Aptitudes', field: 'aptitudes', minWidth: 140 },
      { title: 'Situacion', field: 'situacion_display', minWidth: 140, formatter: formatSituacionColorBadge },
      { title: 'Comentarios', field: 'comentarios', minWidth: 160 },
      { title: 'Fecha Baja', field: 'fecha_baja', width: 130, hozAlign: 'center' },
      { title: 'Agrupación ID', field: 'ars_unidad_id', width: 120, hozAlign: 'center' },
    ];
  }

  function mapStatusLabel(value) {
    let status = String(value || '').toLowerCase();
    if (status === 'created') return 'Creado';
    if (status === 'updated') return 'Actualizado';
    if (status === 'applied') return 'Aplicada';
    if (status === 'skipped') return 'Omitida';
    if (status === 'error') return 'Error';
    return status || 'N/A';
  }

  function mapStatusType(value) {
    let status = String(value || '').toLowerCase();
    if (status === 'created' || status === 'updated' || status === 'applied') {
      return 'success';
    }
    if (status === 'skipped') return 'warning';
    if (status === 'error') return 'danger';
    return 'secondary';
  }

  function renderStatusBadge(cell) {
    let status = String(cell.getValue() || '').toLowerCase();
    let type = mapStatusType(status);
    let label = mapStatusLabel(status);
    return window.GRS1Utils.renderSemanticBadgeHtml(label, type, {
      escapeHtmlFn: esc,
    });
  }

  function warnFormatter(cell) {
    let val = String(cell.getValue() || '');
    let warnMsg = cell.getRow().getData()._warnMsg || '';
    if (val === 'error') {
      return window.GRS1Utils.renderSemanticBadgeHtml('Error', 'danger', {
        escapeHtmlFn: esc,
        title: warnMsg,
      });
    }
    if (val === 'warn') {
      return window.GRS1Utils.renderSemanticBadgeHtml('×', 'warning', {
        escapeHtmlFn: esc,
        title: warnMsg,
      });
    }
    return window.GRS1Utils.renderSemanticBadgeHtml('OK', 'success', {
      escapeHtmlFn: esc,
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
    let seed =
      (row && row.id ? String(row.id) : '') +
      '|' +
      ((row && row.nombre) || '') +
      '|' +
      ((row && row.apellido_1) || '');
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    let hue = Math.abs(hash) % 360;
    return 'hsl(' + hue + ' 55% 45%)';
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

  function avatarFormatter(cell) {
    let row = cell.getRow().getData();
    let initials = avatarGetInitials(row);
    let bg = avatarBg(row);
    let tip = row.tip || '';
    let url = tip ? '/avatars/' + encodeURIComponent(tip) + '.jpg' : '';
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

  function withStandardHeaderFilters(columns) {
    return (columns || []).map(function (col) {
      if (!col || typeof col !== 'object') return col;
      if (Object.prototype.hasOwnProperty.call(col, 'headerFilter')) return col;
      if (col.formatter === 'rowSelection' || col.titleFormatter === 'rowSelection') {
        return Object.assign({}, col, { headerFilter: false });
      }
      if (col.field === '_line' || col.field === '_warn' || col.title === 'Avatar') {
        return Object.assign({}, col, { headerFilter: false });
      }
      if (!col.field) {
        return Object.assign({}, col, { headerFilter: false });
      }
      return Object.assign({}, col, { headerFilter: 'input' });
    });
  }

  // --- Columnas por modo ---

  function getColumnsForMode(mode) {
    if (mode === 'altas') {
      return withStandardHeaderFilters(getLoadColumns());
    }
    if (mode === 'bajas-csv') {
      return [
        { title: '#', field: '_line', width: 55, hozAlign: 'center' },
        { title: 'TIP', field: 'tip', minWidth: 120 },
      ];
    }
    if (mode === 'bajas-seleccion') {
      return withStandardHeaderFilters([
        { formatter: 'rowSelection', titleFormatter: 'rowSelection', width: 36, hozAlign: 'center', headerSort: true },
        { title: 'Avatar', field: 'tip', width: 74, hozAlign: 'center', frozen: true, headerSort: false, formatter: avatarFormatter },
        { title: 'TIP', field: 'tip', width: 110, frozen: true },
        { title: 'NIF', field: 'nif', width: 105, frozen: true },
        { title: 'Nombre', field: 'nombre', minWidth: 160, frozen: true },
        { title: 'Empleo', field: 'empleo_nombre', minWidth: 120,  frozen: true,formatter: formatEmpleoColorBadge },
        { title: 'Fecha Nombramiento', field: 'fecha_ant_empleo',  frozen: true,width: 130, hozAlign: 'center' },
        { title: 'Orden', field: 'orden_gc', width: 80, hozAlign: 'center', frozen: true },
      ]);
    }
    if (mode === 'resultado') {
      return getLoadColumns().concat([
        {
          title: 'Estado',
          field: 'status',
          width: 115,
          hozAlign: 'center',
          frozen: false,
          headerSort: true,
          formatter: renderStatusBadge,
        },
        { title: 'Detalle', field: 'message', minWidth: 240 },
      ]);
    }
    return [];
  }

  var HELP_TEXTS = {
    idle: '<strong>Acciones masivas de agentes</strong> <span class="text-body-secondary">Carga un CSV de altas o bajas, o selecciona agentes para dar de baja.</span>',
    altas: '<strong>Modo Alta masiva</strong> <span class="text-body-secondary"><strong>Obligatorias: </strong> TIP, Nombre, Apellido 1, Apellido 2, Email, Pelotón, Empleo, Orden GC, NIF, Tel\u00e9fono, Situacion,Fecha Nombramiento.<strong>Opcionales: </strong>   Aptitudes, Domicilio, Codigo Postal, Poblacion, Provincia, Comentarios. Referencias: admite ID t\u00e9cnico o literal. <strong>Pol\u00edtica:</strong> si el TIP ya existe se rechaza (no actualiza).</span>',
    'bajas-csv': '<strong>Modo Baja por CSV</strong> <span class="text-body-secondary">Solo se usa la columna <code>TIP</code>. Cualquier otra columna presente en el fichero ser\u00e1 ignorada.</span>',
    'bajas-seleccion': '<strong>Modo Baja por selecci\u00f3n</strong> <span class="text-body-secondary">Selecciona agentes en la tabla y pulsa \u00abEjecutar bajas\u00bb. La operaci\u00f3n es irreversible.</span>',
    resultado: '<strong>Resultado de la \u00faltima operaci\u00f3n</strong> <span class="text-body-secondary">Revisa el estado de cada fila. Las filas con error no fueron procesadas. Usa \u00abExportar errores CSV\u00bb para descargar el detalle.</span>',
  };

  function updateModeHelp(mode) {
    let el = document.getElementById('agentesAccionesColumnasHelp');
    if (!el) return;
    el.innerHTML = HELP_TEXTS[mode] || '';
  }

  function renderMainTable(mode, rows) {
    state.gridMode = mode;
    updateModeHelp(mode);

    if (
      state.mainTable &&
      state.mainTable.element &&
      document.documentElement.contains(state.mainTable.element)
    ) {
      state.mainTable.destroy();
      state.mainTable = null;
    }

    let isSelectable = mode === 'bajas-seleccion';
    let placeholders = {
      idle: 'Carga un CSV o selecciona una operaci\u00f3n',
      altas: 'Sin filas en el CSV de altas',
      'bajas-csv': 'Sin TIPs en el CSV de bajas',
      'bajas-seleccion': 'Sin agentes \u2014 pulsa "Cargar agentes"',
      resultado: 'Sin resultados recientes',
    };

    // @ts-ignore
    state.mainTable = new Tabulator('#tabulatorAgentesMainGrid', {
      locale: 'es-es',
      langs: TABULATOR_LANGS,
      reactiveData: false,
      layout: 'fitColumns',
      height: '380',
      placeholder: placeholders[mode] || 'Sin datos',
      selectable: isSelectable,
      columnDefaults: { headerSort: true, resizable: true },
      columns: getColumnsForMode(mode),
      data: rows || [],
    });

    if (isSelectable) {
      state.mainTable.on('rowSelectionChanged', function () {
        refreshResumenBajas();
      });
    }

    if (mode === 'altas') {
      refreshResumenAltas();
    } else if (mode === 'bajas-csv' || mode === 'bajas-seleccion') {
      refreshResumenBajas();
    } else if (mode === 'resultado') {
      let r = rows || [];
      let ok = r.filter(function (row) {
        return ['created', 'updated', 'applied'].indexOf(String(row.status || '').toLowerCase()) !== -1;
      }).length;
      let errors = r.filter(function (row) {
        return String(row.status || '').toLowerCase() === 'error';
      }).length;
      updateGridBadge(
        r.length + ' filas \u00b7 OK ' + ok + (errors ? ' \u00b7 Err ' + errors : ''),
        errors ? 'danger' : 'success'
      );
    }
  }

  // --- Control de ejecucion ---

  function setExecutionState(isBusy, message) {
    state.isProcessing = Boolean(isBusy);
    let actionIds = [
      'btnAgentesAltasEjecutar',
      'btnAgentesBajasCsvEjecutar',
      'btnAgentesBajasSeleccionEjecutar',
      'btnAgentesBajasDesdeSeleccion',
    ];
    actionIds.forEach(function (id) {
      let el = document.getElementById(id);
      if (!el) return;
      // @ts-ignore
      el.disabled = isBusy;
    });
    if (isBusy) {
      setStatus(message || 'Procesando...', false);
    } else {
      setStatus('', false);
      refreshResumenAltas();
      refreshResumenBajas();
      refreshErrorsCsvButton();
    }
  }

  function formatNowLabel() {
    let d = new Date();
    let pad = function (n) { return String(n).padStart(2, '0'); };
    return (
      pad(d.getDate()) + '/' +
      pad(d.getMonth() + 1) + '/' +
      d.getFullYear() + ' ' +
      pad(d.getHours()) + ':' +
      pad(d.getMinutes()) + ':' +
      pad(d.getSeconds())
    );
  }

  function getCurrentUserLabel() {
    if (app && app.globalState) {
      return String(
        app.globalState.userName ||
        app.globalState.username ||
        app.globalState.email ||
        'desconocido'
      );
    }
    return 'desconocido';
  }

  async function fetchAgentesIndex() {
    let byId = new Map();
    let byTip = new Map();
    try {
      let res = await fetch('/api/agentes', {
        headers: getAuthHeaders(false),
        cache: 'no-store',
      });
      if (!res.ok) return { byId: byId, byTip: byTip };
      let json = await res.json();
      let data = Array.isArray(json.agentes) ? json.agentes : [];
      data.forEach(function (a) {
        let id = Number(a.id);
        let tip = String(a.tip || '').trim().toUpperCase();
        if (Number.isInteger(id) && id > 0) byId.set(id, a);
        if (tip) byTip.set(tip, a);
      });
    } catch (_) {
      // noop
    }
    return { byId: byId, byTip: byTip };
  }

  function buildFallbackRowIndex() {
    let byTip = new Map();
    (state.altasRows || []).forEach(function (r) {
      let tip = String(r.tip || '').trim().toUpperCase();
      if (tip && !byTip.has(tip)) byTip.set(tip, r);
    });
    if (state.mainTable && typeof state.mainTable.getData === 'function') {
      (state.mainTable.getData() || []).forEach(function (r) {
        let tip = String(r.tip || '').trim().toUpperCase();
        if (tip && !byTip.has(tip)) byTip.set(tip, r);
      });
    }
    return byTip;
  }

  async function buildMassiveReportRows(detailRows) {
    let empleoLookup = buildEmpleoLookup();
    let pelotonLookup = buildPelotonLookup();
    let index = await fetchAgentesIndex();
    let fallbackByTip = buildFallbackRowIndex();

    let rows = (detailRows || []).map(function (item) {
      let id = Number(item && item.id);
      let tip = String((item && item.tip) || '').trim().toUpperCase();
      let fromApi = (Number.isInteger(id) && id > 0 ? index.byId.get(id) : null) || index.byTip.get(tip);
      let fromFallback = fallbackByTip.get(tip) || {};

      let nombre = '';
      if (fromApi) {
        nombre = [fromApi.nombre, fromApi.apellido_1, fromApi.apellido_2].filter(Boolean).join(' ');
      }
      if (!nombre) {
        nombre = [fromFallback.nombre, fromFallback.apellido_1, fromFallback.apellido_2].filter(Boolean).join(' ');
      }
      if (!nombre && item && item.nombre) nombre = String(item.nombre);

      let empleoRaw = '';
      if (fromApi) empleoRaw = String(fromApi.empleo_id || fromApi.empleo_nombre || fromApi.empleo || '');
      if (!empleoRaw) empleoRaw = String(fromFallback.empleo_id || fromFallback.empleo_nombre || fromFallback.empleo_display || '');
      let empleoResolved = resolveEmpleoPresentation(empleoRaw, empleoLookup);

      let pelotonRaw = '';
      if (fromApi) pelotonRaw = String(fromApi.peloton_id || fromApi.peloton_nombre || fromApi.peloton || '');
      if (!pelotonRaw) pelotonRaw = String(fromFallback.peloton_id || fromFallback.peloton_display || '');
      let pelotonResolved = resolvePelotonPresentation(pelotonRaw, pelotonLookup);

      let escalafon = fromApi ? String(fromApi.escalafon || '') : String(fromFallback.escalafon || '');

      return {
        tip: tip || String((item && item.tip) || ''),
        nombre: nombre,
        peloton: String(pelotonResolved.peloton_display || pelotonRaw || ''),
        empleo: String(empleoResolved.empleo_display || empleoRaw || ''),
        escalafon: escalafon,
      };
    }).filter(function (r) {
      return String(r.tip || '').trim() !== '';
    });

    rows.sort(function (a, b) {
      let ea = String(a.escalafon || '').toLowerCase();
      let eb = String(b.escalafon || '').toLowerCase();
      if (ea < eb) return -1;
      if (ea > eb) return 1;
      let ta = String(a.tip || '').toLowerCase();
      let tb = String(b.tip || '').toLowerCase();
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return 0;
    });

    return rows;
  }

  async function downloadMassiveOperationPdf(operationTitle, detailRows) {
    // @ts-ignore
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

    let rows = await buildMassiveReportRows(detailRows);
    let head = [['TIP', 'Nombre Completo', 'Pelotón', 'Empleo']];
    let body = rows.map(function (r) {
      return [
        String(r.tip || ''),
        String(r.nombre || ''),
        String(r.peloton || ''),
        String(r.empleo || ''),
      ];
    });

    let fechaListado = formatNowLabel();
    let usuario = getCurrentUserLabel();

    // @ts-ignore
    let jsPDF = window.jspdf.jsPDF;
    let doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    doc.autoTable({
      head: head,
      body: body,
      startY: 52,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [52, 58, 64], textColor: 255 },
      margin: { top: 52, bottom: 28, left: 40, right: 40 },
      didDrawPage: function () {
        let pw = doc.internal.pageSize.getWidth();
        let ph = doc.internal.pageSize.getHeight();
        let p = doc.internal.getCurrentPageInfo().pageNumber;
        let t = doc.internal.getNumberOfPages();

        // Cabecera
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text(operationTitle, 40, 24);
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text('Fecha listado: ' + fechaListado, 40, 38);
        doc.text('Pagina ' + p + ' de ' + t, pw - 40, 24, { align: 'right' });

        // Pie
        doc.setFontSize(8);
        doc.setTextColor(90);
        doc.text('Usuario: ' + usuario, 40, ph - 12);
        doc.text('Timestamp: ' + fechaListado, pw / 2, ph - 12, { align: 'center' });
        doc.text('Pagina ' + p + '/' + t, pw - 40, ph - 12, { align: 'right' });
      },
    });

    let ts = new Date().toISOString().slice(0, 19).replaceAll(':', '-').replace('T', '_');
    doc.save(operationTitle.toLowerCase() + '_masivas_' + ts + '.pdf');
  }

  function resetSectionState() {
    state.isProcessing = false;
    state.gridMode = 'idle';
    state.altasRows = [];
    state.bajasTipsRows = [];
    state.resultRows = [];
    state.lastExecutionDetail = [];
    state.seleccionLoaded = false;
    state.forceReloadAgentesList = false;
    if (state.mainTable && typeof state.mainTable.destroy === 'function') {
      try { state.mainTable.destroy(); } catch (_) { /* noop */ }
    }
    state.mainTable = null;
    if (app.globalState) app.globalState.selectedAgenteIdsForBulk = [];
    if (app.agentesState) app.agentesState.selectedAgenteIdsVista = [];
    setAlert('', 'info');
    setStatus('', false);
  }

  function publishExecutionDetail(operation, detailRows) {
    state.lastExecutionDetail = Array.isArray(detailRows) ? detailRows.slice() : [];

    let altaByLine = new Map();
    (state.altasRows || []).forEach(function (row) {
      altaByLine.set(Number(row._line || 0), row);
    });

    let empleoLookup = buildEmpleoLookup();
    let pelotonLookup = buildPelotonLookup();
    let situacionLookup = buildSituacionLookup();

    state.resultRows = (detailRows || []).map(function (item) {
      let sourceRow = altaByLine.get(Number(item.line || 0)) || {};
      let empleoResolved = resolveEmpleoPresentation(
        sourceRow.empleo_id || sourceRow.empleo_nombre || sourceRow.empleo_display || '',
        empleoLookup
      );
      let pelotonResolved = resolvePelotonPresentation(
        sourceRow.peloton_id || sourceRow.peloton_display || '',
        pelotonLookup
      );
      let situacionResolved = resolveSituacionPresentation(
        sourceRow.situacion_id || sourceRow.situacion_display || '',
        situacionLookup
      );
      let itemErrors = Array.isArray(item.errors) ? item.errors : [];
      let errorColumns = itemErrors
        .map(function (err) {
          return String((err && err.column) || '').trim();
        })
        .filter(function (col) {
          return col !== '' && col !== 'row';
        });
      let extra = '';
      if (errorColumns.length) {
        extra = ' [Columnas: ' + Array.from(new Set(errorColumns)).join(', ') + ']';
      }
      return {
        _line: Number(item.line || sourceRow._line || 0) || '',
        _warn: String(item.status || '').toLowerCase() === 'error' ? 'error' : '',
        operation: operation,
        line: Number(item.line || 0) || '',
        id: Number(item.id || 0) || '',
        tip: String(item.tip || sourceRow.tip || ''),
        email: String(sourceRow.email || ''),
        nif: String(sourceRow.nif || ''),
        telefono: String(sourceRow.telefono || ''),
        nombre: String(sourceRow.nombre || ''),
        apellido_1: String(sourceRow.apellido_1 || ''),
        apellido_2: String(sourceRow.apellido_2 || ''),
        peloton_id: String(sourceRow.peloton_id || ''),
        peloton_display: String(pelotonResolved.peloton_display || sourceRow.peloton_id || ''),
        peloton_color: String(pelotonResolved.peloton_color || '#6c757d'),
        empleo_display: String(empleoResolved.empleo_display || ''),
        empleo_color: String(empleoResolved.empleo_color || '#6c757d'),
        empleo_nombre: String(empleoResolved.empleo_nombre || ''),
        escalafon: String(sourceRow.escalafon || ''),
        fecha_ant_empleo: String(sourceRow.fecha_ant_empleo || ''),
        orden_gc: String(sourceRow.orden_gc || ''),
        domicilio: String(sourceRow.domicilio || ''),
        codigo_postal: String(sourceRow.codigo_postal || ''),
        poblacion: String(sourceRow.poblacion || ''),
        provincia: String(sourceRow.provincia || ''),
        pei: sourceRow.pei === true,
        paef: sourceRow.paef === true,
        aptitudes: String(sourceRow.aptitudes || ''),
        situacion_id: String(sourceRow.situacion_id || ''),
        situacion_display: String(situacionResolved.situacion_display || sourceRow.situacion_id || ''),
        situacion_color: String(situacionResolved.situacion_color || '#6c757d'),
        comentarios: String(sourceRow.comentarios || ''),
        fecha_baja: String(sourceRow.fecha_baja || ''),
        ars_unidad_id: String(sourceRow.ars_unidad_id || ''),
        status: String(item.status || ''),
        message: String(item.message || '') + extra,
      };
    });
    renderMainTable('resultado', state.resultRows);
    refreshErrorsCsvButton();
  }

  function refreshErrorsCsvButton() {
    let btn = document.getElementById('btnAgentesAltasErroresCsv');
    if (!btn) return;
    let hasErrors = (state.lastExecutionDetail || []).some(function (item) {
      return String((item && item.status) || '').toLowerCase() === 'error';
    });
    // @ts-ignore
    btn.disabled = !hasErrors || state.isProcessing;
  }

  function csvCell(value) {
    let text = String(value == null ? '' : value);
    let escaped = text.replaceAll('"', '""');
    if (/[",;\n\r]/.test(escaped)) {
      return '"' + escaped + '"';
    }
    return escaped;
  }

  function downloadAltasErrorsCsv() {
    let rows = [];
    (state.lastExecutionDetail || []).forEach(function (item) {
      if (String((item && item.status) || '').toLowerCase() !== 'error') return;
      let errs = Array.isArray(item.errors) ? item.errors : [];
      if (!errs.length) {
        rows.push([
          item.line || '',
          item.tip || '',
          '',
          'UNKNOWN',
          item.message || 'Error',
          '',
          '',
        ]);
        return;
      }
      errs.forEach(function (err) {
        rows.push([
          item.line || '',
          item.tip || '',
          err.column || '',
          err.code || 'UNKNOWN',
          err.message || 'Error',
          err.value == null ? '' : err.value,
          err.expected || '',
        ]);
      });
    });

    if (!rows.length) {
      showAlert('No hay errores para exportar.', 'info');
      return;
    }

    let header = ['linea', 'tip', 'columna', 'codigo', 'mensaje', 'valor', 'esperado'];
    let csv = [header].concat(rows)
      .map(function (r) {
        return r.map(csvCell).join(';');
      })
      .join('\r\n');

    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    let ts = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    a.href = url;
    a.download = 'errores_altas_agentes_' + ts + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function mapApiValidationErrors(details) {
    if (!Array.isArray(details)) return [];
    let grouped = new Map();

    details.forEach(function (d) {
      let path = Array.isArray(d && d.path) ? d.path : [];
      let line = '';
      if (d && d.row != null && Number.isFinite(Number(d.row))) {
        line = String(Number(d.row));
      } else if (path.length >= 2 && path[0] === 'rows' && Number.isInteger(path[1])) {
        line = String(Number(path[1]) + 2);
      }
      let column = d && d.column ? String(d.column) : (path.length >= 3 ? String(path[2]) : 'row');
      // Una sola fila de resultado por agente/fila de CSV.
      // Si no hay linea detectable, agrupamos en "0" para no duplicar ruido.
      let key = String(line || '0');
      let value = d && Object.prototype.hasOwnProperty.call(d, 'value')
        ? d.value
        : d && Object.prototype.hasOwnProperty.call(d, 'context')
        ? d.context && d.context.value
        : '';
      let errorObj = {
        column: column,
        code: (d && d.code) ? String(d.code) : 'INVALID_PAYLOAD',
        message: String((d && d.message) || 'Error de validación'),
        value: value == null ? '' : String(value),
        expected: d && d.expected ? String(d.expected) : '',
      };

      if (!grouped.has(key)) {
        grouped.set(key, {
          line: line || '',
          tip: '',
          status: 'error',
          message: '',
          errors: [],
        });
      }
      grouped.get(key).errors.push(errorObj);
    });

    return Array.from(grouped.values()).map(function (row) {
      row.message = row.errors
        .map(function (e) {
          let col = String(e.column || '').trim();
          return (col && col !== 'row' ? col + ': ' : '') + e.message;
        })
        .join(' | ');
      return row;
    });
  }

  // --- Utilidades CSV ---

  function extractTipsRows(rows) {
    let out = [];
    (rows || []).forEach(function (row) {
      let tip = String((row && row.tip) || '').trim().toUpperCase();
      if (!tip) return;
      out.push({ _line: row._line || 0, tip: tip });
    });
    let unique = new Map();
    out.forEach(function (row) {
      if (!unique.has(row.tip)) unique.set(row.tip, row);
    });
    return Array.from(unique.values());
  }

  async function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      let reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(new Error('No se pudo leer el fichero CSV.'));
      };
      reader.readAsText(file);
    });
  }

  // --- Carga de CSV ---

  async function onLoadAltasCsv(file) {
    if (!file) return;
    try {
      setStatus('');
      let text = await readTextFile(file);
      let parsed = parseCsvRows(text);

      if (Array.isArray(parsed.unknownHeaders) && parsed.unknownHeaders.length) {
        let detail = parsed.unknownHeaders.map(function (header) {
          return {
            line: 1,
            tip: '',
            status: 'error',
            message: 'Columna no permitida en CSV de altas',
            errors: [
              {
                column: header,
                code: 'UNKNOWN_FIELD',
                message: 'Columna no permitida en CSV de altas',
                value: header,
                expected: 'Usar columnas permitidas de la plantilla',
              },
            ],
          };
        });
        publishExecutionDetail('Validación CSV', detail);
        throw new Error(
          'CSV rechazado: hay columnas no permitidas (' + parsed.unknownHeaders.join(', ') + ')'
        );
      }

      state.altasRows = parsed.rows;

      let empleoLookup = buildEmpleoLookup();
      let pelotonLookup = buildPelotonLookup();
      let situacionLookup = buildSituacionLookup();
      state.altasRows.forEach(function (row) {
        let empleoResolved = resolveEmpleoPresentation(row.empleo_id || '', empleoLookup);
        let pelotonResolved = resolvePelotonPresentation(row.peloton_id || '', pelotonLookup);
        let situacionResolved = resolveSituacionPresentation(row.situacion_id || '', situacionLookup);
        row.empleo_nombre = String(empleoResolved.empleo_nombre || '');
        row.empleo_color = String(empleoResolved.empleo_color || '#6c757d');
        row.empleo_display = String(empleoResolved.empleo_display || row.empleo_id || '');
        row.peloton_color = String(pelotonResolved.peloton_color || '#6c757d');
        row.peloton_display = String(pelotonResolved.peloton_display || row.peloton_id || '');
        row.situacion_color = String(situacionResolved.situacion_color || '#6c757d');
        row.situacion_display = String(situacionResolved.situacion_display || row.situacion_id || '');
      });

      prevalidateAltasRows(state.altasRows);
      renderMainTable('altas', state.altasRows);
      let errors = state.altasRows.filter(function (r) { return r._warn === 'error'; }).length;
      let warns  = state.altasRows.filter(function (r) { return r._warn === 'warn'; }).length;
      let tipo = errors > 0 ? 'warning' : 'info';
      showAlert(
        'CSV de altas: ' + state.altasRows.length + ' filas' +
        (errors ? ' \u00b7 ' + errors + ' sin TIP (ser\u00e1n ignoradas)' : '') +
        (warns  ? ' \u00b7 \u26a0 ' + warns + ' con faltantes DDL para alta nueva' : ''),
        tipo
      );
    } catch (error) {
      showAlert(error.message || 'Error al cargar CSV de altas.', 'danger');
      setStatus(error.message || 'Error al cargar CSV de altas.', true);
    }
  }

  async function onLoadBajasCsv(file) {
    if (!file) return;
    try {
      setStatus('');
      let text = await readTextFile(file);
      let parsed = parseCsvRows(text);

      // Validar que exista columna TIP
      let normalizedHeaders = (parsed.headers || []).map(normalizeHeaderName);
      let hasTip = normalizedHeaders.indexOf('tip') !== -1;
      if (!hasTip) {
        showAlert('El CSV de bajas debe tener la columna "TIP" (obligatoria). Columnas encontradas: ' + (parsed.headers.join(', ') || '(ninguna)'), 'danger');
        setStatus('CSV de bajas sin columna TIP.', true);
        return;
      }

      // Columnas extra: avisamos pero no bloqueamos (bajas solo usa TIP)
      let knownBajasHeaders = new Set(['tip']);
      let extraHeaders = (parsed.headers || []).filter(function (h) {
        return !knownBajasHeaders.has(normalizeHeaderName(h));
      });
      if (extraHeaders.length) {
        showAlert('Columnas extra ignoradas en CSV de bajas: ' + extraHeaders.join(', ') + '. Solo se usa la columna TIP.', 'warning');
      }

      state.bajasTipsRows = extractTipsRows(parsed.rows);
      renderMainTable('bajas-csv', state.bajasTipsRows);
      showAlert('CSV de bajas cargado: ' + state.bajasTipsRows.length + ' TIP \u00fanicos.', 'info');
    } catch (error) {
      showAlert(error.message || 'Error al cargar CSV de bajas.', 'danger');
      setStatus(error.message || 'Error al cargar CSV de bajas.', true);
    }
  }

  // --- Carga de seleccion manual ---
function mapAgenteRowForBajas(row, empleoLookup) {
  let empId = String(row.empleo_id || row.empleo || '');
  let resolved = resolveEmpleoPresentation(empId, empleoLookup);
  if (!resolved.empleo_nombre && row.empleo_nombre) {
    resolved = resolveEmpleoPresentation(row.empleo_nombre, empleoLookup);
  }
  return {
    id: Number(row.id),
    tip: String(row.tip || ''),
    nif: String(row.nif || ''),
    nombre: [row.nombre, row.apellido_1, row.apellido_2]
      .filter(Boolean)
      .join(' '),
    empleo_nombre: resolved.empleo_nombre,
    empleo_color: resolved.empleo_color,
    fecha_ant_empleo: String(row.fecha_ant_empleo || ''),
    orden_gc: String(row.orden_gc || ''),
  };
}
  function getPreselectedIdsFromSharedState() {
    let fromGlobal =
      app.globalState && Array.isArray(app.globalState.selectedAgenteIdsForBulk)
        ? app.globalState.selectedAgenteIdsForBulk
        : [];
    let fromVista =
      app.agentesState && Array.isArray(app.agentesState.selectedAgenteIdsVista)
        ? app.agentesState.selectedAgenteIdsVista
        : [];
    let ids = fromGlobal.concat(fromVista).map(Number).filter(function (id) {
      return Number.isInteger(id) && id > 0;
    });
    return Array.from(new Set(ids));
  }

  async function loadSelectionForBajas() {
    setStatus('Cargando lista de agentes...', false);
    try {
      let rows = [];
      let forceApiReload = state.forceReloadAgentesList === true;

      let empleoLookup = buildEmpleoLookup();
      // 1. Intentar desde tabulatorAgentes si ya esta cargado
      if (!forceApiReload && app.tabulatorAgentes && typeof app.tabulatorAgentes.getData === 'function') {
        let allData = (app.tabulatorAgentes.getData() || []).filter(function (row) { return !row.fecha_baja; });
        if (allData.length) {
          rows = allData.map(function (row) { return mapAgenteRowForBajas(row, empleoLookup); });
        }
      }

      // 2. Si no hay datos locales, cargar desde la API
      if (!rows.length) {
        let res = await fetch('/api/agentes', {
          headers: getAuthHeaders(false),
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('No se pudieron cargar los agentes.');
        let json = await res.json();
        let data = Array.isArray(json.agentes) ? json.agentes
          : Array.isArray(json.data) ? json.data
          : Array.isArray(json) ? json : [];
        data = data.filter(function (row) { return !row.fecha_baja; });
        rows = data.map(function (row) {
          return mapAgenteRowForBajas(row, empleoLookup);
        });
      }

      state.forceReloadAgentesList = false;

      state.seleccionLoaded = true;
      renderMainTable('bajas-seleccion', rows);

      // Pre-seleccionar IDs del estado compartido
      let preselectedIds = getPreselectedIdsFromSharedState();
      if (preselectedIds.length && state.mainTable) {
        let pset = new Set(preselectedIds.map(Number));
        state.mainTable.on('tableBuilt', function () {
          (state.mainTable.getRows() || []).forEach(function (row) {
            if (pset.has(Number(row.getData().id))) row.select();
          });
        });
      }

      setStatus('', false);
      let msg = rows.length + ' agentes cargados';
      if (preselectedIds.length) msg += ' \u00b7 ' + preselectedIds.length + ' pre-marcados desde Lista de Agentes';
      showAlert(msg, 'info');
    } catch (error) {
      setStatus(error.message || 'Error al cargar agentes.', true);
      showAlert(error.message || 'Error al cargar agentes.', 'danger');
    }
  }

  // --- Ejecucion: altas ---

  async function executeAltas() {
    if (!state.altasRows.length) {
      showAlert('No hay filas para procesar en altas masivas.', 'warning');
      return;
    }

    let validRows = state.altasRows.filter(function (r) { return String(r.tip || '').trim() !== ''; });
    if (!validRows.length) {
      showAlert('Ninguna fila tiene TIP v\u00e1lido. Revisa el CSV.', 'danger');
      return;
    }
    let warnCount = validRows.filter(function (r) { return r._warn === 'warn'; }).length;
    let errorCount = validRows.filter(function (r) { return r._warn === 'error'; }).length;
    if (errorCount > 0) {
      showAlert(
        'Hay ' + errorCount + ' fila(s) con errores de validaci\u00f3n en el CSV. Corrige antes de ejecutar.',
        'danger'
      );
      return;
    }
    if (warnCount > 0) {
      setStatus('\u26a0 ' + warnCount + ' fila(s) con advertencias de prevalidaci\u00f3n', false);
    }

    try {
      setExecutionState(true, 'Procesando altas masivas...');
      let payloadRows = buildAltasPayloadRows(state.altasRows);
      let res = await fetch('/api/agentes/altas-masivas', {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ rows: payloadRows }),
      });
      let json = await res.json().catch(function () { return {}; });
      if (!res.ok || !json.ok) {
        let validationRows = mapApiValidationErrors(json && json.details);
        if (validationRows.length) {
          publishExecutionDetail('Alta CSV', validationRows);
        }
        let detailMsg = '';
        if (validationRows.length) {
          let first = validationRows[0];
          let firstDetail = String((first && first.message) || '').trim();
          detailMsg = ' (' + validationRows.length + ' error(es) de validación detectados' +
            (firstDetail ? ' · ' + firstDetail : '') + ')';
        }
        throw new Error(
          ((json && (json.message || json.error)) || 'No se pudieron ejecutar las altas masivas.') + detailMsg
        );
      }

      let r = json.result || {};
      publishExecutionDetail('Alta CSV', r.detail || []);
      showAlert(
        'Altas masivas completadas. Creados: ' + Number(r.created || 0) +
        ' \u00b7 Errores: ' + Number(r.errors || 0),
        r.errors ? 'warning' : 'success'
      );
      await downloadMassiveOperationPdf('ALTAS', r.detail || []);
      setExecutionState(false);

      if (app.currentSection === 'agentes' && typeof app.initializeAgentesTabulator === 'function') {
        Promise.resolve(app.initializeAgentesTabulator()).catch(function () {});
      }
    } catch (error) {
      setExecutionState(false);
      setStatus(error.message || 'Error al ejecutar altas masivas.', true);
      showAlert(error.message || 'Error al ejecutar altas masivas.', 'danger');
    }
  }

  // --- Ejecucion: bajas ---

  async function executeBajasByCsv() {
    if (!state.bajasTipsRows.length) {
      showAlert('No hay TIP en CSV para procesar bajas.', 'warning');
      return;
    }
    await executeBajasPayload({ tips: state.bajasTipsRows.map(function (row) { return row.tip; }) });
  }

  async function executeBajasBySeleccion() {
    if (state.gridMode !== 'bajas-seleccion' || !state.mainTable) {
      showAlert('Primero carga los agentes con "Cargar agentes".', 'warning');
      return;
    }
    let selected = state.mainTable.getSelectedData() || [];
    if (!selected.length) {
      showAlert('Marca al menos un agente en la tabla para ejecutar la baja.', 'warning');
      return;
    }
    await executeBajasPayload({ ids: selected.map(function (row) { return Number(row.id); }) });
  }

  async function executeBajasPayload(payload) {
    try {
      setExecutionState(true, 'Procesando bajas masivas...');
      let res = await fetch('/api/agentes/bajas-masivas', {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify(payload),
      });
      let json = await res.json().catch(function () { return {}; });
      if (!res.ok || !json.ok) {
        throw new Error(
          (json && (json.message || json.error)) || 'No se pudieron ejecutar las bajas masivas.'
        );
      }

      let r = json.result || {};
      publishExecutionDetail('Baja Masiva', r.detail || []);
      showAlert(
        'Bajas masivas completadas. Aplicadas: ' + Number(r.applied || 0) +
        ' \u00b7 Omitidas: ' + Number(r.skipped || 0) +
        ' \u00b7 Errores: ' + Number(r.errors || 0),
        r.errors ? 'warning' : 'success'
      );
      await downloadMassiveOperationPdf('BAJAS', r.detail || []);

      // Invalidar datos locales para forzar recarga real de agentes en la siguiente carga.
      state.forceReloadAgentesList = true;
      if (app.globalState) app.globalState.selectedAgenteIdsForBulk = [];
      if (app.agentesState) app.agentesState.selectedAgenteIdsVista = [];

      if (app.currentSection === 'agentes' && typeof app.initializeAgentesTabulator === 'function') {
        Promise.resolve(app.initializeAgentesTabulator()).catch(function () {});
      }

      setExecutionState(false);
    } catch (error) {
      setExecutionState(false);
      setStatus(error.message || 'Error al ejecutar bajas masivas.', true);
      showAlert(error.message || 'Error al ejecutar bajas masivas.', 'danger');
    }
  }

  // --- Binding de eventos ---

  function bindEvents() {
    let altasInput = document.getElementById('agentesAltasCsvInput');
    if (altasInput && !altasInput.dataset.ttBound) {
      altasInput.dataset.ttBound = '1';
      altasInput.addEventListener('change', function (e) {
        // @ts-ignore
        let file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        onLoadAltasCsv(file);
        // @ts-ignore
        e.target.value = '';
      });
    }

    let bajasInput = document.getElementById('agentesBajasCsvInput');
    if (bajasInput && !bajasInput.dataset.ttBound) {
      bajasInput.dataset.ttBound = '1';
      bajasInput.addEventListener('change', function (e) {
        // @ts-ignore
        let file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        onLoadBajasCsv(file);
        // @ts-ignore
        e.target.value = '';
      });
    }

    let btnAltas = document.getElementById('btnAgentesAltasEjecutar');
    if (btnAltas && !btnAltas.dataset.ttBound) {
      btnAltas.dataset.ttBound = '1';
      btnAltas.addEventListener('click', executeAltas);
    }

    let btnErroresCsv = document.getElementById('btnAgentesAltasErroresCsv');
    if (btnErroresCsv && !btnErroresCsv.dataset.ttBound) {
      btnErroresCsv.dataset.ttBound = '1';
      btnErroresCsv.addEventListener('click', downloadAltasErrorsCsv);
    }

    let btnBajasCsv = document.getElementById('btnAgentesBajasCsvEjecutar');
    if (btnBajasCsv && !btnBajasCsv.dataset.ttBound) {
      btnBajasCsv.dataset.ttBound = '1';
      btnBajasCsv.addEventListener('click', executeBajasByCsv);
    }

    let btnSel = document.getElementById('btnAgentesBajasDesdeSeleccion');
    if (btnSel && !btnSel.dataset.ttBound) {
      btnSel.dataset.ttBound = '1';
      btnSel.addEventListener('click', loadSelectionForBajas);
    }

    let btnBajasSel = document.getElementById('btnAgentesBajasSeleccionEjecutar');
    if (btnBajasSel && !btnBajasSel.dataset.ttBound) {
      btnBajasSel.dataset.ttBound = '1';
      btnBajasSel.addEventListener('click', executeBajasBySeleccion);
    }
  }

  // --- Inicializacion ---

  app.initializeAgentesAccionesSection = async function initializeAgentesAccionesSection() {
    resetSectionState();
    bindAvatarFallbackHandler();
    // Cargar metadatos una sola vez al inicializar la sección (empleos, pelotones, situaciones)
    if (typeof app.loadAgentesMeta === 'function') {
      try { await app.loadAgentesMeta(); } catch (_) { /* noop */ }
    }
    renderMainTable('idle', []);
    bindEvents();
    refreshErrorsCsvButton();
    state.initialized = true;
  };
})();
