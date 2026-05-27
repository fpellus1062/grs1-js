(function () {
  const app = window.GRS1Dashboard;

  function normalizeHexColor(value, fallback) {
    let v = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    return fallback || '#6c757d';
  }

  function colorPickerEditor(cell, onRendered, success) {
    let input = document.createElement('input');
    input.type = 'color';
    input.className = 'form-control form-control-color';
    input.style.cssText =
      'width:100%;height:22px;padding:0;border:none;background:transparent;cursor:pointer;';
    input.value = normalizeHexColor(cell.getValue(), '#6c757d');

    input.addEventListener('change', function () {
      success(normalizeHexColor(input.value, '#6c757d'));
    });
    input.addEventListener('blur', function () {
      success(normalizeHexColor(input.value, '#6c757d'));
    });
    onRendered(function () {
      input.focus();
    });
    return input;
  }

  /** Wire a .notion-color-picker pair (picker ↔ hex input) */
  function setupNotionColorSync(pickerId, hexId) {
    let picker = document.getElementById(pickerId);
    let hex = document.getElementById(hexId);
    if (!picker || !hex) return;
    picker.addEventListener('input', function () {
      hex.value = picker.value;
    });
    hex.addEventListener('input', function () {
      if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value;
    });
    // init hex from picker
    if (!hex.value || hex.value === '#6c757d') hex.value = picker.value;
  }

  // ─── Generic mini-CRUD factory ────────────────────────────────────────────
  // Creates a self-contained CRUD controller for a simple lookup table.
  //
  // cfg = {
  //   apiPath    : '/api/config/empleos',
  //   tableId    : 'tabulatorEmpleos',
  //   pkField    : 'id_empleo',           // row identity field
  //   reportTitle: 'Empleos',             // used in PDF header
  //   columns    : [ Tabulator column defs ],
  //   alertId    : 'alertContainerEmpleo',
  //   saveBarId  : 'saveChangesEmpleo',
  //   pendingId  : 'pendingCountEmpleo',
  //   saveBtnId  : 'btnSaveEmpleo',
  //   discardBtnId: 'btnDiscardEmpleo',
  //   newBtnId   : 'btnNuevoEmpleo',
  //   modalId    : 'modalNuevoEmpleo',
  //   formId     : 'formNuevoEmpleo',
  //   saveBtnModalId: 'btnGuardarNuevoEmpleo',
  //   getFormData: function() { return {...}; },
  //   resetForm  : function() { ... }
  // }

  function createCrud(cfg) {
    const state = {
      rows: [],
      original: [],
      pending: new Map(),
      tabulator: null,
    };

    function headers() {
      let h = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${app.globalState.token}`,
      };
      if (app.globalState.activeArsId)
        h['X-Ars-Id'] = app.globalState.activeArsId;
      return h;
    }

    function showAlert(message, type) {
      const el = document.getElementById(cfg.alertId);
      if (!el) return;
      el.innerHTML = `<div class="alert alert-${type} alert-dismissible py-1 mb-1 fade show" role="alert">
        ${app.escapeHtml(message)}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>`;
      setTimeout(() => {
        el.innerHTML = '';
      }, 5000);
    }

    function updateBar() {
      const count = state.pending.size;
      const bar = document.getElementById(cfg.saveBarId);
      const cntEl = document.getElementById(cfg.pendingId);
      const saveBtn = document.getElementById(cfg.saveBtnId);
      const discardBtn = document.getElementById(cfg.discardBtnId);
      if (cntEl) cntEl.textContent = count;
      if (bar) {
        bar.classList.toggle('pending-changes-active', count > 0);
        bar.classList.toggle('pending-changes-idle', count === 0);
      }
      if (saveBtn) saveBtn.disabled = count === 0;
      if (discardBtn) discardBtn.disabled = count === 0;
    }

    async function load() {
      try {
        const res = await fetch(cfg.apiPath, { headers: headers() });
        if (!res.ok) {
          let msg = 'Error al cargar datos';
          try {
            const err = await res.json();
            msg =
              err && (err.message || err.error)
                ? String(err.message || err.error)
                : msg;
          } catch (_) {
            msg = msg + ' (' + res.status + ')';
          }
          throw new Error(msg);
        }
        const json = await res.json();
        state.rows = json.data || [];
        if (typeof cfg.normalizeRows === 'function') {
          state.rows = cfg.normalizeRows(state.rows);
        }
        state.original = app.cloneRecords(state.rows);
        state.pending.clear();
        if (state.tabulator) await state.tabulator.setData(state.rows);
        updateBar();
      } catch (e) {
        showAlert(e.message, 'danger');
      }
    }

    function initTabulator() {
      const LANGS = {
        'es-es': {
          data: { loading: 'Cargando...', error: 'Error' },
          pagination: {
            page_size: 'Por página',
            first: '«',
            last: '»',
            prev: '‹',
            next: '›',
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

      const deleteBtnCol = {
        title: '',
        width: 60,
        headerSort: false,
        editable: false,
        formatter: function () {
          return '<button class="btn btn-sm btn-outline-danger" type="button" title="Eliminar"><i class="bi bi-trash"></i></button>';
        },
        cellClick: function (e, cell) {
          if (e.target.closest('button'))
            confirmDelete(cell.getRow().getData()[cfg.pkField]);
        },
      };

      state.tabulator = new Tabulator('#' + cfg.tableId, {
        locale: 'es-es',
        langs: LANGS,
        layout: 'fitDataFill',
        height: 'calc(100vh - 420px)',
        pagination: true,
        paginationSize: 25,
        paginationSizeSelector: [10, 25, 50, true],
        columnDefaults: { resizable: true },
        columns: [...cfg.columns, deleteBtnCol],
      });

      state.tabulator.on('cellEdited', function (cell) {
        const rowData = cell.getRow().getData();
        const pk = rowData[cfg.pkField];
        const field = cell.getField();
        const newVal = cell.getValue();
        const oldVal = cell.getOldValue();
        const orig = state.original.find(
          (r) => String(r[cfg.pkField]) === String(pk)
        );
        if (!orig || String(oldVal ?? '') === String(newVal ?? '')) {
          updateBar();
          return;
        }
        if (!state.pending.has(pk)) state.pending.set(pk, { ...orig });
        state.pending.get(pk)[field] = newVal;
        if (typeof cfg.onCellEdited === 'function') {
          cfg.onCellEdited(cell);
        }
        updateBar();
      });
    }

    async function saveAll() {
      const promises = [];
      for (const [pk, changes] of state.pending) {
        promises.push(
          fetch(`${cfg.apiPath}/${encodeURIComponent(pk)}`, {
            method: 'PUT',
            headers: headers(),
            body: JSON.stringify(changes),
          })
        );
      }
      try {
        const results = await Promise.all(promises);
        const failedResponses = results.filter(function (r) {
          return !r.ok;
        });
        const failed = failedResponses.length;
        if (failed === 0) {
          showAlert('Cambios guardados', 'success');
          await load();
        } else {
          let detail = '';
          try {
            const first = failedResponses[0];
            const err = await first.json();
            detail =
              err && (err.message || err.error)
                ? String(err.message || err.error)
                : '';
          } catch (_) {
            detail = '';
          }
          showAlert(
            `${failed} cambio(s) fallaron${detail ? ': ' + detail : ''}`,
            'warning'
          );
        }
      } catch (e) {
        showAlert(e.message, 'danger');
      }
    }

    function discard() {
      state.pending.clear();
      state.rows = app.cloneRecords(state.original);
      if (state.tabulator) state.tabulator.setData(state.rows);
      updateBar();
      showAlert('Cambios descartados', 'info');
    }

    async function confirmDelete(pk) {
      const modalEl = document.getElementById('modalConfirmDeleteConfig');
      if (!modalEl) return;
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      const confirmBtn = document.getElementById('btnConfirmDeleteConfig');
      const handler = async function () {
        confirmBtn.removeEventListener('click', handler);
        modal.hide();
        try {
          const res = await fetch(`${cfg.apiPath}/${encodeURIComponent(pk)}`, {
            method: 'DELETE',
            headers: headers(),
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || 'Error al eliminar');
          }
          showAlert('Registro eliminado', 'success');
          await load();
        } catch (e) {
          showAlert(e.message, 'danger');
        }
      };
      // Clean up any previous listener on dismiss
      modalEl.addEventListener('hide.bs.modal', function cleanup() {
        confirmBtn.removeEventListener('click', handler);
        modalEl.removeEventListener('hide.bs.modal', cleanup);
      });
      confirmBtn.addEventListener('click', handler);
      modal.show();
    }

    async function createRecord() {
      const form = document.getElementById(cfg.formId);
      if (!form || !form.checkValidity()) {
        form && form.classList.add('was-validated');
        return;
      }
      const data = cfg.getFormData();
      try {
        const res = await fetch(cfg.apiPath, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          let msg = 'Error al crear';
          try {
            const err = await res.json();
            msg =
              err && (err.message || err.error)
                ? String(err.message || err.error)
                : msg;
          } catch (_) {
            msg = msg + ' (' + res.status + ')';
          }
          throw new Error(msg);
        }
        const modalEl = document.getElementById(cfg.modalId);
        bootstrap.Modal.getInstance(modalEl)?.hide();
        cfg.resetForm();
        showAlert('Registro creado', 'success');
        await load();
      } catch (e) {
        showAlert(e.message, 'danger');
      }
    }

    function setupEvents() {
      const newBtn = document.getElementById(cfg.newBtnId);
      if (newBtn)
        newBtn.addEventListener('click', function () {
          cfg.resetForm();
          const modalEl = document.getElementById(cfg.modalId);
          const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
          modalEl.addEventListener(
            'hide.bs.modal',
            () => {
              if (document.activeElement) document.activeElement.blur();
            },
            { once: true }
          );
          modal.show();
        });

      const saveModalBtn = document.getElementById(cfg.saveBtnModalId);
      if (saveModalBtn) saveModalBtn.addEventListener('click', createRecord);

      const form = document.getElementById(cfg.formId);
      if (form)
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          createRecord();
        });

      document
        .getElementById(cfg.saveBtnId)
        ?.addEventListener('click', saveAll);
      document
        .getElementById(cfg.discardBtnId)
        ?.addEventListener('click', discard);

      document
        .getElementById(cfg.excelBtnId)
        ?.addEventListener('click', function () {
          const ts = new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', '_')
            .replace(/:/g, '-');
          state.tabulator.download(
            'xlsx',
            cfg.reportTitle.toLowerCase().replace(/\s+/g, '_') +
              '_' +
              ts +
              '.xlsx',
            { sheetName: cfg.reportTitle }
          );
        });

      document
        .getElementById(cfg.pdfBtnId)
        ?.addEventListener('click', function () {
          const usuario = app.globalState.userName || '';
          const fecha = new Date().toLocaleString('es-ES');
          const ts = new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', '_')
            .replace(/:/g, '-');
          const title = cfg.reportTitle;
          const cols = state.tabulator.getColumns().filter(function (c) {
            return c.getDefinition().title && c.getDefinition().field;
          });
          const head = [
            cols.map(function (c) {
              return c.getDefinition().title;
            }),
          ];
          const body = state.tabulator.getData('active').map(function (row) {
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
              doc.text(title, 14, 12);
              doc.setFontSize(7);
              doc.setTextColor(120);
              doc.text(
                'Usuario: ' + usuario + '   Fecha: ' + fecha,
                14,
                ph - 5
              );
              doc.text('P\u00e1gina ' + p + ' de ' + t, pw - 14, ph - 5, {
                align: 'right',
              });
            },
          });
          doc.save(
            title.toLowerCase().replace(/\s+/g, '_') + '_' + ts + '.pdf'
          );
        });
    }

    function setFieldValue(pk, field, newVal) {
      const row = state.rows.find(function (r) {
        return String(r[cfg.pkField]) === String(pk);
      });
      const orig = state.original.find(function (r) {
        return String(r[cfg.pkField]) === String(pk);
      });
      if (!row || !orig) {
        updateBar();
        return;
      }

      row[field] = newVal;

      if (state.tabulator) {
        const tabRow = state.tabulator.getRows().find(function (r) {
          return String(r.getData()[cfg.pkField]) === String(pk);
        });
        if (tabRow) {
          tabRow.update({ [field]: newVal });
        }
      }

      if (!state.pending.has(pk)) {
        state.pending.set(pk, { ...orig });
      }
      state.pending.get(pk)[field] = newVal;

      const pendingRow = state.pending.get(pk);
      const hasDiff = Object.keys(orig).some(function (key) {
        return String(orig[key] ?? '') !== String(pendingRow[key] ?? '');
      });
      if (!hasDiff) {
        state.pending.delete(pk);
      }

      updateBar();
    }

    return { initTabulator, load, setupEvents, setFieldValue };
  }

  // ─── Empleos ──────────────────────────────────────────────────────────────
  function colorBadgeFormatter(cell) {
    let value = cell.getValue();
    let color = String(value || '').trim();
    let display = color || '-';
    let swatch = color || '#adb5bd';

    return (
      '<span style="display:inline-flex;align-items:center;gap:6px;font-size:.75rem;line-height:1.2;">' +
      '<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:' +
      app.escapeHtml(swatch) +
      ';border:1px solid rgba(0,0,0,.2);"></span>' +
      '<span style="font-weight:600;">' +
      app.escapeHtml(display) +
      '</span>' +
      '</span>'
    );
  }

  function textColorFromBackground(bg) {
    let hex = String(bg || '')
      .trim()
      .replace('#', '');
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map(function (c) {
          return c + c;
        })
        .join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      return '#212529';
    }
    let r = parseInt(hex.slice(0, 2), 16);
    let g = parseInt(hex.slice(2, 4), 16);
    let b = parseInt(hex.slice(4, 6), 16);
    let luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#212529' : '#ffffff';
  }

  function colorizedLabelFormatter(cell) {
    let row = cell.getRow().getData() || {};
    let label = String(cell.getValue() || '').trim();
    let bg = String(row.color || '').trim();
    if (!bg) {
      return app.escapeHtml(label || '-');
    }
    let textColor = textColorFromBackground(bg);
    return (
      '<span class="badge" style="background:' +
      app.escapeHtml(bg) +
      ';color:' +
      app.escapeHtml(textColor) +
      ';font-weight:600;font-size:.75rem;padding:.3em .55em;">' +
      app.escapeHtml(label || '-') +
      '</span>'
    );
  }

  function empleoEscalaBadgeFormatter(cell) {
    let row = cell.getRow().getData() || {};
    let escala = cell.getValue() || row.grupo || '';
    let color = (row.color || '').trim();
    let safeEscala = app.escapeHtml(String(escala || '-'));
    let defaultBg = '#6c757d';
    let badgeBg = color || defaultBg;

    return (
      '<span class="badge" style="background:' +
      app.escapeHtml(badgeBg) +
      ';color:#fff;font-weight:600;font-size:.75rem;padding:.3em .55em;">' +
      safeEscala +
      '</span>'
    );
  }

  function configHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${app.globalState.token}`,
    };
  }

  // ─── ARS (Unidades) ──────────────────────────────────────────────────────
  let _agentesCache = null;

  async function loadAgentesForSelect() {
    if (_agentesCache) return _agentesCache;
    try {
      const res = await fetch('/api/agentes', { headers: configHeaders() });
      if (!res.ok) throw new Error('Error al cargar agentes');
      const json = await res.json();
      const agentes = json.agentes || json.data || [];

      // Cargar empleos para filtrar solo Oficiales y obtener descripción/color
      let oficialEmpleos = new Set();
      let empleoMap = {};
      try {
        const resE = await fetch('/api/config/empleos', {
          headers: configHeaders(),
        });
        if (resE.ok) {
          const jsonE = await resE.json();
          (jsonE.data || []).forEach(function (e) {
            if (
              String(e.escala || e.grupo || '').toLowerCase() === 'oficiales'
            ) {
              oficialEmpleos.add(String(e.id_empleo));
            }
            empleoMap[String(e.id_empleo)] = {
              desc: e.descripcion || e.id_empleo,
              color: e.color || '#6c757d',
            };
          });
        }
      } catch (_) {
        /* ignore */
      }

      _agentesCache = agentes
        .filter(function (a) {
          return oficialEmpleos.has(String(a.empleo_id));
        })
        .map(function (a) {
          let parts = [a.apellido_1, a.apellido_2, a.nombre].filter(Boolean);
          let emp = empleoMap[String(a.empleo_id)] || {
            desc: '',
            color: '#6c757d',
          };
          return {
            value: String(a.id),
            label: parts.join(' ') || 'ID ' + a.id,
            empleo: emp.desc,
            empleoColor: emp.color,
          };
        });
    } catch (_) {
      _agentesCache = [];
    }
    return _agentesCache;
  }

  function oficialMandoEditor(cell, onRendered, success, cancel) {
    let select = document.createElement('select');
    select.style.cssText =
      'width:100%;height:100%;border:none;padding:0 2px;font-size:inherit;background:transparent;cursor:pointer;';
    select.innerHTML = '<option value="">— Sin asignar —</option>';
    let current = cell.getValue();
    let ready = false;

    loadAgentesForSelect().then(function (agentes) {
      agentes.forEach(function (a) {
        let opt = document.createElement('option');
        opt.value = a.value;
        opt.textContent = (a.empleo ? a.empleo + ' · ' : '') + a.label;
        select.appendChild(opt);
      });
      select.value = current ? String(current) : '';
      ready = true;
      select.focus();
    });

    onRendered(function () {
      if (ready) select.focus();
    });
    select.addEventListener('change', function () {
      let selectedVal = select.value ? Number(select.value) : null;
      let row = cell.getRow();
      let cached = selectedVal
        ? (_agentesCache || []).find(function (a) {
            return a.value === String(selectedVal);
          })
        : null;
      if (row)
        row.update({
          oficial_mando_nombre: cached ? cached.label : null,
          oficial_mando_empleo: cached ? cached.empleo : null,
          oficial_mando_empleo_color: cached ? cached.empleoColor : null,
        });
      success(selectedVal);
    });
    select.addEventListener('blur', function () {
      setTimeout(function () {
        cancel();
      }, 150);
    });
    return select;
  }

  function oficialMandoFormatter(cell) {
    let row = cell.getRow().getData() || {};
    let nombre = row.oficial_mando_nombre;
    let empleo = row.oficial_mando_empleo || '';
    let empleoColor = row.oficial_mando_empleo_color || '#6c757d';
    if ((!nombre || !String(nombre).trim()) && cell.getValue()) {
      let cached = (_agentesCache || []).find(function (a) {
        return a.value === String(cell.getValue());
      });
      if (cached) {
        nombre = cached.label;
        empleo = cached.empleo || empleo;
        empleoColor = cached.empleoColor || empleoColor;
      }
    }
    if (!nombre || !String(nombre).trim()) {
      return '<span class="text-muted">—</span>';
    }
    let badge = empleo
      ? '<span class="badge me-1" style="background:' +
        app.escapeHtml(empleoColor) +
        ';color:#fff;font-size:.7rem;padding:.2em .45em;">' +
        app.escapeHtml(empleo) +
        '</span>'
      : '';
    return badge + app.escapeHtml(String(nombre).trim());
  }

  // ─── Provincias cache for ARS ─────────────────────────────────────────────
  let _provinciasCache = null;

  function loadProvincias() {
    if (_provinciasCache) return Promise.resolve(_provinciasCache);
    return fetch('/api/config/provincias', {
      headers: { Authorization: 'Bearer ' + app.globalState.token },
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (json) {
        _provinciasCache = (json.data || [])
          .map(function (p) {
            return {
              value: String(p.id),
              label: String(p.nombre || '').trim(),
            };
          })
          .filter(function (p) {
            return !!p.label;
          })
          .sort(function (a, b) {
            return a.label.localeCompare(b.label, 'es', {
              sensitivity: 'base',
            });
          });
        return _provinciasCache;
      });
  }

  function provinciaEditor(cell, onRendered, success) {
    let select = document.createElement('select');
    select.style.cssText = 'width:100%;font-size:.72rem;padding:1px 2px;';
    select.innerHTML = '<option value="">—</option>';
    let currentVal = String(cell.getValue() || '');
    let ready = false;

    loadProvincias().then(function (provincias) {
      provincias.forEach(function (p) {
        let opt = document.createElement('option');
        opt.value = p.value;
        opt.textContent = p.label;
        if (p.value === currentVal) opt.selected = true;
        select.appendChild(opt);
      });
      ready = true;
      select.focus();
    });

    select.addEventListener('change', function () {
      success(select.value);
    });
    select.addEventListener('blur', function () {
      setTimeout(function () {
        if (ready) success(select.value);
      }, 150);
    });
    onRendered(function () {
      select.focus();
    });
    return select;
  }

  function provinciaFormatter(cell) {
    let val = String(cell.getValue() || '').trim();
    if (!val) return '';
    if (!_provinciasCache) return '';
    let found = _provinciasCache.find(function (p) {
      return p.value === val;
    });
    return found ? app.escapeHtml(found.label) : '';
  }

  const arsCrud = createCrud({
    apiPath: '/api/config/ars',
    tableId: 'tabulatorArs',
    pkField: 'id_unidad',
    alertId: 'alertContainerArs',
    saveBarId: 'saveChangesArs',
    pendingId: 'pendingCountArs',
    saveBtnId: 'btnSaveArs',
    discardBtnId: 'btnDiscardArs',
    excelBtnId: 'btnExportExcelArs',
    pdfBtnId: 'btnExportPdfArs',
    reportTitle: 'ARS Unidades',
    newBtnId: 'btnNuevoArs',
    modalId: 'modalNuevoArs',
    formId: 'formNuevoArs',
    saveBtnModalId: 'btnGuardarNuevoArs',
    columns: [
      {
        title: 'Unidad',
        field: 'id_unidad',
        editable: false,
        width: 110,
        headerFilter: 'input',
      },
      {
        title: 'Domicilio',
        field: 'domicilio',
        editor: 'input',
        headerFilter: 'input',
        width: 180,
      },
      {
        title: 'Población',
        field: 'poblacion',
        editor: 'input',
        headerFilter: 'input',
        width: 140,
      },
      { title: 'C.P.', field: 'codigo_postal', editor: 'input', width: 70 },
      {
        title: 'Prov.',
        field: 'provincia',
        editor: provinciaEditor,
        formatter: provinciaFormatter,
        headerFilter: 'input',
        width: 140,
        headerFilterFunc: function (headerValue, rowValue, rowData) {
          let val = String(rowData.provincia || '');
          if (!_provinciasCache)
            return val.toLowerCase().indexOf(headerValue.toLowerCase()) >= 0;
          let found = _provinciasCache.find(function (p) {
            return p.value === val;
          });
          let label = found ? found.label : val;
          return label.toLowerCase().indexOf(headerValue.toLowerCase()) >= 0;
        },
      },
      { title: 'Teléfono', field: 'telefono', editor: 'input', width: 110 },
      {
        title: 'Email',
        field: 'email',
        editor: 'input',
        headerFilter: 'input',
        width: 170,
      },
      {
        title: 'Oficial al Mando',
        field: 'oficial_mando',
        editor: oficialMandoEditor,
        formatter: oficialMandoFormatter,
        headerFilter: 'input',
        width: 180,
        headerFilterFunc: function (headerValue, rowValue, rowData) {
          let nombre = String(rowData.oficial_mando_nombre || '').toLowerCase();
          return nombre.indexOf(headerValue.toLowerCase()) >= 0;
        },
      },
      {
        title: 'Color',
        field: 'color',
        width: 120,
        hozAlign: 'center',
        formatter: colorBadgeFormatter,
        editor: colorPickerEditor,
      },
    ],
    getFormData: function () {
      let hiddenOficial = document.getElementById('nuevoArsOficialMando');
      return {
        id_unidad: document.getElementById('nuevoArsUnidadId')?.value.trim(),
        color: normalizeHexColor(
          document.getElementById('nuevoArsColorHex')?.value ||
            document.getElementById('nuevoArsColor')?.value,
          null
        ),
        domicilio:
          document.getElementById('nuevoArsDomicilio')?.value.trim() || null,
        poblacion:
          document.getElementById('nuevoArsPoblacion')?.value.trim() || null,
        codigo_postal:
          document.getElementById('nuevoArsCp')?.value.trim() || null,
        provincia: document.getElementById('nuevoArsProvincia')?.value || null,
        telefono:
          document.getElementById('nuevoArsTelefono')?.value.trim() || null,
        email: document.getElementById('nuevoArsEmail')?.value.trim() || null,
        oficial_mando:
          hiddenOficial && hiddenOficial.value
            ? Number(hiddenOficial.value)
            : null,
      };
    },
    resetForm: function () {
      let f = document.getElementById('formNuevoArs');
      if (f) {
        f.reset();
        f.classList.remove('was-validated');
      }
      let hiddenOficial = document.getElementById('nuevoArsOficialMando');
      if (hiddenOficial) hiddenOficial.value = '';
      let btnDd = document.getElementById('btnDropdownOficialMando');
      if (btnDd)
        btnDd.innerHTML = '<span class="text-muted">— Sin asignar —</span>';
    },
  });

  // populate agentes dropdown in modal when opening
  function populateArsOficialSelect() {
    let menu = document.getElementById('menuOficialMando');
    let btn = document.getElementById('btnDropdownOficialMando');
    let input = document.getElementById('nuevoArsOficialMando');
    if (!menu || !btn || !input) return;

    loadAgentesForSelect().then(function (agentes) {
      menu.innerHTML =
        '<li><a class="dropdown-item" href="#" data-value="">— Sin asignar —</a></li>' +
        agentes
          .map(function (a) {
            let badge = a.empleo
              ? '<span class="badge me-1" style="background:' +
                app.escapeHtml(a.empleoColor || '#6c757d') +
                '">' +
                app.escapeHtml(a.empleo) +
                '</span>'
              : '';
            return (
              '<li><a class="dropdown-item d-flex align-items-center" href="#" data-value="' +
              app.escapeHtml(String(a.value)) +
              '"' +
              ' data-label="' +
              app.escapeHtml(a.label) +
              '"' +
              ' data-empleo="' +
              app.escapeHtml(a.empleo || '') +
              '"' +
              ' data-empleo-color="' +
              app.escapeHtml(a.empleoColor || '') +
              '">' +
              badge +
              '<span>' +
              app.escapeHtml(a.label) +
              '</span></a></li>'
            );
          })
          .join('');

      menu.querySelectorAll('.dropdown-item').forEach(function (item) {
        item.addEventListener('click', function (e) {
          e.preventDefault();
          let val = this.getAttribute('data-value');
          input.value = val;
          if (!val) {
            btn.innerHTML = '<span class="text-muted">— Sin asignar —</span>';
          } else {
            let empleo = this.getAttribute('data-empleo');
            let color = this.getAttribute('data-empleo-color');
            let label = this.getAttribute('data-label');
            let badgeHtml = empleo
              ? '<span class="badge me-1" style="background:' +
                app.escapeHtml(color || '#6c757d') +
                '">' +
                app.escapeHtml(empleo) +
                '</span>'
              : '';
            btn.innerHTML =
              badgeHtml + '<span>' + app.escapeHtml(label) + '</span>';
          }
        });
      });
    });
  }

  function populateArsProvinciaSelect() {
    let sel = document.getElementById('nuevoArsProvincia');
    if (!sel) return;
    loadProvincias().then(function (provincias) {
      sel.innerHTML =
        '<option value="">—</option>' +
        provincias
          .map(function (p) {
            return (
              '<option value="' +
              app.escapeHtml(p.value) +
              '">' +
              app.escapeHtml(p.label) +
              '</option>'
            );
          })
          .join('');
    });
  }

  // ─── Empleos ──────────────────────────────────────────────────────────────
  const empleosCrud = createCrud({
    apiPath: '/api/config/empleos',
    tableId: 'tabulatorEmpleos',
    pkField: 'id_empleo',
    alertId: 'alertContainerEmpleo',
    saveBarId: 'saveChangesEmpleo',
    pendingId: 'pendingCountEmpleo',
    saveBtnId: 'btnSaveEmpleo',
    discardBtnId: 'btnDiscardEmpleo',
    excelBtnId: 'btnExportExcelEmpleo',
    pdfBtnId: 'btnExportPdfEmpleo',
    reportTitle: 'Empleos',
    newBtnId: 'btnNuevoEmpleo',
    modalId: 'modalNuevoEmpleo',
    formId: 'formNuevoEmpleo',
    saveBtnModalId: 'btnGuardarNuevoEmpleo',
    columns: [
      {
        title: 'Código',
        field: 'id_empleo',
        editable: false,
        width: 90,
        headerFilter: 'input',
      },
      {
        title: 'Descripción',
        field: 'descripcion',
        editor: 'input',
        headerFilter: 'input',
      },
      {
        title: 'Escala',
        field: 'escala',
        headerFilter: 'input',
        formatter: empleoEscalaBadgeFormatter,
        editor: function (cell, onRendered, success, cancel) {
          let select = document.createElement('select');
          select.style.cssText =
            'width:100%;height:100%;border:none;padding:0 2px;font-size:inherit;background:transparent;cursor:pointer;';
          ['Oficiales', 'Suboficiales', 'Guardia Civiles'].forEach(
            function (v) {
              let opt = document.createElement('option');
              opt.value = v;
              opt.textContent = v;
              select.appendChild(opt);
            }
          );
          select.value = cell.getValue() || 'Oficiales';
          onRendered(function () {
            select.focus();
          });
          select.addEventListener('change', function () {
            success(select.value);
          });
          select.addEventListener('blur', function () {
            cancel();
          });
          return select;
        },
      },
      {
        title: 'Jerarquía',
        field: 'jerarquia',
        editor: 'input',
        width: 130,
        headerFilter: 'input',
        formatter: function (cell) {
          let row = cell.getRow().getData() || {};
          let v =
            cell.getValue() != null && String(cell.getValue()).trim() !== ''
              ? String(cell.getValue())
              : row.jerarquia != null
                ? String(row.jerarquia)
                : '';
          return app.escapeHtml(v || '-');
        },
      },
      {
        title: 'Color',
        field: 'color',
        editor: colorPickerEditor,
        width: 120,
        formatter: colorBadgeFormatter,
      },
    ],
    normalizeRows: function (rows) {
      return (Array.isArray(rows) ? rows : []).map(function (r) {
        let escala =
          r && r.escala != null && String(r.escala).trim() !== ''
            ? r.escala
            : r && r.grupo != null
              ? r.grupo
              : '';
        let jerarquia = r && r.jerarquia != null ? String(r.jerarquia) : '';
        return {
          ...r,
          escala: escala,
          jerarquia: jerarquia,
        };
      });
    },
    getFormData: () => ({
      id_empleo: document.getElementById('nuevoEmpleoId')?.value.trim(),
      descripcion: document.getElementById('nuevoEmpleoDesc')?.value.trim(),
      escala: document.getElementById('nuevoEmpleoEscala')?.value,
      jerarquia: document.getElementById('nuevoEmpleoJerarquia')?.value.trim(),
      color: normalizeHexColor(
        document.getElementById('nuevoEmpleoColorHex')?.value ||
          document.getElementById('nuevoEmpleoColor')?.value,
        '#6c757d'
      ),
    }),
    resetForm: () => {
      const f = document.getElementById('formNuevoEmpleo');
      if (f) {
        f.reset();
        f.classList.remove('was-validated');
      }
    },
    onCellEdited: function (cell) {
      let field = cell.getField();
      if (field === 'color' || field === 'escala') {
        cell.getRow().reformat();
      }
    },
  });

  // ─── Pelotones ────────────────────────────────────────────────────────────
  const pelotonesCrud = createCrud({
    apiPath: '/api/config/pelotones',
    tableId: 'tabulatorPelotones',
    pkField: 'id_peloton',
    alertId: 'alertContainerPeloton',
    saveBarId: 'saveChangesPeloton',
    pendingId: 'pendingCountPeloton',
    saveBtnId: 'btnSavePeloton',
    discardBtnId: 'btnDiscardPeloton',
    excelBtnId: 'btnExportExcelPeloton',
    pdfBtnId: 'btnExportPdfPeloton',
    reportTitle: 'Pelotones',
    newBtnId: 'btnNuevoPeloton',
    modalId: 'modalNuevoPeloton',
    formId: 'formNuevoPeloton',
    saveBtnModalId: 'btnGuardarNuevoPeloton',
    columns: [
      {
        title: 'Código',
        field: 'id_peloton',
        editable: false,
        width: 90,
        headerFilter: 'input',
      },
      {
        title: 'Descripción',
        field: 'descripcion',
        editor: 'input',
        headerFilter: 'input',
        formatter: colorizedLabelFormatter,
      },
      {
        title: 'Color',
        field: 'color',
        editor: colorPickerEditor,
        width: 120,
        formatter: colorBadgeFormatter,
      },
    ],
    getFormData: () => ({
      id_peloton: document.getElementById('nuevoPelotonId')?.value.trim(),
      descripcion: document.getElementById('nuevoPelotonDesc')?.value.trim(),
      color: normalizeHexColor(
        document.getElementById('nuevoPelotonColorHex')?.value ||
          document.getElementById('nuevoPelotonColor')?.value,
        '#6c757d'
      ),
    }),
    resetForm: () => {
      const f = document.getElementById('formNuevoPeloton');
      if (f) {
        f.reset();
        f.classList.remove('was-validated');
      }
    },
    onCellEdited: function (cell) {
      if (cell.getField() === 'color') {
        cell.getRow().reformat();
      }
    },
  });

  // ─── Situaciones ──────────────────────────────────────────────────────────
  const situacionesCrud = createCrud({
    apiPath: '/api/config/situaciones',
    tableId: 'tabulatorSituaciones',
    pkField: 'id_situacion',
    alertId: 'alertContainerSituacion',
    saveBarId: 'saveChangesSituacion',
    pendingId: 'pendingCountSituacion',
    saveBtnId: 'btnSaveSituacion',
    discardBtnId: 'btnDiscardSituacion',
    excelBtnId: 'btnExportExcelSituacion',
    pdfBtnId: 'btnExportPdfSituacion',
    reportTitle: 'Situaciones',
    newBtnId: 'btnNuevaSituacion',
    modalId: 'modalNuevaSituacion',
    formId: 'formNuevaSituacion',
    saveBtnModalId: 'btnGuardarNuevaSituacion',
    columns: [
      {
        title: 'Código',
        field: 'id_situacion',
        editable: false,
        width: 100,
        headerFilter: 'input',
      },
      {
        title: 'Descripción',
        field: 'descripcion',
        editor: 'input',
        headerFilter: 'input',
        formatter: colorizedLabelFormatter,
      },
      {
        title: 'Color',
        field: 'color',
        editor: colorPickerEditor,
        width: 120,
        formatter: colorBadgeFormatter,
      },
    ],
    getFormData: () => ({
      id_situacion: document.getElementById('nuevaSituacionId')?.value.trim(),
      descripcion: document.getElementById('nuevaSituacionDesc')?.value.trim(),
      color: normalizeHexColor(
        document.getElementById('nuevaSituacionColorHex')?.value ||
          document.getElementById('nuevaSituacionColor')?.value,
        '#6c757d'
      ),
    }),
    resetForm: () => {
      const f = document.getElementById('formNuevaSituacion');
      if (f) {
        f.reset();
        f.classList.remove('was-validated');
      }
    },
    onCellEdited: function (cell) {
      if (cell.getField() === 'color') {
        cell.getRow().reformat();
      }
    },
  });

  // ─── Roles ────────────────────────────────────────────────────────────────
  function ensureRolDescripcionModal() {
    let existing = document.getElementById('rolDescripcionModal');
    if (existing) return existing;

    let wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="modal fade" id="rolDescripcionModal" tabindex="-1" aria-labelledby="rolDescripcionModalLabel" aria-hidden="true">' +
      '<div class="modal-dialog">' +
      '<div class="modal-content">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="rolDescripcionModalLabel"><i class="bi bi-chat-text me-2"></i>Observaciones del rol</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>' +
      '</div>' +
      '<div class="modal-body">' +
      '<div class="mb-2 text-muted" id="rolDescripcionContexto" style="font-size:.85rem"></div>' +
      '<textarea id="rolDescripcionTextarea" class="form-control" rows="6" maxlength="1000" placeholder="Escriba observaciones del rol..."></textarea>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button type="button" class="btn btn-primary" id="btnSaveRolDescripcion"><i class="bi bi-check2 me-1"></i>Guardar</button>' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(wrapper.firstChild);
    return document.getElementById('rolDescripcionModal');
  }

  function openRolDescripcionModal(rowData, rolesCrudRef) {
    let modalEl = ensureRolDescripcionModal();
    let textarea = document.getElementById('rolDescripcionTextarea');
    let contexto = document.getElementById('rolDescripcionContexto');
    let saveBtn = document.getElementById('btnSaveRolDescripcion');

    if (!textarea || !saveBtn) return;

    textarea.value = rowData.descripcion || '';
    if (contexto) {
      contexto.textContent = 'Rol: ' + (rowData.nombre || 'ID ' + rowData.id);
    }

    saveBtn.onclick = function () {
      rolesCrudRef.setFieldValue(
        rowData.id,
        'descripcion',
        textarea.value.trim() || null
      );
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    };

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  const rolesCrud = createCrud({
    apiPath: '/api/rbac/roles',
    tableId: 'tabulatorRoles',
    pkField: 'id',
    alertId: 'alertContainerRol',
    saveBarId: 'saveChangesRol',
    pendingId: 'pendingCountRol',
    saveBtnId: 'btnSaveRol',
    discardBtnId: 'btnDiscardRol',
    excelBtnId: 'btnExportExcelRol',
    pdfBtnId: 'btnExportPdfRol',
    reportTitle: 'Roles',
    newBtnId: 'btnNuevoRol',
    modalId: 'modalNuevoRol',
    formId: 'formNuevoRol',
    saveBtnModalId: 'btnGuardarNuevoRol',
    columns: [
      {
        title: 'ID',
        field: 'id',
        editable: false,
        width: 60,
        sorter: 'number',
      },
      {
        title: 'Nombre',
        field: 'nombre',
        editor: 'input',
        headerFilter: 'input',
        width: 140,
      },
      {
        title: 'Observaciones',
        field: 'descripcion',
        width: 140,
        editable: false,
        headerSort: false,
        formatter: function (cell) {
          let val = cell.getValue();
          let hasContent = val && String(val).trim().length > 0;
          let cls = hasContent
            ? 'btn btn-sm btn-success'
            : 'btn btn-sm btn-primary';
          let label = hasContent ? 'Ver' : 'Crear';
          return (
            '<button class="' + cls + '" type="button">' + label + '</button>'
          );
        },
        cellClick: function (e, cell) {
          if (e.target.closest('button')) {
            openRolDescripcionModal(cell.getRow().getData(), rolesCrud);
          }
        },
      },
      {
        title: 'Sistema',
        field: 'es_sistema',
        width: 90,
        hozAlign: 'center',
        editable: false,
        formatter: 'tickCross',
        sorter: 'boolean',
      },
      {
        title: 'Activo',
        field: 'activo',
        width: 90,
        hozAlign: 'center',
        formatter: 'tickCross',
        sorter: 'boolean',
        editor: 'tickCross',
      },
    ],
    getFormData: () => ({
      nombre: document.getElementById('nuevoRolNombre')?.value.trim(),
      descripcion:
        document.getElementById('nuevoRolDescripcion')?.value.trim() || null,
    }),
    resetForm: () => {
      const f = document.getElementById('formNuevoRol');
      if (f) {
        f.reset();
        f.classList.remove('was-validated');
      }
    },
  });

  // ─── Permisos ─────────────────────────────────────────────────────────────
  const permisosCrud = createCrud({
    apiPath: '/api/rbac/permisos',
    tableId: 'tabulatorPermisos',
    pkField: 'id',
    alertId: 'alertContainerPermiso',
    saveBarId: 'saveChangesPermiso',
    pendingId: 'pendingCountPermiso',
    saveBtnId: 'btnSavePermiso',
    discardBtnId: 'btnDiscardPermiso',
    excelBtnId: 'btnExportExcelPermiso',
    pdfBtnId: 'btnExportPdfPermiso',
    reportTitle: 'Permisos',
    newBtnId: 'btnNuevoPermiso',
    modalId: 'modalNuevoPermiso',
    formId: 'formNuevoPermiso',
    saveBtnModalId: 'btnGuardarNuevoPermiso',
    columns: [
      {
        title: 'ID',
        field: 'id',
        editable: false,
        width: 60,
        sorter: 'number',
      },
      {
        title: 'Recurso',
        field: 'recurso',
        editor: 'input',
        headerFilter: 'input',
        width: 130,
      },
      {
        title: 'Acción',
        field: 'accion',
        editor: 'input',
        headerFilter: 'input',
        width: 120,
      },
      {
        title: 'Clave',
        field: 'clave',
        editable: false,
        headerFilter: 'input',
        width: 160,
      },
      {
        title: 'Descripción',
        field: 'descripcion',
        editor: 'input',
        headerFilter: 'input',
      },
    ],
    getFormData: () => {
      const recurso = document
        .getElementById('nuevoPermisoRecurso')
        ?.value.trim();
      let accion = document.getElementById('nuevoPermisoAccion')?.value.trim();
      const recursoNorm = String(recurso || '').toLowerCase();
      if (recursoNorm && accion) {
        let accionNorm = String(accion).trim().toLowerCase();
        while (accionNorm.startsWith(recursoNorm + ':')) {
          accionNorm = accionNorm.slice(recursoNorm.length + 1);
        }
        if (accionNorm.includes(':')) {
          accionNorm = accionNorm.split(':').pop();
        }
        accion = accionNorm;
      }
      return {
        recurso: recurso,
        accion: accion,
        descripcion:
          document.getElementById('nuevoPermisoDescripcion')?.value.trim() ||
          null,
      };
    },
    resetForm: () => {
      const f = document.getElementById('formNuevoPermiso');
      if (f) {
        f.reset();
        f.classList.remove('was-validated');
      }
    },
  });

  // ─── Matriz Roles ↔ Permisos ──────────────────────────────────────────────
  const matriz = (function () {
    let _lastData = null;

    function headers() {
      let h = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${app.globalState.token}`,
      };
      if (app.globalState.activeArsId)
        h['X-Ars-Id'] = app.globalState.activeArsId;
      return h;
    }

    function showAlert(message, type) {
      const el = document.getElementById('alertContainerMatriz');
      if (!el) return;
      el.innerHTML = `<div class="alert alert-${type} alert-dismissible py-1 mb-1 fade show" role="alert">
        ${app.escapeHtml(message)}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>`;
      setTimeout(() => {
        el.innerHTML = '';
      }, 5000);
    }

    async function load() {
      try {
        const res = await fetch('/api/rbac/matriz', { headers: headers() });
        if (!res.ok) throw new Error('Error al cargar la matriz');
        const json = await res.json();
        _lastData = json.data;
        render(json.data);
      } catch (e) {
        showAlert(e.message, 'danger');
      }
    }

    function render(data) {
      const container = document.getElementById('matrizContainer');
      if (!container) return;

      const { roles, permisos, matriz: matrizMap } = data;

      // Group permisos by recurso
      const grupos = {};
      permisos.forEach(function (p) {
        if (!grupos[p.recurso]) grupos[p.recurso] = [];
        grupos[p.recurso].push(p);
      });

      let html =
        '<table class="table table-sm table-bordered table-hover mb-0 matriz-permisos">';
      html += '<thead class="table-light"><tr><th>Recurso</th><th>Acción</th>';
      roles.forEach(function (r) {
        html +=
          '<th class="text-center" style="min-width:90px">' +
          app.escapeHtml(r.nombre) +
          '</th>';
      });
      html += '</tr></thead><tbody>';

      const recursoKeys = Object.keys(grupos).sort();
      recursoKeys.forEach(function (recurso) {
        const permsGrupo = grupos[recurso];
        permsGrupo.forEach(function (p, idx) {
          html += '<tr>';
          if (idx === 0) {
            html +=
              '<td rowspan="' +
              permsGrupo.length +
              '" class="fw-bold align-middle bg-light">' +
              app.escapeHtml(recurso) +
              '</td>';
          }
          html += '<td>' + app.escapeHtml(p.accion) + '</td>';
          roles.forEach(function (r) {
            const key = r.id + '_' + p.id;
            const checked = matrizMap[key] ? ' checked' : '';
            html +=
              '<td class="text-center"><input type="checkbox" class="form-check-input matriz-check" data-rol="' +
              r.id +
              '" data-permiso="' +
              p.id +
              '"' +
              checked +
              '></td>';
          });
          html += '</tr>';
        });
      });

      html += '</tbody></table>';
      container.innerHTML = html;

      container.querySelectorAll('.matriz-check').forEach(function (cb) {
        cb.addEventListener('change', function () {
          toggle(
            parseInt(this.dataset.rol, 10),
            parseInt(this.dataset.permiso, 10),
            this.checked
          );
        });
      });
    }

    async function toggle(rolId, permisoId, activo) {
      try {
        const res = await fetch('/api/rbac/matriz/toggle', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            rol_id: rolId,
            permiso_id: permisoId,
            activo: activo,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Error al cambiar permiso');
        }
      } catch (e) {
        showAlert(e.message, 'danger');
        await load();
      }
    }

    function setupEvents() {
      document
        .getElementById('btnRefreshMatriz')
        ?.addEventListener('click', load);

      document
        .getElementById('btnExportExcelMatriz')
        ?.addEventListener('click', function () {
          if (!_lastData) return;
          const wb = XLSX.utils.book_new();
          const rows = buildExportRows(_lastData);
          const ws = XLSX.utils.aoa_to_sheet(rows);
          XLSX.utils.book_append_sheet(wb, ws, 'Matriz');
          const ts = new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', '_')
            .replace(/:/g, '-');
          XLSX.writeFile(wb, 'matriz_permisos_' + ts + '.xlsx');
        });

      document
        .getElementById('btnExportPdfMatriz')
        ?.addEventListener('click', function () {
          if (!_lastData) return;
          const rows = buildExportRows(_lastData);
          const head = [rows[0]];
          const body = rows.slice(1);
          const usuario = app.globalState.userName || '';
          const fecha = new Date().toLocaleString('es-ES');
          const ts = new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', '_')
            .replace(/:/g, '-');
          const title = 'Matriz de Permisos';
          const { jsPDF } = window.jspdf;
          const doc = new jsPDF({ orientation: 'landscape' });
          doc.autoTable({
            head: head,
            body: body,
            startY: 18,
            styles: { fontSize: 6, cellPadding: 1.5 },
            headStyles: { fillColor: [52, 58, 64], fontSize: 6 },
            margin: { top: 18, bottom: 14 },
            didDrawPage: function () {
              let pw = doc.internal.pageSize.getWidth();
              let ph = doc.internal.pageSize.getHeight();
              let p = doc.internal.getCurrentPageInfo().pageNumber;
              let t = doc.internal.getNumberOfPages();
              doc.setFontSize(11);
              doc.setTextColor(0);
              doc.text(title, 14, 12);
              doc.setFontSize(7);
              doc.setTextColor(120);
              doc.text(
                'Usuario: ' + usuario + '   Fecha: ' + fecha,
                14,
                ph - 5
              );
              doc.text('Página ' + p + ' de ' + t, pw - 14, ph - 5, {
                align: 'right',
              });
            },
          });
          doc.save('matriz_permisos_' + ts + '.pdf');
        });
    }

    function buildExportRows(data) {
      let roles = data.roles;
      let permisos = data.permisos;
      let matrizMap = data.matriz;
      let header = ['Recurso', 'Acción'];
      roles.forEach(function (r) {
        header.push(r.nombre);
      });
      let rows = [header];
      permisos.forEach(function (p) {
        let row = [p.recurso, p.accion];
        roles.forEach(function (r) {
          row.push(matrizMap[r.id + '_' + p.id] ? 'Sí' : '');
        });
        rows.push(row);
      });
      return rows;
    }

    return { load, setupEvents };
  })();

  // ─── Public initializer ───────────────────────────────────────────────────
  app.initializeConfiguracion = async function initializeConfiguracion() {
    arsCrud.initTabulator();
    empleosCrud.initTabulator();
    pelotonesCrud.initTabulator();
    situacionesCrud.initTabulator();
    rolesCrud.initTabulator();
    permisosCrud.initTabulator();

    await Promise.all([
      typeof app.loadUsuariosRoles === 'function'
        ? app.loadUsuariosRoles()
        : Promise.resolve(),
      typeof app.loadUsuariosArsCatalog === 'function'
        ? app.loadUsuariosArsCatalog()
        : Promise.resolve(),
    ]);

    if (typeof app.initTabulatorUsuarios === 'function') {
      app.initTabulatorUsuarios();
    }

    if (typeof app.initTabulatorAudit === 'function') {
      app.initTabulatorAudit();
    }

    await Promise.all([loadAgentesForSelect(), loadProvincias()]);

    await Promise.all([
      arsCrud.load(),
      empleosCrud.load(),
      pelotonesCrud.load(),
      situacionesCrud.load(),
      rolesCrud.load(),
      permisosCrud.load(),
      matriz.load(),
      typeof app.loadUsuarios === 'function'
        ? app.loadUsuarios()
        : Promise.resolve(),
      typeof app.initializeCalendarios === 'function'
        ? app.initializeCalendarios()
        : Promise.resolve(),
      typeof app.loadAuditLogin === 'function'
        ? app.loadAuditLogin()
        : Promise.resolve(),
    ]);

    arsCrud.setupEvents();
    populateArsOficialSelect();
    populateArsProvinciaSelect();
    empleosCrud.setupEvents();
    pelotonesCrud.setupEvents();
    situacionesCrud.setupEvents();
    rolesCrud.setupEvents();
    permisosCrud.setupEvents();
    matriz.setupEvents();

    // Wire notion color pickers
    setupNotionColorSync('nuevoArsColor', 'nuevoArsColorHex');
    setupNotionColorSync('nuevoEmpleoColor', 'nuevoEmpleoColorHex');
    setupNotionColorSync('nuevoPelotonColor', 'nuevoPelotonColorHex');
    setupNotionColorSync('nuevaSituacionColor', 'nuevaSituacionColorHex');

    if (typeof app.setupUsuariosEventListeners === 'function') {
      app.setupUsuariosEventListeners();
    }

    if (typeof app.setupAuditEventListeners === 'function') {
      app.setupAuditEventListeners();
    }
  };
})();
