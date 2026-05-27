// @ts-nocheck
(function () {
  let app = window.GRS1Dashboard;
  if (!app) return;

  app.devengosState = app.devengosState || {
    reglas: [],
    actividades: [],
    grupos: [],
    agentes: [],
    empleos: [],
    borradores: [],
    editingId: null,
    lastPreview: null,
    lastPreviewBatch: null,
    savedPreview: null,
    ledgerNestedCache: {},
    gruposJerarquiaFlat: [],
    reglasSortKey: 'id',
    reglasSortDir: 'asc',
  };

  app.devengosState.reglasSortKey = app.devengosState.reglasSortKey || 'id';
  app.devengosState.reglasSortDir =
    app.devengosState.reglasSortDir === 'desc' ? 'desc' : 'asc';

  // nota: ledger movimientos gestionados en dashboard-ledger.js
  function DateTime() {
    return window.luxon && window.luxon.DateTime ? window.luxon.DateTime : null;
  }

  function nowIsoDate() {
    let dt = DateTime();
    if (!dt) return '';
    return dt.now().setZone('Europe/Madrid').toISODate();
  }

  function nowIsoDateTime() {
    let dt = DateTime();
    if (!dt) return '';
    return dt.now().setZone('Europe/Madrid').toFormat('dd/LL/yyyy HH:mm:ss');
  }

  function asText(value) {
    return app.escapeHtml(value == null ? '' : String(value));
  }

  let PREVIEW_ALL_AGENTS_VALUE = '__ALL_AGENTS__';

  function normalizeTipoMovimiento(value) {
    let tipo = String(value || '').trim().toLowerCase();
    if (tipo === 'devengo' || tipo === 'disfrute' || tipo === 'descanso') {
      return tipo;
    }
    return 'devengo';
  }

  function getHeaders(json) {
    if (typeof app.getHeaders === 'function') return app.getHeaders(!!json);
    let headers = { Authorization: 'Bearer ' + app.globalState.token };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async function parseApiError(response, fallback) {
    let message = fallback || 'Error inesperado';
    try {
      let payload = await response.json();
      if (payload && payload.message) message = payload.message;
      if (payload && payload.error) message = payload.error;
      if (payload && Array.isArray(payload.details) && payload.details.length) {
        let first = payload.details[0] || {};
        if (first.message) message = first.message;
      }
      if (payload && payload.details && typeof payload.details === 'string') {
        message = payload.details;
      }
    } catch (_e) {
      // noop
    }
    return message;
  }

  function can(key) {
    return typeof app.hasPermission === 'function'
      ? app.hasPermission(key)
      : true;
  }

  function setStatus(elId, message, tone) {
    let el = document.getElementById(elId);
    if (!el) return;
    if (!message) {
      el.className = 'd-none small mt-2';
      el.textContent = '';
      return;
    }

    let cls = 'small mt-2 text-muted';
    if (tone === 'error') cls = 'small mt-2 text-danger';
    if (tone === 'success') cls = 'small mt-2 text-success';
    if (tone === 'warning') cls = 'small mt-2 text-warning-emphasis';

    el.className = cls;
    el.textContent = message;
    el.classList.remove('d-none');
  }

  function fmtNum(value) {
    let n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('es-ES', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  function hidePreviewCalcCard() {
    let card = document.getElementById('devPreviewCalcCard');
    if (!card) return;
    card.classList.add('d-none');
  }

  function hidePreviewRachasCard() {
    let card = document.getElementById('devPreviewRachasCard');
    if (!card) return;
    card.classList.add('d-none');
  }

  function renderPreviewRachasCard(preview, payload) {
    let card = document.getElementById('devPreviewRachasCard');
    let title = document.getElementById('devPreviewRachasTitle');
    let subtitle = document.getElementById('devPreviewRachasSubtitle');
    let summary = document.getElementById('devPreviewRachasSummary');
    let body = document.getElementById('devPreviewRachasBody');
    let help = document.getElementById('devPreviewRachasHelp');
    if (!card || !title || !subtitle || !summary || !body || !help) return;

    let detalle =
      preview && preview.detalle_consecutivos
        ? preview.detalle_consecutivos
        : null;
    let esConsecutivos =
      String(preview && preview.regla && preview.regla.condicion_tipo || '') ===
      'consecutivos';
    let tipoDia = String(
      preview && preview.regla && preview.regla.tipo_dia
        ? preview.regla.tipo_dia
        : 'periodo'
    );
    let tipoDiaTexto =
      tipoDia === 'festivo'
        ? 'solo festivos de calendario'
        : tipoDia === 'fin_semana'
          ? 'solo sábados y domingos'
          : tipoDia === 'laborable'
            ? 'solo laborables (lunes a viernes, sin festivos)'
            : preview && preview.regla && preview.regla.excluir_festivos
              ? 'días del período sin festivos'
              : 'días del período incluyendo festivos';

    let factor = Number(
      preview && preview.factor_regla != null
        ? preview.factor_regla
        : preview && preview.regla && preview.regla.valor != null
          ? preview.regla.valor
          : 0
    );
    let reglaLabel = String(
      payload && payload.regla_override && payload.regla_override._regla_id
        ? payload.regla_override._regla_id
        : preview && preview.regla && preview.regla.id
          ? preview.regla.id
          : 'simulada'
    );

    title.textContent = 'Desglose del cálculo';
    subtitle.textContent =
      'Regla #' +
      reglaLabel +
      ' · ' +
      String(preview && preview.regla && preview.regla.tipo_movimiento || '-');

    let festivosTxt =
      tipoDia === 'festivo'
        ? 'por cruce con festivos'
        : preview && preview.regla && preview.regla.excluir_festivos
          ? 'sin incluir festivos'
          : 'incluyendo festivos';
    let tipoModuloTxt = esConsecutivos
      ? 'consecutivos trabajados'
      : 'no consecutivos';
    let tipoMovimientoTxt =
      preview && preview.regla && preview.regla.tipo_movimiento
        ? String(preview.regla.tipo_movimiento)
        : 'devengo';

    summary.innerHTML =
      'Para un período computable de <strong>' +
      asText(fmtNum(preview && preview.base_calculo)) +
      '</strong> ' +
      asText(tipoDia === 'festivo' ? 'cruces festivos' : 'días de trabajo') +
      ', <strong>' +
      asText(festivosTxt) +
      '</strong>, en grupos de <strong>' +
      asText(String(preview && preview.regla && preview.regla.condicion_dias || '-')) +
      '</strong> días <strong>' +
      asText(tipoModuloTxt) +
      '</strong>, corresponden <strong>' +
      asText(fmtNum(preview && preview.modulos)) +
      '</strong> módulos que × <strong>' +
      asText(fmtNum(factor)) +
      '</strong> días por módulo son <strong>' +
      asText(fmtNum(preview && preview.cantidad)) +
      '</strong> días ' +
      asText(tipoMovimientoTxt) +
      ' (impacto: <strong>' +
      asText(fmtNum(preview && preview.impacto)) +
      '</strong> días).';

    help.textContent =
      'Rango: ' +
      String(preview && preview.fecha || '-') +
      ' a ' +
      String(preview && (preview.fecha_hasta || preview.fecha) || '-') +
      ' · Origen: ' +
      String(preview && preview.base_origen || '-') +
      ' · Criterio de cómputo: ' +
      tipoDiaTexto +
      ' · Días computables: ' +
      String(fmtNum(preview && preview.base_calculo)) +
      ' · Tipo módulo: ' +
      (esConsecutivos ? 'rachas consecutivas' : 'períodos') +
      ' de ' +
      String(preview && preview.regla && preview.regla.condicion_dias || '-') +
      ' días · Cruces festivos: ' +
      String(fmtNum(preview && preview.cruces_festivos || 0)) +
      ' · Saldo: ' +
      String(fmtNum(preview && preview.saldo_anterior)) +
      ' → ' +
      String(fmtNum(preview && preview.saldo_proyectado));

    if (!esConsecutivos || !detalle || !Array.isArray(detalle.rachas)) {
      body.innerHTML =
        '<tr><td colspan="3" class="text-muted small">No aplica secuencia por rachas para este tipo de módulo.</td></tr>';
    } else {
      let rows = detalle.rachas;
      body.innerHTML = rows
        .map(function (r) {
          return (
            '<tr>' +
            '<td class="small">' +
            asText(String(r.inicio || '-')) +
            ' a ' +
            asText(String(r.fin || '-')) +
            '</td>' +
            '<td class="text-end small">' +
            asText(fmtNum(r.dias)) +
            '</td>' +
            '<td class="text-end small">' +
            asText(fmtNum(r.modulos)) +
            '</td>' +
            '</tr>'
          );
        })
        .join('');

      help.textContent +=
        ' · Tramos: ' +
        String(rows.length) +
        ' · Módulos por rachas: ' +
        String(fmtNum(detalle.modulos_totales || 0)) +
        '.';
    }

    card.classList.remove('d-none');
  }

  function getFormData() {
    let scopeType =
      document.getElementById('devCondicionAlcance').value ||
      'cualquier_actividad';
    let actividadRaw = document.getElementById('devActividadId').value;
    let grupoRaw = document.getElementById('devGrupoId').value;
    let empleoRaw = document.getElementById('devEmpleoId').value;
    let tipoMovimiento = normalizeTipoMovimiento(
      document.getElementById('devTipoMovimiento').value
    );
    let valorRaw = Number(document.getElementById('devValor').value);
    let condicionDiasRaw = Number(
      document.getElementById('devCondicionDias').value || 0
    );
    let empleoId = empleoRaw ? String(empleoRaw).trim() : '';
    let tipoDia =
      (document.getElementById('devCruceFestivo') &&
        document.getElementById('devCruceFestivo').value) ||
      'periodo';
    let festivosModeEl = document.getElementById('devExcluirFestivos');
    let festivosMode = festivosModeEl ? String(festivosModeEl.value || 'false') : 'false';
    let categoriaReglaEl = document.getElementById('devCategoriaRegla');
    return {
      actividad_id:
        scopeType === 'actividad' && actividadRaw ? Number(actividadRaw) : null,
      grupo_id: scopeType === 'grupo' && grupoRaw ? Number(grupoRaw) : null,
      empleo_id: empleoId || null,
      tipo_movimiento: tipoMovimiento,
      unidad: 'dias',
      // Backend espera valor positivo; el signo lo determina tipo_movimiento.
      valor: Math.abs(Number.isFinite(valorRaw) ? valorRaw : 0),
      tipo_dia: tipoDia,
      condicion_dias:
        Number.isFinite(condicionDiasRaw) && condicionDiasRaw >= 0
          ? Math.round(condicionDiasRaw * 10) / 10
          : 0,
      condicion_tipo:
        document.getElementById('devCondicionTipo').value || 'en_periodo',
      condicion_alcance: scopeType,
      excluir_festivos: festivosMode === 'false',
      vigencia_desde: document.getElementById('devVigenciaDesde').value,
      vigencia_hasta: document.getElementById('devVigenciaHasta').value || null,
      prioridad: Number(document.getElementById('devPrioridad').value || 100),
      activo: !!document.getElementById('devActivo').checked,
      categoria_regla: categoriaReglaEl
        ? String(categoriaReglaEl.value || '').trim() || null
        : null,
      descripcion:
        (document.getElementById('devDescripcion').value || '').trim() || null,
    };
  }

  function syncCondicionAlcanceControls() {
    let scopeType =
      document.getElementById('devCondicionAlcance').value ||
      'cualquier_actividad';
    let actividadWrap = document.getElementById('devActividadWrap');
    let grupoWrap = document.getElementById('devGrupoWrap');
    let actividadSel = document.getElementById('devActividadId');
    let grupoSel = document.getElementById('devGrupoId');

    if (scopeType === 'cualquier_actividad') {
      if (actividadWrap) actividadWrap.classList.add('d-none');
      if (grupoWrap) grupoWrap.classList.add('d-none');
      if (actividadSel) actividadSel.required = false;
      if (grupoSel) grupoSel.required = false;
      return;
    }

    if (scopeType === 'grupo') {
      if (actividadWrap) actividadWrap.classList.add('d-none');
      if (grupoWrap) grupoWrap.classList.remove('d-none');
      if (actividadSel) actividadSel.required = false;
      if (grupoSel) grupoSel.required = true;
      return;
    }

    if (actividadWrap) actividadWrap.classList.remove('d-none');
    if (grupoWrap) grupoWrap.classList.add('d-none');
    if (actividadSel) actividadSel.required = true;
    if (grupoSel) grupoSel.required = false;
  }

  function syncTipoMovimientoControls() {
    let tipoSel = document.getElementById('devTipoMovimiento');
    let valorInput = document.getElementById('devValor');
    if (!tipoSel || !valorInput) return;

    let tipo = String(tipoSel.value || 'devengo');
    let valorActual = Number(valorInput.value);
    let valor =
      Number.isFinite(valorActual) && valorActual !== 0 ? valorActual : 0;

    if (tipo === 'disfrute') {
      valorInput.min = '-366';
      valorInput.max = '-0';
      valorInput.value = String(-Math.abs(valor));
      return;
    }

    valorInput.min = '0';
    valorInput.max = '366';
    valorInput.value = String(Math.abs(valor));
  }

  function syncCruceFestivoDefaultByTipo() {
    // Sincronizador legacy: el nuevo formulario usa devExcluirFestivos.
  }

  function buildGruposFromActividades(actividades) {
    let map = new Map();
    (actividades || []).forEach(function (a) {
      if (!a || a.grupo_id == null) return;
      let id = Number(a.grupo_id);
      if (!Number.isFinite(id) || id <= 0) return;
      if (!map.has(id)) {
        map.set(id, {
          id_grupo: id,
          nombre: a.grupo_nombre || 'Grupo #' + id,
          nivel_grupo_orden:
            a.nivel_grupo_orden == null ? 9999 : Number(a.nivel_grupo_orden),
        });
      }
    });
    return Array.from(map.values()).sort(function (a, b) {
      if (a.nivel_grupo_orden !== b.nivel_grupo_orden) {
        return a.nivel_grupo_orden - b.nivel_grupo_orden;
      }
      return String(a.nombre || '').localeCompare(String(b.nombre || ''));
    });
  }

  function flattenGruposTree(nodes, depth, parentName, out) {
    (nodes || []).forEach(function (node) {
      if (!node || node.id_grupo == null) return;
      let id = Number(node.id_grupo);
      if (!Number.isFinite(id) || id <= 0) return;

      let children = Array.isArray(node._children) ? node._children : [];
      out.push({
        id_grupo: id,
        nombre: String(node.nombre || 'Grupo #' + id),
        depth: Number(depth || 0),
        parent_nombre: parentName ? String(parentName) : '',
        has_children: children.length > 0,
      });

      if (children.length) {
        flattenGruposTree(children, Number(depth || 0) + 1, node.nombre, out);
      }
    });
    return out;
  }

  function buildGrupoOptionLabel(grupo) {
    let depth = Number(grupo.depth || 0);
    let indent = depth > 0 ? Array(depth + 1).join('  ') : '';
    let tipo = depth === 0 ? '[PADRE]' : '[HIJO]';
    let parentHint =
      depth > 0 && grupo.parent_nombre
        ? ' (de ' + String(grupo.parent_nombre) + ')'
        : '';
    return (
      indent + tipo + ' ' + String(grupo.nombre || 'Grupo #' + grupo.id_grupo) + parentHint
    );
  }

  async function loadJerarquiaGruposForSelect() {
    let res = await fetch('/api/jerarquiagrupos/grupos', {
      headers: getHeaders(false),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(
        await parseApiError(res, 'No se pudo cargar jerarquia de grupos')
      );
    }

    let json = await res.json();
    let tree = Array.isArray(json.grupos) ? json.grupos : [];
    app.devengosState.gruposJerarquiaFlat = flattenGruposTree(tree, 0, '', []);
  }

  function getGruposForSelect() {
    let jerarquia = Array.isArray(app.devengosState.gruposJerarquiaFlat)
      ? app.devengosState.gruposJerarquiaFlat
      : [];
    if (jerarquia.length) return jerarquia;
    return app.devengosState.grupos || [];
  }

  function clearReglaForm() {
    app.devengosState.editingId = null;
    document.getElementById('devReglaId').value = '';
    document.getElementById('devReglaFormTitle').textContent = 'Nueva regla';
    document.getElementById('devCondicionDias').value = '1';
    document.getElementById('devCondicionTipo').value = 'en_periodo';
    document.getElementById('devCondicionAlcance').value =
      'cualquier_actividad';
    document.getElementById('devTipoMovimiento').value = 'devengo';
    document.getElementById('devValor').value = '1';
    document.getElementById('devVigenciaDesde').value = nowIsoDate();
    document.getElementById('devVigenciaHasta').value = '';
    document.getElementById('devPrioridad').value = '100';
    document.getElementById('devActivo').checked = true;
    if (document.getElementById('devCategoriaRegla')) {
      document.getElementById('devCategoriaRegla').value = '';
    }
    if (document.getElementById('devExcluirFestivos')) {
      document.getElementById('devExcluirFestivos').value = 'false';
    }
    if (document.getElementById('devCruceFestivo')) {
      document.getElementById('devCruceFestivo').value = 'periodo';
    }
    document.getElementById('devDescripcion').value = '';
    if (document.getElementById('devActividadId').options.length > 0) {
      document.getElementById('devActividadId').selectedIndex = 0;
    }
    if (document.getElementById('devGrupoId').options.length > 0) {
      document.getElementById('devGrupoId').selectedIndex = 0;
    }
    document.getElementById('devEmpleoId').value = '';
    syncCondicionAlcanceControls();
    syncTipoMovimientoControls();
  }

  function fillReglaForm(regla) {
    app.devengosState.editingId = Number(regla.id);
    document.getElementById('devReglaId').value = String(regla.id);
    document.getElementById('devReglaFormTitle').textContent =
      'Editar regla #' + regla.id;
    let scopeType =
      (regla && regla.condicion_alcance) ||
      (regla && regla.grupo_id != null
        ? 'grupo'
        : regla && regla.actividad_id != null
          ? 'actividad'
          : 'cualquier_actividad');
    document.getElementById('devCondicionAlcance').value = scopeType;
    document.getElementById('devCondicionDias').value = String(
      regla.condicion_dias == null ? 1 : regla.condicion_dias
    );
    document.getElementById('devCondicionTipo').value = String(
      regla.condicion_tipo || 'en_periodo'
    );
    document.getElementById('devActividadId').value = String(
      regla.actividad_id || ''
    );
    document.getElementById('devGrupoId').value = String(regla.grupo_id || '');
    document.getElementById('devEmpleoId').value =
      regla.empleo_id == null ? '' : String(regla.empleo_id);
    document.getElementById('devTipoMovimiento').value = String(
      regla.tipo_movimiento || 'devengo'
    );
    console.debug('Valor base para formulario:', regla.valor);
    let valorBase = Number(regla.valor == null ? 0 : regla.valor);
    let tipoMovimiento = String(regla.tipo_movimiento || 'devengo');
    let valorConSigno =
      tipoMovimiento === 'disfrute'
        ? -Math.abs(valorBase)
        : Math.abs(valorBase);
    document.getElementById('devValor').value = String(valorConSigno);
    document.getElementById('devVigenciaDesde').value = String(
      regla.vigencia_desde || nowIsoDate()
    );
    document.getElementById('devVigenciaHasta').value = String(
      regla.vigencia_hasta || ''
    );
    document.getElementById('devPrioridad').value = String(
      regla.prioridad == null ? 100 : regla.prioridad
    );
    document.getElementById('devActivo').checked = !!regla.activo;
    if (document.getElementById('devCategoriaRegla')) {
      document.getElementById('devCategoriaRegla').value = String(
        regla.categoria_regla || ''
      );
    }
    if (document.getElementById('devExcluirFestivos')) {
      document.getElementById('devExcluirFestivos').value =
        regla.excluir_festivos ? 'false' : 'true';
    }
    let cruceSel = document.getElementById('devCruceFestivo');
    if (cruceSel) {
      cruceSel.value = regla.tipo_dia || 'periodo';
    }
    document.getElementById('devDescripcion').value = String(
      regla.descripcion || ''
    );
    syncCondicionAlcanceControls();
    syncTipoMovimientoControls();
  }

  function buildReglaRow(regla) {
    let isActive = !!regla.activo;
    let condicionDias = Number(regla.condicion_dias || 1);
    let condicionTipo = String(regla.condicion_tipo || 'en_periodo');
    let condicionTipoLabel =
      condicionTipo === 'consecutivos' ? 'consecutiva' : 'no consecutiva';
    let tipoDia = String(regla.tipo_dia || 'periodo');
    let tipoDiaLabel =
      tipoDia === 'festivo'
        ? 'festivos'
        : tipoDia === 'fin_semana'
          ? 'fin de semana'
          : tipoDia === 'laborable'
            ? 'laborables'
            : 'en período';
    let alcance = String(regla.condicion_alcance || 'cualquier_actividad');
    let alcanceLabel = 'cualquier actividad';
    if (alcance === 'actividad') {
      alcanceLabel =
        (regla.actividad_codigo ? String(regla.actividad_codigo) + ' - ' : '') +
        String(regla.actividad_nombre || 'Actividad #' + regla.actividad_id);
    } else if (alcance === 'grupo') {
      alcanceLabel = String(regla.grupo_nombre || 'Grupo #' + regla.grupo_id);
    }
    let descripcionRegla = String(regla.descripcion || '').trim();
    let detalleCondicion =
      asText(condicionDias) +
      ' días de manera ' +
      asText(condicionTipoLabel) +
      ' · en ' +
      asText(alcanceLabel) +
      ' · ' +
      asText(tipoDiaLabel) +
      (tipoDia === 'festivo' ? ' · cruza festivos' : '') +
      (tipoDia === 'periodo'
        ? regla.excluir_festivos
          ? ' · sin festivos'
          : ' · incluye festivos'
        : '') +
      (regla.empleo_nombre
        ? ' · ' + asText(regla.empleo_nombre)
        : ' · todos los empleos');
    let condicionHtml =
      '<div class="fw-semibold text-truncate">' +
      asText(
        descripcionRegla ||
          (asText(condicionDias) + ' días de manera ' + asText(condicionTipoLabel))
      ) +
      '</div>' +
      '<div class="small text-muted text-truncate">' +
      detalleCondicion +
      '</div>';

    let vigencia =
      '<div class="small text-nowrap">' +
      asText(regla.vigencia_desde || '-') +
      ' - ' +
      asText(regla.vigencia_hasta || '∞') +
      '</div>';
    let categoriaLabel = regla.categoria_regla
      ? '<span class="text-info-emphasis text-truncate d-inline-block align-middle" style="max-width: 12rem" title="' +
        asText(String(regla.categoria_regla)) +
        '">' +
        asText(String(regla.categoria_regla)) +
        '</span>'
      : '<span class="text-muted">Normal</span>';
    let badge = isActive
      ? '<span class="badge text-bg-success">Activa</span>'
      : '<span class="badge text-bg-secondary">Inactiva</span>';
    let acciones = '';
    if (can('asignaciones-reglas:editar')) {
      acciones +=
        '<button class="btn btn-sm btn-outline-primary py-0 px-1" type="button" data-action="edit" data-id="' +
        Number(regla.id) +
        '" title="Editar"><i class="bi bi-pencil-square"></i></button> ';
    }
    if (can('asignaciones-reglas:eliminar') && isActive) {
      acciones +=
        '<button class="btn btn-sm btn-outline-danger py-0 px-1" type="button" data-action="delete" data-id="' +
        Number(regla.id) +
        '" title="Desactivar"><i class="bi bi-slash-circle"></i></button>';
    }

    let tipoMovimiento = String(regla.tipo_movimiento || 'devengo');
    let valorRule = Number(regla.valor || 0);
    let valorConSigno =
      tipoMovimiento === 'disfrute' ? -Math.abs(valorRule) : Math.abs(valorRule);
    let tipoBadgeClass =
      tipoMovimiento === 'devengo'
        ? 'text-bg-success'
        : tipoMovimiento === 'disfrute'
          ? 'text-bg-danger'
          : 'text-bg-secondary';
    let tipoBadgeLabel =
      tipoMovimiento === 'devengo'
        ? 'Devengo'
        : tipoMovimiento === 'disfrute'
          ? 'Disfrute'
          : 'Descanso';
    let generaHtml =
      '<span class="fw-semibold">' +
      asText(valorConSigno) +
      '</span> d · <span class="badge ' +
      asText(tipoBadgeClass) +
      '">' +
      asText(tipoBadgeLabel) +
      '</span>';

    return (
      '<tr data-regla-id="' +
      Number(regla.id) +
      '" class="' +
      (Number(app.devengosState.editingId) === Number(regla.id)
        ? 'dev-regla-selected'
        : '') +
      '">' +
      '<td class="text-muted small text-center">' +
      asText(regla.id) +
      '</td>' +
      '<td>' +
      condicionHtml +
      '</td>' +
      '<td>' +
      generaHtml +
      '</td>' +
      '<td>' +
      vigencia +
      '<div class="small mt-1 d-flex align-items-center gap-2 flex-nowrap">' +
      categoriaLabel +
      badge +
      '</div>' +
      '</td>' +
      '<td class="text-end dev-acciones">' +
      (acciones || '<span class="text-muted small">Sin acciones</span>') +
      '</td>' +
      '</tr>'
    );
  }

  function getReglaSortValue(regla, key) {
    if (key === 'id') return Number(regla && regla.id ? regla.id : 0);

    if (key === 'genera') {
      let tipoMovimiento = String(regla && regla.tipo_movimiento || 'devengo');
      let valorRule = Number(regla && regla.valor ? regla.valor : 0);
      return tipoMovimiento === 'disfrute'
        ? -Math.abs(valorRule)
        : Math.abs(valorRule);
    }

    if (key === 'vigencia') {
      return [
        String(regla && regla.vigencia_desde || ''),
        String(regla && regla.vigencia_hasta || ''),
        Number(regla && regla.activo ? 1 : 0),
      ].join('|');
    }

    let descripcion = String(regla && regla.descripcion || '').trim();
    if (descripcion) return descripcion;
    return [
      String(regla && regla.condicion_dias || ''),
      String(regla && regla.condicion_tipo || ''),
      String(regla && regla.condicion_alcance || ''),
      String(regla && regla.actividad_nombre || ''),
      String(regla && regla.grupo_nombre || ''),
      String(regla && regla.empleo_nombre || ''),
    ].join(' ');
  }

  function compareReglas(a, b, key, dir) {
    let left = getReglaSortValue(a, key);
    let right = getReglaSortValue(b, key);
    let result = 0;

    if (typeof left === 'number' && typeof right === 'number') {
      result = left - right;
    } else {
      result = String(left || '').localeCompare(String(right || ''), 'es', {
        sensitivity: 'base',
        numeric: true,
      });
    }

    if (result === 0) {
      result = Number(a && a.id ? a.id : 0) - Number(b && b.id ? b.id : 0);
    }

    return dir === 'desc' ? -result : result;
  }

  function renderReglasSortHeaders() {
    let table = document.getElementById('devReglasTable');
    if (!table) return;

    let headers = table.querySelectorAll('thead th[data-sort-key]');
    headers.forEach(function (th) {
      let key = th.getAttribute('data-sort-key');
      let icon = th.querySelector('[data-sort-icon]');
      let isActive = key === app.devengosState.reglasSortKey;
      let dir = app.devengosState.reglasSortDir === 'desc' ? 'desc' : 'asc';

      th.setAttribute(
        'aria-sort',
        isActive ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'
      );

      if (!icon) return;
      icon.className =
        'bi ' +
        (isActive
          ? dir === 'desc'
            ? 'bi-sort-down-alt ms-1'
            : 'bi-sort-up ms-1'
          : 'bi-arrow-down-up ms-1');
    });
  }

  function toggleReglasSort(key) {
    let currentKey = app.devengosState.reglasSortKey || 'id';
    let currentDir = app.devengosState.reglasSortDir === 'desc' ? 'desc' : 'asc';

    if (currentKey === key) {
      app.devengosState.reglasSortDir = currentDir === 'asc' ? 'desc' : 'asc';
    } else {
      app.devengosState.reglasSortKey = key;
      app.devengosState.reglasSortDir = key === 'id' ? 'asc' : 'desc';
    }

    renderReglas();
  }

  function renderReglas() {
    let body = document.getElementById('devReglasTableBody');
    if (!body) return;

    let rows = app.devengosState.reglas || [];
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-4">No hay reglas registradas.</td></tr>';
      return;
    }

    let sortKey = app.devengosState.reglasSortKey || 'id';
    let sortDir = app.devengosState.reglasSortDir === 'desc' ? 'desc' : 'asc';
    let sortedRows = rows.slice().sort(function (a, b) {
      return compareReglas(a, b, sortKey, sortDir);
    });

    body.innerHTML = sortedRows
      .map(function (r) {
        return buildReglaRow(r);
      })
      .join('');

    renderReglasSortHeaders();
  }

  function buildAgentName(ag) {
    let nombre = ag && (ag.nombre || ag.agente_nombre);
    let apellido1 = ag && (ag.apellido_1 || ag.agente_apellido1);
    let apellido2 = ag && (ag.apellido_2 || ag.agente_apellido2);
    return (
      [apellido1, apellido2, nombre].filter(Boolean).join(' ').trim() ||
      'Agente #' + (ag && ag.id_agente ? ag.id_agente : '?')
    );
  }

  function buildPreviewAgenteLabel(ag) {
    let tip = ag && (ag.tip || ag.agente_tip);
    let nombreCompleto = buildAgentName(ag);
    return tip ? String(tip) + ' + ' + nombreCompleto : nombreCompleto;
  }

  function normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function normalizeActividadCode(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[[\]\s._-]/g, '')
      .trim();
  }

  function isManualActividad(a) {
    let codeRaw = String(a && (a.actividad || a.actividad_codigo || '')).trim();
    let code = normalizeActividadCode(codeRaw);
    let name = normalizeSearchText(a && (a.nombre || a.actividad_nombre));
    return codeRaw === '-1' || code === '1' || name.indexOf('manual') !== -1;
  }

  function isDiaLibreActividad(a) {
    let code = normalizeActividadCode(a && (a.actividad || a.actividad_codigo));
    let name = normalizeSearchText(a && (a.nombre || a.actividad_nombre));
    return code === 'DL' || name === 'dia libre';
  }

  function buildActividadLabel(a) {
    let code = a.actividad || a.actividad_codigo || '';
    let name = a.nombre || a.actividad_nombre || code;
    return (code ? code + ' - ' : '') + name;
  }

  function renderPreviewActividadesSelect(searchText) {
    let select = document.getElementById('devPreviewActividadId');
    if (!select) return;

    let normalizedSearch = normalizeSearchText(searchText);
    let selectedBefore = String(select.value || '');
    let actividades = app.devengosState.actividades || [];

    let manual = actividades.find(function (a) {
      return isManualActividad(a);
    });
    let diaLibre = actividades.find(function (a) {
      return isDiaLibreActividad(a);
    });

    let ordered = actividades.slice();
    if (manual) {
      ordered = [manual].concat(
        ordered.filter(function (a) {
          return Number(a.id_actividad) !== Number(manual.id_actividad);
        })
      );
    }
    if (diaLibre && (!manual || Number(diaLibre.id_actividad) !== Number(manual.id_actividad))) {
      ordered = [diaLibre].concat(
        ordered.filter(function (a) {
          return Number(a.id_actividad) !== Number(diaLibre.id_actividad);
        })
      );
      if (manual) {
        ordered = [manual].concat(
          ordered.filter(function (a) {
            return Number(a.id_actividad) !== Number(manual.id_actividad);
          })
        );
      }
    }

    let filtered = ordered.filter(function (a) {
      if (!normalizedSearch) return true;
      let label = buildActividadLabel(a);
      let haystack = normalizeSearchText(label + ' ' + (a.id_actividad || ''));
      return haystack.indexOf(normalizedSearch) !== -1;
    });

    fillSelect(
      'devPreviewActividadId',
      filtered,
      function (a) {
        return {
          value: a.id_actividad,
          label: buildActividadLabel(a),
        };
      },
      null
    );

    if (selectedBefore) {
      let restored = filtered.some(function (a) {
        return String(a.id_actividad) === selectedBefore;
      });
      if (restored) select.value = selectedBefore;
    }

    if (!select.value && select.options.length > 0) {
      select.selectedIndex = 0;
    }
  }

  function renderPreviewAgentesSelect(searchText) {
    let select = document.getElementById('devPreviewAgenteId');
    if (!select) return;

    let normalizedSearch = normalizeSearchText(searchText);
    let selectedBefore = String(select.value || '');

    let filtered = (app.devengosState.agentes || []).filter(function (ag) {
      if (!normalizedSearch) return true;
      let label = buildPreviewAgenteLabel(ag);
      let idAgente = String(ag.id_agente || '');
      let haystack = normalizeSearchText(label + ' ' + idAgente);
      return haystack.indexOf(normalizedSearch) !== -1;
    });

    fillSelect(
      'devPreviewAgenteId',
      filtered,
      function (ag) {
        return { value: ag.id_agente, label: buildPreviewAgenteLabel(ag) };
      },
      null
    );

    if (!normalizedSearch || 'todos los agentes'.indexOf(normalizedSearch) !== -1) {
      let allLabel = 'Todos los agentes';
      let allOption = document.createElement('option');
      allOption.value = PREVIEW_ALL_AGENTS_VALUE;
      allOption.textContent = allLabel;
      select.insertBefore(allOption, select.firstChild);
    }

    if (selectedBefore) {
      let restored =
        selectedBefore === PREVIEW_ALL_AGENTS_VALUE ||
        filtered.some(function (ag) {
          return String(ag.id_agente) === selectedBefore;
        });
      if (restored) {
        select.value = selectedBefore;
      }
    }

    if (!select.value && select.options.length > 0) {
      select.selectedIndex = 0;
    }
  }

  function fillSelect(selectId, items, mapFn, emptyLabel) {
    let select = document.getElementById(selectId);
    if (!select) return;
    let html = '';
    if (emptyLabel) {
      html += '<option value="">' + asText(emptyLabel) + '</option>';
    }
    html += (items || [])
      .map(function (item) {
        let mapped = mapFn(item);
        return (
          '<option value="' +
          asText(mapped.value) +
          '">' +
          asText(mapped.label) +
          '</option>'
        );
      })
      .join('');
    select.innerHTML = html;
  }

  function renderSavedPreviewInfo() {
    let el = document.getElementById('devPreviewSavedInfo');
    if (!el) return;

    let saved = app.devengosState.savedPreview;
    if (!saved || !saved.preview || !saved.preview.regla) {
      el.textContent = 'Sin preview grabado.';
      return;
    }

    el.textContent =
      'Grabado: ' +
      String(saved.saved_at || '-') +
      (saved.movimiento_id
        ? ' | Movimiento #' + String(saved.movimiento_id)
        : '') +
      (saved.fecha_insercion
        ? ' | Fecha insercion: ' + String(saved.fecha_insercion)
        : '') +
      ' | Regla #' +
      String(saved.preview.regla.id || '-') +
      ' | Impacto: ' +
      String(saved.preview.impacto || 0) +
      ' dias | Saldo proyectado: ' +
      String(saved.preview.saldo_proyectado || 0);
  }

  function savePreviewInState(savedPayload) {
    app.devengosState.savedPreview = savedPayload;
    renderSavedPreviewInfo();
  }

  function getPreviewPeriod() {
    let dt = DateTime();
    let raw = (document.getElementById('devPreviewFecha').value || '').trim();
    let parsed = raw && dt ? dt.fromISO(raw, { zone: 'Europe/Madrid' }) : null;
    let now = dt ? dt.now().setZone('Europe/Madrid') : null;
    return {
      anio: parsed && parsed.isValid ? parsed.year : now ? now.year : 2026,
      mes: parsed && parsed.isValid ? parsed.month : now ? now.month : 1,
    };
  }

  function buildBorradorPreviewLabel(borrador) {
    let nombre = borrador && borrador.nombre ? String(borrador.nombre) : '';
    let version =
      borrador && borrador.version != null
        ? 'v' + String(borrador.version)
        : '';
    let estado = borrador && borrador.estado ? String(borrador.estado) : '';
    return [nombre, version, estado].filter(Boolean).join(' · ');
  }

  async function loadPreviewBorradores() {
    let period = getPreviewPeriod();
    let selectedBefore = document.getElementById('devPreviewBorradorId').value;
    let url =
      '/api/asignaciones/borradores/' +
      encodeURIComponent(String(period.anio)) +
      '/' +
      encodeURIComponent(String(period.mes));
    let res = await fetch(
      url,
      {
        headers: getHeaders(false),
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      fillSelect(
        'devPreviewBorradorId',
        [],
        function () {
          return { value: '', label: '' };
        },
        'Error al cargar borradores'
      );
      throw new Error(
        await parseApiError(res, 'No se pudieron cargar los borradores')
      );
    }

    let json = await res.json();
    app.devengosState.borradores = Array.isArray(json.borradores)
      ? json.borradores
      : [];

    fillSelect(
      'devPreviewBorradorId',
      app.devengosState.borradores,
      function (item) {
        return {
          value: item.id,
          label: buildBorradorPreviewLabel(item),
        };
      },
      app.devengosState.borradores.length
        ? 'Selecciona un borrador'
        : 'Sin borradores para el período'
    );

    if (selectedBefore) {
      let select = document.getElementById('devPreviewBorradorId');
      let exists = app.devengosState.borradores.some(function (item) {
        return String(item.id) === String(selectedBefore);
      });
      if (select && exists) select.value = String(selectedBefore);
    }
  }

  async function loadMeta() {
    let res = await fetch('/api/asignaciones/meta', {
      headers: getHeaders(false),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(
        await parseApiError(res, 'No se pudieron cargar metadatos')
      );
    }
    let json = await res.json();
    app.devengosState.actividades = Array.isArray(json.actividades)
      ? json.actividades
      : [];
    app.devengosState.grupos = buildGruposFromActividades(
      app.devengosState.actividades
    );
    app.devengosState.empleos = Array.isArray(json.empleos) ? json.empleos : [];
    app.devengosState.agentes = Array.isArray(json.agentes) ? json.agentes : [];

    try {
      await loadJerarquiaGruposForSelect();
    } catch (_e) {
      // Fallback: usar grupos deducidos desde actividades.
      app.devengosState.gruposJerarquiaFlat = [];
    }

    fillSelect(
      'devActividadId',
      app.devengosState.actividades,
      function (a) {
        let code = a.actividad || a.actividad_codigo || '';
        let name = a.nombre || a.actividad_nombre || code;
        return {
          value: a.id_actividad,
          label: (code ? code + ' - ' : '') + name,
        };
      },
      null
    );

    renderPreviewActividadesSelect('');

    fillSelect(
      'devGrupoId',
      getGruposForSelect(),
      function (g) {
        return {
          value: g.id_grupo,
          label: buildGrupoOptionLabel(g),
        };
      },
      null
    );

    fillSelect(
      'devEmpleoId',
      app.devengosState.empleos,
      function (e) {
        return {
          value: e.id_empleo,
          label: e.nombre || e.descripcion || 'Empleo #' + e.id_empleo,
        };
      },
      'Todos los empleos'
    );

    fillSelect(
      'devSaldosEmpleoId',
      app.devengosState.empleos,
      function (e) {
        return {
          value: e.id_empleo,
          label: e.nombre || e.descripcion || 'Empleo #' + e.id_empleo,
        };
      },
      'Todos los empleos'
    );

    renderPreviewAgentesSelect('');

    fillSelect(
      'devSaldosAgenteId',
      app.devengosState.agentes,
      function (ag) {
        return { value: ag.id_agente, label: buildAgentName(ag) };
      },
      'Todos los agentes'
    );
  }

  async function loadReglas() {
    let res = await fetch('/api/asignaciones-reglas/reglas', {
      headers: getHeaders(false),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(await parseApiError(res, 'No se pudieron cargar reglas'));
    }
    let json = await res.json();
    app.devengosState.reglas = Array.isArray(json.reglas) ? json.reglas : [];
    renderReglas();
    fillSelect(
      'devPreviewReglaId',
      app.devengosState.reglas,
      function (r) {
        let idx = app.devengosState.reglas.indexOf(r);
        let alcance = String(r.condicion_alcance || 'cualquier_actividad');
        let alcanceLabel = 'cualquier actividad';
        if (alcance === 'actividad') {
          alcanceLabel =
            (r.actividad_codigo ? r.actividad_codigo + ' - ' : '') +
            (r.actividad_nombre || 'Actividad #' + r.actividad_id);
        } else if (alcance === 'grupo') {
          alcanceLabel = 'Grupo: ' + (r.grupo_nombre || '#' + r.grupo_id);
        }
        let condicionLabel =
          String(r.condicion_dias == null ? 1 : r.condicion_dias) +
          ' días de manera ' +
          (String(r.condicion_tipo || 'en_periodo') === 'consecutivos'
            ? 'consecutiva'
            : 'no consecutiva');
        return {
          value: r.id,
          label:
            idx +
            1 +
            '. ' +
            condicionLabel +
            ' en ' +
            alcanceLabel +
            ' → ' +
            String(r.valor) +
            'd de ' +
            String(r.tipo_movimiento),
        };
      },
      'Usar formulario de regla'
    );
  }

  async function submitReglaForm(ev) {
    ev.preventDefault();

    let payload = getFormData();
    let isEdit = !!app.devengosState.editingId;
    let endpoint = isEdit
      ? '/api/asignaciones-reglas/reglas/' +
        encodeURIComponent(String(app.devengosState.editingId))
      : '/api/asignaciones-reglas/reglas';
    let method = isEdit ? 'PUT' : 'POST';

    let res = await fetch(endpoint, {
      method: method,
      headers: getHeaders(true),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(await parseApiError(res, 'No se pudo guardar la regla'));
    }

    await loadReglas();
    clearReglaForm();
    setStatus(
      'devPreviewResult',
      isEdit
        ? 'Regla actualizada correctamente.'
        : 'Regla creada correctamente.',
      'success'
    );
  }

  function findReglaById(id) {
    let target = Number(id);
    return (
      (app.devengosState.reglas || []).find(function (r) {
        return Number(r.id) === target;
      }) || null
    );
  }

  function ensureConfirmDeactivateReglaModal() {
    let existing = document.getElementById('devConfirmDeactivateReglaModal');
    if (existing) return existing;

    let html =
      '<div class="modal fade" id="devConfirmDeactivateReglaModal" tabindex="-1" aria-labelledby="devConfirmDeactivateReglaLabel" aria-hidden="true">' +
      '<div class="modal-dialog modal-dialog-centered">' +
      '<div class="modal-content modal-notion shadow-sm">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="devConfirmDeactivateReglaLabel"><i class="bi bi-exclamation-triangle me-2"></i>Confirmar desactivación</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>' +
      '</div>' +
      '<div class="modal-body">' +
      '<p class="mb-2" id="devConfirmDeactivateReglaText">¿Desea desactivar esta regla?</p>' +
      '<p class="small text-muted mb-0">La regla quedará inactiva para nuevas ejecuciones.</p>' +
      '</div>' +
      '<div class="modal-footer d-flex justify-content-between align-items-center">' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>' +
      '<button type="button" class="btn btn-outline-danger" id="btnDevConfirmDeactivateRegla">Desactivar</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', html);
    return document.getElementById('devConfirmDeactivateReglaModal');
  }

  function confirmDeactivateRegla(regla) {
    if (!window.bootstrap || !window.bootstrap.Modal) {
      return Promise.resolve(
        window.confirm('Se desactivará la regla seleccionada. ¿Desea continuar?')
      );
    }

    let modalEl = ensureConfirmDeactivateReglaModal();
    let textEl = document.getElementById('devConfirmDeactivateReglaText');
    let btnConfirm = document.getElementById('btnDevConfirmDeactivateRegla');
    let nombre =
      regla && regla.id
        ? 'regla #' + String(regla.id)
        : 'regla seleccionada';

    if (textEl) {
      textEl.textContent = 'Se desactivará la ' + nombre + '. ¿Desea continuar?';
    }

    return new Promise(function (resolve) {
      let confirmed = false;

      function cleanup() {
        if (btnConfirm) btnConfirm.onclick = null;
      }

      if (btnConfirm) {
        btnConfirm.onclick = function () {
          confirmed = true;
          window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        };
      }

      modalEl.addEventListener(
        'hidden.bs.modal',
        function onHidden() {
          cleanup();
          resolve(confirmed);
        },
        { once: true }
      );

      window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    });
  }

  async function deactivateRegla(id) {
    let res = await fetch(
      '/api/asignaciones-reglas/reglas/' + encodeURIComponent(String(id)),
      {
        method: 'DELETE',
        headers: getHeaders(false),
      }
    );

    if (!res.ok) {
      throw new Error(
        await parseApiError(res, 'No se pudo desactivar la regla')
      );
    }

    await loadReglas();
  }

  async function onReglasTableClick(event) {
    let sortHeader = event.target.closest('th[data-sort-key]');
    if (sortHeader) {
      toggleReglasSort(String(sortHeader.getAttribute('data-sort-key') || 'id'));
      return;
    }

    let btn = event.target.closest('button[data-action]');
    if (!btn) {
      let row = event.target.closest('tr[data-regla-id]');
      if (!row) return;
      let rowId = Number(row.getAttribute('data-regla-id'));
      if (!rowId) return;
      let rowRegla = findReglaById(rowId);
      if (!rowRegla) return;
      fillReglaForm(rowRegla);
      renderReglas();
      return;
    }

    let action = btn.getAttribute('data-action');
    let id = Number(btn.getAttribute('data-id'));
    if (!id) return;

    if (action === 'edit') {
      let regla = findReglaById(id);
      if (!regla) return;
      fillReglaForm(regla);
      renderReglas();
      return;
    }

    if (action === 'delete') {
      let regla = findReglaById(id);
      let ok = await confirmDeactivateRegla(regla);
      if (!ok) return;
      await deactivateRegla(id);
      setStatus(
        'devPreviewResult',
        'Regla desactivada correctamente.',
        'success'
      );
    }
  }

  async function submitPreview(event) {
    event.preventDefault();

    let borradorRaw = document.getElementById('devPreviewBorradorId').value;
    let fecha = document.getElementById('devPreviewFecha').value || null;
    let fechaHasta =
      document.getElementById('devPreviewFechaHasta').value || null;

    if (fechaHasta && !fecha) {
      throw new Error('Debe informar Fecha cuando use Fecha hasta');
    }

    if (!fechaHasta && !borradorRaw) {
      throw new Error(
        'Debe seleccionar un borrador cuando no informe Fecha hasta'
      );
    }

    let formData = getFormData();
    let selectedReglaId =
      document.getElementById('devPreviewReglaId') &&
      document.getElementById('devPreviewReglaId').value
        ? Number(document.getElementById('devPreviewReglaId').value)
        : null;
    let reglaOverride;
    if (selectedReglaId) {
      let reglaSeleccionada = (app.devengosState.reglas || []).find(
        function (r) {
          return Number(r.id) === selectedReglaId;
        }
      );
      if (reglaSeleccionada) {
        reglaOverride = {
          tipo_movimiento: normalizeTipoMovimiento(
            reglaSeleccionada.tipo_movimiento
          ),
          valor: reglaSeleccionada.valor,
          // En preview, los selectores actuales del formulario mandan el criterio de cómputo.
          tipo_dia: formData.tipo_dia,
          condicion_dias:
            reglaSeleccionada.condicion_dias == null
              ? 1
              : reglaSeleccionada.condicion_dias,
          condicion_tipo: reglaSeleccionada.condicion_tipo || 'en_periodo',
          condicion_alcance:
            reglaSeleccionada.condicion_alcance || 'cualquier_actividad',
          excluir_festivos: formData.excluir_festivos,
          actividad_id: reglaSeleccionada.actividad_id || null,
          grupo_id: reglaSeleccionada.grupo_id || null,
          empleo_id: reglaSeleccionada.empleo_id || null,
          vigencia_desde: reglaSeleccionada.vigencia_desde || null,
          vigencia_hasta: reglaSeleccionada.vigencia_hasta || null,
          prioridad: reglaSeleccionada.prioridad || 100,
          categoria_regla: reglaSeleccionada.categoria_regla || null,
          _regla_id: reglaSeleccionada.id,
        };
      }
    }
    if (!reglaOverride) {
      reglaOverride = {
        tipo_movimiento: normalizeTipoMovimiento(formData.tipo_movimiento),
        valor: formData.valor,
        tipo_dia: formData.tipo_dia,
        condicion_dias: formData.condicion_dias,
        condicion_tipo: formData.condicion_tipo,
        condicion_alcance: formData.condicion_alcance,
        excluir_festivos: formData.excluir_festivos,
        actividad_id: formData.actividad_id,
        grupo_id: formData.grupo_id,
        empleo_id: formData.empleo_id || null,
        vigencia_desde: formData.vigencia_desde || null,
        vigencia_hasta: formData.vigencia_hasta || null,
        prioridad: formData.prioridad,
        categoria_regla: formData.categoria_regla || null,
      };
    }

    let previewActividadId = Number(
      document.getElementById('devPreviewActividadId').value
    );

    if (!Number.isInteger(previewActividadId) || previewActividadId === 0) {
      throw new Error('No hay actividades válidas en el catálogo para calcular el preview manual.');
    }

    let selectedAgenteRaw = String(
      (document.getElementById('devPreviewAgenteId') || {}).value || ''
    );

    let payloadBase = {
      actividad_id: previewActividadId,
      borrador_id: borradorRaw ? Number(borradorRaw) : null,
      fecha: fecha,
      fecha_hasta: fechaHasta,
      regla_override: reglaOverride,
    };

    if (selectedAgenteRaw === PREVIEW_ALL_AGENTS_VALUE) {
      let agentes = (app.devengosState.agentes || [])
        .map(function (ag) {
          return Number(ag && ag.id_agente);
        })
        .filter(function (id) {
          return Number.isInteger(id) && id > 0;
        });

      if (!agentes.length) {
        throw new Error('No hay agentes disponibles para calcular preview masivo.');
      }

      setStatus('devPreviewResult', 'Calculando preview (una llamada para todos los agentes)...', null);
      hidePreviewCalcCard();
      hidePreviewRachasCard();

      // Una sola llamada usando el primer agente como representativo.
      // La regla y el cálculo (módulos, cantidad) es igual para todos.
      // El backend bulk recalculará el saldo real de cada agente al grabar.
      let payloadRepresentativo = {
        agente_id: agentes[0],
        actividad_id: payloadBase.actividad_id,
        borrador_id: payloadBase.borrador_id,
        fecha: payloadBase.fecha,
        fecha_hasta: payloadBase.fecha_hasta,
        regla_override: payloadBase.regla_override,
      };

      let resPreview = await fetch('/api/asignaciones-reglas/preview', {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify(payloadRepresentativo),
      });

      if (!resPreview.ok) {
        throw new Error(await parseApiError(resPreview, 'No se pudo calcular el preview'));
      }

      let jsonPreview = await resPreview.json();
      let previewBase = jsonPreview && jsonPreview.preview ? jsonPreview.preview : null;

      // Replicar el resultado para todos los agentes
      let results = agentes.map(function (agenteId) {
        let request = {
          agente_id: agenteId,
          actividad_id: payloadBase.actividad_id,
          borrador_id: payloadBase.borrador_id,
          fecha: payloadBase.fecha,
          fecha_hasta: payloadBase.fecha_hasta,
          regla_override: payloadBase.regla_override,
        };
        if (!previewBase) {
          return { agente_id: agenteId, request, preview: null, error: 'No se obtuvo preview' };
        }
        // Clonar preview con el agente_id correcto (saldo se recalculará en backend al grabar)
        let previewAgente = Object.assign({}, previewBase, {
          agente: Object.assign({}, previewBase.agente, { id: agenteId }),
        });
        return { agente_id: agenteId, request, preview: previewAgente, error: null };
      });

      let withPreview = results.filter(function (item) {
        return !!(item && item.preview);
      });
      let applies = withPreview.filter(function (item) {
        return item.preview.aplica === true;
      });
      let errors = results.filter(function (item) {
        return !!(item && item.error);
      });

      app.devengosState.lastPreview = null;
      app.devengosState.lastPreviewBatch = {
        mode: 'all_agents',
        saved_at: nowIsoDateTime(),
        request_base: payloadBase,
        total_agentes: agentes.length,
        total_con_preview: withPreview.length,
        total_aplica: applies.length,
        total_errores: errors.length,
        items: results,
      };

      if (!applies.length) {
        setStatus(
          'devPreviewResult',
          'Preview masivo finalizado: ' +
            String(agentes.length) +
            ' agentes, 0 aplican, ' +
            String(errors.length) +
            ' con error. Resultado reservado para futuras acciones masivas.',
          'warning'
        );
        return;
      }

      let firstApplicable = applies[0];
      setStatus(
        'devPreviewResult',
        'Preview masivo: ' +
          String(agentes.length) +
          ' agentes, ' +
          String(applies.length) +
          ' aplican. Resultado reservado para futuras acciones masivas.',
        'success'
      );
      hidePreviewCalcCard();
      renderPreviewRachasCard(firstApplicable.preview, firstApplicable.request);
      return;
    }

    let payload = {
      agente_id: Number(selectedAgenteRaw),
      actividad_id: payloadBase.actividad_id,
      borrador_id: payloadBase.borrador_id,
      fecha: payloadBase.fecha,
      fecha_hasta: payloadBase.fecha_hasta,
      regla_override: payloadBase.regla_override,
    };

    let res = await fetch('/api/asignaciones-reglas/preview', {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(
        await parseApiError(res, 'No se pudo calcular el preview')
      );
    }

    let json = await res.json();
    let preview = json && json.preview ? json.preview : null;

    app.devengosState.lastPreview = {
      request: payload,
      preview: preview,
    };
    app.devengosState.lastPreviewBatch = null;

    if (!preview || !preview.aplica) {
      hidePreviewCalcCard();
      hidePreviewRachasCard();
      setStatus(
        'devPreviewResult',
        (preview && preview.motivo) ||
          'No aplica ninguna regla para este caso.',
        'warning'
      );
      return;
    }

    setStatus('devPreviewResult', '', null);
    hidePreviewCalcCard();
    renderPreviewRachasCard(preview, payload);
  }

  async function handlePreviewGrabar() {
    let selectedAgenteRaw = String((document.getElementById('devPreviewAgenteId') || {}).value || '');
    let observaciones = String((document.getElementById('devPreviewObservaciones') || {}).value || '').trim();
    if (observaciones.length < 5) {
      setStatus('devPreviewResult', 'Debes indicar una justificación (mínimo 5 caracteres) para grabar movimiento manual.', 'warning');
      return;
    }

    let targets = [];
    if (selectedAgenteRaw === PREVIEW_ALL_AGENTS_VALUE) {
      let batch = app.devengosState.lastPreviewBatch;
      if (!batch || !Array.isArray(batch.items)) {
        setStatus('devPreviewResult', 'Primero debes calcular un preview masivo válido antes de grabar para todos los agentes.', 'warning');
        return;
      }
      targets = batch.items.filter(function (item) {
        return item && item.request && item.preview && item.preview.aplica === true && !item.error;
      });
      if (!targets.length) {
        setStatus('devPreviewResult', 'No hay agentes con preview aplicable para grabar.', 'warning');
        return;
      }
    } else {
      let selectedAgenteId = Number(selectedAgenteRaw);
      let single =
        app.devengosState.lastPreview &&
        app.devengosState.lastPreview.request &&
        Number(app.devengosState.lastPreview.request.agente_id) === selectedAgenteId &&
        app.devengosState.lastPreview.preview &&
        app.devengosState.lastPreview.preview.aplica
          ? app.devengosState.lastPreview
          : null;
      if (!single && app.devengosState.lastPreviewBatch && Array.isArray(app.devengosState.lastPreviewBatch.items)) {
        single = app.devengosState.lastPreviewBatch.items.find(function (item) {
          return item && item.request && Number(item.request.agente_id) === selectedAgenteId && item.preview && item.preview.aplica === true && !item.error;
        }) || null;
      }
      if (!single) {
        setStatus('devPreviewResult', 'Primero debes calcular un preview válido para el agente seleccionado antes de grabar.', 'warning');
        return;
      }
      targets = [single];
    }

    let okCount = 0;
    let errCount = 0;
    let lastMovimientoId = null;
    let lastMovimientoFecha = null;
    let fechasInsertadas = [];

    // Si hay múltiples targets, usar endpoint bulk. Si es uno solo, usar el individual.
    if (targets.length > 1) {
      const bulkItems = targets.map((t) => ({
        agente_id: Number(t.request.agente_id),
        actividad_id: Number(t.request.actividad_id),
        borrador_id: t.request.borrador_id ? Number(t.request.borrador_id) : null,
        fecha: t.request.fecha || null,
        fecha_hasta: t.request.fecha_hasta || null,
        preview_snapshot: t.preview || null,
        regla_override: t.request.regla_override || null,
      }));

      const bulkPayload = {
        items: bulkItems,
        observaciones: observaciones,
      };

      try {
        let res = await fetch('/api/asignaciones-reglas/movimientos-manuales/bulk', {
          method: 'POST',
          headers: getHeaders(true),
          body: JSON.stringify(bulkPayload),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        let json = await res.json();
        if (json.movimientos && Array.isArray(json.movimientos)) {
          okCount = json.movimientos.length;
          json.movimientos.forEach((mov) => {
            if (mov && mov.id) lastMovimientoId = mov.id;
            if (mov && mov.fecha) {
              lastMovimientoFecha = String(mov.fecha);
              fechasInsertadas.push(String(mov.fecha));
            }
          });
        }
      } catch (error) {
        errCount = targets.length;
        okCount = 0;
        setStatus(
          'devPreviewResult',
          'Error en grabación masiva: ' + (error.message || 'Error desconocido'),
          'error'
        );
        return;
      }
    } else {
      // Grabación individual para un único agente
      for (let i = 0; i < targets.length; i += 1) {
        let req = targets[i].request;
        let payload = {
          agente_id: Number(req.agente_id),
          actividad_id: Number(req.actividad_id),
          borrador_id: req.borrador_id ? Number(req.borrador_id) : null,
          fecha: req.fecha || null,
          fecha_hasta: req.fecha_hasta || null,
          preview_snapshot: targets[i].preview || null,
          regla_override: req.regla_override || null,
          observaciones: observaciones,
        };
        let res = await fetch('/api/asignaciones-reglas/movimientos-manuales', {
          method: 'POST',
          headers: getHeaders(true),
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          errCount += 1;
          continue;
        }
        let json = await res.json();
        let mov = json && json.movimiento ? json.movimiento : null;
        lastMovimientoId = mov && mov.id ? mov.id : lastMovimientoId;
        lastMovimientoFecha = mov && mov.fecha ? String(mov.fecha) : lastMovimientoFecha;
        if (mov && mov.fecha) fechasInsertadas.push(String(mov.fecha));
        okCount += 1;
      }
    }

    if (!okCount) {
      setStatus('devPreviewResult', 'No se pudo grabar ningún movimiento.', 'error');
      return;
    }

    if (targets.length === 1) {
      savePreviewInState({
        saved_at: nowIsoDateTime(),
        request: targets[0].request,
        preview: targets[0].preview,
        movimiento_id: lastMovimientoId,
        fecha_insercion: lastMovimientoFecha,
        observaciones: observaciones,
      });
      setStatus(
        'devPreviewResult',
        lastMovimientoId
          ? 'Preview grabado en BBDD. Movimiento #' + String(lastMovimientoId) + (lastMovimientoFecha ? ' (fecha insercion: ' + lastMovimientoFecha + ')' : '')
          : 'Preview grabado en BBDD.',
        'success'
      );
    } else {
      let minFecha = null;
      let maxFecha = null;
      if (fechasInsertadas.length) {
        fechasInsertadas.sort();
        minFecha = fechasInsertadas[0];
        maxFecha = fechasInsertadas[fechasInsertadas.length - 1];
      }
      setStatus(
        'devPreviewResult',
        'Grabación masiva completada: ' +
          String(okCount) +
          ' guardados' +
          (errCount ? ', ' + String(errCount) + ' con error.' : '.') +
          (minFecha
            ? ' Fechas insercion: ' + minFecha + (maxFecha && maxFecha !== minFecha ? ' a ' + maxFecha : '')
            : ''),
        errCount ? 'warning' : 'success'
      );
    }

    app.devengosState.lastPreview = null;
    app.devengosState.lastPreviewBatch = null;
  }

  async function handleReglaSubmit(event) {
    try {
      await submitReglaForm(event);
    } catch (error) {
      setStatus(
        'devPreviewResult',
        error.message || 'Error al guardar regla',
        'error'
      );
    }
  }

  async function handlePreviewSubmit(event) {
    try {
      await submitPreview(event);
    } catch (error) {
      setStatus(
        'devPreviewResult',
        error.message || 'Error al calcular preview',
        'error'
      );
    }
  }

  function bindEvents() {
    if (app.devengosState._bound) return;

    let reglasTable = document.getElementById('devReglasTable');
    if (reglasTable) {
      reglasTable.addEventListener('click', function (event) {
        onReglasTableClick(event).catch(function (error) {
          setStatus(
            'devPreviewResult',
            error.message || 'Error en acciones de regla',
            'error'
          );
        });
      });

      reglasTable.addEventListener('keydown', function (event) {
        let sortHeader = event.target.closest('th[data-sort-key]');
        if (!sortHeader) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleReglasSort(String(sortHeader.getAttribute('data-sort-key') || 'id'));
      });
    }

    let reglaForm = document.getElementById('devReglaForm');
    if (reglaForm) reglaForm.addEventListener('submit', handleReglaSubmit);

    let btnClear = document.getElementById('btnDevCancelarEdicion');
    if (btnClear) {
      btnClear.addEventListener('click', function () {
        clearReglaForm();
      });
    }

    let btnNueva = document.getElementById('btnDevNuevaRegla');
    if (btnNueva) {
      btnNueva.addEventListener('click', function () {
        clearReglaForm();
      });
    }

    let btnRefresh = document.getElementById('btnDevRefrescarReglas');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', function () {
        loadReglas().catch(function (error) {
          setStatus(
            'devPreviewResult',
            error.message || 'Error al refrescar reglas',
            'error'
          );
        });
      });
    }

    let btnConsolidarPendientes = document.getElementById(
      'btnDevConsolidarPendientes'
    );
    if (btnConsolidarPendientes) {
      btnConsolidarPendientes.addEventListener('click', function () {
        (async function () {
          let previousHtml = btnConsolidarPendientes.innerHTML;
          btnConsolidarPendientes.disabled = true;
          btnConsolidarPendientes.innerHTML =
            '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Consolidando...';
          try {
            let response = await fetch(
              '/api/asignaciones/devengos/consolidar-pendientes',
              {
                method: 'POST',
                headers: getHeaders(true),
                body: JSON.stringify({}),
              }
            );
            if (!response.ok) {
              throw new Error(
                await parseApiError(
                  response,
                  'Error al consolidar devengos pendientes'
                )
              );
            }
            let payload = await response.json();
            setStatus(
              'devPreviewResult',
              (payload && payload.message) ||
                'Devengos pendientes consolidados correctamente',
              'success'
            );
          } catch (error) {
            setStatus(
              'devPreviewResult',
              error.message || 'Error al consolidar devengos pendientes',
              'error'
            );
          } finally {
            btnConsolidarPendientes.disabled = false;
            btnConsolidarPendientes.innerHTML = previousHtml;
          }
        })();
      });
    }

    let scopeTypeSel = document.getElementById('devCondicionAlcance');
    if (scopeTypeSel) {
      scopeTypeSel.addEventListener('change', function () {
        syncCondicionAlcanceControls();
      });
    }

    let tipoMovimientoSel = document.getElementById('devTipoMovimiento');
    if (tipoMovimientoSel) {
      tipoMovimientoSel.addEventListener('change', function () {
        syncTipoMovimientoControls();
        syncCruceFestivoDefaultByTipo();
      });
    }

    let previewForm = document.getElementById('devPreviewForm');
    if (previewForm)
      previewForm.addEventListener('submit', handlePreviewSubmit);

    let previewGrabarBtn = document.getElementById('btnDevPreviewGrabar');
    if (previewGrabarBtn) {
      previewGrabarBtn.addEventListener('click', function () {
        handlePreviewGrabar().catch(function (error) {
          setStatus(
            'devPreviewResult',
            error.message || 'Error al grabar preview en BBDD',
            'error'
          );
        });
      });
    }

    let previewAgenteBuscar = document.getElementById('devPreviewAgenteBuscar');
    if (previewAgenteBuscar) {
      previewAgenteBuscar.addEventListener('input', function (event) {
        renderPreviewAgentesSelect(event.target.value || '');
      });
    }

    let previewActividadBuscar = document.getElementById(
      'devPreviewActividadBuscar'
    );
    if (previewActividadBuscar) {
      previewActividadBuscar.addEventListener('input', function (event) {
        renderPreviewActividadesSelect(event.target.value || '');
      });
    }

    let previewFecha = document.getElementById('devPreviewFecha');
    if (previewFecha) {
      let refreshPreviewBorradores = function () {
        loadPreviewBorradores().catch(function (error) {
          setStatus(
            'devPreviewResult',
            error.message || 'Error al cargar borradores del preview',
            'error'
          );
        });
      };
      previewFecha.addEventListener('input', refreshPreviewBorradores);
      previewFecha.addEventListener('change', refreshPreviewBorradores);
    }

    let calcCloseBtn = document.getElementById('devPreviewCalcClose');
    if (calcCloseBtn) {
      calcCloseBtn.addEventListener('click', function () {
        hidePreviewCalcCard();
      });
    }

    let rachasCloseBtn = document.getElementById('devPreviewRachasClose');
    if (rachasCloseBtn) {
      rachasCloseBtn.addEventListener('click', function () {
        hidePreviewRachasCard();
      });
    }

    app.devengosState._bound = true;
  }

  function initDefaultFilters() {
    let dt = DateTime();
    let now = dt ? dt.now().setZone('Europe/Madrid') : null;
    let iso = now ? now.toISODate() : '';

    document.getElementById('devPreviewFecha').value = iso;
    document.getElementById('devPreviewFechaHasta').value = '';
    let previewAgenteBuscar = document.getElementById('devPreviewAgenteBuscar');
    if (previewAgenteBuscar) previewAgenteBuscar.value = '';
    let previewActividadBuscar = document.getElementById(
      'devPreviewActividadBuscar'
    );
    if (previewActividadBuscar) previewActividadBuscar.value = '';
  }

  app.initializeDevengos = async function initializeDevengos() {
    bindEvents();
    initDefaultFilters();
    hidePreviewCalcCard();
    hidePreviewRachasCard();
    renderSavedPreviewInfo();
    await loadMeta();
    await loadPreviewBorradores();
    clearReglaForm();
    syncCondicionAlcanceControls();
    syncTipoMovimientoControls();
    await loadReglas();
    setStatus('devPreviewResult', '', null);
  };
})();
