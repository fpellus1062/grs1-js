(function () {
  const app = window.GRS1Dashboard;
  const actividadEditableFields = [
    'actividad',
    'nombre',
    'disponible',
    'grupo_id',
    'horario',
    'hora_inicio',
    'hora_fin',
    'color',
  ];

  // @ts-ignore
  let TABULATOR_LANGS = window.GRS1TabulatorLangs;
  // @ts-ignore
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
    app.showAlertActividad('Perfil consulta: solo lectura', 'warning');
    return true;
  }

  function applyConsultaReadOnlyUi() {
    if (!isConsultaReadOnly()) return;
    if (!window.GRS1Utils || typeof window.GRS1Utils.disableElementsById !== 'function') {
      return;
    }
    window.GRS1Utils.disableElementsById([
      'btnAgregarNuevaActividad',
      'btnSaveAllChangesActividad',
      'btnDiscardChangesActividad',
      'btnSaveActividad',
      'confirmActividadDeleteBtn',
    ]);
  }

  function buildActividadPayload(source) {
    return actividadEditableFields.reduce((payload, field) => {
      // @ts-ignore
      if (Object.hasOwn(source, field)) {
        payload[field] = source[field];
      }

      return payload;
    }, {});
  }

  function buildActividadChangesPayload(id, changes) {
    const original = app.actividadesState.originalActividades.find(
      (a) => Number(a.id_actividad) === Number(id)
    );
    if (!original) {
      return {};
    }

    const originalPayload = buildActividadPayload(original);
    const currentPayload = buildActividadPayload(changes);

    return actividadEditableFields.reduce((payload, field) => {
      if (
        // @ts-ignore
        Object.hasOwn(currentPayload, field) &&
        !sameValue(originalPayload[field], currentPayload[field])
      ) {
        payload[field] = currentPayload[field];
      }
      return payload;
    }, {});
  }

  function updateActividadesCounters() {
    let totalEl = document.getElementById('totalRecordsActividad');
    let filteredEl = document.getElementById('filteredRecordsActividad');
    let shownEl = document.getElementById('shownRecordsActividad');
    if (!app.tabulatorActividades) return;
    let total = app.tabulatorActividades.getData().length;
    let filtered = app.tabulatorActividades.getData('active').length;
    if (totalEl) totalEl.textContent = total;
    if (filteredEl) filteredEl.textContent = filtered;
    // @ts-ignore
    if (shownEl) shownEl.textContent = total - filtered;
  }

  function normalizeTime(val) {
    if (!val) return val;
    let s = String(val).trim();
    return s.length > 5 ? s.substring(0, 5) : s;
  }

  function parseTimestampWithoutZone(value) {
    const DateTime = window.luxon && window.luxon.DateTime;
    if (!DateTime || value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const dtSql = DateTime.fromSQL(raw);
    if (dtSql.isValid) return dtSql;
    const dtIso = DateTime.fromISO(raw);
    if (dtIso.isValid) return dtIso;
    return null;
  }

  function formatTimestampWithoutZone(value) {
    const dt = parseTimestampWithoutZone(value);
    if (dt && dt.isValid) {
      return dt.setLocale('es').toFormat('dd/MM/yyyy HH:mm:ss');
    }
    return value == null ? '' : String(value);
  }

  function fechaBajaFormatter(cell) {
    const val = cell.getValue();
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

  function trackPendingActividadField(id, field, newValue) {
    const original = app.actividadesState.originalActividades.find(
      (a) => Number(a.id_actividad) === id
    );
    if (!original) {
      app.updatePendingChangesActividad();
      return;
    }

    const currentPending = app.actividadesState.cambiosPendientes.get(id);
    const originalPayload = buildActividadPayload(original);
    const originalValue = originalPayload[field];

    if (!currentPending && sameValue(originalValue, newValue)) {
      app.updatePendingChangesActividad();
      return;
    }

    if (!currentPending) {
      app.actividadesState.cambiosPendientes.set(id, { ...originalPayload });
    }

    const pendingData = app.actividadesState.cambiosPendientes.get(id);
    pendingData[field] = newValue;

    const hasDifferences = Object.keys(originalPayload).some(
      (key) => !sameValue(originalPayload[key], pendingData[key])
    );
    if (!hasDifferences) {
      app.actividadesState.cambiosPendientes.delete(id);
    }

    const actividad = app.actividadesState.actividades.find(
      (a) => Number(a.id_actividad) === id
    );
    if (actividad) {
      actividad[field] = newValue;
      if (field === 'grupo_id') {
        const grupo = app.actividadesState.grupos.find(
          (g) => String(g.id_grupo) === String(newValue)
        );
        actividad.grupo_nombre = grupo ? grupo.nombre : null;
      }
    }

    app.updatePendingChangesActividad();
  }

  app.getActividadGroupDisplay = function getActividadGroupDisplay(
    grupoId,
    grupoNombre
  ) {
    if (!grupoId) {
      return 'Sin grupo';
    }

    if (grupoNombre) {
      return grupoNombre;
    }

    const grupo = app.actividadesState.grupos.find(
      (item) => Number(item.id_grupo) === Number(grupoId)
    );
    return grupo ? grupo.nombre : 'Grupo desconocido';
  };

  app.loadActividadesMeta = async function loadActividadesMeta() {
    const response = await fetch('/api/actividades/meta', {
      headers: { Authorization: `Bearer ${app.globalState.token}` },
    });

    if (!response.ok) {
      throw new Error('Error al cargar metadatos de servicios');
    }

    const data = await response.json();
    app.actividadesState.grupos = Array.isArray(data.grupos) ? data.grupos : [];
    app.actividadesState.disponibilidadOptions = Array.isArray(
      data.disponibilidadOptions
    )
      ? data.disponibilidadOptions
      : ['', '--a--', '--d--'];
    app.populateActividadFormOptions();
  };

  app.initTabulatorActividades = function initTabulatorActividades() {
    // @ts-ignore
    app.tabulatorActividades = new Tabulator('#tabulatorActividades', {
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
          // @ts-ignore
          cellClick: function (e, cell) {
            cell.getRow().toggleSelect();
          },
        },
        {
          title: 'ID',
          field: 'id_actividad',
          width: 65,
          editable: false,
          sorter: 'number',
          visible: false,
        },
        {
          title: 'Servicio',
          field: 'actividad',
          editor: 'input',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
        },
        {
          title: 'Nombre',
          field: 'nombre',
          editor: 'input',
          minWidth: 140,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
        },
        {
          title: 'Grupo',
          field: 'grupo_id',
          minWidth: 120,
          editor: function (cell, onRendered, success, cancel) {
            const select = document.createElement('select');
            select.style.cssText =
              'width:100%;height:100%;border:none;padding:0 2px;font-size:0.72rem;background:transparent;cursor:pointer;';
            const opciones = [
              { label: 'Sin grupo', value: '' },
              ...app.actividadesState.grupos.map((g) => ({
                label: `${g.id_grupo} - ${g.nombre}`,
                value: String(g.id_grupo),
              })),
            ];
            opciones.forEach(function (item) {
              const opt = document.createElement('option');
              opt.value = item.value;
              opt.textContent = item.label;
              if (String(cell.getValue() || '') === item.value) {
                opt.selected = true;
              }
              select.appendChild(opt);
            });
            onRendered(function () {
              select.focus();
            });
            select.addEventListener('change', function () {
              const val = select.value;
              const grupo = app.actividadesState.grupos.find(
                (g) => String(g.id_grupo) === val
              );
              cell
                .getRow()
                .update({ grupo_nombre: grupo ? grupo.nombre : null });
              success(val);
            });
            select.addEventListener('blur', cancel);
            return select;
          },
          formatter: function (cell) {
            const rowData = cell.getRow().getData();
            const display = app.getActividadGroupDisplay(
              cell.getValue(),
              rowData.grupo_nombre
            );
            const grupo = app.actividadesState.grupos.find(
              (item) => Number(item.id_grupo) === Number(cell.getValue())
            );
            if (grupo && grupo.color) {
              return (
                '<span class="badge" style="background-color:' +
                app.escapeHtml(grupo.color) +
                ';font-size:0.88em;padding:.4em .65em">' +
                app.escapeHtml(display) +
                '</span>'
              );
            }
            return app.escapeHtml(display);
          },
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar grupo...',
          headerFilterFunc: function (headerValue, rowValue, rowData) {
            if (!headerValue) {
              return true;
            }

            const display = app.getActividadGroupDisplay(
              rowValue,
              rowData.grupo_nombre
            );
            return display.toLowerCase().includes(headerValue.toLowerCase());
          },
        },
        {
          title: 'Disponible',
          field: 'disponible',
          width: 115,
          editor: function (cell, onRendered, success, cancel) {
            const select = document.createElement('select');
            select.style.cssText =
              'width:100%;height:100%;border:none;padding:0 2px;font-size:0.72rem;background:transparent;cursor:pointer;';
            [
              { label: 'Sin marca', value: '' },
              { label: '--a--', value: '--a--' },
              { label: '--d--', value: '--d--' },
            ].forEach(function (item) {
              const opt = document.createElement('option');
              opt.value = item.value;
              opt.textContent = item.label;
              if ((cell.getValue() || '') === item.value) {
                opt.selected = true;
              }
              select.appendChild(opt);
            });
            onRendered(function () {
              select.focus();
            });
            select.addEventListener('change', function () {
              success(select.value);
            });
            select.addEventListener('blur', cancel);
            return select;
          },
          formatter: function (cell) {
            return cell.getValue() || 'Sin marca';
          },
          headerFilter: 'list',
          headerFilterParams: {
            values: {
              '': 'Todos',
              __sin_marca__: 'Sin marca',
              '--a--': '--a--',
              '--d--': '--d--',
            },
          },
          headerFilterEmptyCheck: function (value) {
            return !value;
          },
          headerFilterFunc: function (headerValue, rowValue) {
            if (!headerValue) {
              return true;
            }

            if (headerValue === '__sin_marca__') {
              return !rowValue || rowValue === '';
            }

            return rowValue === headerValue;
          },
        },

        {
          title: 'Horario',
          field: 'horario',
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
          title: 'Fecha baja',
          field: 'fecha_baja',
          width: 180,
          editable: false,
          formatter: fechaBajaFormatter,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          headerFilterFunc: function (headerValue, rowValue) {
            if (!headerValue) return true;
            const needle = String(headerValue).toLowerCase().trim();
            if (!needle) return true;
            if (needle === 'activa' || needle === 'activo') return !rowValue;
            if (
              needle === 'baja' ||
              needle === 'inactiva' ||
              needle === 'inactivo'
            ) {
              return !!rowValue;
            }
            return formatTimestampWithoutZone(rowValue)
              .toLowerCase()
              .includes(needle);
          },
        },
        {
          title: 'Color',
          field: 'color',
          width: 80,
          headerSort: false,
          formatter: function (cell) {
            let val = String(cell.getValue() || '').trim();
            if (!val)
              return '<span class="text-muted" style="font-size:.75rem">-</span>';
            return (
              '<span style="display:inline-block;width:22px;height:14px;border-radius:3px;background:' +
              app.escapeHtml(val) +
              ';border:1px solid rgba(0,0,0,.18);vertical-align:middle;"></span>' +
              ' <span style="font-size:.7rem;vertical-align:middle;">' +
              app.escapeHtml(val) +
              '</span>'
            );
          },
          editor: function (cell, onRendered, success, cancel) {
            let input = document.createElement('input');
            input.type = 'color';
            input.className = 'form-control form-control-color';
            input.style.cssText =
              'width:100%;height:28px;padding:0;border:none;background:transparent;cursor:pointer;';
            let current = String(cell.getValue() || '').trim();
            input.value = /^#[0-9a-fA-F]{6}$/.test(current)
              ? current
              : '#6c757d';
            onRendered(function () {
              input.focus();
              input.click();
            });
            input.addEventListener('input', function () {
              success(input.value);
            });
            input.addEventListener('blur', function () {
              cancel();
            });
            return input;
          },
        },
        {
          title: '',
          width: 52,
          headerSort: false,
          editable: false,
          formatter: function () {
            return '<button class="btn btn-sm btn-outline-info" title="Ver ficha" type="button"><i class="bi bi-card-list"></i></button>';
          },
          cellClick: function (e, cell) {
            if (e.target.closest('button')) {
              app.openFichaActividad(cell.getRow().getData());
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
            const title = row.fecha_baja ? 'Reactivar' : 'Dar de baja';
            return (
              '<button class="btn btn-sm btn-outline-danger" title="' +
              app.escapeHtml(title) +
              '" type="button"><i class="bi bi-trash"></i></button>'
            );
          },
          cellClick: function (e, cell) {
            if (e.target.closest('button')) {
              const rowData = cell.getRow().getData() || {};
              app.openActividadDeleteModal(rowData.id_actividad);
            }
          },
        },
      ],
    });

    app.tabulatorActividades.on('cellEdited', function (cell) {
      const rowData = cell.getRow().getData();
      const id = Number(rowData.id_actividad);
      const field = cell.getField();
      const newValue = cell.getValue();

      trackPendingActividadField(id, field, newValue);
    });
    app.tabulatorActividades.on('dataFiltered', updateActividadesCounters);
    app.tabulatorActividades.on('renderComplete', updateActividadesCounters);
  };

  app.loadActividades = async function loadActividades() {
    try {
      const response = await fetch(`/api/actividades?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${app.globalState.token}` },
      });

      if (!response.ok) {
        throw new Error('Error al cargar servicios');
      }

      const data = await response.json();
      if (!Array.isArray(data.actividades)) {
        throw new Error('La respuesta de la API no es un array válido');
      }

      const normalizedActividades = app
        .cloneRecords(data.actividades)
        .map(function (a) {
          if (a.hora_inicio) a.hora_inicio = normalizeTime(a.hora_inicio);
          if (a.hora_fin) a.hora_fin = normalizeTime(a.hora_fin);
          return a;
        });
      app.actividadesState.actividades = normalizedActividades;
      app.actividadesState.originalActividades = app.cloneRecords(
        normalizedActividades
      );
      app.actividadesState.cambiosPendientes.clear();

      if (app.tabulatorActividades) {
        await app.tabulatorActividades.setData(
          app.actividadesState.actividades
        );
        updateActividadesCounters();
      }

      app.updatePendingChangesActividad();
    } catch (error) {
      console.error('Error loading actividades:', error);
      app.showAlertActividad('Error al cargar los servicios', 'danger');
    }
  };

  app.setupActividadesEventListeners =
    function setupActividadesEventListeners() {
      applyConsultaReadOnlyUi();
      document
        .getElementById('btnAgregarNuevaActividad')
        .addEventListener('click', () => {
          if (guardReadOnlyAction()) return;
          app.openActividadModal();
        });
      document
        .getElementById('btnSaveAllChangesActividad')
        .addEventListener('click', function () {
          if (guardReadOnlyAction()) return;
          app.saveAllChangesActividad();
        });
      document
        .getElementById('btnDiscardChangesActividad')
        .addEventListener('click', function () {
          if (guardReadOnlyAction()) return;
          app.discardChangesActividad();
        });
      document
        .getElementById('btnExportExcelActividad')
        .addEventListener('click', function () {
          const ts = new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', '_')
            .replace(/:/g, '-');
          app.tabulatorActividades.download(
            'xlsx',
            'servicios_' + ts + '.xlsx',
            {
              sheetName: 'Servicios',
            }
          );
        });
      document
        .getElementById('btnExportPdfActividad')
        .addEventListener('click', function () {
          const usuario = app.globalState.userName || '';
          const fecha = luxon.DateTime.now()
            .setLocale('es')
            .toFormat('dd/MM/yyyy HH:mm');
          const ts = new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', '_')
            .replace(/:/g, '-');
          const cols = app.tabulatorActividades
            .getColumns()
            .filter(function (c) {
              return c.getDefinition().title && c.getDefinition().field;
            });
          const head = [
            cols.map(function (c) {
              return c.getDefinition().title;
            }),
          ];
          const body = app.tabulatorActividades
            .getData('active')
            .map(function (row) {
              return cols.map(function (c) {
                const field = c.getDefinition().field;

                if (field === 'grupo_id') {
                  return app.getActividadGroupDisplay(
                    row.grupo_id,
                    row.grupo_nombre
                  );
                }

                if (field === 'disponible') {
                  return row.disponible || 'Sin marca';
                }

                if (field === 'fecha_baja') {
                  return formatTimestampWithoutZone(row.fecha_baja) || 'Activa';
                }

                return row[field] ?? '';
              });
            });
          // @ts-ignore
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
              const pageWidth = doc.internal.pageSize.getWidth();
              const pageHeight = doc.internal.pageSize.getHeight();
              const pageNum = doc.internal.getCurrentPageInfo().pageNumber;
              const totalPages = doc.internal.getNumberOfPages();
              doc.setFontSize(11);
              doc.setTextColor(0);
              doc.text('Listado de Servicios', 14, 12);
              doc.setFontSize(7);
              doc.setTextColor(120);
              doc.text(
                'Usuario: ' + usuario + '   Fecha: ' + fecha,
                14,
                pageHeight - 5
              );
              doc.text(
                'P\u00e1gina ' + pageNum + ' de ' + totalPages,
                pageWidth - 14,
                pageHeight - 5,
                { align: 'right' }
              );
            },
          });
          doc.save('servicios_' + ts + '.pdf');
        });
    };

  app.updatePendingChangesActividad = function updatePendingChangesActividad() {
    const count = app.actividadesState.cambiosPendientes.size;
    const countEl = document.getElementById('pendingChangesCountActividad');
    const sectionEl = document.getElementById('saveChangesSectionActividad');
    const saveBtn = document.getElementById('btnSaveAllChangesActividad');
    const discardBtn = document.getElementById('btnDiscardChangesActividad');
    if (countEl) countEl.textContent = count;
    if (sectionEl) {
      sectionEl.classList.toggle('pending-changes-active', count > 0);
      sectionEl.classList.toggle('pending-changes-idle', count === 0);
    }
    // @ts-ignore
    if (saveBtn) saveBtn.disabled = isConsultaReadOnly() ? true : count === 0;
    // @ts-ignore
    if (discardBtn) discardBtn.disabled = isConsultaReadOnly() ? true : count === 0;
    applyConsultaReadOnlyUi();
  };

  app.saveAllChangesActividad = async function saveAllChangesActividad() {
    if (guardReadOnlyAction()) return;
    const promises = [];

    for (const [id, changes] of app.actividadesState.cambiosPendientes) {
      const payload = buildActividadChangesPayload(id, changes);
      if (Object.keys(payload).length === 0) {
        continue;
      }

      promises.push(
        fetch(`/api/actividades/${id}`, {
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
        app.showAlertActividad(
          'Todos los cambios guardados correctamente',
          'success'
        );
        await app.loadActividades();
        return;
      }

      app.showAlertActividad(
        `${failed} cambios fallaron. Revisa los datos.`,
        'warning'
      );
    } catch (error) {
      console.error('Error saving changes:', error);
      app.showAlertActividad('Error al guardar los cambios', 'danger');
    }
  };

  app.discardChangesActividad = function discardChangesActividad() {
    app.actividadesState.cambiosPendientes.clear();
    app.actividadesState.actividades = app.cloneRecords(
      app.actividadesState.originalActividades
    );

    if (app.tabulatorActividades) {
      app.tabulatorActividades.setData(app.actividadesState.actividades);
    }

    app.updatePendingChangesActividad();
    app.showAlertActividad('Cambios descartados', 'info');
  };

  app.openActividadDeleteModal = function openActividadDeleteModal(id) {
    if (guardReadOnlyAction()) return;
    app.actividadIdToDelete = id;
    const actividad = app.actividadesState.actividades.find(
      (item) => item.id_actividad === id
    );
    const isBaja = !!(actividad && actividad.fecha_baja);
    const label = document.getElementById('deleteActividadNombre');
    if (label) {
      label.textContent = actividad?.nombre || actividad?.actividad || `#${id}`;
    }
    const titleEl = document.getElementById('confirmActividadDeleteTitle');
    const bodyEl = document.getElementById('confirmActividadDeleteText');
    const hintEl = document.getElementById('confirmActividadDeleteHint');
    const confirmBtn = document.getElementById('confirmActividadDeleteBtn');
    if (titleEl)
      titleEl.textContent = isBaja
        ? 'Confirmar reactivación'
        : 'Confirmar baja';
    if (bodyEl)
      bodyEl.innerHTML = isBaja
        ? '¿Está seguro de que desea reactivar el servicio <strong id="deleteActividadNombre">' +
          app.escapeHtml(
            actividad?.nombre || actividad?.actividad || `#${id}`
          ) +
          '</strong>?'
        : '¿Está seguro de que desea dar de baja el servicio <strong id="deleteActividadNombre">' +
          app.escapeHtml(
            actividad?.nombre || actividad?.actividad || `#${id}`
          ) +
          '</strong>?';
    if (hintEl)
      hintEl.textContent = isBaja
        ? 'La actividad volverá a estado activa (fecha_baja = null).'
        : 'Se marcará fecha_baja con la fecha/hora actual.';
    if (confirmBtn)
      confirmBtn.textContent = isBaja ? 'Reactivar' : 'Dar de baja';

    const modal = new bootstrap.Modal(
      document.getElementById('confirmActividadDeleteModal')
    );
    modal.show();
  };

  app.confirmDeleteActividad = async function confirmDeleteActividad() {
    if (guardReadOnlyAction()) return;
    if (app.actividadIdToDelete === null) {
      return;
    }

    try {
      const response = await fetch(
        `/api/actividades/${app.actividadIdToDelete}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${app.globalState.token}` },
        }
      );

      if (!response.ok) {
        const errJson = await response.json().catch(function () {
          return null;
        });
        throw new Error(
          (errJson && errJson.message) || 'Error al cambiar estado de actividad'
        );
      }
      const payload = await response.json().catch(function () {
        return null;
      });

      const modalElement = document.getElementById(
        'confirmActividadDeleteModal'
      );
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) {
        modal.hide();
      }

      app.actividadIdToDelete = null;
      app.showAlertActividad(
        (payload && payload.message) || 'Estado de actividad actualizado',
        'success'
      );
      await app.loadActividades();
    } catch (error) {
      console.error('Error deleting actividad:', error);
      app.showAlertActividad(
        error.message || 'Error al cambiar estado de la actividad',
        'danger'
      );
    }
  };

  app.openActividadModal = function openActividadModal(actividad = null) {
    const modal = bootstrap.Modal.getOrCreateInstance(
      document.getElementById('actividadModal')
    );
    const title = document.getElementById('actividadModalTitle');
    app.populateActividadFormOptions();

    if (actividad) {
      app.actividadModalState.mode = 'edit';
      app.actividadModalState.id = actividad.id_actividad;
      title.textContent = 'Editar Servicio';
      app.fillActividadForm(actividad);
    } else {
      app.actividadModalState.mode = 'create';
      app.actividadModalState.id = null;
      app.resetActividadForm();
    }

    modal.show();
    applyConsultaReadOnlyUi();
  };

  app.handleActividadSaveClick = function handleActividadSaveClick() {
    if (guardReadOnlyAction()) return;
    if (!app.validateActividadForm()) {
      return;
    }

    if (
      app.actividadModalState.mode === 'edit' &&
      app.actividadModalState.id !== null
    ) {
      app.updateActividad(app.actividadModalState.id);
      return;
    }

    app.createActividad();
  };

  app.resetActividadModalState = function resetActividadModalState() {
    app.actividadModalState.mode = 'create';
    app.actividadModalState.id = null;
    app.resetActividadForm();
  };

  app.createActividad = async function createActividad() {
    if (guardReadOnlyAction()) return;
    const actividadData = app.getActividadFormData();

    try {
      const response = await fetch('/api/actividades', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${app.globalState.token}`,
        },
        body: JSON.stringify(actividadData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Error al crear actividad');
      }

      app.hideActividadModal();
      app.showAlertActividad('Actividad creada correctamente', 'success');
      await app.loadActividades();
    } catch (error) {
      console.error('Error creating actividad:', error);
      app.showAlertActividad(error.message, 'danger');
    }
  };

  app.updateActividad = async function updateActividad(id) {
    if (guardReadOnlyAction()) return;
    const actividadData = app.getActividadFormData();

    Object.entries(actividadData).forEach(([field, value]) => {
      trackPendingActividadField(Number(id), field, value);
    });

    if (app.tabulatorActividades) {
      const row = app.tabulatorActividades.getRow(Number(id));
      if (row) {
        const rowUpdate = { ...actividadData };
        const grupo = app.actividadesState.grupos.find(
          (g) => String(g.id_grupo) === String(actividadData.grupo_id)
        );
        rowUpdate.grupo_nombre = grupo ? grupo.nombre : null;
        row.update(rowUpdate);
      }
    }

    app.hideActividadModal();
    app.showAlertActividad('Actividad marcada como cambio pendiente', 'info');
  };

  function actividadBadge(text, color) {
    if (!text) return '<span class="text-muted">-</span>';
    if (!color) return app.escapeHtml(String(text));

    let hex = String(color).replace('#', '');
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map(function (c) {
          return c + c;
        })
        .join('');
    }
    let textColor = '#fff';
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      let r = parseInt(hex.slice(0, 2), 16);
      let g = parseInt(hex.slice(2, 4), 16);
      let b = parseInt(hex.slice(4, 6), 16);
      if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6) {
        textColor = '#212529';
      }
    }

    return (
      '<span class="badge" style="background:' +
      app.escapeHtml(String(color)) +
      ';color:' +
      textColor +
      ';font-size:.85em;padding:.35em .6em">' +
      app.escapeHtml(String(text)) +
      '</span>'
    );
  }

  function fichaActividadField(label, value) {
    return (
      '<div class="col-12 col-md-6 mb-3">' +
      '<div class="text-muted" style="font-size:.75rem;margin-bottom:4px">' +
      app.escapeHtml(label) +
      '</div>' +
      '<div style="line-height:1.3;white-space:normal;overflow-wrap:anywhere;word-break:break-word;">' +
      (value !== null && value !== undefined && value !== ''
        ? value
        : '<span class="text-muted">-</span>') +
      '</div>' +
      '</div>'
    );
  }

  app.openFichaActividad = function openFichaActividad(data) {
    let a = data || {};
    let grupo = app.actividadesState.grupos.find(function (g) {
      return Number(g.id_grupo) === Number(a.grupo_id);
    });

    let grupoNombre = app.getActividadGroupDisplay(a.grupo_id, a.grupo_nombre);
    let grupoColor = grupo ? grupo.color : null;
    let disponibilidad = a.disponible || 'Sin marca';

    let html =
      '<div class="px-2 px-md-4 py-1">' +
      '<div class="row g-3">' +
      fichaActividadField('ID', app.escapeHtml(String(a.id_actividad || ''))) +
      fichaActividadField(
        'Actividad',
        app.escapeHtml(String(a.actividad || ''))
      ) +
      fichaActividadField('Nombre', app.escapeHtml(String(a.nombre || ''))) +
      fichaActividadField('Grupo', actividadBadge(grupoNombre, grupoColor)) +
      fichaActividadField(
        'Disponible',
        app.escapeHtml(String(disponibilidad))
      ) +
      fichaActividadField('Horario', app.escapeHtml(String(a.horario || ''))) +
      fichaActividadField(
        'Hora inicio',
        app.escapeHtml(String(a.hora_inicio || ''))
      ) +
      fichaActividadField(
        'Hora fin',
        app.escapeHtml(String(a.hora_fin || ''))
      ) +
      '</div>' +
      '</div>';

    let body = document.getElementById('fichaActividadBody');
    if (body) {
      body.innerHTML = html;
    }

    let title = document.getElementById('modalFichaActividadLabel');
    if (title) {
      title.textContent =
        'Ficha de Servicio - ' + (a.nombre || a.actividad || '');
    }

    let btn = document.getElementById('btnExportFichaActividadPDF');
    if (btn) {
      btn.onclick = function () {
        exportFichaActividadPDF(a, grupoNombre);
      };
    }

    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('modalFichaActividad')
    ).show();
  };

  function exportFichaActividadPDF(a, grupoNombre) {
    // @ts-ignore
    let jsPDF = window.jspdf.jsPDF;
    let doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
    let pw = doc.internal.pageSize.getWidth();
    let ph = doc.internal.pageSize.getHeight();

    doc.setFillColor(52, 58, 64);
    doc.rect(0, 0, pw, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('FICHA DE SERVICIO', 14, 14);
    doc.setTextColor(0, 0, 0);

    let y = 32;
    let rows = [
      ['ID', a.id_actividad || '-', 'Actividad', a.actividad || '-'],
      ['Nombre', a.nombre || '-', 'Grupo', grupoNombre || '-'],
      ['Disponible', a.disponible || 'Sin marca', 'Horario', a.horario || '-'],
      ['Hora inicio', a.hora_inicio || '-', 'Hora fin', a.hora_fin || '-'],
    ];

    doc.setFontSize(10);
    let col2x = pw / 2 + 6;
    rows.forEach(function (row) {
      doc.setFont(undefined, 'bold');
      doc.setTextColor(80);
      doc.text(row[0] + ':', 14, y);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0);
      doc.text(String(row[1]).slice(0, 45), 45, y);

      doc.setFont(undefined, 'bold');
      doc.setTextColor(80);
      doc.text(row[2] + ':', col2x, y);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0);
      doc.text(String(row[3]).slice(0, 45), col2x + 28, y);

      y += 10;
    });

    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(
      'GRS1 Dashboard  -  Generado: ' + new Date().toLocaleString('es-ES'),
      14,
      ph - 8
    );

    let ts = new Date().toISOString().slice(0, 10);
    doc.save('ficha_servicio_' + (a.id_actividad || '') + '_' + ts + '.pdf');
  }

  app.showAlertActividad = function showAlertActividad(message, type) {
    const container = document.getElementById('alertContainerActividad');
    if (!container) {
      return;
    }

    container.innerHTML = app.actividadesTemplates.alert(message, type);
    setTimeout(() => {
      container.innerHTML = '';
    }, 5000);
  };
})();
