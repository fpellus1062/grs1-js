(function () {
  const app = window.GRS1Dashboard;
  const usuarioEditableFields = [
    'tip',
    'nombre',
    'email',
    'role',
    'password',
    'activo',
    'bloqueado_hasta',
    'login_intentos',
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
    app.showAlertUsuario('Perfil consulta: solo lectura', 'warning');
    return true;
  }

  function applyConsultaReadOnlyUi() {
    if (!isConsultaReadOnly()) return;
    if (!window.GRS1Utils || typeof window.GRS1Utils.disableElementsById !== 'function') {
      return;
    }
    window.GRS1Utils.disableElementsById([
      'btnAgregarNuevoUsuario',
      'btnSaveAllChangesUsuario',
      'btnDiscardChangesUsuario',
      'btnSaveUsuario',
      'confirmUsuarioDeleteBtn',
    ]);
  }

  function updateUsuariosCounters() {
    let totalEl = document.getElementById('totalRecordsUsuario');
    let filteredEl = document.getElementById('filteredRecordsUsuario');
    let shownEl = document.getElementById('shownRecordsUsuario');
    if (!app.tabulatorUsuarios) return;
    let total = app.tabulatorUsuarios.getData().length;
    let filtered = app.tabulatorUsuarios.getData('active').length;
    if (totalEl) totalEl.textContent = total;
    if (filteredEl) filteredEl.textContent = filtered;
    if (shownEl) shownEl.textContent = total - filtered;
  }

  function normalizeArsIds(list) {
    return [
      ...new Set(
        (list || [])
          .map(function (id) {
            return String(id || '').trim();
          })
          .filter(Boolean)
      ),
    ].sort();
  }

  function getArsDisplayNames(arsIds) {
    let catalog = (app.usuariosState && app.usuariosState.arsCatalog) || [];
    let byId = new Map(
      catalog.map(function (ars) {
        return [
          String(ars.id_unidad || '').trim(),
          ars.nombre || ars.id_unidad,
        ];
      })
    );
    return normalizeArsIds(arsIds).map(function (id) {
      return byId.get(id) || id;
    });
  }

  function formatArsBadges(arsIds) {
    let labels = getArsDisplayNames(arsIds);
    if (!labels.length) {
      return '<span class="text-muted">Sin ARS</span>';
    }
    let visibleLabels = labels.length > 2 ? labels.slice(0, 2) : labels;
    let badges = visibleLabels
      .map(function (label) {
        return (
          '<span class="badge rounded-pill text-bg-light border me-1">' +
          label +
          '</span>'
        );
      })
      .join('');
    if (labels.length > 2) {
      badges +=
        '<span class="badge rounded-pill text-bg-secondary">+' +
        (labels.length - 2) +
        '</span>';
    }
    let title = labels.join(', ').replace(/"/g, '&quot;');
    return '<span title="' + title + '">' + badges + '</span>';
  }

  function getUsuarioExportValue(row, field) {
    if (field === 'ars_unidad_ids') {
      let labels = getArsDisplayNames(row[field]);
      return labels.length ? labels.join(', ') : 'Sin ARS';
    }
    if (field === 'estado_cuenta') {
      if (row[field] === 'inactivo') return 'Inactivo';
      if (row[field] === 'bloqueado') return 'Bloqueado';
      return 'Activo';
    }
    if (field === 'ultimo_login' || field === 'password_changed_at') {
      if (!row[field]) return '';
      return new Date(row[field]).toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return row[field] ?? '';
  }

  function sanitizeForFilename(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 40);
  }

  function resolveUsuarioExportArsLabel() {
    let direct =
      app.globalState &&
      (app.globalState.arsUnidadId ||
        app.globalState.arsId ||
        app.globalState.activeArsId);

    let sessionArs =
      sessionStorage.getItem('ars_unidad_id') ||
      sessionStorage.getItem('activeArsId') ||
      sessionStorage.getItem('currentArsId') ||
      sessionStorage.getItem('x_ars_id');

    if (!sessionArs) {
      let legacyArs =
        localStorage.getItem('ars_unidad_id') ||
        localStorage.getItem('activeArsId') ||
        localStorage.getItem('currentArsId') ||
        localStorage.getItem('x_ars_id');
      if (legacyArs) {
        sessionArs = legacyArs;
        sessionStorage.setItem('activeArsId', legacyArs);
        localStorage.removeItem('ars_unidad_id');
        localStorage.removeItem('activeArsId');
        localStorage.removeItem('currentArsId');
        localStorage.removeItem('x_ars_id');
      }
    }

    let fromStorage = sessionArs || '';

    let resolved = direct || fromStorage;
    if (!resolved) {
      let catalog = (app.usuariosState && app.usuariosState.arsCatalog) || [];
      if (catalog.length === 1 && catalog[0] && catalog[0].id_unidad) {
        resolved = catalog[0].id_unidad;
      } else if (catalog.length > 1) {
        resolved = 'MULTIARS(' + catalog.length + ')';
      }
    }

    return sanitizeForFilename(resolved || 'MULTIARS') || 'MULTIARS';
  }

  function deriveEstadoCuenta(usuario) {
    if (!usuario || usuario.activo === false) return 'inactivo';
    if (
      usuario.bloqueado_hasta &&
      new Date(usuario.bloqueado_hasta) > new Date()
    )
      return 'bloqueado';
    return 'activo';
  }

  function withEstadoCuenta(usuario) {
    return { ...usuario, estado_cuenta: deriveEstadoCuenta(usuario) };
  }

  function trackPendingUsuarioField(id, field, newValue) {
    const original = app.usuariosState.originalUsuarios.find(
      (u) => Number(u.id) === id
    );
    if (!original) {
      app.updatePendingChangesUsuario();
      return;
    }

    const currentPending = app.usuariosState.cambiosPendientes.get(id);
    const originalValue = original[field];

    if (!currentPending && sameValue(originalValue, newValue)) {
      app.updatePendingChangesUsuario();
      return;
    }

    if (!currentPending) {
      app.usuariosState.cambiosPendientes.set(id, { ...original });
    }

    const pendingData = app.usuariosState.cambiosPendientes.get(id);
    pendingData[field] = newValue;

    const hasDifferences = Object.keys(pendingData).some(
      (key) => !sameValue(original[key], pendingData[key])
    );
    if (!hasDifferences) {
      app.usuariosState.cambiosPendientes.delete(id);
    }

    const usuario = app.usuariosState.usuarios.find((u) => Number(u.id) === id);
    if (usuario) {
      usuario[field] = newValue;
    }

    app.updatePendingChangesUsuario();
  }

  function buildUsuarioChangesPayload(id, changes) {
    const original = app.usuariosState.originalUsuarios.find(
      (u) => Number(u.id) === Number(id)
    );
    if (!original) {
      return {};
    }

    return usuarioEditableFields.reduce((payload, field) => {
      if (
        Object.hasOwn(changes, field) &&
        !sameValue(original[field], changes[field])
      ) {
        payload[field] = changes[field];
      }
      return payload;
    }, {});
  }

  app.loadUsuariosRoles = async function loadUsuariosRoles() {
    try {
      const res = await fetch('/api/rbac/roles', {
        headers: { Authorization: 'Bearer ' + app.globalState.token },
      });
      if (!res.ok) throw new Error('No se pudieron cargar los roles');
      const data = await res.json();
      const roles =
        data.data && Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.roles)
            ? data.roles
            : [];
      app.usuariosState.roles =
        roles.length > 0 ? roles : [{ nombre: 'user' }, { nombre: 'admin' }];
      console.log('[Usuarios] Roles cargados:', app.usuariosState.roles);
    } catch (e) {
      console.warn(
        '[Usuarios] No se pudieron cargar roles dinámicos, usando fallback.',
        e
      );
      app.usuariosState.roles = [{ nombre: 'user' }, { nombre: 'admin' }];
    }
  };

  app.loadUsuariosArsCatalog = async function loadUsuariosArsCatalog() {
    try {
      const res = await fetch('/api/config/ars', {
        headers: { Authorization: 'Bearer ' + app.globalState.token },
      });
      if (!res.ok)
        throw new Error('No se pudieron cargar las agrupaciones ARS');
      const data = await res.json();
      app.usuariosState.arsCatalog = Array.isArray(data.data) ? data.data : [];
    } catch (e) {
      console.error('Error cargando ARS para usuarios:', e);
      app.usuariosState.arsCatalog = [];
      app.showAlertUsuario('No se pudo cargar el catálogo de ARS', 'warning');
    }
  };

  app.fetchUsuarioArs = async function fetchUsuarioArs(id) {
    const response = await fetch('/api/usuarios/' + id + '/ars', {
      headers: { Authorization: 'Bearer ' + app.globalState.token },
    });
    if (!response.ok) {
      throw new Error('No se pudieron cargar las agrupaciones del usuario');
    }
    const data = await response.json();
    return normalizeArsIds(
      (data.ars || []).map(function (item) {
        return item.ars_unidad_id;
      })
    );
  };

  app.syncUsuarioArs = async function syncUsuarioArs(id, arsIds) {
    const ars_unidad_ids = normalizeArsIds(arsIds);
    const response = await fetch('/api/usuarios/' + id + '/ars', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + app.globalState.token,
      },
      body: JSON.stringify({ ars_unidad_ids: ars_unidad_ids }),
    });
    if (!response.ok) {
      let msg = 'No se pudieron guardar las agrupaciones del usuario';
      try {
        const err = await response.json();
        msg = err.message || msg;
      } catch (_) {
        // noop
      }
      throw new Error(msg);
    }
    return ars_unidad_ids;
  };

  app.initTabulatorUsuarios = function initTabulatorUsuarios() {
    app.tabulatorUsuarios = new Tabulator('#tabulatorUsuarios', {
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
          title: 'TIP',
          field: 'tip',
          width: 110,
          editor: 'input',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
        },
        {
          title: 'ID',
          field: 'id',
          width: 55,
          editable: false,
          sorter: 'number',
        },
        {
          title: 'Nombre',
          field: 'nombre',
          editor: 'input',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
        },
        {
          title: 'Email',
          field: 'email',
          editor: 'input',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
        },
        {
          title: 'Rol',
          field: 'role',
          width: 110,
          editor: function (cell, onRendered, success, cancel) {
            const select = document.createElement('select');
            select.style.cssText =
              'width:100%;height:100%;border:none;padding:0 2px;font-size:0.72rem;background:transparent;cursor:pointer;';
            const roles = (app.usuariosState && app.usuariosState.roles) || [];
            roles.forEach(function (r) {
              const opt = document.createElement('option');
              opt.value = r.nombre;
              opt.textContent = r.nombre;
              if (cell.getValue() === r.nombre) {
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
          headerFilter: 'list',
          headerFilterParams: function () {
            const roles = (app.usuariosState && app.usuariosState.roles) || [];
            const values = { '': 'Todos' };
            roles.forEach(function (r) {
              values[r.nombre] = r.nombre;
            });
            return { values: values };
          },
          headerFilterEmptyCheck: function (value) {
            return !value;
          },
        },
        {
          title: 'ARS',
          field: 'ars_unidad_ids',
          minWidth: 190,
          formatter: function (cell) {
            return formatArsBadges(cell.getValue());
          },
          accessorDownload: function (value) {
            let labels = getArsDisplayNames(value);
            return labels.length ? labels.join(', ') : 'Sin ARS';
          },
          sorter: function (a, b) {
            return getArsDisplayNames(a)
              .join(', ')
              .localeCompare(getArsDisplayNames(b).join(', '), 'es', {
                sensitivity: 'base',
              });
          },
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar ARS...',
          headerFilterFunc: function (headerValue, rowValue) {
            if (!headerValue) return true;
            let haystack = getArsDisplayNames(rowValue).join(' ').toLowerCase();
            return haystack.includes(String(headerValue).toLowerCase());
          },
        },
        {
          title: 'Estado',
          field: 'estado_cuenta',
          width: 120,
          hozAlign: 'center',
          editor: function (cell, onRendered, success, cancel) {
            let select = document.createElement('select');
            select.style.cssText =
              'width:100%;height:100%;border:none;padding:0 4px;font-size:0.75rem;background:transparent;cursor:pointer;';
            let opts = [
              { val: 'activo', label: 'Activo' },
              { val: 'bloqueado', label: 'Bloqueado' },
              { val: 'inactivo', label: 'Inactivo' },
            ];
            opts.forEach(function (o) {
              let opt = document.createElement('option');
              opt.value = o.val;
              opt.textContent = o.label;
              if (cell.getValue() === o.val) opt.selected = true;
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
            let estado = cell.getValue();
            if (estado === 'inactivo')
              return '<span class="badge bg-secondary">Inactivo</span>';
            if (estado === 'bloqueado')
              return '<span class="badge bg-danger">Bloqueado</span>';
            return '<span class="badge bg-success">Activo</span>';
          },
          headerFilter: 'list',
          headerFilterParams: {
            values: {
              '': 'Todos',
              activo: 'Activo',
              bloqueado: 'Bloqueado',
              inactivo: 'Inactivo',
            },
          },
          headerFilterFunc: function (headerValue, rowValue, rowData) {
            if (!headerValue) return true;
            return rowData.estado_cuenta === headerValue;
          },
          headerFilterEmptyCheck: function (value) {
            return !value;
          },
        },
        {
          title: 'Intentos',
          field: 'login_intentos',
          width: 95,
          hozAlign: 'center',
          editable: false,
          formatter: function (cell) {
            let v = Number(cell.getValue() || 0);
            if (v >= 5)
              return window.GRS1Utils.renderSemanticBadgeHtml(String(v), 'danger', {
                variant: 'solid',
              });
            if (v > 0)
              return window.GRS1Utils.renderSemanticBadgeHtml(String(v), 'warning', {
                variant: 'solid',
              });
            return '<span class="text-muted">0</span>';
          },
          sorter: 'number',
          headerFilter: 'number',
          headerFilterPlaceholder: 'N',
        },
        {
          title: 'Bloqueado Hasta',
          field: 'bloqueado_hasta',
          width: 170,
          editable: false,
          formatter: function (cell) {
            let v = cell.getValue();
            if (!v) return '<span class="text-muted">—</span>';
            let d = new Date(v);
            if (Number.isNaN(d.getTime()))
              return '<span class="text-muted">—</span>';
            return d.toLocaleString('es-ES', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
          },
          sorter: 'datetime',
          headerFilter: 'input',
          headerFilterPlaceholder: 'dd/mm/yyyy',
        },
        {
          title: 'Último Login',
          field: 'ultimo_login',
          width: 145,
          editable: false,
          formatter: function (cell) {
            let v = cell.getValue();
            if (!v) return '<span class="text-muted">—</span>';
            return new Date(v).toLocaleString('es-ES', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
          },
          sorter: 'datetime',
        },
        {
          title: 'Cambio Password',
          field: 'password_changed_at',
          width: 155,
          editable: false,
          formatter: function (cell) {
            let v = cell.getValue();
            if (!v) return '<span class="text-muted">—</span>';
            return new Date(v).toLocaleString('es-ES', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
          },
          sorter: 'datetime',
        },
        {
          title: '',
          width: 140,
          headerSort: false,
          editable: false,
          formatter: function (cell) {
            let row = cell.getRow().getData();
            let btns = '';
            btns +=
              '<button class="btn btn-sm btn-outline-primary me-1" title="Editar" type="button" data-action="edit"><i class="bi bi-pencil"></i></button>';
            if (!row.activo) {
              btns +=
                '<button class="btn btn-sm btn-outline-success me-1" title="Reactivar" type="button" data-action="reactivar"><i class="bi bi-arrow-counterclockwise"></i></button>';
            } else if (
              row.bloqueado_hasta &&
              new Date(row.bloqueado_hasta) > new Date()
            ) {
              btns +=
                '<button class="btn btn-sm btn-outline-warning me-1" title="Desbloquear" type="button" data-action="desbloquear"><i class="bi bi-unlock"></i></button>';
            }
            btns +=
              '<button class="btn btn-sm btn-outline-danger" title="Desactivar" type="button" data-action="delete"><i class="bi bi-trash"></i></button>';
            return btns;
          },
          cellClick: function (e, cell) {
            let btn = e.target.closest('button');
            if (!btn) return;
            let id = cell.getRow().getData().id;
            let action = btn.dataset.action;
            if (action === 'edit') {
              app.openUsuarioModal(cell.getRow().getData());
            } else if (action === 'delete') {
              app.openUsuarioDeleteModal(id);
            } else if (action === 'reactivar') {
              app.reactivarUsuario(id);
            } else if (action === 'desbloquear') {
              app.desbloquearUsuario(id);
            }
          },
        },
      ],
    });

    app.tabulatorUsuarios.on('cellEdited', function (cell) {
      const rowData = cell.getRow().getData();
      const id = Number(rowData.id);
      const field = cell.getField();
      const newValue = cell.getValue();

      if (field === 'ars_unidad_ids') {
        return;
      }

      if (field === 'estado_cuenta') {
        let activo = true;
        let bloqueadoHasta = null;
        let intentos = 0;

        if (newValue === 'inactivo') {
          activo = false;
        } else if (newValue === 'bloqueado') {
          // Bloqueo manual por 24 horas (o hasta desbloqueo manual).
          bloqueadoHasta = new Date(
            Date.now() + 24 * 60 * 60 * 1000
          ).toISOString();
          intentos = 5;
        }

        cell.getRow().update({
          activo: activo,
          bloqueado_hasta: bloqueadoHasta,
          login_intentos: intentos,
          estado_cuenta: newValue,
        });

        trackPendingUsuarioField(id, 'activo', activo);
        trackPendingUsuarioField(id, 'bloqueado_hasta', bloqueadoHasta);
        trackPendingUsuarioField(id, 'login_intentos', intentos);
        return;
      }

      trackPendingUsuarioField(id, field, newValue);
    });
    app.tabulatorUsuarios.on('dataFiltered', updateUsuariosCounters);
    app.tabulatorUsuarios.on('renderComplete', updateUsuariosCounters);
  };

  app.loadUsuarios = async function loadUsuarios() {
    try {
      const response = await fetch('/api/usuarios?incluirInactivos=true', {
        headers: { Authorization: `Bearer ${app.globalState.token}` },
      });

      if (!response.ok) {
        throw new Error('Error al cargar usuarios');
      }

      const data = await response.json();

      if (!Array.isArray(data.usuarios)) {
        throw new Error('La respuesta de la API no es un array válido');
      }

      app.usuariosState.usuarios = app
        .cloneRecords(data.usuarios)
        .map(function (u) {
          return withEstadoCuenta({
            ...u,
            ars_unidad_ids: Array.isArray(u.ars_unidad_ids)
              ? normalizeArsIds(u.ars_unidad_ids)
              : [],
          });
        });
      app.usuariosState.originalUsuarios = app
        .cloneRecords(data.usuarios)
        .map(function (u) {
          return withEstadoCuenta({
            ...u,
            ars_unidad_ids: Array.isArray(u.ars_unidad_ids)
              ? normalizeArsIds(u.ars_unidad_ids)
              : [],
          });
        });
      app.usuariosState.cambiosPendientes.clear();

      if (app.tabulatorUsuarios) {
        await app.tabulatorUsuarios.setData(app.usuariosState.usuarios);
        updateUsuariosCounters();
      }

      app.updatePendingChangesUsuario();
    } catch (error) {
      console.error('Error loading usuarios:', error);
      app.showAlertUsuario('Error al cargar los usuarios', 'danger');
    }
  };

  app.setupUsuariosEventListeners = function setupUsuariosEventListeners() {
    applyConsultaReadOnlyUi();
    document
      .getElementById('btnAgregarNuevoUsuario')
      .addEventListener('click', () => {
        if (guardReadOnlyAction()) return;
        app.openUsuarioModal();
      });
    document
      .getElementById('btnSaveAllChangesUsuario')
      .addEventListener('click', function () {
        if (guardReadOnlyAction()) return;
        app.saveAllChangesUsuario();
      });
    document
      .getElementById('btnDiscardChangesUsuario')
      .addEventListener('click', function () {
        if (guardReadOnlyAction()) return;
        app.discardChangesUsuario();
      });
    document
      .getElementById('btnExportExcelUsuario')
      .addEventListener('click', function () {
        const ts = new Date()
          .toISOString()
          .slice(0, 19)
          .replace('T', '_')
          .replace(/:/g, '-');
        const arsLabel = resolveUsuarioExportArsLabel();
        app.tabulatorUsuarios.download(
          'xlsx',
          'usuarios_' + arsLabel + '_' + ts + '.xlsx',
          { sheetName: 'Usuarios' }
        );
      });
    document
      .getElementById('btnExportPdfUsuario')
      .addEventListener('click', function () {
        const usuario = app.globalState.userName || '';
        const fecha = new Date().toLocaleString('es-ES');
        const ts = new Date()
          .toISOString()
          .slice(0, 19)
          .replace('T', '_')
          .replace(/:/g, '-');
        const arsLabel = resolveUsuarioExportArsLabel();
        const cols = app.tabulatorUsuarios.getColumns().filter(function (c) {
          return c.getDefinition().title && c.getDefinition().field;
        });
        const head = [
          cols.map(function (c) {
            return c.getDefinition().title;
          }),
        ];
        const body = app.tabulatorUsuarios
          .getData('active')
          .map(function (row) {
            return cols.map(function (c) {
              let field = c.getDefinition().field;
              return getUsuarioExportValue(row, field);
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
            doc.text('Listado de Usuarios', 14, 12);
            doc.setFontSize(7);
            doc.setTextColor(120);
            doc.text(
              'Usuario: ' +
                usuario +
                '   ARS: ' +
                arsLabel +
                '   Fecha: ' +
                fecha,
              14,
              ph - 5
            );
            doc.text('P\u00e1gina ' + p + ' de ' + t, pw - 14, ph - 5, {
              align: 'right',
            });
          },
        });
        doc.save('usuarios_' + arsLabel + '_' + ts + '.pdf');
      });
  };

  app.updatePendingChangesUsuario = function updatePendingChangesUsuario() {
    const count = app.usuariosState.cambiosPendientes.size;
    const countEl = document.getElementById('pendingChangesCountUsuario');
    const sectionEl = document.getElementById('saveChangesSectionUsuario');
    const saveBtn = document.getElementById('btnSaveAllChangesUsuario');
    const discardBtn = document.getElementById('btnDiscardChangesUsuario');
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

  app.saveAllChangesUsuario = async function saveAllChangesUsuario() {
    if (guardReadOnlyAction()) return;
    const promises = [];

    for (const [id, changes] of app.usuariosState.cambiosPendientes) {
      const payload = buildUsuarioChangesPayload(id, changes);
      if (Object.keys(payload).length === 0) {
        continue;
      }

      promises.push(
        fetch(`/api/usuarios/${id}`, {
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
        app.showAlertUsuario(
          'Todos los cambios guardados correctamente',
          'success'
        );
        await app.loadUsuarios();
        return;
      }

      app.showAlertUsuario(
        `${failed} cambios fallaron. Revisa los datos.`,
        'warning'
      );
    } catch (error) {
      console.error('Error saving changes:', error);
      app.showAlertUsuario('Error al guardar los cambios', 'danger');
    }
  };

  app.discardChangesUsuario = function discardChangesUsuario() {
    app.usuariosState.cambiosPendientes.clear();
    app.usuariosState.usuarios = app.cloneRecords(
      app.usuariosState.originalUsuarios
    );

    if (app.tabulatorUsuarios) {
      app.tabulatorUsuarios.setData(app.usuariosState.usuarios);
    }

    app.updatePendingChangesUsuario();
    app.showAlertUsuario('Cambios descartados', 'info');
  };

  app.openUsuarioDeleteModal = function openUsuarioDeleteModal(id) {
    if (guardReadOnlyAction()) return;
    app.usuarioIdToDelete = id;

    const usuario = app.usuariosState.usuarios.find((item) => item.id === id);
    const label = document.getElementById('deleteUsuarioNombre');
    if (label) {
      label.textContent = usuario?.nombre || `#${id}`;
    }

    const modal = new bootstrap.Modal(
      document.getElementById('confirmUsuarioDeleteModal')
    );
    modal.show();
  };

  app.confirmDeleteUsuario = async function confirmDeleteUsuario() {
    if (guardReadOnlyAction()) return;
    if (app.usuarioIdToDelete === null) {
      return;
    }

    try {
      const response = await fetch(`/api/usuarios/${app.usuarioIdToDelete}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${app.globalState.token}` },
      });

      if (!response.ok) {
        throw new Error('Error al eliminar usuario');
      }

      const modalElement = document.getElementById('confirmUsuarioDeleteModal');
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) {
        modal.hide();
      }

      app.usuarioIdToDelete = null;
      app.showAlertUsuario('Usuario eliminado correctamente', 'success');
      await app.loadUsuarios();
    } catch (error) {
      console.error('Error deleting usuario:', error);
      app.showAlertUsuario('Error al eliminar el usuario', 'danger');
    }
  };

  app.openUsuarioModal = async function openUsuarioModal(usuario = null) {
    const modal = bootstrap.Modal.getOrCreateInstance(
      document.getElementById('usuarioModal')
    );
    const title = document.getElementById('usuarioModalTitle');

    // Asegurar que el catálogo ARS esté cargado antes de llenar el formulario
    if (!app.usuariosState.arsCatalog || !app.usuariosState.arsCatalog.length) {
      await app.loadUsuariosArsCatalog();
    }

    if (usuario) {
      app.usuarioModalState.mode = 'edit';
      app.usuarioModalState.id = usuario.id;
      title.textContent = 'Editar Usuario';
      try {
        const arsIds = await app.fetchUsuarioArs(usuario.id);
        app.fillUsuarioForm(usuario, arsIds);
      } catch (error) {
        console.error('Error cargando ARS del usuario:', error);
        app.showAlertUsuario(
          error.message || 'No se pudieron cargar las agrupaciones del usuario',
          'warning'
        );
        app.fillUsuarioForm(usuario, usuario.ars_unidad_ids || []);
      }
    } else {
      app.usuarioModalState.mode = 'create';
      app.usuarioModalState.id = null;
      app.resetUsuarioForm();
    }

    modal.show();
    applyConsultaReadOnlyUi();
  };

  app.handleUsuarioSaveClick = function handleUsuarioSaveClick() {
    if (guardReadOnlyAction()) return;
    if (!app.validateUsuarioForm()) {
      return;
    }

    if (
      app.usuarioModalState.mode === 'edit' &&
      app.usuarioModalState.id !== null
    ) {
      app.updateUsuario(app.usuarioModalState.id);
      return;
    }

    app.createUsuario();
  };

  app.resetUsuarioModalState = function resetUsuarioModalState() {
    app.usuarioModalState.mode = 'create';
    app.usuarioModalState.id = null;
    app.resetUsuarioForm();
  };

  app.createUsuario = async function createUsuario() {
    if (guardReadOnlyAction()) return;
    const usuarioData = app.getUsuarioFormData({ includePassword: true });
    const arsIds = normalizeArsIds(usuarioData.ars_unidad_ids);
    delete usuarioData.ars_unidad_ids;

    try {
      const response = await fetch('/api/usuarios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${app.globalState.token}`,
        },
        body: JSON.stringify(usuarioData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Error al crear usuario');
      }

      const created = await response.json();
      const createdId =
        created && created.usuarios ? created.usuarios.id : null;
      if (!createdId) {
        throw new Error('Usuario creado sin ID de respuesta para asignar ARS');
      }

      await app.syncUsuarioArs(createdId, arsIds);

      app.hideUsuarioModal();
      app.showAlertUsuario('Usuario creado correctamente', 'success');
      await app.loadUsuarios();
    } catch (error) {
      console.error('Error creating usuario:', error);
      app.showAlertUsuario(error.message, 'danger');
    }
  };

  app.updateUsuario = async function updateUsuario(id) {
    if (guardReadOnlyAction()) return;
    const usuarioData = app.getUsuarioFormData();
    const arsIds = normalizeArsIds(usuarioData.ars_unidad_ids);
    delete usuarioData.ars_unidad_ids;
    const usuarioActual = app.usuariosState.usuarios.find(function (u) {
      return Number(u.id) === Number(id);
    });
    const arsActuales = normalizeArsIds(
      usuarioActual && usuarioActual.ars_unidad_ids
        ? usuarioActual.ars_unidad_ids
        : []
    );
    const arsChanged = arsIds.join('|') !== arsActuales.join('|');

    // Guardar ARS si cambiaron (se guardan directamente al servidor)
    if (arsChanged) {
      try {
        const syncedArs = await app.syncUsuarioArs(id, arsIds);
        if (usuarioActual) {
          usuarioActual.ars_unidad_ids = syncedArs;
        }
        const original = app.usuariosState.originalUsuarios.find(function (u) {
          return Number(u.id) === Number(id);
        });
        if (original) {
          original.ars_unidad_ids = syncedArs;
        }
      } catch (error) {
        console.error('Error guardando ARS de usuario:', error);
        app.showAlertUsuario(
          error.message ||
            'No se pudieron guardar las agrupaciones del usuario',
          'danger'
        );
        return;
      }
    }

    // Construir payload solo con campos que realmente cambiaron
    const originalUser = app.usuariosState.originalUsuarios.find(function (u) {
      return Number(u.id) === Number(id);
    });
    const changedFields = {};
    ['nombre', 'email', 'role'].forEach(function (field) {
      if (!sameValue(usuarioData[field], originalUser && originalUser[field])) {
        changedFields[field] = usuarioData[field];
      }
    });
    if (usuarioData.password) {
      changedFields.password = usuarioData.password;
    }

    if (Object.keys(changedFields).length > 0) {
      try {
        const response = await fetch('/api/usuarios/' + id, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + app.globalState.token,
          },
          body: JSON.stringify(changedFields),
        });
        if (!response.ok) {
          const err = await response.json().catch(function () {
            return {};
          });
          throw new Error(err.message || 'Error al actualizar usuario');
        }
      } catch (error) {
        console.error('Error updating usuario:', error);
        app.showAlertUsuario(
          error.message || 'Error al guardar el usuario',
          'danger'
        );
        return;
      }
    }

    app.hideUsuarioModal();

    if (Object.keys(changedFields).length > 0 || arsChanged) {
      app.showAlertUsuario('Usuario actualizado correctamente', 'success');
      await app.loadUsuarios();
    } else {
      app.showAlertUsuario('Sin cambios detectados', 'info');
    }
  };

  app.showAlertUsuario = function showAlertUsuario(message, type) {
    const container = document.getElementById('alertContainerUsuario');
    if (!container) {
      return;
    }

    container.innerHTML = app.usuariosTemplates.alert(message, type);
    setTimeout(() => {
      container.innerHTML = '';
    }, 5000);
  };

  app.reactivarUsuario = async function reactivarUsuario(id) {
    try {
      const response = await fetch('/api/usuarios/' + id + '/reactivar', {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + app.globalState.token },
      });
      if (!response.ok) throw new Error('Error al reactivar usuario');
      app.showAlertUsuario('Usuario reactivado correctamente', 'success');
      await app.loadUsuarios();
    } catch (error) {
      console.error('Error reactivando usuario:', error);
      app.showAlertUsuario('Error al reactivar el usuario', 'danger');
    }
  };

  app.desbloquearUsuario = async function desbloquearUsuario(id) {
    try {
      const response = await fetch('/api/usuarios/' + id + '/desbloquear', {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + app.globalState.token },
      });
      if (!response.ok) throw new Error('Error al desbloquear usuario');
      app.showAlertUsuario('Usuario desbloqueado correctamente', 'success');
      await app.loadUsuarios();
    } catch (error) {
      console.error('Error desbloqueando usuario:', error);
      app.showAlertUsuario('Error al desbloquear el usuario', 'danger');
    }
  };
})();
