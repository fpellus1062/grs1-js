/* ========================================================================
 *  dashboard-jerarquiagrupos.js
 *  CRUD split-panel: Jerarquía de Grupos (árbol) + Servicios (actividades)
 *  Tablas: grupos_actividad (dataTree) | actividades (grid por grupo seleccionado)
 * ======================================================================== */
(function () {
  let app = window.GRS1Dashboard;
  let TREE_COLLAPSE_STORAGE_KEY = 'grs1.jerarquiagrupos.collapsed.v1';

  let LANGS = {
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

  // ─── State ────────────────────────────────────────────────────────────────

  let state = {
    grupos: [], // flat list for meta/selectors
    gruposTree: [], // nested tree for Tabulator
    actividades: [],
    niveles: [],
    treeSearchTerm: '',
    collapsedGrupoIds: {},
    selectedGrupoId: null,
    selectedGrupoNombre: '',
    selectedGrupoNivel: null,
    draggingGrupoId: null,
    dragOverGrupoId: null,
    tabulatorGrupos: null,
    tabulatorActividades: null,
    actividadesTableBuilt: false,
    pendingActividadesData: null,
  };

  function applyActividadesData(rows) {
    let data = Array.isArray(rows) ? rows : [];
    if (!state.tabulatorActividades) return;

    if (!state.actividadesTableBuilt) {
      state.pendingActividadesData = data;
      return;
    }

    state.tabulatorActividades.setData(data);
    requestAnimationFrame(function () {
      try {
        state.tabulatorActividades.redraw(true);
      } catch (_e) {
        // noop
      }
    });
  }

  // ─── Headers ─────────────────────────────────────────────────────────────

  function headers() {
    let h = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + app.globalState.token,
    };
    if (app.globalState.activeArsId)
      h['X-Ars-Id'] = app.globalState.activeArsId;
    return h;
  }

  function headersGet() {
    let h = { Authorization: 'Bearer ' + app.globalState.token };
    if (app.globalState.activeArsId)
      h['X-Ars-Id'] = app.globalState.activeArsId;
    return h;
  }

  async function readJsonOrThrow(response, fallbackMessage) {
    let payload = null;
    try {
      payload = await response.json();
    } catch (_e) {
      // noop
    }

    if (!response.ok) {
      throw new Error(
        (payload && (payload.message || payload.error || payload.details)) ||
          fallbackMessage
      );
    }

    return payload || {};
  }

  function getXlsx() {
    return window.XLSX;
  }

  function getActividadGroupDisplay(grupoId, grupoNombre) {
    if (!grupoId) {
      return 'Sin grupo';
    }

    if (grupoNombre) {
      return grupoNombre;
    }

    return 'Grupo ' + grupoId;
  }

  function exportTimestamp() {
    return new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');
  }

  function flattenGrupoRow(grupoNode, pathText) {
    return {
      tipo: 'Grupo',
      nivel: getNivelLabel(
        getGrupoNivelValue(grupoNode),
        grupoNode && grupoNode.nivel_nombre
      ),
      nivel_id: grupoNode && grupoNode.nivel_id != null ? grupoNode.nivel_id : '',
      grupo_id: grupoNode && grupoNode.id_grupo != null ? grupoNode.id_grupo : '',
      grupo_padre_id:
        grupoNode && grupoNode.parent_id_grupo != null ? grupoNode.parent_id_grupo : '',
      grupo_nombre: grupoNode && grupoNode.nombre ? grupoNode.nombre : '',
      grupo_orden: grupoNode && grupoNode.orden != null ? grupoNode.orden : '',
      grupo_activo:
        grupoNode && Object.prototype.hasOwnProperty.call(grupoNode, 'activo')
          ? grupoNode.activo
            ? 'Sí'
            : 'No'
          : '',
      ruta_jerarquica: pathText || '',
      actividad_id: '',
      actividad_codigo: '',
      actividad_nombre: '',
      disponible: '',
      horario: '',
      hora_inicio: '',
      hora_fin: '',
      color: grupoNode && grupoNode.color ? grupoNode.color : '',
      fecha_baja: '',
    };
  }

  function flattenActividadRow(actividad, grupoNode, pathText) {
    return {
      tipo: 'Actividad',
      nivel: getNivelLabel(
        getGrupoNivelValue(grupoNode),
        grupoNode && grupoNode.nivel_nombre
      ),
      nivel_id: grupoNode && grupoNode.nivel_id != null ? grupoNode.nivel_id : '',
      grupo_id: grupoNode && grupoNode.id_grupo != null ? grupoNode.id_grupo : '',
      grupo_padre_id:
        grupoNode && grupoNode.parent_id_grupo != null ? grupoNode.parent_id_grupo : '',
      grupo_nombre: grupoNode && grupoNode.nombre ? grupoNode.nombre : '',
      grupo_orden: grupoNode && grupoNode.orden != null ? grupoNode.orden : '',
      grupo_activo:
        grupoNode && Object.prototype.hasOwnProperty.call(grupoNode, 'activo')
          ? grupoNode.activo
            ? 'Sí'
            : 'No'
          : '',
      ruta_jerarquica: pathText || '',
      actividad_id:
        actividad && actividad.id_actividad != null ? actividad.id_actividad : '',
      actividad_codigo: actividad && actividad.actividad ? actividad.actividad : '',
      actividad_nombre: actividad && actividad.nombre ? actividad.nombre : '',
      disponible: actividad && actividad.disponible ? actividad.disponible : '',
      horario: actividad && actividad.horario ? actividad.horario : '',
      hora_inicio: actividad && actividad.hora_inicio ? actividad.hora_inicio : '',
      hora_fin: actividad && actividad.hora_fin ? actividad.hora_fin : '',
      color: actividad && actividad.color ? actividad.color : '',
      fecha_baja: actividad && actividad.fecha_baja ? actividad.fecha_baja : '',
    };
  }

  async function fetchActividadesForGrupo(grupoId) {
    let response = await fetch(
      '/api/jerarquiagrupos/grupos/' + encodeURIComponent(grupoId) + '/actividades',
      { headers: headersGet() }
    );
    let json = await readJsonOrThrow(response, 'Error al cargar actividades');
    return Array.isArray(json.actividades) ? json.actividades : [];
  }

  async function buildJerarquiaExportRows(nodes, ancestorNames, rows) {
    if (!Array.isArray(nodes) || !nodes.length) return rows;

    for (let i = 0; i < nodes.length; i += 1) {
      let node = nodes[i];
      let pathNames = ancestorNames.concat(node.nombre || '');
      let pathText = pathNames.filter(Boolean).join(' / ');

      rows.push(flattenGrupoRow(node, pathText));

      let actividades = await fetchActividadesForGrupo(node.id_grupo);
      actividades.forEach(function (actividad) {
        rows.push(flattenActividadRow(actividad, node, pathText));
      });

      if (Array.isArray(node._children) && node._children.length) {
        await buildJerarquiaExportRows(node._children, pathNames, rows);
      }
    }

    return rows;
  }

  async function exportJerarquiaExcel() {
    let xlsx = getXlsx();
    if (!xlsx || !xlsx.utils) {
      showAlert(
        'alertContainerGrupoJer',
        'No está disponible XLSX para exportar Excel.',
        'warning'
      );
      return;
    }

    if (!Array.isArray(state.gruposTree) || !state.gruposTree.length) {
      showAlert(
        'alertContainerGrupoJer',
        'No hay jerarquía cargada para exportar.',
        'warning'
      );
      return;
    }

    let rows = await buildJerarquiaExportRows(state.gruposTree, [], []);
    let headers = [
      'Tipo',
      'Nivel',
      'Nivel ID',
      'Grupo ID',
      'Grupo padre ID',
      'Grupo',
      'Orden grupo',
      'Activo grupo',
      'Ruta jerárquica',
      'Actividad ID',
      'Código actividad',
      'Actividad',
      'Disponible',
      'Horario',
      'Hora inicio',
      'Hora fin',
      'Color',
      'Fecha baja',
    ];

    let data = rows.map(function (row) {
      return [
        row.tipo,
        row.nivel,
        row.nivel_id,
        row.grupo_id,
        row.grupo_padre_id,
        row.grupo_nombre,
        row.grupo_orden,
        row.grupo_activo,
        row.ruta_jerarquica,
        row.actividad_id,
        row.actividad_codigo,
        row.actividad_nombre,
        row.disponible,
        row.horario,
        row.hora_inicio,
        row.hora_fin,
        row.color,
        row.fecha_baja,
      ];
    });

    let ws = xlsx.utils.aoa_to_sheet([headers].concat(data));
    let wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Jerarquia');

    xlsx.writeFile(wb, 'jerarquia_grupos_actividades_' + exportTimestamp() + '.xlsx');
  }

  function exportActividadesExcel() {
    let xlsx = getXlsx();
    if (!xlsx || !xlsx.utils) {
      showAlert(
        'alertContainerActividadJer',
        'No está disponible XLSX para exportar Excel.',
        'warning'
      );
      return;
    }

    fetch('/api/actividades', { headers: headersGet() })
      .then(function (response) {
        return readJsonOrThrow(response, 'Error al cargar actividades');
      })
      .then(function (json) {
        let actividades = Array.isArray(json.actividades) ? json.actividades : [];
        if (!actividades.length) {
          showAlert(
            'alertContainerActividadJer',
            'No hay actividades para exportar.',
            'warning'
          );
          return;
        }

        let keys = [];
        actividades.forEach(function (actividad) {
          Object.keys(actividad || {}).forEach(function (key) {
            if (keys.indexOf(key) === -1) keys.push(key);
          });
        });

        let preferredOrder = [
          'id_actividad',
          'actividad',
          'nombre',
          'disponible',
          'grupo_id',
          'grupo_nombre',
          'nivel_grupo_orden',
          'nivel_grupo_nombre',
          'nivel_grupo_color',
          'horario',
          'hora_inicio',
          'hora_fin',
          'color',
          'fecha_baja',
          'create_user',
          'update_user',
          'created_at',
          'updated_at',
        ];

        let orderedKeys = preferredOrder.concat(
          keys.filter(function (key) {
            return preferredOrder.indexOf(key) === -1;
          })
        );

        let header = orderedKeys;
        let rows = actividades.map(function (actividad) {
          return orderedKeys.map(function (key) {
            let value = actividad[key];
            if (key === 'grupo_id') {
              return getActividadGroupDisplay(
                actividad.grupo_id,
                actividad.grupo_nombre
              );
            }
            if (value === null || value === undefined) {
              return '';
            }
            return value;
          });
        });

        let ws = xlsx.utils.aoa_to_sheet([header].concat(rows));
        let wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, 'Actividades');

        xlsx.writeFile(wb, 'actividades_jerarquia_' + exportTimestamp() + '.xlsx');
      })
      .catch(function (e) {
        showAlert('alertContainerActividadJer', e.message, 'danger');
      });
  }

  // ─── Alerts ──────────────────────────────────────────────────────────────

  function showAlert(containerId, msg, type) {
    let el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML =
      '<div class="alert alert-' +
      type +
      ' alert-dismissible py-1 mb-1 fade show" role="alert">' +
      app.escapeHtml(msg) +
      '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>';
    setTimeout(function () {
      if (el) el.innerHTML = '';
    }, 5500);
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function loadCollapsedState() {
    try {
      let raw = window.sessionStorage.getItem(TREE_COLLAPSE_STORAGE_KEY);
      if (!raw) {
        state.collapsedGrupoIds = {};
        return;
      }
      let parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        state.collapsedGrupoIds = {};
        return;
      }

      let normalized = {};
      Object.keys(parsed).forEach(function (key) {
        if (parsed[key] === true) normalized[String(key)] = true;
      });
      state.collapsedGrupoIds = normalized;
    } catch (_e) {
      // noop
      state.collapsedGrupoIds = {};
    }
  }

  function persistCollapsedState() {
    try {
      window.sessionStorage.setItem(
        TREE_COLLAPSE_STORAGE_KEY,
        JSON.stringify(state.collapsedGrupoIds || {})
      );
    } catch (_e) {
      // noop
    }
  }

  function setNodeCollapsed(grupoId, collapsed) {
    let key = String(grupoId);
    if (collapsed) {
      state.collapsedGrupoIds[key] = true;
    } else {
      delete state.collapsedGrupoIds[key];
    }
    persistCollapsedState();
  }

  function toggleNodeCollapsed(grupoId) {
    let key = String(grupoId);
    setNodeCollapsed(grupoId, !state.collapsedGrupoIds[key]);
  }

  function getNivelLabel(nivel, nivelNombre) {
    let display = nivelNombre || 'Nivel ' + (nivel || '?');
    return display;
  }

  function normalizeHexColor(value) {
    let color = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
  }

  function getNivelColor(nivel, explicitColor) {
    let explicit = normalizeHexColor(explicitColor);
    if (explicit) return explicit;

    let nivelInfo = (state.niveles || []).find(function (item) {
      return Number(item.id) === Number(nivel);
    });
    let fromNivel = normalizeHexColor(nivelInfo && nivelInfo.color);
    if (fromNivel) return fromNivel;

    return NIVEL_COLORS[nivel] || '#6c757d';
  }

  function getGrupoNivelValue(grupo) {
    if (!grupo) return null;
    if (grupo.nivel_id != null) return Number(grupo.nivel_id);
    if (grupo.nivel != null) return Number(grupo.nivel);
    return null;
  }

  function getGrupoById(grupoId) {
    return (
      state.grupos.find(function (grupo) {
        return Number(grupo.id_grupo) === Number(grupoId);
      }) || null
    );
  }

  function getGrupoMap() {
    let map = new Map();
    state.grupos.forEach(function (grupo) {
      map.set(String(grupo.id_grupo), grupo);
    });
    return map;
  }

  function buildBreadcrumb(grupoId) {
    let map = getGrupoMap();
    let current = map.get(String(grupoId));
    let chain = [];
    let guard = 0;

    while (current && guard < 20) {
      chain.unshift(current.nombre);
      current =
        current.parent_id_grupo == null
          ? null
          : map.get(String(current.parent_id_grupo));
      guard += 1;
    }

    return chain.join(' / ');
  }

  function countGroupsByLevel(levelId) {
    return state.grupos.filter(function (grupo) {
      return Number(getGrupoNivelValue(grupo)) === Number(levelId);
    }).length;
  }

  function getFirstGrupoByNivel(levelId) {
    return (
      (state.grupos || [])
        .filter(function (grupo) {
          return Number(getGrupoNivelValue(grupo)) === Number(levelId);
        })
        .sort(function (a, b) {
          let ordenA = Number(a.orden || 0);
          let ordenB = Number(b.orden || 0);
          if (ordenA !== ordenB) return ordenA - ordenB;
          return String(a.nombre || '').localeCompare(String(b.nombre || ''));
        })[0] || null
    );
  }

  function clearGrupoSelectionForLevel(nivelId) {
    state.selectedGrupoId = null;
    state.selectedGrupoNombre = '';
    state.selectedGrupoNivel = Number(nivelId);
    state.actividades = [];

    applyActividadesData([]);

    let panel = document.getElementById('actividadesJerPanel');
    let noMsg = document.getElementById('jerarquiagruposNoGrupoMsg');
    let newBtn = document.getElementById('btnNuevaActividadJer');
    let childBtn = document.getElementById('btnNuevoHijoGrupoJer');
    let bc = document.getElementById('jerarquiagruposBreadcrumb');
    let nivel = (state.niveles || []).find(function (item) {
      return Number(item.id) === Number(nivelId);
    });

    if (panel) panel.style.display = 'none';
    if (noMsg) noMsg.style.display = '';
    // @ts-ignore
    if (newBtn) newBtn.disabled = true;
    // @ts-ignore
    if (childBtn) childBtn.disabled = true;
    if (bc) bc.textContent = getNivelLabel(nivelId, nivel && nivel.nombre);

    updateActivitiesSummary(0);
    renderLevelsRail();
  }

  function selectNivel(nivelId) {
    let grupo = getFirstGrupoByNivel(nivelId);
    if (!grupo) {
      clearGrupoSelectionForLevel(nivelId);
      return;
    }

    selectGrupo(grupo.id_grupo, grupo.nombre);
  }

  function updateActivitiesSummary(total) {
    let summary = document.getElementById('jerarquiagruposGroupSummary');
    let totalEl = document.getElementById('jerarquiagruposSummaryTotal');
    let nivelEl = document.getElementById('jerarquiagruposSummaryNivel');
    let superiorEl = document.getElementById('jerarquiagruposSummarySuperior');
    let estadoEl = document.getElementById('jerarquiagruposSummaryEstado');
    let colorSwatchEl = document.getElementById(
      'jerarquiagruposSummaryColorSwatch'
    );
    let colorTextEl = document.getElementById(
      'jerarquiagruposSummaryColorText'
    );

    if (
      !summary ||
      !totalEl ||
      !nivelEl ||
      !superiorEl ||
      !estadoEl ||
      !colorSwatchEl ||
      !colorTextEl
    )
      return;

    if (!state.selectedGrupoId) {
      summary.classList.add('d-none');
      totalEl.textContent = '0';
      nivelEl.textContent = '-';
      superiorEl.textContent = 'Raíz';
      estadoEl.textContent = '-';
      colorSwatchEl.style.background = '#d6d9dd';
      colorTextEl.textContent = '-';
      return;
    }

    let current = state.grupos.find(function (grupo) {
      return String(grupo.id_grupo) === String(state.selectedGrupoId);
    });

    summary.classList.remove('d-none');
    totalEl.textContent = String(total || 0);
    let currentNivel = getGrupoNivelValue(current);
    nivelEl.textContent = current
      ? getNivelLabel(currentNivel, current.nivel_nombre)
      : '-';
    superiorEl.textContent = current ? current.parent_nombre || 'Raíz' : 'Raíz';
    estadoEl.textContent = current
      ? current.activo
        ? 'Activo'
        : 'Inactivo'
      : '-';
    let resolvedColor = current
      ? normalizeHexColor(current.color) ||
        getNivelColor(currentNivel, current.nivel_color)
      : null;
    colorSwatchEl.style.background = resolvedColor || '#d6d9dd';
    colorTextEl.textContent = resolvedColor || 'Sin color';
  }

  function renderLevelsRail() {
    let container = document.getElementById('jerarquiagruposLevelsList');
    if (!container) return;

    container.innerHTML = (state.niveles || [])
      .map(function (nivel) {
        let count = countGroupsByLevel(nivel.id);
        let color = getNivelColor(nivel.id, nivel.color);
        let isSelected = Number(state.selectedGrupoNivel) === Number(nivel.id);
        return (
          '<div class="jerarquiagrupos-level-item' +
          (isSelected ? ' is-selected' : '') +
          '" data-level-id="' +
          app.escapeHtml(nivel.id) +
          '">' +
          '<div class="jerarquiagrupos-level-badge" style="background:' +
          color +
          ';">N' +
          app.escapeHtml(nivel.id) +
          '</div>' +
          '<div class="jerarquiagrupos-level-copy">' +
          '<div class="jerarquiagrupos-level-name">' +
          app.escapeHtml(nivel.nombre || 'Nivel ' + nivel.id) +
          '</div>' +
          '<div class="jerarquiagrupos-level-meta">' +
          count +
          ' grupo(s)</div>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function nodeMatchesSearch(node, term) {
    if (!term) return true;
    if (normalizeText(node.nombre).includes(term)) return true;
    let children = Array.isArray(node._children) ? node._children : [];
    return children.some(function (child) {
      return nodeMatchesSearch(child, term);
    });
  }

  function renderTreeNodes(nodes, depth, term) {
    if (!Array.isArray(nodes) || !nodes.length) return '';

    return nodes
      .map(function (node) {
        if (!nodeMatchesSearch(node, term)) return '';

        let hasChildren =
          Array.isArray(node._children) && node._children.length > 0;
        let isCollapsed =
          !!state.collapsedGrupoIds[String(node.id_grupo)] && !term;
        let isActive = String(state.selectedGrupoId) === String(node.id_grupo);
        let isDragSource =
          state.draggingGrupoId != null &&
          String(state.draggingGrupoId) === String(node.id_grupo);
        let isDragOver =
          state.dragOverGrupoId != null &&
          String(state.dragOverGrupoId) === String(node.id_grupo);
        let rowClass =
          'jer-tree-row' +
          (isActive ? ' is-active' : '') +
          (isDragSource ? ' is-dragging' : '') +
          (isDragOver ? ' is-drag-over' : '');
        let color =
          normalizeHexColor(node.color) ||
          getNivelColor(getGrupoNivelValue(node), node.nivel_color);
        let indent = 10 + depth * 14;
        let levelLabel = getNivelLabel(
          getGrupoNivelValue(node),
          node.nivel_nombre
        );
        let treeItemId = 'jer-treeitem-' + node.id_grupo;
        let statusBadge = node.activo
          ? '<span class="jer-tree-status is-on">Activo</span>'
          : '<span class="jer-tree-status is-off">Inactivo</span>';
        let colorBadge =
          '<span class="jer-tree-color-dot" style="background:' +
          app.escapeHtml(color) +
          ';" title="Color ' +
          app.escapeHtml(color) +
          '" aria-label="Color ' +
          app.escapeHtml(color) +
          '"></span>';
        let activeChip = isActive
          ? '<span class="jer-tree-active-chip" title="Seleccionado" aria-label="Seleccionado"><i class="bi bi-check2"></i></span>'
          : '';

        let childrenHtml = '';
        if (hasChildren && !isCollapsed) {
          childrenHtml =
            '<div class="jer-tree-children" role="group">' +
            renderTreeNodes(node._children, depth + 1, term) +
            '</div>';
        }

        return (
          '' +
          '<div class="jer-tree-node" data-grupo-id="' +
          app.escapeHtml(node.id_grupo) +
          '" id="' +
          app.escapeHtml(treeItemId) +
          '" role="treeitem" aria-level="' +
          String(depth + 1) +
          '" aria-selected="' +
          (isActive ? 'true' : 'false') +
          '"' +
          (hasChildren
            ? ' aria-expanded="' + (isCollapsed ? 'false' : 'true') + '"'
            : '') +
          '">' +
          '  <div class="' +
          rowClass +
          '" style="--jer-node-indent:' +
          indent +
          'px; --jer-node-color:' +
          app.escapeHtml(color) +
          ';" draggable="true">' +
          '    <button type="button" class="jer-tree-toggle" data-action="toggle" ' +
          (hasChildren ? '' : 'disabled') +
          '>' +
          (hasChildren
            ? '<i class="bi ' +
              (isCollapsed ? 'bi-caret-right-fill' : 'bi-caret-down-fill') +
              '"></i>'
            : '<i class="bi bi-dot"></i>') +
          '    </button>' +
          '    <button type="button" class="jer-tree-select" data-action="select">' +
          '      <span class="jer-tree-title-line">' +
          activeChip +
          '      <span class="jer-tree-name">' +
          app.escapeHtml(node.nombre || '-') +
          '</span>' +
          '      </span>' +
          '      <span class="jer-tree-meta">' +
          app.escapeHtml(levelLabel) +
          '</span>' +
          '    </button>' +
          '    <div class="jer-tree-badges">' +
          colorBadge +
          statusBadge +
          '    </div>' +
          '    <div class="jer-tree-actions">' +
          '      <button type="button" class="btn btn-sm btn-outline-success py-0 px-1 jer-tree-add-child" data-action="add-child" title="Nuevo hijo"><i class="bi bi-node-plus"></i></button>' +
          '      <button type="button" class="btn btn-sm btn-outline-primary py-0 px-1 jer-tree-edit" data-action="edit" title="Editar"><i class="bi bi-pencil"></i></button>' +
          '      <button type="button" class="btn btn-sm btn-outline-danger py-0 px-1 jer-tree-delete" data-action="delete" title="Eliminar"><i class="bi bi-trash"></i></button>' +
          '    </div>' +
          '  </div>' +
          childrenHtml +
          '</div>'
        );
      })
      .join('');
  }

  function findNodeById(nodes, targetId) {
    if (!Array.isArray(nodes) || !nodes.length) return null;

    for (let i = 0; i < nodes.length; i += 1) {
      let node = nodes[i];
      if (String(node.id_grupo) === String(targetId)) return node;
      let children = findNodeById(node._children || [], targetId);
      if (children) return children;
    }

    return null;
  }

  function flattenVisibleTree(nodes, term, depth, out) {
    if (!Array.isArray(nodes) || !nodes.length) return out;

    nodes.forEach(function (node) {
      if (!nodeMatchesSearch(node, term)) return;

      let hasChildren =
        Array.isArray(node._children) && node._children.length > 0;
      let isCollapsed =
        !!state.collapsedGrupoIds[String(node.id_grupo)] && !term;
      out.push({ id: Number(node.id_grupo), depth: depth, node: node });

      if (hasChildren && !isCollapsed) {
        flattenVisibleTree(node._children, term, depth + 1, out);
      }
    });

    return out;
  }

  function getVisibleTreeOrder() {
    let term = normalizeText(state.treeSearchTerm);
    return flattenVisibleTree(state.gruposTree || [], term, 0, []);
  }

  function updateTreeActiveDescendant() {
    let treeEl = document.getElementById('jerarquiagruposTree');
    if (!treeEl) return;

    if (!state.selectedGrupoId) {
      treeEl.removeAttribute('aria-activedescendant');
      return;
    }

    let nodeEl = getTreeNodeElementByGrupoId(state.selectedGrupoId);
    if (!nodeEl || !nodeEl.id) {
      treeEl.removeAttribute('aria-activedescendant');
      return;
    }

    treeEl.setAttribute('aria-activedescendant', nodeEl.id);
  }

  function getTreeNodeElementByGrupoId(grupoId) {
    let treeEl = document.getElementById('jerarquiagruposTree');
    if (!treeEl || grupoId == null) return null;
    let nodes = treeEl.querySelectorAll('.jer-tree-node[data-grupo-id]');
    for (let i = 0; i < nodes.length; i += 1) {
      if (String(nodes[i].getAttribute('data-grupo-id')) === String(grupoId))
        return nodes[i];
    }
    return null;
  }

  function ensureActiveNodeVisible() {
    if (!state.selectedGrupoId) return;
    let nodeEl = getTreeNodeElementByGrupoId(state.selectedGrupoId);
    if (!nodeEl) return;

    requestAnimationFrame(function () {
      let active = nodeEl.querySelector('.jer-tree-row');
      if (!active) return;
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function focusActiveTreeNode() {
    let treeEl = document.getElementById('jerarquiagruposTree');
    if (!treeEl) return;
    treeEl.focus();
  }

  function expandNode(grupoId) {
    let key = String(grupoId);
    if (!state.collapsedGrupoIds[key]) return false;
    setNodeCollapsed(grupoId, false);
    renderGruposTree();
    return true;
  }

  function collapseNode(grupoId) {
    let key = String(grupoId);
    if (state.collapsedGrupoIds[key]) return false;
    setNodeCollapsed(grupoId, true);
    renderGruposTree();
    return true;
  }

  function handleTreeKeyboardNavigation(e) {
    let key = e.key;
    if (
      ![
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'Enter',
      ].includes(key)
    ) {
      return;
    }

    let visible = getVisibleTreeOrder();
    if (!visible.length) return;

    let currentId = state.selectedGrupoId
      ? Number(state.selectedGrupoId)
      : null;
    let currentIndex = visible.findIndex(function (item) {
      return Number(item.id) === Number(currentId);
    });

    if (currentIndex < 0) currentIndex = 0;

    let current = visible[currentIndex];
    let currentNode = current ? current.node : null;

    let handled = false;

    if (key === 'ArrowDown') {
      let next =
        visible[Math.min(currentIndex + 1, visible.length - 1)] || current;
      if (next) selectGrupo(next.id, next.node.nombre);
      handled = true;
    }

    if (key === 'ArrowUp') {
      let prev = visible[Math.max(currentIndex - 1, 0)] || current;
      if (prev) selectGrupo(prev.id, prev.node.nombre);
      handled = true;
    }

    if (key === 'Home') {
      selectGrupo(visible[0].id, visible[0].node.nombre);
      handled = true;
    }

    if (key === 'End') {
      let last = visible[visible.length - 1];
      selectGrupo(last.id, last.node.nombre);
      handled = true;
    }

    if (key === 'ArrowRight' && currentNode) {
      let hasChildren =
        Array.isArray(currentNode._children) &&
        currentNode._children.length > 0;
      if (hasChildren) {
        if (expandNode(currentNode.id_grupo)) {
          handled = true;
        } else {
          let firstChild = currentNode._children[0];
          if (firstChild) {
            selectGrupo(firstChild.id_grupo, firstChild.nombre);
            handled = true;
          }
        }
      }
    }

    if (key === 'ArrowLeft' && currentNode) {
      let hasVisibleChildren =
        Array.isArray(currentNode._children) &&
        currentNode._children.length > 0;
      if (
        hasVisibleChildren &&
        normalizeText(state.treeSearchTerm) === '' &&
        !state.collapsedGrupoIds[String(currentNode.id_grupo)]
      ) {
        if (collapseNode(currentNode.id_grupo)) handled = true;
      } else {
        let parentId = currentNode.parent_id_grupo;
        if (parentId != null) {
          let parentNode = findNodeById(state.gruposTree || [], parentId);
          let parentNombre = parentNode ? parentNode.nombre : '';
          selectGrupo(parentId, parentNombre);
          handled = true;
        }
      }
    }

    if (key === 'Enter' && current) {
      selectGrupo(current.id, current.node.nombre);
      handled = true;
    }

    if (handled) {
      e.preventDefault();
      focusActiveTreeNode();
    }
  }

  function renderGruposTree() {
    let container = document.getElementById('jerarquiagruposTree');
    if (!container) return;

    let term = normalizeText(state.treeSearchTerm);
    let html = renderTreeNodes(state.gruposTree || [], 0, term);
    if (!html) {
      container.innerHTML =
        '<div class="jer-tree-empty">No hay grupos para el filtro actual.</div>';
      updateTreeActiveDescendant();
      return;
    }
    container.innerHTML = html;
    updateTreeActiveDescendant();
    ensureActiveNodeVisible();
  }

  function clearTreeDragState() {
    if (state.draggingGrupoId == null && state.dragOverGrupoId == null) return;
    state.draggingGrupoId = null;
    state.dragOverGrupoId = null;
    renderGruposTree();
  }

  async function moveGrupoToParent(grupoId, nuevoPadreId) {
    let source = getGrupoById(grupoId);
    let target = getGrupoById(nuevoPadreId);
    if (!source || !target) {
      throw new Error('No se pudo determinar grupo origen/destino');
    }

    let body = {
      parent_id_grupo: Number(nuevoPadreId),
      nombre: source.nombre,
      nivel: getGrupoNivelValue(source) || 1,
      orden: Number(source.orden || 0),
      activo: !!source.activo,
    };

    let res = await fetch(
      '/api/jerarquiagrupos/grupos/' + encodeURIComponent(grupoId),
      {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      let err = await res.json().catch(function () {
        return {};
      });
      throw new Error(err.message || err.error || 'Error al mover el grupo');
    }

    await Promise.all([loadMeta(), loadGrupos()]);
    selectGrupo(Number(grupoId), source.nombre);
    showAlert(
      'alertContainerGrupoJer',
      'Grupo movido bajo "' + target.nombre + '" correctamente',
      'success'
    );
  }

  async function handleTreeDrop(sourceId, targetId) {
    if (!sourceId || !targetId) return;
    if (Number(sourceId) === Number(targetId)) return;

    let descendants = collectDescendantIds(sourceId);
    if (descendants.has(String(targetId))) {
      showAlert(
        'alertContainerGrupoJer',
        'No se puede mover el grupo dentro de su propio árbol',
        'warning'
      );
      return;
    }

    let source = getGrupoById(sourceId);
    let target = getGrupoById(targetId);
    if (!source || !target) {
      showAlert(
        'alertContainerGrupoJer',
        'No se pudo resolver origen/destino',
        'danger'
      );
      return;
    }

    let confirmed = window.confirm(
      'Mover "' +
        source.nombre +
        '" para que dependa de "' +
        target.nombre +
        '"?'
    );
    if (!confirmed) return;

    try {
      await moveGrupoToParent(sourceId, targetId);
    } catch (e) {
      showAlert('alertContainerGrupoJer', e.message, 'danger');
    }
  }

  // ─── Data Loading ────────────────────────────────────────────────────────

  async function loadMeta() {
    let res = await fetch('/api/jerarquiagrupos/meta', {
      headers: headersGet(),
    });
    let json = await readJsonOrThrow(res, 'Error al cargar metadatos');
    state.niveles = json.niveles || [];
    state.grupos = json.grupos || [];
    renderLevelsRail();
    renderGruposTree();
  }

  async function loadGrupos() {
    let res = await fetch('/api/jerarquiagrupos/grupos', {
      headers: headersGet(),
    });
    let json = await readJsonOrThrow(res, 'Error al cargar grupos');
    state.gruposTree = json.grupos || [];
    renderGruposTree();
  }

  async function loadActividadesByGrupo(grupoId) {
    if (!state.tabulatorActividades) initTabulatorActividades();
    let res = await fetch(
      '/api/jerarquiagrupos/grupos/' + grupoId + '/actividades',
      { headers: headersGet() }
    );
    let json = await readJsonOrThrow(res, 'Error al cargar actividades');
    state.actividades = json.actividades || [];
    updateActivitiesSummary(state.actividades.length);
    applyActividadesData(state.actividades);
  }

  // ─── Formatters ──────────────────────────────────────────────────────────

  const NIVEL_COLORS = {
    1: '#0d6efd',
    2: '#6610f2',
    3: '#198754',
    4: '#fd7e14',
    5: '#dc3545',
  };

  function disponibleFormatter(cell) {
    let v = cell.getValue();
    if (v === '--a--')
      return '<span class="badge bg-success" style="font-size:.68rem;">Activos</span>';
    if (v === '--d--')
      return '<span class="badge bg-secondary" style="font-size:.68rem;">De baja</span>';
    return '<span class="badge bg-light text-dark border" style="font-size:.68rem;">General</span>';
  }

  function actionBtns(editClass, deleteClass) {
    return (
      '<div class="d-flex gap-1">' +
      '<button class="btn btn-sm btn-outline-primary py-0 px-1 ' +
      editClass +
      '" type="button" title="Editar"><i class="bi bi-pencil"></i></button>' +
      '<button class="btn btn-sm btn-outline-danger py-0 px-1 ' +
      deleteClass +
      '" type="button" title="Eliminar"><i class="bi bi-trash"></i></button>' +
      '</div>'
    );
  }

  function selectGrupo(grupoId, nombre) {
    state.selectedGrupoId = grupoId;
    state.selectedGrupoNombre = nombre;
    let current =
      state.grupos.find(function (grupo) {
        return String(grupo.id_grupo) === String(grupoId);
      }) || null;
    let currentNivel = getGrupoNivelValue(current);
    state.selectedGrupoNivel = currentNivel;
    renderLevelsRail();
    renderGruposTree();

    let bc = document.getElementById('jerarquiagruposBreadcrumb');
    if (bc) {
      let path = buildBreadcrumb(grupoId);
      let context = current
        ? getNivelLabel(currentNivel, current.nivel_nombre) +
          ' · ' +
          (current.parent_nombre || 'Raíz')
        : '';
      bc.textContent = context ? context + ' · ' + path : path;
    }

    let panel = document.getElementById('actividadesJerPanel');
    let noMsg = document.getElementById('jerarquiagruposNoGrupoMsg');
    let newBtn = document.getElementById('btnNuevaActividadJer');
    let childBtn = document.getElementById('btnNuevoHijoGrupoJer');
    if (panel) panel.style.display = 'block';
    if (noMsg) noMsg.style.display = 'none';
    // @ts-ignore
    if (newBtn) newBtn.disabled = false;
    // @ts-ignore
    if (childBtn) childBtn.disabled = false;
    updateActivitiesSummary(state.actividades.length);

    if (!state.tabulatorActividades) initTabulatorActividades();

    loadActividadesByGrupo(grupoId).catch(function (e) {
      showAlert('alertContainerActividadJer', e.message, 'danger');
    });
  }

  // ─── Tabulator: Actividades ──────────────────────────────────────────────

  function initTabulatorActividades() {
    if (state.tabulatorActividades) return;
    state.actividadesTableBuilt = false;
    state.pendingActividadesData = null;

    // @ts-ignore
    state.tabulatorActividades = new Tabulator('#tabulatorActividadesJer', {
      locale: 'es-es',
      langs: LANGS,
      data: [],
      layout: 'fitDataFill',
      height: '600px', // <--- Añade esta línea (puedes ajustar los px)

      pagination: true,
      paginationSize: 25,
      paginationSizeSelector: [10, 25, 50, true],
      columnDefaults: { resizable: true },
      columns: [
        {
          title: 'Código',
          field: 'actividad',
          width: 85,
          formatter: function (cell) {
            return app.escapeHtml(cell.getValue() || '—');
          },
        },
        {
          title: 'Nombre',
          field: 'nombre',
          minWidth: 130,
          headerFilter: 'input',
        },
        {
          title: 'Color',
          field: 'color',
          width: 95,
          headerSort: false,
          formatter: function (cell) {
            let value = normalizeHexColor(cell.getValue()) || '#d6d9dd';
            let raw = String(cell.getValue() || '').trim();
            return (
              '<span style="display:inline-flex;align-items:center;gap:6px;font-size:.75rem;line-height:1.2;">' +
              '<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:' +
              app.escapeHtml(value) +
              ';border:1px solid rgba(0,0,0,.2);"></span>' +
              '<span>' +
              app.escapeHtml(raw || '-') +
              '</span></span>'
            );
          },
        },
        {
          title: 'Disp.',
          field: 'disponible',
          width: 88,
          formatter: disponibleFormatter,
        },
        {
          title: 'Horario',
          field: 'horario',
          width: 110,
          formatter: function (cell) {
            return app.escapeHtml(cell.getValue() || '—');
          },
        },
        { title: 'Inicio', field: 'hora_inicio', width: 72 },
        { title: 'Fin', field: 'hora_fin', width: 72 },
        {
          title: 'Baja',
          field: 'fecha_baja',
          width: 90,
          headerSort: false,
          formatter: function (cell) {
            let val = cell.getValue();
            if (!val) {
              return window.GRS1Utils.renderSemanticBadgeHtml('Activa', 'success', {
                escapeHtmlFn: app.escapeHtml,
              });
            }
            let dt =
              window.luxon && window.luxon.DateTime
                ? window.luxon.DateTime.fromISO(val)
                    .setZone('Europe/Madrid')
                    .toFormat('dd/LL/yyyy')
                : String(val).slice(0, 10);
            return window.GRS1Utils.renderSemanticBadgeHtml(dt, 'danger', {
              escapeHtmlFn: app.escapeHtml,
            });
          },
        },
        {
          title: '',
          width: 72,
          headerSort: false,
          editable: false,
          formatter: function () {
            return actionBtns('btn-edit-act-jer', 'btn-delete-act-jer');
          },
          cellClick: function (e, cell) {
            let data = cell.getRow().getData();
            if (e.target.closest('.btn-edit-act-jer')) {
              openEditActividadModal(data);
            }
            if (e.target.closest('.btn-delete-act-jer')) {
              // @ts-ignore
              confirmDeleteActividad(data.id_actividad, data.nombre);
            }
          },
        },
      ],
    });

    state.tabulatorActividades.on('tableBuilt', function () {
      state.actividadesTableBuilt = true;
      if (state.pendingActividadesData !== null) {
        let pending = state.pendingActividadesData;
        state.pendingActividadesData = null;
        applyActividadesData(pending);
      }
    });
  }

  // ─── Modal: Grupo ─────────────────────────────────────────────────────────

  function collectDescendantIds(grupoId) {
    let node = findNodeById(state.gruposTree || [], grupoId);
    let ids = new Set();
    if (!node) return ids;

    function walk(children) {
      (children || []).forEach(function (child) {
        ids.add(String(child.id_grupo));
        walk(child._children || []);
      });
    }

    walk(node._children || []);
    return ids;
  }

  function populatePadreSelect(excludeId, blockedParentIds) {
    let sel = document.getElementById('grupoJerPadre');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Sin padre (raíz nivel 1) —</option>';
    let blocked = blockedParentIds || new Set();
    state.grupos.forEach(function (g) {
      if (excludeId && String(g.id_grupo) === String(excludeId)) return;
      if (blocked.has(String(g.id_grupo))) return;
      let nivel = getGrupoNivelValue(g) || 1;
      let indent = '\u00a0\u00a0'.repeat(Math.max(nivel - 1, 0));
      let opt = document.createElement('option');
      opt.value = g.id_grupo;
      opt.textContent =
        indent + '[' + getNivelLabel(nivel, g.nivel_nombre) + '] ' + g.nombre;
      sel.appendChild(opt);
    });
  }

  function setGrupoModalParent(parentId) {
    let sel = document.getElementById('grupoJerPadre');
    if (!sel) return;
    // @ts-ignore
    sel.value = parentId != null ? String(parentId) : '';
  }

  function populateNivelSelect(selectedNivelId) {
    let sel = document.getElementById('grupoJerNivel');
    if (!sel) return;

    let niveles = Array.isArray(state.niveles) ? state.niveles : [];
    sel.innerHTML = '';

    if (!niveles.length) {
      let fallback = document.createElement('option');
      fallback.value = '1';
      fallback.textContent = 'Nivel 1';
      sel.appendChild(fallback);
      // @ts-ignore
      sel.value = '1';
      return;
    }

    niveles.forEach(function (nivel) {
      let opt = document.createElement('option');
      opt.value = String(nivel.id);
      opt.textContent = getNivelLabel(nivel.id, nivel.nombre);
      sel.appendChild(opt);
    });

    let selected = selectedNivelId != null ? String(selectedNivelId) : '';
    if (
      selected &&
      niveles.some(function (nivel) {
        return String(nivel.id) === selected;
      })
    ) {
      // @ts-ignore
      sel.value = selected;
    } else {
      // @ts-ignore
      sel.value = String(niveles[0].id);
    }
  }

  function openNewGrupoModal(parentGrupoId) {
    document.getElementById('modalGrupoJerLabel').textContent = 'Nuevo Grupo';
    // @ts-ignore
    document.getElementById('grupoJerId').value = '';
    let form = document.getElementById('formGrupoJer');
    if (form) {
      // @ts-ignore
      form.reset();
      form.classList.remove('was-validated');
    }
    let sel = document.getElementById('grupoJerPadre');
    // @ts-ignore
    if (sel) sel.disabled = false;
    // @ts-ignore
    document.getElementById('grupoJerCodigo').value = '';
    // @ts-ignore
    document.getElementById('grupoJerColor').value = '#6c757d';
    populatePadreSelect(null);
    let parentGroup =
      parentGrupoId != null
        ? state.grupos.find(function (g) {
            return Number(g.id_grupo) === Number(parentGrupoId);
          })
        : null;
    populateNivelSelect(getGrupoNivelValue(parentGroup) || 1);
    setGrupoModalParent(parentGrupoId != null ? parentGrupoId : null);
    // @ts-ignore
    document.getElementById('grupoJerActivo').checked = true;
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('modalGrupoJer')
    ).show();
  }

  function openNewChildGrupoModal(parentData) {
    if (!parentData || !parentData.id_grupo) {
      openNewGrupoModal();
      return;
    }
    openNewGrupoModal(parentData.id_grupo);
    document.getElementById('modalGrupoJerLabel').textContent =
      'Nuevo Subgrupo de ' + (parentData.nombre || 'Grupo');
  }

  function openEditGrupoModal(data) {
    document.getElementById('modalGrupoJerLabel').textContent = 'Editar Grupo';
    // @ts-ignore
    document.getElementById('grupoJerId').value = data.id_grupo;
    // @ts-ignore
    document.getElementById('grupoJerNombre').value = data.nombre || '';
    // @ts-ignore
    document.getElementById('grupoJerCodigo').value = data.codigo || '';
    // @ts-ignore
    document.getElementById('grupoJerColor').value =
      normalizeHexColor(data.color) || '#6c757d';
    // @ts-ignore
    document.getElementById('grupoJerOrden').value =
      data.orden != null ? data.orden : 0;
    // @ts-ignore
    document.getElementById('grupoJerActivo').checked = !!data.activo;
    let form = document.getElementById('formGrupoJer');
    if (form) form.classList.remove('was-validated');

    let blocked = collectDescendantIds(data.id_grupo);
    populatePadreSelect(data.id_grupo, blocked);

    let sel = document.getElementById('grupoJerPadre');
    if (sel) {
      // @ts-ignore
      sel.value = data.parent_id_grupo || '';
      // @ts-ignore
      sel.disabled = false;
    }

    let currentNivel = getGrupoNivelValue(data);
    populateNivelSelect(currentNivel);

    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('modalGrupoJer')
    ).show();
  }

  async function saveGrupo() {
    let form = document.getElementById('formGrupoJer');
    // @ts-ignore
    if (!form || !form.checkValidity()) {
      if (form) form.classList.add('was-validated');
      return;
    }

    // @ts-ignore
    let id = document.getElementById('grupoJerId').value;
    // @ts-ignore
    let padreId = document.getElementById('grupoJerPadre').value;
    let nivel = parseInt(
      // @ts-ignore
      document.getElementById('grupoJerNivel').value || '1',
      10
    );
    // @ts-ignore
    let codigo = document.getElementById('grupoJerCodigo').value.trim();
    let color = normalizeHexColor(
      // @ts-ignore
      document.getElementById('grupoJerColor').value
    );

    let body = {
      // @ts-ignore
      nombre: document.getElementById('grupoJerNombre').value.trim(),
      codigo: codigo || null,
      color: color || null,
      orden: parseInt(
        // @ts-ignore
        document.getElementById('grupoJerOrden').value || '0',
        10
      ),
      // @ts-ignore
      activo: document.getElementById('grupoJerActivo').checked,
      parent_id_grupo: padreId ? parseInt(padreId, 10) : null,
      nivel: nivel,
    };

    let url = id
      ? '/api/jerarquiagrupos/grupos/' + id
      : '/api/jerarquiagrupos/grupos';
    let method = id ? 'PUT' : 'POST';

    try {
      let res = await fetch(url, {
        method: method,
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let err = await res.json().catch(function () {
          return {};
        });
        throw new Error(err.message || err.error || 'Error al guardar');
      }
      let modalEl = document.getElementById('modalGrupoJer');
      if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
      showAlert(
        'alertContainerGrupoJer',
        id ? 'Grupo actualizado' : 'Grupo creado correctamente',
        'success'
      );
      await Promise.all([loadMeta(), loadGrupos()]);
      if (id) {
        selectGrupo(Number(id), body.nombre);
      }
    } catch (e) {
      showAlert('alertContainerGrupoJer', e.message, 'danger');
    }
  }

  function confirmDeleteGrupo(id) {
    let modalEl = document.getElementById('modalDeleteGrupoJer');
    if (!modalEl) return;
    let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let btn = document.getElementById('btnConfirmDeleteGrupoJer');

    let handler = async function () {
      btn.removeEventListener('click', handler);
      modal.hide();
      try {
        let res = await fetch(
          '/api/jerarquiagrupos/grupos/' + encodeURIComponent(id),
          {
            method: 'DELETE',
            headers: headers(),
          }
        );
        if (!res.ok) {
          let err = await res.json().catch(function () {
            return {};
          });
          throw new Error(err.message || err.error || 'Error al eliminar');
        }
        showAlert(
          'alertContainerGrupoJer',
          'Grupo eliminado correctamente',
          'success'
        );
        if (state.selectedGrupoId === id) {
          state.selectedGrupoId = null;
          state.selectedGrupoNombre = '';
          state.selectedGrupoNivel = null;
          let panel = document.getElementById('actividadesJerPanel');
          let noMsg = document.getElementById('jerarquiagruposNoGrupoMsg');
          let newBtn = document.getElementById('btnNuevaActividadJer');
          let childBtn = document.getElementById('btnNuevoHijoGrupoJer');
          let bc = document.getElementById('jerarquiagruposBreadcrumb');
          if (panel) panel.style.display = 'none';
          if (noMsg) noMsg.style.display = '';
          // @ts-ignore
          if (newBtn) newBtn.disabled = true;
          // @ts-ignore
          if (childBtn) childBtn.disabled = true;
          if (bc) bc.textContent = '';
          updateActivitiesSummary(0);
          renderLevelsRail();
          renderGruposTree();
        }
        await Promise.all([loadMeta(), loadGrupos()]);
      } catch (e) {
        showAlert('alertContainerGrupoJer', e.message, 'danger');
      }
    };

    modalEl.addEventListener('hide.bs.modal', function cleanup() {
      btn.removeEventListener('click', handler);
      modalEl.removeEventListener('hide.bs.modal', cleanup);
    });
    btn.addEventListener('click', handler);
    modal.show();
  }

  // ─── Modal: Actividad ────────────────────────────────────────────────────

  function renderActividadJerFechaBaja(displayEl, btnEl, fechaBaja) {
    if (!displayEl || !btnEl) return;
    if (!fechaBaja) {
      displayEl.innerHTML = window.GRS1Utils.renderSemanticBadgeHtml(
        'Activa',
        'success',
        { escapeHtmlFn: app.escapeHtml }
      );
      btnEl.innerHTML = '<i class="bi bi-slash-circle me-1"></i>Dar de baja';
      btnEl.className = 'btn btn-sm btn-outline-danger';
    } else {
      let dt =
        window.luxon && window.luxon.DateTime
          ? window.luxon.DateTime.fromISO(fechaBaja)
              .setZone('Europe/Madrid')
              .toFormat('dd/LL/yyyy HH:mm')
          : String(fechaBaja).slice(0, 16).replace('T', ' ');
      displayEl.innerHTML = window.GRS1Utils.renderSemanticBadgeHtml(
        dt,
        'danger',
        { escapeHtmlFn: app.escapeHtml }
      );
      btnEl.innerHTML =
        '<i class="bi bi-arrow-counterclockwise me-1"></i>Reactivar';
      btnEl.className = 'btn btn-sm btn-outline-success';
    }
  }

  async function handleActividadJerToggleBaja(id, displayEl, btnEl) {
    btnEl.disabled = true;
    try {
      let res = await fetch(
        '/api/jerarquiagrupos/actividades/' + id + '/baja',
        {
          method: 'PATCH',
          headers: headers(),
        }
      );
      if (!res.ok) {
        let err = await res.json().catch(function () {
          return {};
        });
        throw new Error(err.message || err.error || 'Error al cambiar estado');
      }
      let json = await res.json();
      let nuevaFechaBaja =
        json && json.actividad ? json.actividad.fecha_baja : null;
      renderActividadJerFechaBaja(displayEl, btnEl, nuevaFechaBaja);
      // actualizar dato en la tabla sin recargar
      if (state.tabulatorActividades) {
        let row = state.tabulatorActividades.getRow(id);
        if (row) row.update({ fecha_baja: nuevaFechaBaja });
      }
    } catch (e) {
      showAlert('alertContainerActividadJer', e.message, 'danger');
    } finally {
      btnEl.disabled = false;
    }
  }

  function openNewActividadModal() {
    if (!state.selectedGrupoId) return;
    document.getElementById('modalActividadJerLabel').textContent =
      'Nueva Actividad — ' + state.selectedGrupoNombre;
    // @ts-ignore
    document.getElementById('actividadJerId').value = '';
    let codigoEl = document.getElementById('actividadJerCodigo');
    if (codigoEl) {
      // @ts-ignore
      codigoEl.readOnly = false;
      codigoEl.title = '';
    }
    let bajaRow = document.getElementById('actividadJerBajaRow');
    if (bajaRow) bajaRow.style.display = 'none';
    let form = document.getElementById('formActividadJer');
    if (form) {
      // @ts-ignore
      form.reset();
      form.classList.remove('was-validated');
    }
    let colorEl = document.getElementById('actividadJerColor');
    if (colorEl) {
      // @ts-ignore
      colorEl.value = '#6c757d';
    }
    populateActividadGrupoSelect(state.selectedGrupoId);
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('modalActividadJer')
    ).show();
  }

  function openEditActividadModal(data) {
    document.getElementById('modalActividadJerLabel').textContent =
      'Editar Actividad';
    // @ts-ignore
    document.getElementById('actividadJerId').value = data.id_actividad;
    populateActividadGrupoSelect(data.grupo_id);
    let codigoEl = document.getElementById('actividadJerCodigo');
    if (codigoEl) {
      // @ts-ignore
      codigoEl.value = data.actividad || '';
      // @ts-ignore
      codigoEl.readOnly = true;
      codigoEl.title = 'El código es PK y no se puede modificar';
    }
    // @ts-ignore
    document.getElementById('actividadJerNombre').value = data.nombre || '';
    // @ts-ignore
    document.getElementById('actividadJerDisponible').value =
      data.disponible || '';
    // @ts-ignore
    document.getElementById('actividadJerHorario').value = data.horario || '';
    let colorEl = document.getElementById('actividadJerColor');
    if (colorEl) {
      // @ts-ignore
      colorEl.value = normalizeHexColor(data.color) || '#6c757d';
    }
    // @ts-ignore
    document.getElementById('actividadJerHoraInicio').value = data.hora_inicio
      ? String(data.hora_inicio).slice(0, 5)
      : '';
    // @ts-ignore
    document.getElementById('actividadJerHoraFin').value = data.hora_fin
      ? String(data.hora_fin).slice(0, 5)
      : '';

    // fecha_baja — solo en edición
    let bajaRow = document.getElementById('actividadJerBajaRow');
    let bajaDisplay = document.getElementById('actividadJerFechaBajaDisplay');
    let btnToggleBaja = document.getElementById('btnActividadJerToggleBaja');
    if (bajaRow) bajaRow.style.display = '';
    renderActividadJerFechaBaja(bajaDisplay, btnToggleBaja, data.fecha_baja);
    if (btnToggleBaja) {
      let newBtn = btnToggleBaja.cloneNode(true);
      btnToggleBaja.parentNode.replaceChild(newBtn, btnToggleBaja);
      newBtn.addEventListener('click', function () {
        handleActividadJerToggleBaja(data.id_actividad, bajaDisplay, newBtn);
      });
    }

    let form = document.getElementById('formActividadJer');
    if (form) form.classList.remove('was-validated');
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('modalActividadJer')
    ).show();
  }

  function populateActividadGrupoSelect(selectedId) {
    let sel = document.getElementById('actividadJerGrupoId');
    if (!sel) return;

    sel.innerHTML = '<option value="">Selecciona un grupo...</option>';

    let sorted = (state.grupos || []).slice().sort(function (a, b) {
      let ordenA = Number(a.orden || 0);
      let ordenB = Number(b.orden || 0);
      if (ordenA !== ordenB) return ordenA - ordenB;
      return String(a.nombre || '').localeCompare(String(b.nombre || ''));
    });

    sorted.forEach(function (g) {
      let opt = document.createElement('option');
      opt.value = g.id_grupo;
      let nivel = getGrupoNivelValue(g) || 1;
      let indent = ' '.repeat(Math.max(Number(nivel) - 1, 0) * 2);
      opt.textContent =
        indent + '[' + getNivelLabel(nivel, g.nivel_nombre) + '] ' + g.nombre;
      sel.appendChild(opt);
    });

    if (selectedId != null) {
      // @ts-ignore
      sel.value = String(selectedId);
    }
  }

  async function saveActividad() {
    let form = document.getElementById('formActividadJer');
    // @ts-ignore
    if (!form || !form.checkValidity()) {
      if (form) form.classList.add('was-validated');
      return;
    }

    // @ts-ignore
    let id = document.getElementById('actividadJerId').value;
    // @ts-ignore
    let codigo = document.getElementById('actividadJerCodigo').value.trim();
    let body = {
      // @ts-ignore
      nombre: document.getElementById('actividadJerNombre').value.trim(),
      // @ts-ignore
      disponible: document.getElementById('actividadJerDisponible').value,
      grupo_id: parseInt(
        // @ts-ignore
        document.getElementById('actividadJerGrupoId').value,
        10
      ),
      horario:
        // @ts-ignore
        document.getElementById('actividadJerHorario').value.trim() || null,
      color:
        normalizeHexColor(
          // @ts-ignore
          document.getElementById('actividadJerColor').value
        ) || null,
      hora_inicio:
        // @ts-ignore
        document.getElementById('actividadJerHoraInicio').value || null,
      // @ts-ignore
      hora_fin: document.getElementById('actividadJerHoraFin').value || null,
    };

    if (!id) {
      body.actividad = codigo;
    }

    let url = id
      ? '/api/jerarquiagrupos/actividades/' + id
      : '/api/jerarquiagrupos/actividades';
    let method = id ? 'PUT' : 'POST';

    try {
      let res = await fetch(url, {
        method: method,
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let err = await res.json().catch(function () {
          return {};
        });
        throw new Error(err.message || err.error || 'Error al guardar');
      }
      let modalEl = document.getElementById('modalActividadJer');
      if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
      showAlert(
        'alertContainerActividadJer',
        id ? 'Actividad actualizada' : 'Actividad creada correctamente',
        'success'
      );
      await loadActividadesByGrupo(state.selectedGrupoId);
    } catch (e) {
      showAlert('alertContainerActividadJer', e.message, 'danger');
    }
  }

  function confirmDeleteActividad(id) {
    let modalEl = document.getElementById('modalDeleteActividadJer');
    if (!modalEl) return;
    let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let btn = document.getElementById('btnConfirmDeleteActividadJer');

    let handler = async function () {
      btn.removeEventListener('click', handler);
      modal.hide();
      try {
        let res = await fetch(
          '/api/jerarquiagrupos/actividades/' + encodeURIComponent(id),
          {
            method: 'DELETE',
            headers: headers(),
          }
        );
        if (!res.ok) {
          let err = await res.json().catch(function () {
            return {};
          });
          throw new Error(err.message || err.error || 'Error al eliminar');
        }
        showAlert(
          'alertContainerActividadJer',
          'Actividad eliminada correctamente',
          'success'
        );
        await loadActividadesByGrupo(state.selectedGrupoId);
      } catch (e) {
        showAlert('alertContainerActividadJer', e.message, 'danger');
      }
    };

    modalEl.addEventListener('hide.bs.modal', function cleanup() {
      btn.removeEventListener('click', handler);
      modalEl.removeEventListener('hide.bs.modal', cleanup);
    });
    btn.addEventListener('click', handler);
    modal.show();
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  function setupEvents() {
    document
      .getElementById('btnNuevoGrupoJer')
      ?.addEventListener('click', function () {
        openNewGrupoModal(null);
      });
    document
      .getElementById('btnNuevoHijoGrupoJer')
      ?.addEventListener('click', function () {
        if (!state.selectedGrupoId) return;
        let current = state.grupos.find(function (item) {
          return Number(item.id_grupo) === Number(state.selectedGrupoId);
        });
        openNewChildGrupoModal(current || null);
      });
    document
      .getElementById('btnGuardarGrupoJer')
      ?.addEventListener('click', saveGrupo);
    document
      .getElementById('formGrupoJer')
      ?.addEventListener('submit', function (e) {
        e.preventDefault();
        saveGrupo();
      });
    // Re-enable padre select on modal close (was disabled for edit)
    document
      .getElementById('modalGrupoJer')
      ?.addEventListener('hidden.bs.modal', function () {
        let sel = document.getElementById('grupoJerPadre');
        // @ts-ignore
        if (sel) sel.disabled = false;
      });

    document
      .getElementById('btnNuevaActividadJer')
      ?.addEventListener('click', openNewActividadModal);
    document
      .getElementById('btnExportJerarquiaExcel')
      ?.addEventListener('click', function () {
        exportJerarquiaExcel().catch(function (e) {
          showAlert('alertContainerGrupoJer', e.message, 'danger');
        });
      });
    document
      .getElementById('btnExportActividadesJerExcel')
      ?.addEventListener('click', function () {
        exportActividadesExcel();
      });
    document
      .getElementById('btnGuardarActividadJer')
      ?.addEventListener('click', saveActividad);
    document
      .getElementById('formActividadJer')
      ?.addEventListener('submit', function (e) {
        e.preventDefault();
        saveActividad();
      });

    document
      .getElementById('jerarquiagruposLevelsList')
      ?.addEventListener('click', function (e) {
        // @ts-ignore
        let item = e.target.closest('.jerarquiagrupos-level-item');
        if (!item) return;
        let nivelId = Number(item.getAttribute('data-level-id'));
        if (!nivelId) return;
        selectNivel(nivelId);
      });

    document
      .getElementById('jerarquiagruposTreeSearch')
      ?.addEventListener('input', function (e) {
        // @ts-ignore
        state.treeSearchTerm = e.target.value || '';
        renderGruposTree();
      });

    document
      .getElementById('jerarquiagruposTreeSearch')
      ?.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          let visible = getVisibleTreeOrder();
          if (!visible.length) return;
          let first = visible[0];
          selectGrupo(first.id, first.node.nombre);
          focusActiveTreeNode();
        }
      });

    document
      .getElementById('jerarquiagruposTree')
      ?.addEventListener('click', function (e) {
        // @ts-ignore
        let nodeEl = e.target.closest('.jer-tree-node');
        if (!nodeEl) return;

        let grupoId = Number(nodeEl.getAttribute('data-grupo-id'));
        if (!grupoId) return;

        let grupo = state.grupos.find(function (item) {
          return Number(item.id_grupo) === Number(grupoId);
        });
        if (!grupo) return;

        // @ts-ignore
        let actionEl = e.target.closest('[data-action]');
        let action = actionEl ? actionEl.getAttribute('data-action') : 'select';

        if (action === 'toggle') {
          toggleNodeCollapsed(grupoId);
          renderGruposTree();
          return;
        }

        if (action === 'edit') {
          openEditGrupoModal(grupo);
          return;
        }

        if (action === 'add-child') {
          openNewChildGrupoModal(grupo);
          return;
        }

        if (action === 'delete') {
          // @ts-ignore
          confirmDeleteGrupo(grupo.id_grupo, grupo.nombre);
          return;
        }

        selectGrupo(grupo.id_grupo, grupo.nombre);
      });

    document
      .getElementById('jerarquiagruposTree')
      ?.addEventListener('dragstart', function (e) {
        // @ts-ignore
        let row = e.target.closest('.jer-tree-row');
        // @ts-ignore
        let nodeEl = e.target.closest('.jer-tree-node');
        if (!row || !nodeEl) return;
        let groupId = Number(nodeEl.getAttribute('data-grupo-id'));
        if (!groupId) return;

        state.draggingGrupoId = groupId;
        state.dragOverGrupoId = null;
        row.classList.add('is-dragging');

        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(groupId));
        }
      });

    document
      .getElementById('jerarquiagruposTree')
      ?.addEventListener('dragover', function (e) {
        if (state.draggingGrupoId == null) return;
        // @ts-ignore
        let nodeEl = e.target.closest('.jer-tree-node');
        if (!nodeEl) return;
        let targetId = Number(nodeEl.getAttribute('data-grupo-id'));
        if (!targetId || Number(targetId) === Number(state.draggingGrupoId)) {
          // Si se vuelve al propio nodo origen, limpiar resaltado previo.
          if (state.dragOverGrupoId != null) {
            state.dragOverGrupoId = null;
            renderGruposTree();
          }
          return;
        }

        e.preventDefault();
        if (state.dragOverGrupoId !== targetId) {
          state.dragOverGrupoId = targetId;
          renderGruposTree();
        }
      });

    document
      .getElementById('jerarquiagruposTree')
      ?.addEventListener('dragleave', function (e) {
        let related = e.relatedTarget;
        let tree = document.getElementById('jerarquiagruposTree');
        // @ts-ignore
        if (!tree || (related && tree.contains(related))) return;
        if (state.dragOverGrupoId != null) {
          state.dragOverGrupoId = null;
          renderGruposTree();
        }
      });

    document
      .getElementById('jerarquiagruposTree')
      ?.addEventListener('drop', function (e) {
        if (state.draggingGrupoId == null) return;
        e.preventDefault();
        let sourceId = Number(
          (e.dataTransfer && e.dataTransfer.getData('text/plain')) ||
            state.draggingGrupoId
        );
        // @ts-ignore
        let nodeEl = e.target.closest('.jer-tree-node');
        let targetId = nodeEl
          ? Number(nodeEl.getAttribute('data-grupo-id'))
          : null;
        clearTreeDragState();
        if (!sourceId || !targetId) return;
        if (Number(sourceId) === Number(targetId)) {
          let sourceGrupo = getGrupoById(sourceId);
          let sourceNivel = getGrupoNivelValue(sourceGrupo);
          clearGrupoSelectionForLevel(sourceNivel || 1);
          return;
        }
        handleTreeDrop(sourceId, targetId);
      });

    document
      .getElementById('jerarquiagruposTree')
      ?.addEventListener('dragend', function () {
        clearTreeDragState();
      });

    document
      .getElementById('jerarquiagruposTree')
      ?.addEventListener('keydown', handleTreeKeyboardNavigation);
  }

  // ─── Public initializer ──────────────────────────────────────────────────

  app.initializeJerarquiaGrupos = async function initializeJerarquiaGrupos() {
    try {
      loadCollapsedState();
      await loadMeta();
      await loadGrupos();
      setupEvents();
      let childBtn = document.getElementById('btnNuevoHijoGrupoJer');
      // @ts-ignore
      if (childBtn) childBtn.disabled = true;
    } catch (e) {
      showAlert(
        'alertContainerGrupoJer',
        e.message || 'Error al inicializar la sección',
        'danger'
      );
    }
  };
})();
