(function () {
  const app = window.GRS1Dashboard;
  // ── Form helpers (consolidado) ─────────────────────────────
  app.turnosTemplates = {
    alert(message, type) {
      return (
        '<div class="alert alert-' +
        type +
        ' alert-dismissible fade show" role="alert">' +
        app.escapeHtml(message) +
        '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>' +
        '</div>'
      );
    },
  };
  let turnoFormFields = {
    codigo: 'turnoCodigo',
    nombre: 'turnoNombre',
    hora_inicio: 'turnoHoraInicio',
    hora_fin: 'turnoHoraFin',
    color: 'turnoColor',
    observaciones: 'turnoObservaciones',
  };

  function getTurnoFieldValue(fieldId) {
    let field = document.getElementById(fieldId);
    return field ? field.value : '';
  }

  function setTurnoFieldValue(fieldId, value) {
    let field = document.getElementById(fieldId);
    if (field) field.value = value || '';
  }

  app.getTurnoFormData = function getTurnoFormData() {
    let data = {};
    Object.entries(turnoFormFields).forEach(function (entry) {
      data[entry[0]] = getTurnoFieldValue(entry[1]);
    });
    if (data.codigo) data.codigo = data.codigo.toUpperCase().trim();
    return data;
  };

  app.fillTurnoForm = function fillTurnoForm(turno) {
    Object.entries(turnoFormFields).forEach(function (entry) {
      setTurnoFieldValue(entry[1], turno ? turno[entry[0]] : '');
    });

    let colorPicker = document.getElementById('turnoColorPicker');
    if (colorPicker) {
      let color = turno && turno.color ? turno.color : '#28a745';
      colorPicker.value = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#28a745';
    }

    let codigoField = document.getElementById('turnoCodigo');
    if (codigoField) {
      codigoField.disabled = !!(turno && turno.id_turno);
    }

    let form = document.getElementById('turnoForm');
    if (form) form.classList.remove('was-validated');
  };

  app.validateTurnoForm = function validateTurnoForm() {
    let form = document.getElementById('turnoForm');
    if (!form) return false;
    let isValid = form.checkValidity();
    form.classList.toggle('was-validated', !isValid);
    if (!isValid) form.reportValidity();
    return isValid;
  };

  app.resetTurnoForm = function resetTurnoForm() {
    let form = document.getElementById('turnoForm');
    if (form) {
      form.reset();
      form.classList.remove('was-validated');
    }

    let codigoField = document.getElementById('turnoCodigo');
    if (codigoField) codigoField.disabled = false;

    let title = document.getElementById('turnoModalTitle');
    if (title) title.textContent = 'Agregar Nuevo Turno';
  };

  app.hideTurnoModal = function hideTurnoModal() {
    let modalElement = document.getElementById('turnoModal');
    let modal = modalElement ? bootstrap.Modal.getInstance(modalElement) : null;
    if (modal) modal.hide();
  };

  app.setupTurnoColorSync = function setupTurnoColorSync() {
    let picker = document.getElementById('turnoColorPicker');
    let input = document.getElementById('turnoColor');
    if (picker && input) {
      picker.addEventListener('input', function () {
        input.value = picker.value;
      });
      input.addEventListener('input', function () {
        if (/^#[0-9a-fA-F]{6}$/.test(input.value)) picker.value = input.value;
      });
    }
  };
  const turnoEditableFields = [
    'nombre',
    'hora_inicio',
    'hora_fin',
    'color',
    'observaciones',
    'baja_at',
  ];

  let TABULATOR_LANGS = window.GRS1TabulatorLangs;
  let sameValue = window.GRS1Utils.sameValue;

  function isConsultaReadOnly() {
    return (
      window.GRS1Utils &&
      typeof window.GRS1Utils.isConsultaReadOnlyRole === 'function' &&
      window.GRS1Utils.isConsultaReadOnlyRole(app)
    );
  }

  function guardReadOnlyAction() {
    if (!isConsultaReadOnly()) return false;
    app.showAlertTurno('Perfil consulta: solo lectura', 'warning');
    return true;
  }

  function applyConsultaReadOnlyUi() {
    if (!isConsultaReadOnly()) return;
    if (!window.GRS1Utils || typeof window.GRS1Utils.disableElementsById !== 'function') {
      return;
    }
    window.GRS1Utils.disableElementsById([
      'btnAgregarNuevoTurno',
      'btnSaveAllChangesTurno',
      'btnDiscardChangesTurno',
      'btnSaveTurno',
      'confirmTurnoDeleteBtn',
    ]);
  }

  // ── Helpers ────────────────────────────────────────────────

  function buildTurnoPayload(source) {
    return turnoEditableFields.reduce(function (payload, field) {
      if (Object.hasOwn(source, field)) {
        payload[field] = source[field];
      }
      return payload;
    }, {});
  }

  function buildTurnoChangesPayload(id, changes) {
    let original = app.turnosState.originalTurnos.find(function (t) {
      return Number(t.id_turno) === Number(id);
    });
    if (!original) return {};

    let originalPayload = buildTurnoPayload(original);
    let currentPayload = buildTurnoPayload(changes);

    return turnoEditableFields.reduce(function (payload, field) {
      if (
        Object.hasOwn(currentPayload, field) &&
        !sameValue(originalPayload[field], currentPayload[field])
      ) {
        payload[field] = currentPayload[field];
      }
      return payload;
    }, {});
  }

  function normalizeHexColor(value, fallback) {
    let v = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    return fallback || '#6c757d';
  }

  function turnoColorPickerEditor(cell, onRendered, success, cancel) {
    let input = document.createElement('input');
    input.type = 'color';
    input.className = 'form-control form-control-color';
    input.style.cssText =
      'width:100%;height:30px;padding:0;border:none;background:transparent;';
    input.value = normalizeHexColor(cell.getValue(), '#6c757d');

    onRendered(function () {
      input.focus();
      input.click();
    });

    input.addEventListener('input', function () {
      success(normalizeHexColor(input.value, '#6c757d'));
    });
    input.addEventListener('blur', function () {
      cancel();
    });
    return input;
  }

  function normalizeTime(val) {
    if (!val) return val;
    let s = String(val).trim();
    return s.length > 5 ? s.substring(0, 5) : s;
  }

  function updateTurnosCounters() {
    let totalEl = document.getElementById('totalRecordsTurno');
    let filteredEl = document.getElementById('filteredRecordsTurno');
    if (!app.tabulatorTurnos) return;
    let total = app.tabulatorTurnos.getData().length;
    let filtered = app.tabulatorTurnos.getData('active').length;
    if (totalEl) totalEl.textContent = total;
    if (filteredEl) filteredEl.textContent = filtered;
  }

  function trackPendingTurnoField(id, field, newValue) {
    let original = app.turnosState.originalTurnos.find(function (t) {
      return Number(t.id_turno) === id;
    });
    if (!original) {
      app.updatePendingChangesTurno();
      return;
    }

    let currentPending = app.turnosState.cambiosPendientes.get(id);
    let originalPayload = buildTurnoPayload(original);
    let originalValue = originalPayload[field];

    if (!currentPending && sameValue(originalValue, newValue)) {
      app.updatePendingChangesTurno();
      return;
    }

    if (!currentPending) {
      app.turnosState.cambiosPendientes.set(id, { ...originalPayload });
    }

    let pendingData = app.turnosState.cambiosPendientes.get(id);
    pendingData[field] = newValue;

    let hasDifferences = Object.keys(originalPayload).some(function (key) {
      return !sameValue(originalPayload[key], pendingData[key]);
    });
    if (!hasDifferences) {
      app.turnosState.cambiosPendientes.delete(id);
    }

    let turno = app.turnosState.turnos.find(function (t) {
      return Number(t.id_turno) === id;
    });
    if (turno) {
      turno[field] = newValue;
    }

    app.updatePendingChangesTurno();
  }

  function textColorFromHex(hex) {
    hex = String(hex || '').replace('#', '');
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map(function (c) {
          return c + c;
        })
        .join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#212529';
    let r = parseInt(hex.slice(0, 2), 16);
    let g = parseInt(hex.slice(2, 4), 16);
    let b = parseInt(hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
      ? '#212529'
      : '#ffffff';
  }

  function ensureTurnoObservacionesModal() {
    let existing = document.getElementById('turnoObservacionesModal');
    if (existing) return existing;

    let wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="modal fade" id="turnoObservacionesModal" tabindex="-1" aria-labelledby="turnoObservacionesLabel" aria-hidden="true">' +
      '<div class="modal-dialog">' +
      '<div class="modal-content">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="turnoObservacionesLabel"><i class="bi bi-chat-left-text me-2"></i>Observaciones del turno</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>' +
      '</div>' +
      '<div class="modal-body">' +
      '<div id="turnoObservacionesContext" class="text-muted mb-2" style="font-size:.85rem"></div>' +
      '<textarea id="turnoObservacionesTextarea" class="form-control" rows="6" maxlength="1000" placeholder="Escriba observaciones..."></textarea>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button type="button" class="btn btn-primary" id="btnSaveTurnoObservaciones"><i class="bi bi-check2 me-1"></i>Guardar</button>' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.appendChild(wrapper.firstChild);
    return document.getElementById('turnoObservacionesModal');
  }

  app.openTurnoObservacionesModal = function openTurnoObservacionesModal(
    turnoData
  ) {
    let modalEl = ensureTurnoObservacionesModal();
    let contextEl = document.getElementById('turnoObservacionesContext');
    let textarea = document.getElementById('turnoObservacionesTextarea');
    let saveBtn = document.getElementById('btnSaveTurnoObservaciones');

    if (!textarea || !saveBtn) return;

    if (contextEl) {
      contextEl.textContent =
        'Turno: ' + (turnoData.codigo || '') + ' - ' + (turnoData.nombre || '');
    }
    textarea.value = turnoData.observaciones || '';

    saveBtn.onclick = function () {
      let newValue = textarea.value.trim() || null;
      trackPendingTurnoField(
        Number(turnoData.id_turno),
        'observaciones',
        newValue
      );

      if (app.tabulatorTurnos) {
        let row = app.tabulatorTurnos.getRows().find(function (r) {
          return Number(r.getData().id_turno) === Number(turnoData.id_turno);
        });
        if (row) {
          row.update({ observaciones: newValue });
        }
      }

      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      app.showAlertTurno(
        'Observaciones marcadas como cambio pendiente',
        'info'
      );
    };

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  };

  // ── Tabulator ──────────────────────────────────────────────

  app.initTabulatorTurnos = function initTabulatorTurnos() {
    app.tabulatorTurnos = new Tabulator('#tabulatorTurnos', {
      locale: 'es-es',
      langs: TABULATOR_LANGS,
      layout: 'fitDataFill',
      height: 'calc(100vh - 290px)',
      pagination: true,
      paginationSize: 25,
      paginationSizeSelector: [10, 25, 50, 100, true],
      columnDefaults: { resizable: true },
      columns: [
        {
          formatter: 'rowSelection',
          titleFormatter: 'rowSelection',
          headerSort: false,
          width: 40,
          hozAlign: 'center',
          headerHozAlign: 'center',
          editable: false,
          cellClick: function (e, cell) {
            cell.getRow().toggleSelect();
          },
        },
        {
          title: 'ID',
          field: 'id_turno',
          width: 60,
          editable: false,
          sorter: 'number',
          visible: false,
        },
        {
          title: 'Código',
          field: 'codigo',
          width: 100,
          editable: false,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let row = cell.getRow().getData();
            let codigo = cell.getValue() || '';
            let color = row.color || '#6c757d';
            let textColor = textColorFromHex(color);
            return (
              '<span class="badge" style="background:' +
              app.escapeHtml(color) +
              ';color:' +
              textColor +
              ';font-size:.88em;padding:.4em .65em;font-weight:700">' +
              app.escapeHtml(codigo) +
              '</span>'
            );
          },
        },
        {
          title: 'Nombre',
          field: 'nombre',
          minWidth: 150,
          editor: 'input',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
        },
        {
          title: 'Inicio',
          field: 'hora_inicio',
          width: 90,
          editor: 'time',
          formatter: 'datetime',
          formatterParams: {
            inputFormat: 'HH:mm',
            outputFormat: 'HH:mm',
            invalidPlaceholder: '-',
          },
        },
        {
          title: 'Fin',
          field: 'hora_fin',
          width: 90,
          editor: 'time',
          formatter: 'datetime',
          formatterParams: {
            inputFormat: 'HH:mm',
            outputFormat: 'HH:mm',
            invalidPlaceholder: '-',
          },
        },
        {
          title: 'Color',
          field: 'color',
          width: 110,
          editor: turnoColorPickerEditor,
          formatter: function (cell) {
            let value = cell.getValue() || '';
            let swatch = value || '#adb5bd';
            return (
              '<span style="display:inline-flex;align-items:center;gap:6px;font-size:.75rem;">' +
              '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' +
              app.escapeHtml(swatch) +
              ';border:1px solid rgba(0,0,0,.2);"></span>' +
              '<span style="font-weight:600;">' +
              app.escapeHtml(value || '-') +
              '</span>' +
              '</span>'
            );
          },
        },
        {
          title: 'Estado',
          field: 'baja_at',
          width: 110,
          editable: true,
          editor: function (cell, onRendered, success, cancel) {
            let select = document.createElement('select');
            select.style.cssText =
              'width:100%;height:100%;border:none;padding:0 2px;font-size:0.72rem;background:transparent;cursor:pointer;';

            [
              { label: 'Activo', value: 'activo' },
              { label: 'De baja', value: 'baja' },
            ].forEach(function (item) {
              let opt = document.createElement('option');
              opt.value = item.value;
              opt.textContent = item.label;
              if (
                (!cell.getValue() && item.value === 'activo') ||
                (cell.getValue() && item.value === 'baja')
              ) {
                opt.selected = true;
              }
              select.appendChild(opt);
            });

            onRendered(function () {
              select.focus();
            });

            select.addEventListener('change', function () {
              let selected = select.value;
              if (selected === 'activo') {
                success(null);
                return;
              }
              success(cell.getValue() || new Date().toISOString());
            });

            select.addEventListener('blur', cancel);
            return select;
          },
          cellClick: function (e, cell) {
            cell.edit(true);
          },
          headerFilter: 'list',
          headerFilterParams: {
            values: { '': 'Todos', activo: 'Activo', baja: 'De baja' },
          },
          headerFilterFunc: function (headerValue, rowValue) {
            if (!headerValue) return true;
            if (headerValue === 'activo') return !rowValue;
            if (headerValue === 'baja') return !!rowValue;
            return true;
          },
          formatter: function (cell) {
            let value = cell.getValue();
            if (!value) {
              return '<span class="badge bg-success" style="font-size:.8em">Activo</span>';
            }
            return '<span class="badge bg-secondary" style="font-size:.8em">Baja</span>';
          },
        },
        {
          title: 'Observaciones',
          field: 'observaciones',
          width: 130,
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
              app.openTurnoObservacionesModal(cell.getRow().getData());
            }
          },
        },
        {
          title: '',
          width: 52,
          headerSort: false,
          editable: false,
          formatter: function () {
            return '<button class="btn btn-sm btn-outline-info" title="Historial" type="button"><i class="bi bi-clock-history"></i></button>';
          },
          cellClick: function (e, cell) {
            if (e.target.closest('button')) {
              app.openTurnoHistorial(cell.getRow().getData());
            }
          },
        },
        {
          title: '',
          width: 52,
          headerSort: false,
          editable: false,
          formatter: function () {
            return '<button class="btn btn-sm btn-outline-danger" title="Eliminar" type="button"><i class="bi bi-trash"></i></button>';
          },
          cellClick: function (e, cell) {
            if (e.target.closest('button')) {
              app.openTurnoDeleteModal(cell.getRow().getData().id_turno);
            }
          },
        },
      ],
    });

    app.tabulatorTurnos.on('cellEdited', function (cell) {
      let rowData = cell.getRow().getData();
      let id = Number(rowData.id_turno);
      let field = cell.getField();
      let newValue = cell.getValue();
      trackPendingTurnoField(id, field, newValue);

      if (field === 'color') {
        cell.getRow().reformat();
      }
    });
    app.tabulatorTurnos.on('dataFiltered', updateTurnosCounters);
    app.tabulatorTurnos.on('renderComplete', updateTurnosCounters);
  };

  // ── Carga de datos ─────────────────────────────────────────

  app.loadTurnos = async function loadTurnos() {
    try {
      let response = await fetch('/api/turnos', {
        headers: { Authorization: 'Bearer ' + app.globalState.token },
      });

      if (!response.ok) throw new Error('Error al cargar turnos');

      let data = await response.json();
      if (!Array.isArray(data.turnos)) {
        throw new Error('La respuesta de la API no es un array válido');
      }

      let normalizedTurnos = app.cloneRecords(data.turnos).map(function (t) {
        if (t.hora_inicio) t.hora_inicio = normalizeTime(t.hora_inicio);
        if (t.hora_fin) t.hora_fin = normalizeTime(t.hora_fin);
        return t;
      });
      app.turnosState.turnos = normalizedTurnos;
      app.turnosState.originalTurnos = app.cloneRecords(normalizedTurnos);
      app.turnosState.cambiosPendientes.clear();

      if (app.tabulatorTurnos) {
        await app.tabulatorTurnos.setData(app.turnosState.turnos);
        updateTurnosCounters();
      }

      app.updatePendingChangesTurno();
    } catch (error) {
      console.error('Error loading turnos:', error);
      app.showAlertTurno('Error al cargar los turnos', 'danger');
    }
  };

  // ── Event listeners ────────────────────────────────────────

  app.setupTurnosEventListeners = function setupTurnosEventListeners() {
    applyConsultaReadOnlyUi();
    document
      .getElementById('btnAgregarNuevoTurno')
      .addEventListener('click', function () {
        if (guardReadOnlyAction()) return;
        app.openTurnoModal();
      });
    document
      .getElementById('btnSaveAllChangesTurno')
      .addEventListener('click', function () {
        if (guardReadOnlyAction()) return;
        app.saveAllChangesTurno();
      });
    document
      .getElementById('btnDiscardChangesTurno')
      .addEventListener('click', function () {
        if (guardReadOnlyAction()) return;
        app.discardChangesTurno();
      });

    document
      .getElementById('btnExportExcelTurno')
      .addEventListener('click', function () {
        let ts = new Date()
          .toISOString()
          .slice(0, 19)
          .replace('T', '_')
          .replace(/:/g, '-');
        app.tabulatorTurnos.download('xlsx', 'turnos_' + ts + '.xlsx', {
          sheetName: 'Turnos',
        });
      });

    document
      .getElementById('btnExportPdfTurno')
      .addEventListener('click', function () {
        let usuario = app.globalState.userName || '';
        let fecha = luxon.DateTime.now()
          .setLocale('es')
          .toFormat('dd/MM/yyyy HH:mm');
        let ts = new Date()
          .toISOString()
          .slice(0, 19)
          .replace('T', '_')
          .replace(/:/g, '-');
        let cols = app.tabulatorTurnos.getColumns().filter(function (c) {
          return c.getDefinition().title && c.getDefinition().field;
        });
        let head = [
          cols.map(function (c) {
            return c.getDefinition().title;
          }),
        ];
        let body = app.tabulatorTurnos.getData('active').map(function (row) {
          return cols.map(function (c) {
            let field = c.getDefinition().field;
            if (field === 'baja_at') return row.baja_at ? 'Baja' : 'Activo';
            return row[field] ?? '';
          });
        });
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
            doc.text('Catálogo de Turnos', 14, 12);
            doc.setFontSize(7);
            doc.setTextColor(120);
            doc.text('Usuario: ' + usuario + '   Fecha: ' + fecha, 14, ph - 5);
            doc.text('Página ' + p + ' de ' + t, pw - 14, ph - 5, {
              align: 'right',
            });
          },
        });
        doc.save('turnos_' + ts + '.pdf');
      });

    app.setupTurnoColorSync();
  };

  // ── Pending changes ────────────────────────────────────────

  app.updatePendingChangesTurno = function updatePendingChangesTurno() {
    let count = app.turnosState.cambiosPendientes.size;
    let countEl = document.getElementById('pendingChangesCountTurno');
    let sectionEl = document.getElementById('saveChangesSectionTurno');
    let saveBtn = document.getElementById('btnSaveAllChangesTurno');
    let discardBtn = document.getElementById('btnDiscardChangesTurno');
    if (countEl) countEl.textContent = count;
    if (sectionEl) {
      sectionEl.classList.toggle('pending-changes-active', count > 0);
      sectionEl.classList.toggle('pending-changes-idle', count === 0);
    }
    if (saveBtn) saveBtn.disabled = isConsultaReadOnly() ? true : count === 0;
    if (discardBtn)
      discardBtn.disabled = isConsultaReadOnly() ? true : count === 0;
    applyConsultaReadOnlyUi();
  };

  app.saveAllChangesTurno = async function saveAllChangesTurno() {
    if (guardReadOnlyAction()) return;
    let promises = [];

    for (let [id, changes] of app.turnosState.cambiosPendientes) {
      let payload = buildTurnoChangesPayload(id, changes);
      if (Object.keys(payload).length === 0) continue;

      promises.push(
        fetch('/api/turnos/' + id, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + app.globalState.token,
          },
          body: JSON.stringify(payload),
        })
      );
    }

    try {
      let responses = await Promise.all(promises);
      let failed = responses.filter(function (r) {
        return !r.ok;
      }).length;

      if (failed === 0) {
        app.showAlertTurno(
          'Todos los cambios guardados correctamente',
          'success'
        );
        await app.loadTurnos();
        return;
      }
      app.showAlertTurno(
        failed + ' cambios fallaron. Revisa los datos.',
        'warning'
      );
    } catch (error) {
      console.error('Error saving turno changes:', error);
      app.showAlertTurno('Error al guardar los cambios', 'danger');
    }
  };

  app.discardChangesTurno = function discardChangesTurno() {
    app.turnosState.cambiosPendientes.clear();
    app.turnosState.turnos = app.cloneRecords(app.turnosState.originalTurnos);

    if (app.tabulatorTurnos) {
      app.tabulatorTurnos.setData(app.turnosState.turnos);
    }

    app.updatePendingChangesTurno();
    app.showAlertTurno('Cambios descartados', 'info');
  };

  // ── Modal crear/editar ─────────────────────────────────────

  app.openTurnoModal = function openTurnoModal(turno) {
    let modal = bootstrap.Modal.getOrCreateInstance(
      document.getElementById('turnoModal')
    );
    let title = document.getElementById('turnoModalTitle');

    if (turno) {
      app.turnoModalState.mode = 'edit';
      app.turnoModalState.id = turno.id_turno;
      title.textContent = 'Editar Turno - ' + (turno.codigo || '');
      app.fillTurnoForm(turno);
    } else {
      app.turnoModalState.mode = 'create';
      app.turnoModalState.id = null;
      app.resetTurnoForm();
    }

    modal.show();
    applyConsultaReadOnlyUi();
  };

  app.handleTurnoSaveClick = function handleTurnoSaveClick() {
    if (guardReadOnlyAction()) return;
    if (!app.validateTurnoForm()) return;

    if (
      app.turnoModalState.mode === 'edit' &&
      app.turnoModalState.id !== null
    ) {
      app.updateTurnoFromModal(app.turnoModalState.id);
      return;
    }

    app.createTurno();
  };

  app.resetTurnoModalState = function resetTurnoModalState() {
    app.turnoModalState.mode = 'create';
    app.turnoModalState.id = null;
    app.resetTurnoForm();
  };

  app.createTurno = async function createTurno() {
    if (guardReadOnlyAction()) return;
    let turnoData = app.getTurnoFormData();

    try {
      let response = await fetch('/api/turnos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + app.globalState.token,
        },
        body: JSON.stringify(turnoData),
      });

      if (!response.ok) {
        let error = await response.json();
        throw new Error(error.message || 'Error al crear turno');
      }

      app.hideTurnoModal();
      app.showAlertTurno('Turno creado correctamente', 'success');
      await app.loadTurnos();
    } catch (error) {
      console.error('Error creating turno:', error);
      app.showAlertTurno(error.message, 'danger');
    }
  };

  app.updateTurnoFromModal = async function updateTurnoFromModal(id) {
    if (guardReadOnlyAction()) return;
    let turnoData = app.getTurnoFormData();
    // No enviar el código (es inmutable)
    delete turnoData.codigo;

    Object.entries(turnoData).forEach(function (entry) {
      trackPendingTurnoField(Number(id), entry[0], entry[1]);
    });

    if (app.tabulatorTurnos) {
      let row = app.tabulatorTurnos.getRows().find(function (r) {
        return Number(r.getData().id_turno) === Number(id);
      });
      if (row) {
        row.update(turnoData);
      }
    }

    app.hideTurnoModal();
    app.showAlertTurno('Turno marcado como cambio pendiente', 'info');
  };

  // ── Modal eliminar ─────────────────────────────────────────

  app.openTurnoDeleteModal = function openTurnoDeleteModal(id) {
    if (guardReadOnlyAction()) return;
    app.turnoIdToDelete = id;
    let turno = app.turnosState.turnos.find(function (t) {
      return t.id_turno === id;
    });
    let label = document.getElementById('deleteTurnoNombre');
    if (label) {
      label.textContent = turno
        ? turno.codigo + ' - ' + turno.nombre
        : '#' + id;
    }

    let modal = new bootstrap.Modal(
      document.getElementById('confirmTurnoDeleteModal')
    );
    modal.show();
  };

  app.confirmDeleteTurno = async function confirmDeleteTurno() {
    if (guardReadOnlyAction()) return;
    if (app.turnoIdToDelete === null) return;

    try {
      let response = await fetch('/api/turnos/' + app.turnoIdToDelete, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + app.globalState.token },
      });

      if (!response.ok) {
        let err = await response.json();
        throw new Error(err.message || 'Error al eliminar turno');
      }

      let modalElement = document.getElementById('confirmTurnoDeleteModal');
      let modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) modal.hide();

      app.turnoIdToDelete = null;
      app.showAlertTurno('Turno eliminado correctamente', 'success');
      await app.loadTurnos();
    } catch (error) {
      console.error('Error deleting turno:', error);
      app.showAlertTurno(error.message, 'danger');
    }
  };

  // ── Historial ──────────────────────────────────────────────

  app.openTurnoHistorial = async function openTurnoHistorial(turno) {
    let title = document.getElementById('turnoHistorialTitle');
    let content = document.getElementById('turnoHistorialContent');

    if (title) {
      title.textContent =
        'Historial - ' + (turno.codigo || '') + ' ' + (turno.nombre || '');
    }

    if (content) {
      content.innerHTML =
        '<div class="text-center text-muted py-4">' +
        '<div class="spinner-border spinner-border-sm me-2" role="status"></div>' +
        'Cargando historial...</div>';
    }

    let modal = bootstrap.Modal.getOrCreateInstance(
      document.getElementById('turnoHistorialModal')
    );
    modal.show();

    try {
      let response = await fetch(
        '/api/turnos/' + turno.id_turno + '/historial',
        {
          headers: { Authorization: 'Bearer ' + app.globalState.token },
        }
      );

      if (!response.ok) throw new Error('Error al cargar historial');

      let data = await response.json();
      let historial = Array.isArray(data.historial) ? data.historial : [];

      if (historial.length === 0) {
        content.innerHTML =
          '<div class="text-center text-muted py-4">No hay registros de cambios.</div>';
        return;
      }

      let html =
        '<div class="table-responsive"><table class="table table-sm table-striped">' +
        '<thead><tr>' +
        '<th>Fecha</th><th>Acción</th><th>Usuario</th><th>Cambios</th>' +
        '</tr></thead><tbody>';

      historial.forEach(function (entry) {
        let fecha = luxon.DateTime.fromISO(entry.created_at)
          .setLocale('es')
          .toFormat('dd/MM/yyyy HH:mm');
        let accion = entry.accion;
        let usuario = entry.usuario_nombre || 'ID: ' + entry.usuario_id;
        let cambios = '';

        if (
          accion === 'UPDATE' &&
          entry.datos_anteriores &&
          entry.datos_nuevos
        ) {
          let antes = entry.datos_anteriores;
          let despues = entry.datos_nuevos;
          let diffs = [];

          Object.keys(despues).forEach(function (key) {
            if (String(antes[key] ?? '') !== String(despues[key] ?? '')) {
              diffs.push(
                '<small><strong>' +
                  app.escapeHtml(key) +
                  ':</strong> ' +
                  app.escapeHtml(String(antes[key] ?? '-')) +
                  ' → ' +
                  app.escapeHtml(String(despues[key] ?? '-')) +
                  '</small>'
              );
            }
          });
          cambios =
            diffs.join('<br>') ||
            '<small class="text-muted">Sin diferencias</small>';
        } else if (accion === 'INSERT' && entry.datos_nuevos) {
          cambios = '<small class="text-success">Registro creado</small>';
        } else if (accion === 'DELETE' && entry.datos_anteriores) {
          cambios = '<small class="text-danger">Registro eliminado</small>';
        }

        let badgeClass =
          accion === 'INSERT'
            ? 'bg-success'
            : accion === 'DELETE'
              ? 'bg-danger'
              : 'bg-warning text-dark';

        html +=
          '<tr>' +
          '<td class="text-nowrap"><small>' +
          app.escapeHtml(fecha) +
          '</small></td>' +
          '<td><span class="badge ' +
          badgeClass +
          '">' +
          app.escapeHtml(accion) +
          '</span></td>' +
          '<td><small>' +
          app.escapeHtml(usuario) +
          '</small></td>' +
          '<td>' +
          cambios +
          '</td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
      content.innerHTML = html;
    } catch (error) {
      console.error('Error loading historial:', error);
      content.innerHTML =
        '<div class="alert alert-danger">Error al cargar el historial: ' +
        app.escapeHtml(error.message) +
        '</div>';
    }
  };

  // ── Alert ──────────────────────────────────────────────────

  app.showAlertTurno = function showAlertTurno(message, type) {
    let container = document.getElementById('alertContainerTurno');
    if (!container) return;
    container.innerHTML = app.turnosTemplates.alert(message, type);
    setTimeout(function () {
      container.innerHTML = '';
    }, 5000);
  };
})();
