(function () {
  'use strict';

  const app = window.GRS1Dashboard;

  const MESES = [
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

  const state = {
    anio: null,
    mes: null,
    tipo: 'definitivo',
    borradorId: null,
    borradores: [],
    periodos: [],
  };

  function el(id) {
    return document.getElementById(id);
  }

  function getHeaders() {
    return typeof app.getHeaders === 'function'
      ? app.getHeaders(false)
      : { Authorization: `Bearer ${app.globalState.token}` };
  }

  function formatFechaIso(iso) {
    const DateTime = window.luxon && window.luxon.DateTime;
    if (DateTime) {
      const dt = DateTime.fromISO(String(iso || '').slice(0, 10), {
        zone: 'Europe/Madrid',
      });
      if (dt.isValid) return dt.toFormat('dd/LL/yyyy');
    }
    return String(iso || '').slice(0, 10);
  }

  function setStatus(visible, message) {
    const s = el('informesStatus');
    if (!s) return;
    const label = el('informesStatusLabel');
    if (label && message) label.textContent = message;
    s.classList.toggle('informes-hidden', !visible);
  }

  function setError(msg) {
    const e = el('informesError');
    if (!e) return;
    if (msg) {
      e.textContent = msg;
      e.classList.remove('informes-hidden');
    } else {
      e.classList.add('informes-hidden');
      e.textContent = '';
    }
  }

  function actualizarResumenFuente() {
    // @ts-ignore
    const anio = el('informesAnio')?.value || '—';
    // @ts-ignore
    const mesNum = Number(el('informesMes')?.value || 0);
    const mes = MESES[mesNum - 1] || '—';
    // @ts-ignore
    const tipo = el('informesTipo')?.value || 'definitivo';
    const resumen = el('informesFuenteResumen');
    if (!resumen) return;

    if (tipo === 'borrador') {
      const borradorSel = el('informesBorrador');
      // @ts-ignore
      const borradorId = borradorSel?.value || '';
      const borradorTxt =
        // @ts-ignore
        borradorSel && borradorSel.selectedIndex >= 0
          // @ts-ignore
          ? borradorSel.options[borradorSel.selectedIndex]?.textContent ||
            'Sin borrador'
          : 'Sin borrador';
      resumen.textContent = `Fuente: Borrador${borradorId ? ` (${borradorTxt})` : ''} · Período: ${mes} ${anio}`;
      return;
    }

    resumen.textContent = `Fuente: Definitivo · Período: ${mes} ${anio}`;
  }

  function buildPeriodos(cuadrantes) {
    const porAnio = new Map();
    (cuadrantes || []).forEach((c) => {
      if (!c || c.estado === 'archivado') return;
      const anio = Number(c.anio != null ? c.anio : c.anio_referencia);
      const mes = Number(c.mes != null ? c.mes : c.mes_referencia);
      if (!Number.isInteger(anio) || anio <= 0) return;
      if (!Number.isInteger(mes) || mes < 1 || mes > 12) return;
      if (!porAnio.has(anio)) porAnio.set(anio, new Set());
      porAnio.get(anio).add(mes);
    });

    return Array.from(porAnio.entries())
      .map(([anio, mesesSet]) => ({
        anio,
        meses: Array.from(mesesSet).sort((a, b) => a - b),
      }))
      .sort((a, b) => b.anio - a.anio);
  }

  function aplicarRangoInputs(desdeInput, hastaInput, rango) {
    if (!desdeInput || !hastaInput || !rango || !rango.desde || !rango.hasta) return;
    desdeInput.min = rango.desde;
    desdeInput.max = rango.hasta;
    hastaInput.min = rango.desde;
    hastaInput.max = rango.hasta;
    if (!desdeInput.value || desdeInput.value < rango.desde || desdeInput.value > rango.hasta) {
      desdeInput.value = rango.desde;
    }
    if (!hastaInput.value || hastaInput.value < rango.desde || hastaInput.value > rango.hasta) {
      hastaInput.value = rango.hasta;
    }
  }

  async function obtenerRangoCuadrante(anio, mes, borradorId) {
    let fechas = [];

    if (borradorId) {
      const resp = await fetch(
        `/api/asignaciones/cuadrante/${anio}/${mes}?borrador_id=${encodeURIComponent(String(borradorId))}`,
        { headers: getHeaders(), cache: 'no-store' }
      );
      if (!resp.ok) return null;
      const json = await resp.json();
      const rows = Array.isArray(json.borrador)
        ? json.borrador
        : Array.isArray(json.definitivo)
          ? json.definitivo
          : [];
      fechas = rows
        .map((day) => String(day && day.fecha ? day.fecha : '').slice(0, 10))
        .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso));
    } else if (app._asig && typeof app._asig.fetchCuadranteDaysForPeriod === 'function') {
      const days = await app._asig.fetchCuadranteDaysForPeriod(anio, mes);
      fechas = Array.isArray(days)
        ? days
            .map((day) => String(day && (day.key || day.fecha) ? (day.key || day.fecha) : '').slice(0, 10))
            .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso))
        : [];
    }

    fechas.sort((a, b) => a.localeCompare(b));
    return fechas.length
      ? { desde: fechas[0], hasta: fechas[fechas.length - 1], fechas }
      : null;
  }

  function poblarMesesPorAnio(anioPreferido, mesPreferido) {
    const mesSel = el('informesMes');
    if (!mesSel) return;

    const periodo =
      state.periodos.find((p) => p.anio === Number(anioPreferido)) ||
      state.periodos[0];
    const meses = (periodo && periodo.meses) || [];
    if (!meses.length) {
      mesSel.innerHTML = '<option value="">Sin meses</option>';
      return;
    }

    mesSel.innerHTML = meses
      .map((m) => `<option value="${m}">${MESES[m - 1] || m}</option>`)
      .join('');

    const selectedMes = meses.includes(Number(mesPreferido))
      ? Number(mesPreferido)
      : meses[meses.length - 1];
    // @ts-ignore
    mesSel.value = String(selectedMes);
  }

  function poblarPeriodoDisponible(preferredAnio, preferredMes) {
    const anioSel = el('informesAnio');
    if (!anioSel) return;

    if (!state.periodos.length) {
      anioSel.innerHTML = '<option value="">Sin años</option>';
      const mesSel = el('informesMes');
      if (mesSel) mesSel.innerHTML = '<option value="">Sin meses</option>';
      return;
    }

    anioSel.innerHTML = state.periodos
      .map((p) => `<option value="${p.anio}">${p.anio}</option>`)
      .join('');

    const anios = state.periodos.map((p) => p.anio);
    const selectedAnio = anios.includes(Number(preferredAnio))
      ? Number(preferredAnio)
      : anios[0];
    // @ts-ignore
    anioSel.value = String(selectedAnio);
    poblarMesesPorAnio(selectedAnio, preferredMes);
  }

  async function cargarPeriodosDisponibles() {
    const headers = getHeaders();
    const source = String(
      // @ts-ignore
      el('informesTipo')?.value || 'definitivo'
    ).toLowerCase();

    try {
      const resp = await fetch(
        `/api/asignaciones/periodos-disponibles?source=${encodeURIComponent(source)}`,
        { headers, cache: 'no-store' }
      );
      if (!resp.ok)
        throw new Error('No se pudieron cargar períodos efectivos.');
      const json = await resp.json();
      state.periodos = buildPeriodos(
        Array.isArray(json.periodos) ? json.periodos : []
      );
    } catch (_e) {
      const resp = await fetch('/api/cuadrantes', {
        headers,
        cache: 'no-store',
      });
      if (!resp.ok) {
        throw new Error(
          'No se pudieron cargar los períodos disponibles para informes.'
        );
      }
      const json = await resp.json();
      state.periodos = buildPeriodos(Array.isArray(json.data) ? json.data : []);
    }
  }

  async function poblarFechasCuadrante() {
    // @ts-ignore
    const anio = Number(el('informesAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(el('informesMes')?.value || 0);
    const sel = el('informesFechas');
    if (!anio || !mes || !sel) return;

    const tipo = String(
      // @ts-ignore
      el('informesTipo')?.value || 'definitivo'
    ).toLowerCase();
    const headers = getHeaders();
    const prevSelected = new Set(
      // @ts-ignore
      Array.from(sel.selectedOptions || []).map((o) => o.value)
    );
    // @ts-ignore
    const modoPorDia = !!el('informesModoPorDia')?.checked;
    let url = `/api/asignaciones/cuadrante/${anio}/${mes}`;

    if (tipo === 'definitivo') {
      url += '?source=definitivo';
    } else {
      const borradorId = String(
        // @ts-ignore
        el('informesBorrador')?.value || state.borradorId || ''
      );
      if (!borradorId) {
        resetModoPorDiaState();
        updateExportButtonState();
        sel.innerHTML =
          '<option value="">Selecciona un borrador para ver fechas</option>';
        const container = el('informesCuadrantePreviewContainer');
        if (container)
          container.innerHTML =
            '<div class="text-center text-muted py-3">Selecciona un borrador para ver fechas</div>';
        return;
      }
      url += `?borrador_id=${encodeURIComponent(borradorId)}`;
    }

    let fechas = [];
    try {
      const resp = await fetch(url, { headers, cache: 'no-store' });
      if (!resp.ok)
        throw new Error(
          'No se pudieron cargar las fechas de la fuente seleccionada.'
        );
      const json = await resp.json();
      const rows =
        tipo === 'borrador'
          ? Array.isArray(json.borrador)
            ? json.borrador
            : []
          : Array.isArray(json.definitivo)
            ? json.definitivo
            : [];

      fechas = Array.from(
        new Set(
          rows
            .map((r) => String((r && r.fecha) || '').slice(0, 10))
            .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso))
        )
      ).sort((a, b) => a.localeCompare(b));
    } catch (_err) {
      resetModoPorDiaState();
      updateExportButtonState();
      sel.innerHTML = '<option value="">Error al cargar fechas</option>';
      const container = el('informesCuadrantePreviewContainer');
      if (container)
        container.innerHTML =
          '<div class="text-center text-danger py-3">Error al cargar fechas</div>';
      return;
    }

    sel.innerHTML = '';
    if (!fechas.length) {
      resetModoPorDiaState();
      updateExportButtonState();
      sel.innerHTML =
        '<option value="">Sin fechas en la fuente seleccionada</option>';
      const container = el('informesCuadrantePreviewContainer');
      if (container)
        container.innerHTML =
          '<div class="text-center text-muted py-3">Sin fechas en la fuente seleccionada</div>';
      return;
    }

    // Poblar el select con las fechas del origen
    fechas.forEach((iso) => {
      const opt = document.createElement('option');
      opt.value = iso;
      opt.textContent = formatFechaIso(iso);
      if (prevSelected.has(iso)) opt.selected = true;
      sel.appendChild(opt);
    });

    updateExportButtonState();

    // Renderizar el calendario del cuadrante
    await cargarYRenderizarCuadranteCalendario();

    // En modo por día, si no hay selección previa válida, seleccionar todas
    // @ts-ignore
    if (modoPorDia && !Array.from(sel.options).some((opt) => opt.selected)) {
      seleccionarTodasFechas();
    }
  }

  async function cargarYRenderizarCuadranteCalendario() {
    // @ts-ignore
    const anio = Number(el('informesAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(el('informesMes')?.value || 0);
    const container = el('informesCuadrantePreviewContainer');
    const sel = el('informesFechas');
    // @ts-ignore
    const modoPorDia = !!el('informesModoPorDia')?.checked;
    if (!container || !sel) return;
    if (!anio || !mes) {
      resetModoPorDiaState();
      updateExportButtonState();
      container.innerHTML =
        '<div class="text-center text-muted py-3">No esxiste Cuadrante ....</div>';
      return;
    }

    const headers = getHeaders();
    try {
      // Obtener lista de cuadrantes
      const cuadrantesResp = await fetch(
        `/api/cuadrantes?anio=${anio}&mes=${mes}`,
        { headers, cache: 'no-store' }
      );
      if (!cuadrantesResp.ok)
        throw new Error('No se pudieron cargar cuadrantes');

      const cuadrantesData = await cuadrantesResp.json();
      const cuadrantes = Array.isArray(cuadrantesData.data)
        ? cuadrantesData.data
        : [];

      // Buscar cuadrante activo o preferente
      let cuadrante = cuadrantes.find(
        (c) =>
          Number(c.anio_referencia) === anio &&
          Number(c.mes_referencia) === mes &&
          String(c.estado || '').toLowerCase() === 'activo'
      );

      if (!cuadrante) {
        cuadrante = cuadrantes.find(
          (c) =>
            Number(c.anio_referencia) === anio &&
            Number(c.mes_referencia) === mes &&
            String(c.estado || '').toLowerCase() !== 'archivado'
        );
      }

      if (!cuadrante) {
        resetModoPorDiaState();
        updateExportButtonState();
        container.innerHTML =
          '<div class="text-center text-muted py-3">No existe Cuadrante ....</div>';
        return;
      }

      // Si el cuadrante no tiene los días cargados, obtener el detalle
      if (
        !cuadrante.dias ||
        !Array.isArray(cuadrante.dias) ||
        cuadrante.dias.length === 0
      ) {
        const detailResp = await fetch(`/api/cuadrantes/${cuadrante.id}`, {
          headers,
          cache: 'no-store',
        });
        if (detailResp.ok) {
          const detailData = await detailResp.json();
          cuadrante =
            detailData && detailData.data ? detailData.data : cuadrante;
        }
      }

      // Obtener fechas seleccionadas
      // @ts-ignore
      const selectedDates = Array.from(sel.selectedOptions || []).map(
        (o) => o.value
      );
      // @ts-ignore
      const allowedDates = Array.from(sel.options || [])
        .map((o) => o.value)
        .filter(Boolean);

      // Verificar que el cuadrante tiene la estructura necesaria
      if (!cuadrante.dias || !Array.isArray(cuadrante.dias)) {
        resetModoPorDiaState();
        updateExportButtonState();
        console.warn('Cuadrante sin estructura de días:', cuadrante);
        container.innerHTML =
          '<div class="text-center text-muted py-3">Estructura de cuadrante inválida.</div>';
        return;
      }

      // Renderizar calendario usando renderCuadrantePreview
      if (typeof window.renderCuadrantePreview === 'function') {
        window.renderCuadrantePreview(
          'informesCuadrantePreviewContainer',
          cuadrante,
          {
            selectable: modoPorDia,
            selectedDates: selectedDates,
            allowedDates: allowedDates,
            onSelect: sincronizarSelectDesdeCalendarioPreview,
          }
        );
      } else {
        container.innerHTML =
          '<div class="text-center text-muted py-3">Función de calendario no disponible.</div>';
      }
    } catch (err) {
      resetModoPorDiaState();
      updateExportButtonState();
      console.error('Error cargando cuadrante:', err);
      container.innerHTML = `<div class="text-center text-danger py-3">Error: ${err.message || 'No se pudo cargar el cuadrante'}</div>`;
    }
  }

  function sincronizarSelectDesdeCalendarioPreview(selectedFechas) {
    const sel = el('informesFechas');
    if (!sel) return;
    // @ts-ignore
    Array.from(sel.options).forEach((opt) => {
      opt.selected = selectedFechas.includes(opt.value);
    });
  }

  function resetModoPorDiaState() {
    const toggle = el('informesModoPorDia');
    const wrap = el('informesFechasWrap');
    const fechasSel = el('informesFechas');
    const btnTodas = el('btninformesFechasTodas');
    const btnLimpiar = el('btninformesFechasLimpiar');

    // @ts-ignore
    if (toggle) toggle.checked = false;
    if (wrap) wrap.classList.add('is-disabled');
    if (fechasSel) {
      // @ts-ignore
      fechasSel.disabled = true;
      // @ts-ignore
      Array.from(fechasSel.options).forEach((opt) => {
        opt.selected = false;
      });
    }
    // @ts-ignore
    if (btnTodas) btnTodas.disabled = true;
    // @ts-ignore
    if (btnLimpiar) btnLimpiar.disabled = true;
  }

  function updateExportButtonState() {
    const btnExcel = el('btninformesExportar');
    const btnPdf = el('btninformesExportarPdf');
    if (!btnExcel && !btnPdf) return;

    // @ts-ignore
    const anio = Number(el('informesAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(el('informesMes')?.value || 0);
    const tipo = String(
      // @ts-ignore
      el('informesTipo')?.value || 'definitivo'
    ).toLowerCase();
    const fechasSel = el('informesFechas');
    // @ts-ignore
    const hasFechas = Array.from(fechasSel?.options || []).some((opt) =>
      Boolean(opt.value)
    );
    const hasBorrador =
      tipo !== 'borrador' ||
      // @ts-ignore
      Boolean(el('informesBorrador')?.value || state.borradorId);
    const enabled = !!(anio && mes && hasFechas && hasBorrador);

    // @ts-ignore
    if (btnExcel) btnExcel.disabled = !enabled;
    // @ts-ignore
    if (btnPdf) btnPdf.disabled = !enabled;
  }

  function actualizarModoPorDia() {
    // @ts-ignore
    const checked = !!el('informesModoPorDia')?.checked;
    const wrap = el('informesFechasWrap');
    if (wrap) wrap.classList.toggle('is-disabled', !checked);

    const fechasSel = el('informesFechas');
    const btnTodas = el('btninformesFechasTodas');
    const btnLimpiar = el('btninformesFechasLimpiar');
    // @ts-ignore
    if (fechasSel) fechasSel.disabled = !checked;
    // @ts-ignore
    if (btnTodas) btnTodas.disabled = !checked;
    // @ts-ignore
    if (btnLimpiar) btnLimpiar.disabled = !checked;

    if (checked) {
      if (
        fechasSel &&
        // @ts-ignore
        !Array.from(fechasSel.options).some((opt) => opt.selected)
      ) {
        seleccionarTodasFechas();
      }
    } else if (fechasSel) {
      // @ts-ignore
      Array.from(fechasSel.options).forEach((opt) => {
        opt.selected = false;
      });
    }

    // Re-render para reflejar modo seleccionable/no seleccionable del cuadrante.
    cargarYRenderizarCuadranteCalendario();
  }

  function seleccionarTodasFechas() {
    const container = el('informesCuadrantePreviewContainer');
    const checkboxes =
      container?.querySelectorAll('.cuadrante-day-check:not(:disabled)') || [];
    const fechas = Array.from(checkboxes).map((ch) => ch.value);
    checkboxes.forEach((ch) => {
      ch.checked = true;
    });
    sincronizarSelectDesdeCalendarioPreview(fechas);
    cargarYRenderizarCuadranteCalendario();
  }

  function limpiarFechasSeleccionadas() {
    const container = el('informesCuadrantePreviewContainer');
    const checkboxes =
      container?.querySelectorAll('.cuadrante-day-check:not(:disabled)') || [];
    checkboxes.forEach((ch) => {
      ch.checked = false;
    });
    sincronizarSelectDesdeCalendarioPreview([]);
    cargarYRenderizarCuadranteCalendario();
  }

  async function cargarBorradores() {
    // @ts-ignore
    const anio = el('informesAnio')?.value;
    // @ts-ignore
    const mes = el('informesMes')?.value;
    if (!anio || !mes) return;

    const sel = el('informesBorrador');
    if (!sel) return;
    // @ts-ignore
    const prevId = String(state.borradorId || sel.value || '');

    sel.innerHTML = '<option value="">Cargando…</option>';

    try {
      const token = app.globalState.token;
      const resp = await fetch(`/api/asignaciones/borradores/${anio}/${mes}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await resp.json();
      state.borradores = data.borradores || [];

      sel.innerHTML = '';
      state.borradores.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${b.nombre} (v${b.version}) — ${b.estado}`;
        opt.dataset.nombre = b.nombre;
        sel.appendChild(opt);
      });

      if (!state.borradores.length) {
        sel.innerHTML =
          '<option value="">Sin borradores para este período</option>';
        state.borradorId = null;
      } else {
        const existsPrev = state.borradores.some(
          (b) => String(b.id) === prevId
        );
        const selected = existsPrev ? prevId : String(state.borradores[0].id);
        // @ts-ignore
        sel.value = selected;
        state.borradorId = selected;
      }
      actualizarResumenFuente();
    } catch (err) {
      sel.innerHTML = '<option value="">Error al cargar borradores</option>';
      state.borradorId = null;
      actualizarResumenFuente();
    }
  }

  async function actualizarVisibilidadBorrador() {
    // @ts-ignore
    const tipo = el('informesTipo')?.value;
    const wrap = el('informesBorradorWrap');
    const sel = el('informesBorrador');
    if (wrap) wrap.style.display = tipo === 'borrador' ? 'block' : 'none';
    if (!sel) return;

    if (tipo === 'borrador') {
      // @ts-ignore
      sel.disabled = false;
      await cargarBorradores();
      return;
    }

    // @ts-ignore
    sel.disabled = true;
    sel.innerHTML = '<option value="">Versión única</option>';
    // @ts-ignore
    sel.value = '';
    state.borradorId = null;
  }

  async function exportar(formato = 'xlsx') {
    setError(null);
    // @ts-ignore
    const anio = el('informesAnio')?.value;
    // @ts-ignore
    const mes = el('informesMes')?.value;
    // @ts-ignore
    const tipo = el('informesTipo')?.value;

    if (!anio || !mes) {
      setError('Selecciona año y mes.');
      return;
    }

    let borrador_id = null;
    let nombre_borrador = '';
    // @ts-ignore
    const modoPorDia = !!el('informesModoPorDia')?.checked;
    const selFechas = el('informesFechas');
    // @ts-ignore
    let fechasSeleccionadas = Array.from(selFechas?.selectedOptions || []).map(
      (o) => o.value
    );

    if (tipo === 'borrador') {
      const sel = el('informesBorrador');
      // @ts-ignore
      borrador_id = sel?.value || state.borradorId || null;
      if (!borrador_id) {
        setError('No hay borrador disponible para el período seleccionado.');
        return;
      }
      // @ts-ignore
      const opt = sel.options[sel.selectedIndex];
      nombre_borrador = opt?.dataset?.nombre || '';
    }
    actualizarResumenFuente();

    setStatus(
      true,
      formato === 'pdf'
        ? 'Generando PDF, por favor espera…'
        : 'Generando Excel, por favor espera…'
    );
    const btnExcel = el('btninformesExportar');
    const btnPdf = el('btninformesExportarPdf');
    // @ts-ignore
    if (btnExcel) btnExcel.disabled = true;
    // @ts-ignore
    if (btnPdf) btnPdf.disabled = true;

    try {
      const headers =
        typeof app.getHeaders === 'function'
          ? app.getHeaders(false)
          : { Authorization: `Bearer ${app.globalState.token}` };
      const params = new URLSearchParams({ anio, mes, formato });
      if (tipo === 'borrador' && borrador_id)
        params.set('borrador_id', borrador_id);
      if (nombre_borrador) params.set('nombre_borrador', nombre_borrador);
      if (modoPorDia || formato === 'pdf') {
        if (!fechasSeleccionadas.length) {
          // @ts-ignore
          fechasSeleccionadas = Array.from(selFechas?.options || [])
            .map((o) => o.value)
            .filter(Boolean);
        }
        if (!fechasSeleccionadas.length) {
          throw new Error('No hay fechas disponibles para exportar por día.');
        }
        params.set('modo', 'por_dia');
        params.set('fechas', fechasSeleccionadas.join(','));
      }

      const resp = await fetch(`/api/asignaciones/exportar?${params}`, {
        headers,
      });

      if (!resp.ok) {
        const err = await resp
          .json()
          .catch(() => ({ error: 'Error desconocido' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const blob = await resp.blob();
      if (!blob || Number(blob.size || 0) === 0) {
        throw new Error('El servidor no devolvió contenido para descargar.');
      }
      const url = URL.createObjectURL(blob);
      const disposition = resp.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename =
        match && match[1]
          ? match[1]
          : formato === 'pdf'
            ? 'servicio.pdf'
            : 'cuadrante.xlsx';

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Error al exportar: ${err.message}`);
    } finally {
      setStatus(false);
      updateExportButtonState();
    }
  }

  function bindEventos() {
    const bindOnce = (id, eventName, handler) => {
      const node = el(id);
      if (!node) return;
      const key = `bound_${eventName}`;
      if (node.dataset[key] === '1') return;
      node.dataset[key] = '1';
      node.addEventListener(eventName, handler);
    };

    bindOnce('btninformesExportar', 'click', () => exportar('xlsx'));
    bindOnce('btninformesExportarPdf', 'click', () => exportar('pdf'));
    bindOnce('btninformesFechasTodas', 'click', seleccionarTodasFechas);
    bindOnce('btninformesFechasLimpiar', 'click', limpiarFechasSeleccionadas);
    bindOnce('informesTipo', 'change', async () => {
      // @ts-ignore
      const anioActual = Number(el('informesAnio')?.value || 0) || state.anio;
      // @ts-ignore
      const mesActual = Number(el('informesMes')?.value || 0) || state.mes;
      try {
        await cargarPeriodosDisponibles();
        poblarPeriodoDisponible(anioActual, mesActual);
        await actualizarVisibilidadBorrador();
        await poblarFechasCuadrante();
      } catch (err) {
        setError(
          err.message ||
            'No se pudieron cargar los períodos para la fuente seleccionada.'
        );
      }
      actualizarResumenFuente();
    });
    bindOnce('informesModoPorDia', 'change', actualizarModoPorDia);
    bindOnce('informesBorrador', 'change', async () => {
      // @ts-ignore
      state.borradorId = el('informesBorrador')?.value || null;
      await poblarFechasCuadrante();
      actualizarResumenFuente();
    });

    bindOnce('informesAnio', 'change', async () => {
      // @ts-ignore
      poblarMesesPorAnio(el('informesAnio')?.value, null);
      // @ts-ignore
      if (el('informesTipo')?.value === 'borrador') await cargarBorradores();
      await poblarFechasCuadrante();
      actualizarResumenFuente();
    });

    bindOnce('informesMes', 'change', async () => {
      // @ts-ignore
      if (el('informesTipo')?.value === 'borrador') await cargarBorradores();
      await poblarFechasCuadrante();
      actualizarResumenFuente();
    });
  }


  // ══════════════════════════════════════════════════════════════════════════
  // RESUMEN ACTIVIDADES - INDEPENDIENTE (sin compartir estado)
  // ══════════════════════════════════════════════════════════════════════════

  const stateRA = { 
    periodos: [],
    anio: null,
    mes: null,
    borradorId: null,
    borradores: [],
  };

  function elRA(id) { return document.getElementById(id); }

  async function cargarPeriodosRA(preferredAnio, preferredMes) {
    // @ts-ignore
    const source = String(elRA('raFuente')?.value || 'definitivo').toLowerCase();
    try {
      const resp = await fetch(
        `/api/asignaciones/periodos-disponibles?source=${encodeURIComponent(source)}`,
        {
          headers: getHeaders(),
          cache: 'no-store',
        }
      );
      if (!resp.ok) {
        throw new Error('No se pudieron cargar periodos efectivos');
      }

      const json = await resp.json();
      stateRA.periodos = buildPeriodos(
        Array.isArray(json.periodos) ? json.periodos : []
      );
    } catch (_err) {
      const resp = await fetch('/api/cuadrantes', {
        headers: getHeaders(),
        cache: 'no-store',
      });
      if (!resp.ok) {
        stateRA.periodos = [];
      } else {
        const json = await resp.json();
        stateRA.periodos = buildPeriodos(Array.isArray(json.data) ? json.data : []);
      }
    }

    poblarAnoRA(preferredAnio, preferredMes);
  }

  function poblarAnoRA(preferredAnio, preferredMes) {
    const anioSel = elRA('raAnio');
    if (!anioSel) return;
    const mesSel = elRA('raMes');

    if (!stateRA.periodos.length) {
      anioSel.innerHTML = '<option value="">Sin años</option>';
      if (mesSel) mesSel.innerHTML = '<option value="">Sin meses</option>';
      return;
    }

    anioSel.innerHTML = stateRA.periodos
      .map((p) => `<option value="${p.anio}">${p.anio}</option>`)
      .join('');
    const anios = stateRA.periodos.map((p) => p.anio);
    const selectedAnio = anios.includes(Number(preferredAnio))
      ? Number(preferredAnio)
      : anios[0];
    // @ts-ignore
    anioSel.value = String(selectedAnio);
    stateRA.anio = selectedAnio;

    poblarMesRA(preferredMes);
  }

  function poblarMesRA(preferredMes) {
    const mesSel = elRA('raMes');
    if (!mesSel) return;

    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || stateRA.anio || 0);
    const period = stateRA.periodos.find((p) => p.anio === anio);
    const meses = (period && period.meses) || [];

    if (!meses.length) {
      mesSel.innerHTML = '<option value="">Sin meses</option>';
      stateRA.mes = null;
      return;
    }

    mesSel.innerHTML = meses
      .map((m) => `<option value="${m}">${MESES[m - 1] || m}</option>`)
      .join('');
    const selectedMes = meses.includes(Number(preferredMes))
      ? Number(preferredMes)
      : meses[meses.length - 1];
    // @ts-ignore
    mesSel.value = String(selectedMes);
    stateRA.mes = selectedMes;
    sincronizarRangoFechasRA();
  }

  function limitesMesRA() {
    if (stateRA.rangoCuadrante && stateRA.rangoCuadrante.desde && stateRA.rangoCuadrante.hasta) {
      return {
        desdeMes: stateRA.rangoCuadrante.desde,
        hastaMes: stateRA.rangoCuadrante.hasta,
      };
    }
    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || stateRA.anio || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || stateRA.mes || 0);
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
    const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    return {
      desdeMes: `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`,
      hastaMes: `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`,
    };
  }

  function limitesFechasRA() {
    return limitesMesRA();
  }

  async function cargarFechasDisponiblesRA() {
    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || 0);
    // @ts-ignore
    const tipo = String(elRA('raFuente')?.value || 'definitivo').toLowerCase();
    if (!anio || !mes) {
      sincronizarRangoFechasRA();
      return;
    }

    if (tipo === 'borrador' && !stateRA.borradorId) {
      sincronizarRangoFechasRA();
      return;
    }

    stateRA.rangoCuadrante = await obtenerRangoCuadrante(anio, mes, tipo === 'borrador' ? stateRA.borradorId : null);

    sincronizarRangoFechasRA();
  }

  function sincronizarRangoFechasRA() {
    const desdeInput = elRA('raFechaDesde');
    const hastaInput = elRA('raFechaHasta');
    if (!desdeInput || !hastaInput) return;

    const limites = limitesFechasRA();
    if (!limites) return;
    aplicarRangoInputs(desdeInput, hastaInput, {
      desde: limites.desdeMes,
      hasta: limites.hastaMes,
    });
  }

  function obtenerRangoFechasRA() {
    const limites = limitesFechasRA();
    if (!limites) return { desde: '', hasta: '' };

    const desdeInput = elRA('raFechaDesde');
    const hastaInput = elRA('raFechaHasta');
    // @ts-ignore
    let desde = String(desdeInput?.value || limites.desdeMes);
    // @ts-ignore
    let hasta = String(hastaInput?.value || limites.hastaMes);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) desde = limites.desdeMes;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta)) hasta = limites.hastaMes;
    if (desde > hasta) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }

    return { desde, hasta };
  }

  function expandirRangoFechas(desde, hasta) {
    const out = [];
    if (!desde || !hasta) return out;
    let cursor = new Date(`${desde}T00:00:00Z`);
    const fin = new Date(`${hasta}T00:00:00Z`);
    while (cursor <= fin) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 86400000);
    }
    return out;
  }

  async function cargarBorradoresRA() {
    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || 0);
    if (!anio || !mes) return;

    const sel = elRA('raBorrador');
    if (!sel) return;

    sel.innerHTML = '<option value="">Cargando…</option>';
    try {
      const resp = await fetch(`/api/asignaciones/borradores/${anio}/${mes}`, {
        headers: getHeaders(),
      });
      const data = await resp.json();
      stateRA.borradores = data.borradores || [];
      sel.innerHTML = '';

      stateRA.borradores.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${b.nombre} (v${b.version}) — ${b.estado}`;
        sel.appendChild(opt);
      });

      if (!stateRA.borradores.length) {
        sel.innerHTML = '<option value="">Sin borradores</option>';
        stateRA.borradorId = null;
      } else {
        // @ts-ignore
        sel.value = String(stateRA.borradores[0].id);
        stateRA.borradorId = stateRA.borradores[0].id;
      }
    } catch (_e) {
      sel.innerHTML = '<option value="">Error al cargar</option>';
      stateRA.borradorId = null;
    }
  }

  async function actualizarBorradorVisibilidadRA() {
    // @ts-ignore
    const tipo = elRA('raFuente')?.value || 'definitivo';
    const wrap = elRA('raBorradorWrap');
    if (wrap) wrap.style.display = tipo === 'borrador' ? 'block' : 'none';
    if (tipo === 'borrador') {
      await cargarBorradoresRA();
    } else {
      stateRA.borradorId = null;
    }
    await cargarFechasDisponiblesRA();
  }

  async function generarResumenRA() {
    const container = elRA('raTablaContainer');
    if (!container) return;

    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || 0);
    // @ts-ignore
    const tipo = String(elRA('raFuente')?.value || 'definitivo').toLowerCase();

    if (!anio || !mes) {
      container.innerHTML = '<div class="alert alert-warning">Selecciona año y mes.</div>';
      return;
    }

    let borradorId = null;
    if (tipo === 'borrador') {
      // @ts-ignore
      borradorId = elRA('raBorrador')?.value || null;
      if (!borradorId) {
        container.innerHTML = '<div class="alert alert-warning">Selecciona un borrador.</div>';
        return;
      }
    }

    try {
      container.innerHTML = '<div class="text-center text-muted py-3">Generando tabla…</div>';
      const btn = elRA('btnRaGenerar');
      // @ts-ignore
      if (btn) btn.disabled = true;

      const headers = getHeaders();
      const cuadranteUrl = tipo === 'borrador' && borradorId
        ? `/api/asignaciones/cuadrante/${anio}/${mes}?borrador_id=${encodeURIComponent(String(borradorId))}`
        : `/api/asignaciones/cuadrante/${anio}/${mes}?source=definitivo`;

      const [cuadranteResp, metaResp] = await Promise.all([
        fetch(cuadranteUrl, { headers, cache: 'no-store' }),
        fetch('/api/asignaciones/meta', { headers, cache: 'no-store' }),
      ]);

      if (!cuadranteResp.ok) {
        const err = await cuadranteResp
          .json()
          .catch(() => ({ error: 'Error al cargar cuadrante' }));
        throw new Error(err.error || `HTTP ${cuadranteResp.status}`);
      }
      if (!metaResp.ok) {
        const err = await metaResp
          .json()
          .catch(() => ({ error: 'Error al cargar meta' }));
        throw new Error(err.error || `HTTP ${metaResp.status}`);
      }

      const cuadranteJson = await cuadranteResp.json();
      const metaJson = await metaResp.json();

      const rango = obtenerRangoFechasRA();

      const baseRowsRaw = tipo === 'borrador'
        ? (Array.isArray(cuadranteJson.borrador) ? cuadranteJson.borrador : [])
        : (Array.isArray(cuadranteJson.definitivo) ? cuadranteJson.definitivo : []);
      const baseRows = baseRowsRaw.filter((r) => {
        const fecha = String((r && r.fecha) || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
        return fecha >= rango.desde && fecha <= rango.hasta;
      });
      const rawServicios = tipo === 'borrador'
        ? (Array.isArray(cuadranteJson.borradorServicios) ? cuadranteJson.borradorServicios : [])
        : (Array.isArray(cuadranteJson.definitivoServicios) ? cuadranteJson.definitivoServicios : []);
      const servicioKey = tipo === 'borrador' ? 'asignacion_borrador_id' : 'asignacion_id';

      const serviciosMap = new Map();
      rawServicios.forEach((s) => {
        const k = Number(s[servicioKey]);
        const actId = Number(s.actividad_id);
        if (!k || !actId) return;
        if (!serviciosMap.has(k)) serviciosMap.set(k, []);
        serviciosMap.get(k).push(actId);
      });

      const actividades = Array.isArray(metaJson.actividades)
        ? metaJson.actividades
        : [];
      const actividadMap = new Map();
      actividades.forEach((a) => {
        const id = Number(a.id_actividad || a.id);
        if (!id) return;
        const codigo = String(a.actividad || a.codigo || '').trim();
        const nombre = String(a.nombre || '').trim();
        actividadMap.set(id, codigo && nombre ? `${codigo} - ${nombre}` : codigo || nombre || `Actividad ${id}`);
      });

      const grupos = new Map();
      baseRows.forEach((r) => {
        const peloton = String(r.peloton_codigo || 'Sin pelotón').trim();
        const pelotonNombre = String(
          r.peloton_nombre || r.peloton || r.peloton_codigo || 'Sin pelotón'
        ).trim();
        const fecha = String((r && r.fecha) || '').slice(0, 10);
        const agenteId = Number(r && r.agente_id);
        if (!agenteId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
        const actIdsFromRow = Array.isArray(r.actividad_ids)
          ? r.actividad_ids.map(Number).filter(Boolean)
          : [];
        const actIdsFromServicios = serviciosMap.get(Number(r.id)) || [];
        const actIds = Array.from(
          new Set(actIdsFromRow.length ? actIdsFromRow : actIdsFromServicios)
        );
        if (!actIds.length) return;

        actIds.forEach((actId) => {
          const key = `${peloton}|||${pelotonNombre}|||${fecha}|||${actId}`;
          if (!grupos.has(key)) {
            grupos.set(key, {
              peloton_codigo: peloton,
              peloton_nombre: pelotonNombre,
              fecha,
              actividad_label: actividadMap.get(actId) || `Actividad ${actId}`,
              agentes: new Set(),
            });
          }
          grupos.get(key).agentes.add(agenteId);
        });
      });

      const rows = Array.from(grupos.values()).sort((a, b) => {
        const pc = a.peloton_codigo.localeCompare(b.peloton_codigo, 'es');
        if (pc !== 0) return pc;
        const fc = String(a.fecha || '').localeCompare(String(b.fecha || ''), 'es');
        if (fc !== 0) return fc;
        return a.actividad_label.localeCompare(b.actividad_label, 'es');
      });

      if (!rows.length) {
        container.innerHTML = '<div class="alert alert-info">Sin datos para mostrar.</div>';
        // @ts-ignore
        if (btn) btn.disabled = false;
        return;
      }

      const formatFechaResumen = (iso) => {
        const text = String(iso || '').slice(0, 10);
        const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return text || '—';
        return `${m[3]}/${m[2]}/${m[1]}`;
      };

      // Agrupar por día + actividad
      const actividadesMapa = new Map();
      rows.forEach((row) => {
        const fecha = String(row.fecha || '').slice(0, 10) || '—';
        const actLabel = row.actividad_label || '—';
        const key = `${fecha}|||${actLabel}`;
        if (!actividadesMapa.has(key)) {
          actividadesMapa.set(key, {
            fecha,
            actividad_label: actLabel,
            agentes: new Set(),
          });
        }
        const act = actividadesMapa.get(key);
        if (row.agentes && row.agentes instanceof Set) {
          row.agentes.forEach((a) => act.agentes.add(a));
        }
      });

      const actividadesArray = Array.from(actividadesMapa.values()).sort((a, b) =>
        String(a.fecha || '').localeCompare(String(b.fecha || ''), 'es') ||
        a.actividad_label.localeCompare(b.actividad_label, 'es')
      );

      const totalAgenteGlobal = Array.from(
        new Set(
          rows.reduce((acc, row) => {
            if (row.agentes && row.agentes instanceof Set) {
              row.agentes.forEach((a) => acc.add(a));
            }
            return acc;
          }, new Set())
        )
      ).length;

      let html = '<div class="informes-ra-table-wrap"><table class="table table-sm table-hover" style="font-size:0.85rem"><thead><tr><th style="background:#276836;color:white;text-align:center">Total Agentes</th><th style="background:#3a7d4a;color:white">Día</th><th style="background:#3a7d4a;color:white">Código Actividad</th><th style="background:#3a7d4a;color:white">Descripción Actividad</th><th style="background:#3a7d4a;color:white;text-align:right">Agentes</th></tr></thead><tbody>';

      actividadesArray.forEach((act, index) => {
        html += '<tr>';
        if (index === 0) {
          html += `<td rowspan="${actividadesArray.length}" style="font-weight:bold;vertical-align:middle;background:#f0f5f1;text-align:center;font-size:1.1em">${totalAgenteGlobal}</td>`;
        }
        const actParts = String(act.actividad_label || '').split(' - ');
        const codigo = actParts[0] || '—';
        const descripcion = actParts.slice(1).join(' - ') || '—';
        html += `<td style="vertical-align:middle">${formatFechaResumen(act.fecha)}</td>`;
        html += `<td style="vertical-align:middle">${codigo}</td>`;
        html += `<td style="vertical-align:middle">${descripcion}</td>`;
        html += `<td style="text-align:right;vertical-align:middle;font-weight:bold">${act.agentes.size}</td>`;
        html += '</tr>';
      });

      html += '</tbody></table></div>';
      container.innerHTML = html;

      const btnExcel = elRA('btnRaExcel');
      // @ts-ignore
      if (btnExcel) btnExcel.disabled = false;

      const badge = elRA('raResumenBadge');
      if (badge) {
        badge.textContent = `${rows.length} registros`;
        badge.style.display = 'inline-block';
      }

      // @ts-ignore
      if (btn) btn.disabled = false;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">Error: ${err.message}</div>`;
      const btn = elRA('btnRaGenerar');
      // @ts-ignore
      if (btn) btn.disabled = false;
    }
  }

  async function exportarResumenExcelRA() {
    const btn = elRA('btnRaExcel');
    // @ts-ignore
    if (btn) btn.disabled = true;

    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || 0);
    // @ts-ignore
    const tipo = String(elRA('raFuente')?.value || 'definitivo').toLowerCase();

    let borradorId = null;
    if (tipo === 'borrador') {
      // @ts-ignore
      borradorId = elRA('raBorrador')?.value || null;
    }

    try {
      const params = new URLSearchParams({ anio: String(anio), mes: String(mes) });
      if (tipo === 'borrador' && borradorId) {
        params.set('borrador_id', borradorId);
      } else {
        params.set('source', 'definitivo');
      }
      const rango = obtenerRangoFechasRA();
      const fechas = expandirRangoFechas(rango.desde, rango.hasta);
      if (fechas.length) params.set('fechas', fechas.join(','));

      const resp = await fetch(`/api/asignaciones/resumen-actividades/excel?${params}`, {
        headers: getHeaders(),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const disposition = resp.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
      const fromHeader = match && match[1] ? decodeURIComponent(match[1].replace(/"/g, '')) : '';
      const a = document.createElement('a');
      a.href = url;
      a.download = fromHeader || `resumen-actividades-${anio}-${String(mes).padStart(2, '0')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const errDiv = elRA('raError');
      if (errDiv) {
        errDiv.textContent = `Error al exportar: ${err.message}`;
        errDiv.classList.remove('informes-hidden');
      }
    } finally {
      // @ts-ignore
      if (btn) btn.disabled = false;
    }
  }

  function bindEventosRA() {
    const bindOnce = (id, evt, fn) => {
      const node = elRA(id);
      if (!node) return;
      const key = `bound_${evt}`;
      if (node.dataset[key] === '1') return;
      node.dataset[key] = '1';
      node.addEventListener(evt, fn);
    };

    bindOnce('raFuente', 'change', async () => {
      await cargarPeriodosRA();
      await actualizarBorradorVisibilidadRA();
      sincronizarRangoFechasRA();
    });
    bindOnce('raAnio', 'change', async () => {
      poblarMesRA();
      await actualizarBorradorVisibilidadRA();
      sincronizarRangoFechasRA();
    });
    bindOnce('raMes', 'change', async () => {
      await actualizarBorradorVisibilidadRA();
      sincronizarRangoFechasRA();
    });
    bindOnce('raBorrador', 'change', async () => {
      // @ts-ignore
      stateRA.borradorId = elRA('raBorrador')?.value || null;
      await cargarFechasDisponiblesRA();
    });

    bindOnce('btnRaGenerar', 'click', generarResumenRA);
    bindOnce('btnRaExcel', 'click', exportarResumenExcelRA);

    const accordionEl = document.getElementById('informesResumenActividades');
    if (accordionEl && !accordionEl.dataset.raInitBound) {
      accordionEl.dataset.raInitBound = '1';
      accordionEl.addEventListener('show.bs.collapse', async () => {
        await cargarPeriodosRA(state.anio, state.mes);
        await actualizarBorradorVisibilidadRA();
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AUDITORIA ASIGNACIONES (RAW)
  // ══════════════════════════════════════════════════════════════════════════
  const stateIA = {
    periodos: [],
    anio: null,
    mes: null,
    borradorId: null,
    borradores: [],
    applyFechaCambioFilter: false,
    insights: null,
    logs: [],
    rangoCuadrante: null,
    fechasCuadrante: [],
    actividadLabelById: new Map(),
    timelineTable: null,
    timelineColumnsKey: null,
    agentesTable: null,
    defaultAccionesApplied: false,
    mainFiltersSnapshot: null,
    crossFilters: {
      createdDate: '',
      accion: '',
      usuarioId: null,
      usuarioNombre: '',
      agenteId: null,
      agenteNombre: '',
      fechaCuadrante: '',
    },
  };

  const IA_BASE_ACCIONES = [
    { value: 'BORRADOR_EDITAR', label: 'Edicion en borrador' },
    { value: 'BORRADOR_EDITAR_MASIVO', label: 'Edicion masiva en borrador' },
    { value: 'BORRADOR_CREAR', label: 'Alta en borrador' },
    { value: 'BORRADOR_CREAR_MASIVO', label: 'Alta masiva en borrador' },
  ];
  const IA_BASE_ACCIONES_SET = new Set(IA_BASE_ACCIONES.map((item) => item.value));
  const IA_BASE_ACCIONES_LABEL = new Map(IA_BASE_ACCIONES.map((item) => [item.value, item.label]));

  function elIA(id) {
    return /** @type {any} */ (document.getElementById(id));
  }

  const IA_CHECKLIST_META = {
    iaAgente: {
      toggleId: 'iaAgenteToggle',
      panelId: 'iaAgentePanel',
      listId: 'iaAgenteChecklist',
      countId: 'iaAgenteCount',
      searchId: 'iaAgenteSearch',
      emptyText: 'Sin agentes para mostrar',
      allLabel: 'Todos',
      pluralLabel: 'agentes',
    },
    iaAccion: {
      toggleId: 'iaAccionToggle',
      panelId: 'iaAccionPanel',
      listId: 'iaAccionChecklist',
      countId: 'iaAccionCount',
      searchId: null,
      emptyText: 'Sin movimientos para mostrar',
      allLabel: 'Todos',
      pluralLabel: 'mvtos',
    },
    iaActividad: {
      toggleId: 'iaActividadToggle',
      panelId: 'iaActividadPanel',
      listId: 'iaActividadChecklist',
      countId: 'iaActividadCount',
      searchId: 'iaActividadSearch',
      emptyText: 'Sin actividades para mostrar',
      allLabel: 'Todas',
      pluralLabel: 'actividades',
    },
  };

  function closeAllIaChecklistPanels(exceptSelectId) {
    Object.keys(IA_CHECKLIST_META).forEach((selectId) => {
      if (exceptSelectId && selectId === exceptSelectId) return;
      const meta = IA_CHECKLIST_META[selectId];
      const panel = elIA(meta.panelId);
      const toggle = elIA(meta.toggleId);
      if (panel) panel.classList.add('d-none');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  function updateIaChecklistCount(selectId) {
    const meta = IA_CHECKLIST_META[selectId];
    const sel = /** @type {any} */ (elIA(selectId));
    const countEl = meta ? elIA(meta.countId) : null;
    if (!meta || !sel || !countEl) return;

    const entries = Array.from(sel.options || []).filter((opt) => String(opt.value || '').trim());
    const selectedCount = entries.filter((opt) => !!opt.selected).length;
    countEl.textContent = selectedCount
      ? `${selectedCount} ${meta.pluralLabel}`
      : meta.allLabel;
  }

  function renderIaChecklist(selectId) {
    const meta = IA_CHECKLIST_META[selectId];
    const sel = /** @type {any} */ (elIA(selectId));
    const listEl = meta ? elIA(meta.listId) : null;
    if (!meta || !sel || !listEl) return;

    const searchInput = meta.searchId ? elIA(meta.searchId) : null;
    const term = String(searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();
    const entries = Array.from(sel.options || [])
      .map((opt, idx) => ({ opt, idx }))
      .filter((entry) => String(entry.opt && entry.opt.value ? entry.opt.value : '').trim())
      .filter((entry) => {
        if (!term) return true;
        const text = String(entry.opt && entry.opt.textContent ? entry.opt.textContent : '').toLowerCase();
        return text.includes(term);
      });

    if (!entries.length) {
      listEl.innerHTML = `<div class="ia-checklist-empty">${app.escapeHtml(meta.emptyText)}</div>`;
      updateIaChecklistCount(selectId);
      return;
    }

    listEl.innerHTML = entries
      .map((entry) => {
        const text = String(entry.opt && entry.opt.textContent ? entry.opt.textContent : '').trim() || '-';
        return (
          '<label class="ia-checklist-item">' +
          `<input type="checkbox" class="form-check-input ia-checklist-chk" data-select-id="${app.escapeHtml(selectId)}" data-option-idx="${entry.idx}"${entry.opt.selected ? ' checked' : ''}>` +
          `<span>${app.escapeHtml(text)}</span>` +
          '</label>'
        );
      })
      .join('');

    updateIaChecklistCount(selectId);
  }

  function renderAllIaChecklists() {
    Object.keys(IA_CHECKLIST_META).forEach((selectId) => renderIaChecklist(selectId));
  }

  function getSelectedValuesFromSelect(selectId) {
    // @ts-ignore
    return Array.from(elIA(selectId)?.selectedOptions || [])
      .map((opt) => String(opt && opt.value ? opt.value : '').trim())
      .filter(Boolean);
  }

  function setSelectedValuesToSelect(selectId, values) {
    const sel = /** @type {any} */ (elIA(selectId));
    if (!sel) return;
    const wanted = new Set((Array.isArray(values) ? values : []).map((v) => String(v).trim()).filter(Boolean));
    // @ts-ignore
    Array.from(sel.options || []).forEach((opt) => {
      const value = String(opt && opt.value ? opt.value : '').trim();
      opt.selected = wanted.has(value);
    });
  }

  function captureIaMainFiltersSnapshot() {
    stateIA.mainFiltersSnapshot = {
      usuarioId: String(elIA('iaUsuario')?.value || ''),
      agenteIds: getSelectedValuesFromSelect('iaAgente'),
      acciones: getSelectedValuesFromSelect('iaAccion'),
      actividadIds: getSelectedValuesFromSelect('iaActividad'),
      from: String(elIA('iaFechaDesde')?.value || '').trim(),
      to: String(elIA('iaFechaHasta')?.value || '').trim(),
    };
  }

  function restoreIaMainFiltersSnapshot() {
    const snap = stateIA.mainFiltersSnapshot;
    if (!snap) return;

    const usuarioSel = /** @type {any} */ (elIA('iaUsuario'));
    if (usuarioSel) {
      usuarioSel.value = String(snap.usuarioId || '');
    }
    setSelectedValuesToSelect('iaAgente', snap.agenteIds || []);
    setSelectedValuesToSelect('iaAccion', snap.acciones || []);
    setSelectedValuesToSelect('iaActividad', snap.actividadIds || []);

    const from = /** @type {any} */ (elIA('iaFechaDesde'));
    const to = /** @type {any} */ (elIA('iaFechaHasta'));
    const fromVal = String(snap.from || '').trim();
    const toVal = String(snap.to || '').trim();
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(fromVal)) {
      from.value = fromVal;
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(toVal)) {
      to.value = toVal;
    }

    renderAllIaChecklists();
  }

  function initIaChecklistUi() {
    if (stateIA.checklistUiReady) return;
    stateIA.checklistUiReady = true;

    Object.keys(IA_CHECKLIST_META).forEach((selectId) => {
      const meta = IA_CHECKLIST_META[selectId];
      const toggle = elIA(meta.toggleId);
      const panel = elIA(meta.panelId);
      const listEl = elIA(meta.listId);
      const searchInput = meta.searchId ? elIA(meta.searchId) : null;
      const sel = /** @type {any} */ (elIA(selectId));
      if (!toggle || !panel || !listEl || !sel) return;

      toggle.addEventListener('click', (ev) => {
        ev.preventDefault();
        const willOpen = panel.classList.contains('d-none');
        closeAllIaChecklistPanels(willOpen ? selectId : null);
        panel.classList.toggle('d-none', !willOpen);
        toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (willOpen && searchInput) {
          searchInput.focus();
        }
      });

      listEl.addEventListener('change', (ev) => {
        const target = /** @type {any} */ (ev.target);
        if (!target || !target.classList || !target.classList.contains('ia-checklist-chk')) return;
        const idx = Number(target.dataset.optionIdx || -1);
        if (!Number.isInteger(idx) || idx < 0 || idx >= sel.options.length) return;
        sel.options[idx].selected = !!target.checked;
        updateIaChecklistCount(selectId);
        setIaPendingNotice(true);
      });

      if (searchInput) {
        searchInput.addEventListener('input', () => renderIaChecklist(selectId));
      }
    });

    document.addEventListener('click', (ev) => {
      const target = /** @type {any} */ (ev.target);
      if (!target || typeof target.closest !== 'function') return;
      if (target.closest('#informesAuditoriaAsignaciones .ia-checklist-picker')) return;
      closeAllIaChecklistPanels(null);
    });

    renderAllIaChecklists();
  }

  function setIaError(msg) {
    const err = elIA('iaError');
    if (!err) return;
    if (msg) {
      err.textContent = String(msg);
      err.classList.remove('informes-hidden');
      return;
    }
    err.textContent = '';
    err.classList.add('informes-hidden');
  }

  function setIaLoading(visible, message) {
    const loading = elIA('iaLoading');
    const label = elIA('iaLoadingLabel');
    const btnConsultar = elIA('btnIaConsultar');
    const btnLimpiar = elIA('btnIaLimpiar');

    if (label && message) {
      label.textContent = String(message);
    }

    if (loading) {
      loading.classList.toggle('informes-hidden', !visible);
      loading.setAttribute('aria-busy', visible ? 'true' : 'false');
    }

    if (btnConsultar) {
      // @ts-ignore
      btnConsultar.disabled = !!visible;
    }
    if (btnLimpiar) {
      // @ts-ignore
      btnLimpiar.disabled = !!visible;
    }
  }

  function setIaPendingNotice(visible) {
    const notice = elIA('iaPendingNotice');
    if (!notice) return;
    notice.classList.toggle('informes-hidden', !visible);
  }

  function resetIaKpis() {
    const ids = [
      'iaKpiVolatilidad',
      'iaKpiVolatilidadEstado',
      'iaKpiCambiosEfectivos',
      'iaKpiCambiosEfectivosSub',
      'iaKpiRetrabajo',
      'iaKpiRetrabajoSub',
      'iaKpiCambiosTardios',
      'iaKpiCambiosTardiosSub',
    ];
    ids.forEach((id) => {
      const node = elIA(id);
      if (!node) return;
      node.textContent = '-';
      node.style.color = '';
    });
  }

  function resetIaChartsAndTable() {
    disposeIaChart('linea');
    disposeIaChart('usuarios');
    disposeIaChart('agentes');

    const chartLinea = elIA('iaChartLinea');
    const chartUsuarios = elIA('iaChartUsuarios');
    const chartHeatmap = elIA('iaChartHeatmap');
    if (chartLinea) chartLinea.innerHTML = '';
    if (chartUsuarios) chartUsuarios.innerHTML = '';
    if (stateIA.agentesTable && typeof stateIA.agentesTable.destroy === 'function') {
      try {
        stateIA.agentesTable.destroy();
      } catch (_e) {
        // noop
      }
      stateIA.agentesTable = null;
    }
    if (chartHeatmap) chartHeatmap.innerHTML = '';

    const container = elIA('iaTablaContainer');
    if (stateIA.timelineTable && typeof stateIA.timelineTable.destroy === 'function') {
      try {
        stateIA.timelineTable.destroy();
      } catch (_e) {
        // noop
      }
      stateIA.timelineTable = null;
      stateIA.timelineColumnsKey = null;
    }
    if (container) {
      container.innerHTML = '<div class="informes-audit-placeholder">Configura los filtros y pulsa <strong>Consultar</strong> para refrescar resultados.</div>';
    }
  }

  function clearIaDependentFilters() {
    const usuarioSel = /** @type {any} */ (elIA('iaUsuario'));
    if (usuarioSel) {
      usuarioSel.innerHTML = '<option value="">Todos los usuarios</option>';
      usuarioSel.value = '';
    }

    const clearMulti = (id) => {
      const sel = /** @type {any} */ (elIA(id));
      if (!sel) return;
      sel.innerHTML = '';
    };
    clearMulti('iaAgente');
    clearMulti('iaActividad');

    stateIA.defaultAccionesApplied = false;
    hydrateIaAccionesOptions();

    renderIaChecklist('iaAgente');
    renderIaChecklist('iaActividad');
  }

  function invalidateIaConsultaState(options) {
    const opts = options || {};
    const resetFilters = !!opts.resetFilters;
    if (resetFilters) {
      clearIaDependentFilters();
    }

    stateIA.insights = null;
    stateIA.logs = [];
    stateIA._baseLogsForView = [];
    stateIA.mainFiltersSnapshot = null;
    stateIA.actividadLabelById = new Map();

    clearIaCrossFilters();
    resetIaKpis();
    resetIaChartsAndTable();
    setIaPendingNotice(true);
  }

  function fmtNum(value) {
    return Number(value || 0).toLocaleString('es-ES');
  }

  function fmtDate(value, withTime) {
    if (!value) return '-';
    const dt = new Date(String(value));
    if (Number.isNaN(dt.getTime())) return String(value);
    return withTime ? dt.toLocaleString('es-ES') : dt.toLocaleDateString('es-ES');
  }

  function actualizarEtiquetasFechaIA() {
    const labelDesde = elIA('iaFechaDesde')?.closest('.informes-filter-group')?.querySelector('label');
    const labelHasta = elIA('iaFechaHasta')?.closest('.informes-filter-group')?.querySelector('label');
    if (labelDesde) {
      labelDesde.textContent = 'Fecha cuadrante desde';
    }
    if (labelHasta) {
      labelHasta.textContent = 'Fecha cuadrante hasta';
    }
  }

  function toIsoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parts = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!parts) return '';
    return `${parts[3]}-${parts[2]}-${parts[1]}`;
  }

  function resolveIaDayKey(row) {
    const keyRaw = String(row && row.historial_day_key ? row.historial_day_key : '').trim();
    const fechaRaw = String(row && row.fecha ? row.fecha : '').trim();
    const keyIso = /^\d{4}-\d{2}-\d{2}$/.test(keyRaw) ? keyRaw : '';
    const fechaIso = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? fechaRaw : '';
    if (keyIso) return keyIso;
    if (fechaIso) return fechaIso;
    return '__SIN_FECHA_MASIVO__';
  }

  function fmtPct(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${n.toLocaleString('es-ES', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}%`;
  }

  function classifyIaVolatilidad(pct) {
    const value = Number(pct);
    if (!Number.isFinite(value)) {
      return {
        label: 'Sin base de asignaciones',
        color: '#6c757d',
      };
    }
   
    if (value < 5) {
      return { label: 'Muy estable', color: '#198754' };
    }
    if (value < 15) {
      return { label: 'Normal', color: '#a97800' };
    }
    if (value < 30) {
      return { label: 'Alta variabilidad', color: '#d17a00' };
    }
    return { label: 'Muy inestable', color: '#dc3545' };
  }

  function computeIaTimelineDerivedKpis(logs) {
    const list = Array.isArray(logs) ? logs : [];
    let cambiosTardios = 0;
    let comparablesTardios = 0;

    list.forEach((row) => {
      const dayKey = resolveIaDayKey(row);
      const fechaCuadrante = /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey : '';
      const fechaCambio = String(row && row.created_at ? row.created_at : '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(fechaCuadrante) && /^\d{4}-\d{2}-\d{2}$/.test(fechaCambio)) {
        comparablesTardios += 1;
        if (fechaCuadrante < fechaCambio) cambiosTardios += 1;
      }
    });

    const tardiosPct = comparablesTardios > 0 ? (cambiosTardios * 100) / comparablesTardios : 0;

    return {
      cambiosTardios,
      comparablesTardios,
      tardiosPct,
    };
  }

  function renderIaAdvancedKpis(metrics) {
    const m = metrics || {};
    const vol = classifyIaVolatilidad(m.volatilidad);

    const kpiVol = elIA('iaKpiVolatilidad');
    const kpiVolSub = elIA('iaKpiVolatilidadEstado');
    const kpiCambios = elIA('iaKpiCambiosEfectivos');
    const kpiCambiosSub = elIA('iaKpiCambiosEfectivosSub');
    const kpiRetrabajo = elIA('iaKpiRetrabajo');
    const kpiRetrabajoSub = elIA('iaKpiRetrabajoSub');
    const kpiTardios = elIA('iaKpiCambiosTardios');
    const kpiTardiosSub = elIA('iaKpiCambiosTardiosSub');

    if (kpiVol) {
      kpiVol.textContent = fmtPct(m.volatilidad, 1);
      kpiVol.style.color = vol.color;
    }
    if (kpiVolSub) {
      kpiVolSub.textContent = `${vol.label} · Base: ${fmtNum(m.baseAsignaciones || 0)}`;
      kpiVolSub.style.color = vol.color;
    }

    if (kpiCambios) {
      kpiCambios.textContent = fmtNum(m.cambiosEfectivos || 0);
      kpiCambios.style.color = '#1f3f2a';
    }
    if (kpiCambiosSub) {
      kpiCambiosSub.textContent = `Base cuadrante: ${fmtNum(m.baseAsignaciones || 0)} celdas (${fmtPct(m.volatilidad, 1)})`;
      kpiCambiosSub.style.color = '#6c757d';
    }

    if (kpiRetrabajo) {
      kpiRetrabajo.textContent = fmtPct(m.retrabajoPct, 1);
      kpiRetrabajo.style.color = Number(m.retrabajoPct || 0) >= 30 ? '#d17a00' : '#1f3f2a';
    }
    if (kpiRetrabajoSub) {
      kpiRetrabajoSub.textContent = `${fmtNum(m.retrabajosAdicionales || 0)} extras en ${fmtNum(m.slotsConRetrabajo || 0)} slots (${fmtNum(m.slotsTocados || 0)} slots totales)`;
      kpiRetrabajoSub.style.color = '#6c757d';
    }

    if (kpiTardios) {
      kpiTardios.textContent = fmtPct(m.tardiosPct, 1);
      kpiTardios.style.color = Number(m.tardiosPct || 0) > 0 ? '#dc3545' : '#1f3f2a';
    }
    if (kpiTardiosSub) {
      kpiTardiosSub.textContent = `${fmtNum(m.cambiosTardios || 0)} tardíos de ${fmtNum(m.comparablesTardios || 0)} comparables`;
      kpiTardiosSub.style.color = '#6c757d';
    }
  }

  function buildIaCuadranteUrl(filters) {
    const f = filters || {};
    const anio = Number(f.anio || 0);
    const mes = Number(f.mes || 0);
    const source = String(f.source || 'definitivo').toLowerCase();
    const borradorId = String(f.borradorId || '').trim();
    let url = `/api/asignaciones/cuadrante/${anio}/${mes}`;
    if (source === 'borrador' && borradorId) {
      url += `?borrador_id=${encodeURIComponent(borradorId)}`;
    } else {
      url += '?source=definitivo';
    }
    return url;
  }

  async function fetchIaAsignacionesExistentes(filters) {
    const f = filters || {};
    const resp = await fetch(buildIaCuadranteUrl(f), {
      headers: getHeaders(),
      cache: 'no-store',
    });
    if (!resp.ok) {
      throw new Error('No se pudo cargar el cuadrante para KPI de volatilidad');
    }
    const json = await resp.json();
    const source = String(f.source || 'definitivo').toLowerCase();
    const rows = source === 'borrador'
      ? (Array.isArray(json && json.borrador) ? json.borrador : [])
      : (Array.isArray(json && json.definitivo) ? json.definitivo : []);

    const from = String(f.from || '').trim();
    const to = String(f.to || '').trim();
    const hasRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
    const min = hasRange ? (from <= to ? from : to) : '';
    const max = hasRange ? (from <= to ? to : from) : '';
    const agenteSet = new Set(
      (Array.isArray(f.agenteIds) ? f.agenteIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    );

    return rows.filter((row) => {
      const fecha = String(row && row.fecha ? row.fecha : '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
      if (hasRange && (fecha < min || fecha > max)) return false;
      if (agenteSet.size) {
        const agenteId = Number(row && row.agente_id ? row.agente_id : 0);
        if (!agenteSet.has(agenteId)) return false;
      }
      return true;
    }).length;
  }


  function renderIaCrossFiltersStatus() {
    const statusEl = elIA('iaCrossFiltersCurrent');
    const clearBtn = elIA('btnIaCrossFiltersClear');
    const f = /** @type {any} */ (stateIA.crossFilters || {});
    const parts = [];

    if (f.createdDate) parts.push(`Fecha cuadrante: ${fmtDate(f.createdDate, false)}`);
    if (f.accion) {
      parts.push(`Movimiento: ${String(IA_BASE_ACCIONES_LABEL.get(f.accion) || f.accion)}`);
    }
    if (f.usuarioId) {
      parts.push(`Usuario: #${f.usuarioId}`);
    } else if (f.usuarioNombre) {
      parts.push(`Usuario: ${f.usuarioNombre}`);
    }
    if (f.agenteNombre) {
      parts.push(`Agente: ${f.agenteNombre}`);
    } else if (f.agenteId) {
      parts.push(`Agente: #${f.agenteId}`);
    }
    if (f.fechaCuadrante) {
      parts.push(
        `Fecha cuadrante: ${
          f.fechaCuadrante === '__SIN_FECHA_MASIVO__'
            ? 'Sin fecha (masivo)'
            : fmtDate(f.fechaCuadrante, false)
        }`
      );
    }

    if (statusEl) {
      statusEl.textContent = parts.length
        ? `Filtro gráfico activo · ${parts.join(' · ')}`
        : 'Sin filtro cruzado desde gráficos.';
    }
    if (clearBtn) {
      // @ts-ignore
      clearBtn.disabled = parts.length === 0;
    }
  }

  function clearIaCrossFilters() {
    stateIA.crossFilters = {
      createdDate: '',
      accion: '',
      usuarioId: null,
      usuarioNombre: '',
      agenteId: null,
      agenteNombre: '',
      fechaCuadrante: '',
    };
    renderIaCrossFiltersStatus();
  }

  function getIaFilteredLogs(options) {
    const opts = options || {};
    const ignoreAgentFilter = !!opts.ignoreAgentFilter;
    const logs = Array.isArray(stateIA._baseLogsForView)
      ? stateIA._baseLogsForView
      : (Array.isArray(stateIA.logs) ? stateIA.logs : []);
    const f = /** @type {any} */ (stateIA.crossFilters || {});
    return logs.filter((row) => {
      if (f.createdDate) {
        const dayKey = resolveIaDayKey(row);
        if (dayKey !== f.createdDate) return false;
      }
      if (f.accion) {
        const accion = String(row && row.accion ? row.accion : '').trim();
        if (accion !== String(f.accion)) return false;
      }
      if (f.usuarioId && Number(row && row.usuario_id ? row.usuario_id : 0) !== Number(f.usuarioId)) {
        return false;
      }
      if (!f.usuarioId && f.usuarioNombre) {
        const usuarioNombre = String(row && row.usuario_nombre ? row.usuario_nombre : '').trim();
        if (usuarioNombre !== String(f.usuarioNombre)) return false;
      }
      if (!ignoreAgentFilter && f.agenteId && Number(row && row.agente_id ? row.agente_id : 0) !== Number(f.agenteId)) {
        return false;
      }
      if (f.fechaCuadrante) {
        const dayKey = resolveIaDayKey(row);
        if (dayKey !== String(f.fechaCuadrante)) return false;
      }
      return true;
    });
  }

  function getIaBaseLogsByFechaInputs() {
    const logs = Array.isArray(stateIA.logs) ? stateIA.logs : [];
    const from = String(elIA('iaFechaDesde')?.value || '').trim();
    const to = String(elIA('iaFechaHasta')?.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return logs;
    }

    const min = from <= to ? from : to;
    const max = from <= to ? to : from;
    return logs.filter((row) => {
      const dayKey = resolveIaDayKey(row);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return false;
      return dayKey >= min && dayKey <= max;
    });
  }

  function buildIaUsersFromLogs(logs) {
    const map = new Map();
    (Array.isArray(logs) ? logs : []).forEach((row) => {
      const usuarioId = Number(row && row.usuario_id ? row.usuario_id : 0) || null;
      const usuarioNombre = String(row && row.usuario_nombre ? row.usuario_nombre : '-').trim() || '-';
      const key = usuarioId ? `id:${usuarioId}` : `name:${usuarioNombre}`;
      if (!map.has(key)) {
        map.set(key, { usuario_id: usuarioId, usuario_nombre: usuarioNombre, cambios: 0 });
      }
      map.get(key).cambios += 1;
    });
    return Array.from(map.values()).sort((a, b) => Number(b.cambios || 0) - Number(a.cambios || 0));
  }

  function buildIaAgentRankingFromLogs(logs) {
    const map = new Map();
    (Array.isArray(logs) ? logs : []).forEach((row) => {
      const agenteId = Number(row && row.agente_id ? row.agente_id : 0) || null;
      const agenteTip = String(row && row.agente_tip ? row.agente_tip : '').trim();
      const agenteNombre = [row && row.agente_apellido1, row && row.agente_apellido2, row && row.agente_nombre]
        .filter(Boolean)
        .join(' ')
        .trim() || (agenteId ? `Agente #${agenteId}` : '-');
      const key = agenteId ? `id:${agenteId}` : `name:${agenteNombre}`;
      if (!map.has(key)) {
        map.set(key, {
          agente_id: agenteId,
          agente_tip: agenteTip,
          agente_nombre: agenteNombre,
          cambios: 0,
        });
      }
      map.get(key).cambios += 1;
    });
    return Array.from(map.values()).sort((a, b) => {
      const byCount = Number(b.cambios || 0) - Number(a.cambios || 0);
      if (byCount !== 0) return byCount;
      return String(a.agente_nombre || '').localeCompare(String(b.agente_nombre || ''), 'es', {
        sensitivity: 'base',
      });
    });
  }

  function extractIaActividadIdsFromLog(row, mode) {
    const after = row && row.datos_nuevos && Array.isArray(row.datos_nuevos.actividad_ids)
      ? row.datos_nuevos.actividad_ids
      : [];
    const before = row && row.datos_anteriores && Array.isArray(row.datos_anteriores.actividad_ids)
      ? row.datos_anteriores.actividad_ids
      : [];
    const source = mode === 'before'
      ? before
      : mode === 'after'
        ? after
        : after.concat(before);
    return Array.from(
      new Set(
        source
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
  }

  function renderIaSincronizado() {
    const baseLogs = getIaBaseLogsByFechaInputs();
    stateIA._baseLogsForView = baseLogs;
    const filteredLogs = getIaFilteredLogs();
    const rankingLogs = getIaFilteredLogs({ ignoreAgentFilter: true });

    renderIaLineChart(buildIaLineaCambiosDiaFromLogs(baseLogs));
    renderIaUsersChart(buildIaUsersFromLogs(filteredLogs));
    renderIaAgentRankingTable(buildIaAgentRankingFromLogs(rankingLogs));
    renderIaTableByView(filteredLogs);
  }

  function syncIaDetailViews() {
    const baseLogs = getIaBaseLogsByFechaInputs();
    stateIA._baseLogsForView = baseLogs;
    const filteredLogs = getIaFilteredLogs();
    const rankingLogs = getIaFilteredLogs({ ignoreAgentFilter: true });
    renderIaUsersChart(buildIaUsersFromLogs(filteredLogs));
    renderIaAgentRankingTable(buildIaAgentRankingFromLogs(rankingLogs));
    renderIaTableByView(filteredLogs);
  }

  function setIaAgentSelection(agentId) {
    const sel = elIA('iaAgente');
    if (!sel) return;
    const target = String(agentId || '').trim();
    const values = target ? new Set([target]) : new Set();
    // @ts-ignore
    Array.from(sel.options || []).forEach((opt) => {
      opt.selected = values.has(String(opt.value || ''));
    });
    renderIaChecklist('iaAgente');
  }

  async function cargarPeriodosIA(preferredAnio, preferredMes) {
    // @ts-ignore
    const source = String(elIA('iaFuente')?.value || 'definitivo').toLowerCase();
    try {
      const resp = await fetch(
        `/api/asignaciones/periodos-disponibles?source=${encodeURIComponent(source)}`,
        { headers: getHeaders(), cache: 'no-store' }
      );
      if (!resp.ok) throw new Error('No se pudieron cargar periodos de auditoría');
      const json = await resp.json();
      stateIA.periodos = buildPeriodos(
        Array.isArray(json.periodos) ? json.periodos : []
      );
    } catch (_err) {
      stateIA.periodos = [];
    }

    const anioSel = elIA('iaAnio');
    const mesSel = elIA('iaMes');
    if (!anioSel || !mesSel) return;

    if (!stateIA.periodos.length) {
      anioSel.innerHTML = '<option value="">Sin años</option>';
      mesSel.innerHTML = '<option value="">Sin meses</option>';
      return;
    }

    anioSel.innerHTML = stateIA.periodos
      .map((p) => `<option value="${p.anio}">${p.anio}</option>`)
      .join('');
    const anios = stateIA.periodos.map((p) => p.anio);
    const anio = anios.includes(Number(preferredAnio))
      ? Number(preferredAnio)
      : anios[0];
    // @ts-ignore
    anioSel.value = String(anio);
    stateIA.anio = anio;

    const period = stateIA.periodos.find((p) => p.anio === anio);
    const meses = (period && period.meses) || [];
    mesSel.innerHTML = meses
      .map((m) => `<option value="${m}">${MESES[m - 1] || m}</option>`)
      .join('');
    const mes = meses.includes(Number(preferredMes))
      ? Number(preferredMes)
      : meses[meses.length - 1];
    // @ts-ignore
    mesSel.value = String(mes);
    stateIA.mes = mes;

  }

  function sincronizarRangoIA() {
    const from = elIA('iaFechaDesde');
    const to = elIA('iaFechaHasta');
    // @ts-ignore
    const anio = Number(elIA('iaAnio')?.value || stateIA.anio || 0);
    // @ts-ignore
    const mes = Number(elIA('iaMes')?.value || stateIA.mes || 0);
    if (!from || !to || !anio || !mes) return;

    const limiteRango = stateIA.rangoCuadrante && stateIA.rangoCuadrante.desde && stateIA.rangoCuadrante.hasta
      ? stateIA.rangoCuadrante
      : (function () {
          const y = Number(anio);
          const m = Number(mes);
          if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
          const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
          return {
            desde: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`,
            hasta: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`,
          };
        })();
    if (!limiteRango) return;
    aplicarRangoInputs(from, to, {
      desde: String(limiteRango.desde || '').slice(0, 10),
      hasta: String(limiteRango.hasta || '').slice(0, 10),
    });
  }

  async function cargarBorradoresIA() {
    // @ts-ignore
    const anio = Number(elIA('iaAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elIA('iaMes')?.value || 0);
    const sel = elIA('iaBorrador');
    if (!anio || !mes || !sel) return;

    sel.innerHTML = '<option value="">Cargando…</option>';
    try {
      const resp = await fetch(`/api/asignaciones/borradores/${anio}/${mes}`, {
        headers: getHeaders(),
      });
      const data = await resp.json();
      stateIA.borradores = Array.isArray(data.borradores) ? data.borradores : [];
      if (!stateIA.borradores.length) {
        sel.innerHTML = '<option value="">Sin borradores</option>';
        stateIA.borradorId = null;
        return;
      }
      sel.innerHTML = stateIA.borradores
        .map((b) => `<option value="${b.id}">${b.nombre} (v${b.version}) — ${b.estado}</option>`)
        .join('');
      // @ts-ignore
      sel.value = String(stateIA.borradores[0].id);
      stateIA.borradorId = Number(stateIA.borradores[0].id);
    } catch (_err) {
      sel.innerHTML = '<option value="">Error al cargar</option>';
      stateIA.borradorId = null;
    }
  }

  async function actualizarVisibilidadBorradorIA() {
    // @ts-ignore
    const source = String(elIA('iaFuente')?.value || 'definitivo').toLowerCase();
    const wrap = elIA('iaBorradorWrap');
    if (wrap) wrap.style.display = source === 'borrador' ? 'block' : 'none';
    if (source === 'borrador') {
      await cargarBorradoresIA();
      return;
    }
    stateIA.borradorId = null;
  }

  async function refrescarPeriodoYRangoIA(preferredAnio, preferredMes) {
    await cargarPeriodosIA(preferredAnio, preferredMes);
    await actualizarVisibilidadBorradorIA();

    const source = String(elIA('iaFuente')?.value || 'definitivo').toLowerCase();
    // @ts-ignore
    const anio = Number(elIA('iaAnio')?.value || stateIA.anio || 0);
    // @ts-ignore
    const mes = Number(elIA('iaMes')?.value || stateIA.mes || 0);
    // @ts-ignore
    const borradorId = source === 'borrador' ? (Number(elIA('iaBorrador')?.value || 0) || null) : null;
    stateIA.borradorId = borradorId;

    if (!anio || !mes) {
      stateIA.rangoCuadrante = null;
      stateIA.fechasCuadrante = [];
      sincronizarRangoIA();
      return;
    }

    stateIA.rangoCuadrante = await obtenerRangoCuadrante(anio, mes, borradorId);
    stateIA.fechasCuadrante = Array.isArray(stateIA.rangoCuadrante && stateIA.rangoCuadrante.fechas)
      ? stateIA.rangoCuadrante.fechas
      : [];
    sincronizarRangoIA();
  }

  function getIaFilters() {
    // @ts-ignore
    const anio = Number(elIA('iaAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elIA('iaMes')?.value || 0);
    // @ts-ignore
    const source = String(elIA('iaFuente')?.value || 'definitivo').toLowerCase();
    // @ts-ignore
    const borradorId = source === 'borrador' ? String(elIA('iaBorrador')?.value || '') : '';
    // @ts-ignore
    const usuarioId = String(elIA('iaUsuario')?.value || '');
    // @ts-ignore
    const agenteIds = Array.from(elIA('iaAgente')?.selectedOptions || [])
      .map((opt) => Number(String(opt && opt.value ? opt.value : '').trim()))
      .filter((id) => Number.isInteger(id) && id > 0);
    const agenteId = agenteIds.length === 1 ? String(agenteIds[0]) : '';
    // @ts-ignore
    const acciones = Array.from(elIA('iaAccion')?.selectedOptions || [])
      .map((opt) => String(opt && opt.value ? opt.value : '').trim())
      .filter((value) => value && IA_BASE_ACCIONES_SET.has(value));
    // @ts-ignore
    const actividadIds = Array.from(elIA('iaActividad')?.selectedOptions || [])
      .map((opt) => Number(String(opt && opt.value ? opt.value : '').trim()))
      .filter((id) => Number.isInteger(id) && id > 0);
    const actividadId = actividadIds.length === 1 ? String(actividadIds[0]) : '';
    // @ts-ignore
    const from = String(elIA('iaFechaDesde')?.value || '');
    // @ts-ignore
    const to = String(elIA('iaFechaHasta')?.value || '');

    let accionesFinal = acciones;
    if (!accionesFinal.length && !stateIA.defaultAccionesApplied) {
      accionesFinal = ['BORRADOR_EDITAR', 'BORRADOR_EDITAR_MASIVO'];
    }

    return {
      anio,
      mes,
      source,
      borradorId,
      usuarioId,
      agenteIds,
      agenteId,
      acciones: accionesFinal,
      actividadIds,
      actividadId,
      from,
      to,
    };
  }

  function buildIaQueryString(includeLogs, filtersOverride) {
    const f = filtersOverride || getIaFilters();
    const params = new URLSearchParams({
      anio: String(f.anio || ''),
      mes: String(f.mes || ''),
      modo: 'raw',
      estado_comunicado: 'todos',
    });
    if (f.source === 'borrador' && f.borradorId) params.set('borrador_id', f.borradorId);
    if (f.usuarioId) params.set('usuario_id', f.usuarioId);
    if (Array.isArray(f.agenteIds) && f.agenteIds.length > 1) {
      params.set('agente_ids', f.agenteIds.join(','));
    } else if (f.agenteId) {
      params.set('agente_id', f.agenteId);
    }
    if (Array.isArray(f.acciones) && f.acciones.length) {
      params.set('acciones', f.acciones.join(','));
    }
    if (Array.isArray(f.actividadIds) && f.actividadIds.length > 1) {
      params.set('actividad_ids', f.actividadIds.join(','));
    } else if (f.actividadId) {
      params.set('actividad_id', f.actividadId);
    }
    if (stateIA.applyFechaCambioFilter && f.from && f.to) {
      const baseFechas = Array.isArray(stateIA.fechasCuadrante) && stateIA.fechasCuadrante.length
        ? stateIA.fechasCuadrante
        : expandirRangoFechas(f.from, f.to);
      const fechas = baseFechas.filter((iso) => iso >= f.from && iso <= f.to);
      if (fechas.length) {
        params.set('fechas_cuadrante', fechas.join(','));
      }
    }
    if (!includeLogs) {
      params.set('include_logs', '0');
      params.set('top_usuarios', '12');
      params.set('top_agentes_heatmap', '40');
    }
    return params.toString();
  }

  function hydrateIaFiltersFromInsights(insights) {
    const filtros = (insights && insights.filtros) || {};
    stateIA.actividadLabelById = new Map(
      (Array.isArray(filtros.actividades) ? filtros.actividades : [])
        .map((row) => [
          Number(row && row.actividad_id ? row.actividad_id : 0),
          String(row && row.actividad_label ? row.actividad_label : '').trim(),
        ])
        .filter((entry) => Number.isInteger(entry[0]) && entry[0] > 0)
    );

    hydrateIaSelectOptions('iaUsuario', filtros.usuarios || [], 'usuario_id', 'usuario_nombre', 'Todos los usuarios');
    hydrateIaSelectOptions(
      'iaAgente',
      (Array.isArray(filtros.agentes) ? filtros.agentes : []).map((row) => ({
        ...row,
        agente_label: [
          String(row && row.agente_tip ? row.agente_tip : '').trim(),
          String(row && row.agente_nombre ? row.agente_nombre : '').trim(),
        ].filter(Boolean).join(' · ') || String(row && row.agente_nombre ? row.agente_nombre : '').trim(),
      })),
      'agente_id',
      'agente_label',
      'Todos los agentes'
    );
    hydrateIaSelectOptions('iaActividad', filtros.actividades || [], 'actividad_id', 'actividad_label', 'Todas las actividades');
    hydrateIaAccionesOptions();
  }

  function ensureIaChartRegistry() {
    if (!app._informesAuditCharts) {
      app._informesAuditCharts = {};
    }
    return app._informesAuditCharts;
  }

  function disposeIaChart(key) {
    const registry = ensureIaChartRegistry();
    if (!registry[key]) return;
    try {
      registry[key].dispose();
    } catch (_e) {
      // noop
    }
    registry[key] = null;
  }

  function renderIaLineChart(data) {
    const el = elIA('iaChartLinea');
    if (!el || typeof echarts === 'undefined') return;
    disposeIaChart('linea');
    const chart = echarts.init(el, null, { renderer: 'svg' });
    ensureIaChartRegistry().linea = chart;
    const payload = data && typeof data === 'object' ? data : {};
    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    const seriesRows = Array.isArray(payload.series) ? payload.series : [];
    const activeDate = String(stateIA.crossFilters && stateIA.crossFilters.createdDate ? stateIA.crossFilters.createdDate : '');
    chart.setOption({
      animation: false,
      legend: {
        top: 0,
        type: 'scroll',
        textStyle: { fontSize: 10 },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [];
          const iso = list.length && list[0] && list[0].axisValue ? String(list[0].axisValue) : '';
          const lines = list.map((item) => {
            const val = item && item.value != null ? Number(item.value) : 0;
            const marker = item && item.marker ? String(item.marker) : '';
            const name = item && item.seriesName ? String(item.seriesName) : 'Serie';
            return `${marker}${app.escapeHtml(name)}: <b>${fmtNum(val)}</b>`;
          });
          return [fmtDate(iso, false)].concat(lines).join('<br/>');
        },
      },
      grid: { top: 42, left: 36, right: 12, bottom: 34 },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          fontSize: 10,
          formatter: (value) => fmtDate(String(value || ''), false),
        },
      },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
      series: seriesRows.map((seriesRow, index) => ({
        id: String(seriesRow && seriesRow.key ? seriesRow.key : `serie_${index + 1}`),
        name: String(seriesRow && seriesRow.name ? seriesRow.name : `Serie ${index + 1}`),
        type: 'line',
        smooth: true,
        connectNulls: true,
        symbolSize: 7,
        lineStyle: {
          width: String(seriesRow && seriesRow.key ? seriesRow.key : '') === '__TOTAL__' ? 3 : 2,
          type: String(seriesRow && seriesRow.key ? seriesRow.key : '') === '__TOTAL__' ? 'solid' : 'dashed',
        },
        areaStyle: String(seriesRow && seriesRow.key ? seriesRow.key : '') === '__TOTAL__' ? { opacity: 0.08 } : undefined,
        markLine: activeDate
          ? {
              symbol: 'none',
              animation: false,
              lineStyle: { color: '#9ca3af', type: 'dotted', width: 1 },
              label: { show: false },
              data: [{ xAxis: activeDate }],
            }
          : undefined,
        data: Array.isArray(seriesRow && seriesRow.data)
          ? seriesRow.data.map((point) => Number(point || 0))
          : [],
      })),
    });

    chart.off('click');
    chart.on('click', (params) => {
      const iso = toIsoDate(params && params.name ? params.name : '');
      if (!iso) return;
      const activeDate = String(stateIA.crossFilters && stateIA.crossFilters.createdDate ? stateIA.crossFilters.createdDate : '');
      const activeAccion = String(stateIA.crossFilters && stateIA.crossFilters.accion ? stateIA.crossFilters.accion : '');
      const seriesIndex = Number(params && params.seriesIndex != null ? params.seriesIndex : -1);
      const rawSeriesKey = seriesIndex >= 0 && seriesRows[seriesIndex] && seriesRows[seriesIndex].key
        ? String(seriesRows[seriesIndex].key)
        : '';
      const nextAccion = rawSeriesKey && rawSeriesKey !== '__TOTAL__' && IA_BASE_ACCIONES_SET.has(rawSeriesKey)
        ? rawSeriesKey
        : '';

      if (activeDate === iso && activeAccion === nextAccion) {
        stateIA.crossFilters.createdDate = '';
        stateIA.crossFilters.accion = '';
      } else {
        stateIA.crossFilters.createdDate = iso;
        stateIA.crossFilters.accion = nextAccion;
      }
      renderIaCrossFiltersStatus();
      renderIaSincronizado();
    });
  }

  function buildIaLineaCambiosDiaFromLogs(logs) {
    const selectedAcciones = (Array.isArray(getIaFilters().acciones) ? getIaFilters().acciones : [])
      .map((value) => String(value || '').trim())
      .filter((value) => value && IA_BASE_ACCIONES_SET.has(value));
    const actionOrder = selectedAcciones.length
      ? selectedAcciones
      : Array.from(
          new Set(
            (Array.isArray(logs) ? logs : [])
              .map((row) => String(row && row.accion ? row.accion : '').trim())
              .filter((value) => value && IA_BASE_ACCIONES_SET.has(value))
          )
        );
    const totalsByDay = new Map();
    const actionByDay = new Map(actionOrder.map((accion) => [accion, new Map()]));
    (Array.isArray(logs) ? logs : []).forEach((row) => {
      const dayKey = resolveIaDayKey(row);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return;
      const accion = String(row && row.accion ? row.accion : '').trim();
      totalsByDay.set(dayKey, (totalsByDay.get(dayKey) || 0) + 1);
      if (actionByDay.has(accion)) {
        const perDay = actionByDay.get(accion);
        perDay.set(dayKey, (perDay.get(dayKey) || 0) + 1);
      }
    });
    const categories = Array.from(totalsByDay.keys())
      .sort((a, b) => String(a).localeCompare(String(b), 'es'));

    return {
      categories,
      series: [
        {
          key: '__TOTAL__',
          name: 'Total',
          data: categories.map((dayKey) => Number(totalsByDay.get(dayKey) || 0)),
        },
      ].concat(
        actionOrder.map((accion) => {
          const perDay = actionByDay.get(accion) || new Map();
          return {
            key: accion,
            name: String(IA_BASE_ACCIONES_LABEL.get(accion) || accion),
            data: categories.map((dayKey) => Number(perDay.get(dayKey) || 0)),
          };
        })
      ),
    };
  }

  function renderIaUsersChart(data) {
    const el = elIA('iaChartUsuarios');
    if (!el || typeof echarts === 'undefined') return;
    disposeIaChart('usuarios');
    const chart = echarts.init(el, null, { renderer: 'svg' });
    ensureIaChartRegistry().usuarios = chart;
    const rows = Array.isArray(data) ? data.slice() : [];
    rows.sort((a, b) => Number(a.cambios || 0) - Number(b.cambios || 0));
    chart.setOption({
      animation: false,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { top: 8, left: 120, right: 12, bottom: 26 },
      xAxis: { type: 'value' },
      yAxis: {
        type: 'category',
        data: rows.map((r) => String(r.usuario_nombre || '-')),
        axisLabel: { fontSize: 10 },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((r) => ({
            value: Number(r && r.cambios ? r.cambios : 0),
            usuario_id: r && r.usuario_id != null ? Number(r.usuario_id) : null,
            usuario_nombre: String(r && r.usuario_nombre ? r.usuario_nombre : '-'),
          })),
          itemStyle: { color: '#4f8f5a' },
        },
      ],
    });

    chart.off('click');
    chart.on('click', (params) => {
      const dataPoint = /** @type {any} */ (params && params.data ? params.data : null);
      const id = dataPoint && dataPoint.usuario_id ? Number(dataPoint.usuario_id) : null;
      const name = String(
        dataPoint && dataPoint.usuario_nombre ? dataPoint.usuario_nombre : (params && params.name ? params.name : '')
      ).trim();

      const sameSelection = id
        ? Number(stateIA.crossFilters.usuarioId || 0) === id
        : String(stateIA.crossFilters.usuarioNombre || '') === name;

      stateIA.crossFilters.usuarioId = sameSelection ? null : id;
      stateIA.crossFilters.usuarioNombre = sameSelection ? '' : (id ? '' : name);

      const usuarioSel = elIA('iaUsuario');
      if (usuarioSel) {
        // @ts-ignore
        usuarioSel.value = id ? String(id) : '';
      }

      renderIaCrossFiltersStatus();
      renderIaSincronizado();
    });
  }

  function renderIaAgentRankingTable(data) {
    const el = elIA('iaChartHeatmap');
    if (!el) return;
    disposeIaChart('agentes');
    if (stateIA.agentesTable && typeof stateIA.agentesTable.destroy === 'function') {
      try {
        stateIA.agentesTable.destroy();
      } catch (_e) {
        // noop
      }
      stateIA.agentesTable = null;
    }

    const rows = Array.isArray(data) ? data.slice() : [];
    const activeDate = String(stateIA.crossFilters && stateIA.crossFilters.createdDate ? stateIA.crossFilters.createdDate : '').trim();
    if (!rows.length) {
      el.innerHTML = `<div class="informes-audit-placeholder">${app.escapeHtml(activeDate ? `Sin agentes con cambios para ${fmtDate(activeDate, false)}.` : 'Sin agentes con cambios para los filtros actuales.')}</div>`;
      return;
    }

    el.innerHTML = '<div id="iaAgentesTable"></div>';
    const tableData = rows.map((row) => ({
      agente_id: row && row.agente_id != null ? Number(row.agente_id) : null,
      agente_tip: String(row && row.agente_tip ? row.agente_tip : '').trim(),
      agente_nombre: String(row && row.agente_nombre ? row.agente_nombre : '-'),
      cambios: Number(row && row.cambios ? row.cambios : 0),
      selected: Number(stateIA.crossFilters && stateIA.crossFilters.agenteId ? stateIA.crossFilters.agenteId : 0) === Number(row && row.agente_id ? row.agente_id : 0),
    }));
    const maxCambios = tableData.reduce((acc, row) => Math.max(acc, Number(row.cambios || 0)), 0);

    const applyAgentFilterFromRowData = (dataRow) => {
      const agenteId = dataRow && dataRow.agente_id ? Number(dataRow.agente_id) : null;
      if (!Number.isInteger(Number(agenteId)) || Number(agenteId) <= 0) return;
      const currentId = Number(stateIA.crossFilters.agenteId || 0);
      // Evita doble toggle cuando Tabulator emite más de un evento por click.
      if (currentId === Number(agenteId)) return;

      stateIA.crossFilters.agenteId = Number(agenteId);
      const tip = String(dataRow && dataRow.agente_tip ? dataRow.agente_tip : '').trim();
      const nombre = String(dataRow && dataRow.agente_nombre ? dataRow.agente_nombre : '').trim();
      stateIA.crossFilters.agenteNombre = [tip, nombre].filter(Boolean).join(' · ') || nombre;
      stateIA.crossFilters.fechaCuadrante = '';
      setIaAgentSelection(stateIA.crossFilters.agenteId || null);
      renderIaCrossFiltersStatus();
      syncIaDetailViews();
    };

    // @ts-ignore
    stateIA.agentesTable = new Tabulator('#iaAgentesTable', {
      layout: 'fitColumns',
      height: '200px',
      data: tableData,
      reactiveData: false,
      placeholder: activeDate
        ? `Sin agentes con cambios para ${fmtDate(activeDate, false)}.`
        : 'Sin agentes con cambios para los filtros actuales.',
      rowFormatter: (row) => {
        const dataRow = row.getData();
        row.getElement().style.background = dataRow && dataRow.selected ? '#eef6ef' : '';
      },
      columns: [
        { title: 'TIP', field: 'agente_tip', width: 78, headerSort: true },
        { title: 'Agente', field: 'agente_nombre', minWidth: 210, headerSort: true },
        {
          title: 'Cambios',
          field: 'cambios',
          width: 180,
          formatter: 'progress',
          formatterParams: {
            min: 0,
            max: Math.max(1, maxCambios),
            color: (value) => {
              const numericValue = Number(value || 0);
              const maxValue = Math.max(1, maxCambios);
              if (numericValue <= maxValue / 3) return '#dcefdc';
              if (numericValue <= (maxValue * 2) / 3) return '#f8dfc2';
              return '#f4d1d1';
            },
            legend: true,
            legendColor: '#111111',
          },
          sorter: 'number',
        },
      ],
      initialSort: [{ column: 'cambios', dir: 'desc' }],
    });

    if (stateIA.agentesTable && typeof stateIA.agentesTable.on === 'function') {
      stateIA.agentesTable.on('rowClick', (_e, row) => {
        applyAgentFilterFromRowData(row && typeof row.getData === 'function' ? row.getData() : null);
      });
      stateIA.agentesTable.on('cellClick', (_e, cell) => {
        const row = cell && typeof cell.getRow === 'function' ? cell.getRow() : null;
        applyAgentFilterFromRowData(row && typeof row.getData === 'function' ? row.getData() : null);
      });
    }
  }

  function renderIaTimelineTable(rows) {
    const container = elIA('iaTablaContainer');
    if (!container) return;
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      container.innerHTML = '<div class="informes-audit-placeholder">Sin cambios para los filtros actuales.</div>';
      return;
    }

    let mount = elIA('iaTimelineTable');
    if (!mount) {
      container.innerHTML = '<div id="iaTimelineTable"></div>';
      mount = elIA('iaTimelineTable');
    }
    if (!mount) return;

    let maxActividadesAntes = 1;
    let maxActividadesDespues = 1;

    const timelineRows = list.map((row) => {
      const agente = [row.agente_apellido1, row.agente_apellido2, row.agente_nombre]
        .filter(Boolean)
        .join(' ') || '-';
      const fechaCuadrante = resolveIaDayKey(row);
      const createdDay = String(row && row.created_at ? row.created_at : '').slice(0, 10);
      const fechaCuadranteIso = /^\d{4}-\d{2}-\d{2}$/.test(fechaCuadrante) ? fechaCuadrante : '';
      const createdDayIso = /^\d{4}-\d{2}-\d{2}$/.test(createdDay) ? createdDay : '';
      const isCuadranteBeforeCreated = !!(fechaCuadranteIso && createdDayIso && fechaCuadranteIso < createdDayIso);
      const actividadIdsAntes = extractIaActividadIdsFromLog(row, 'before');
      const actividadIdsDespues = extractIaActividadIdsFromLog(row, 'after');

      const serviciosAntes = actividadIdsAntes.map((id) => stateIA.actividadLabelById.get(id) || `ACT-${id}`);
      const serviciosDespues = actividadIdsDespues.map((id) => stateIA.actividadLabelById.get(id) || `ACT-${id}`);

      maxActividadesAntes = Math.max(maxActividadesAntes, serviciosAntes.length || 1);
      maxActividadesDespues = Math.max(maxActividadesDespues, serviciosDespues.length || 1);
      const ts = new Date(row && row.created_at ? row.created_at : 0).getTime() || 0;

      return {
        fecha_cambio: fmtDate(row.created_at, true),
        fecha_cambio_ts: ts,
        fecha_cuadrante: fechaCuadrante,
        is_cuadrante_before_created: isCuadranteBeforeCreated,
        agente,
        usuario: String(row && row.usuario_nombre ? row.usuario_nombre : '-'),
        accion: String(row && row.accion ? row.accion : '-'),
        serviciosAntes,
        serviciosDespues,
      };
    });

    const data = timelineRows.map((row) => {
      const payload = {
        fecha_cambio: row.fecha_cambio,
        fecha_cambio_ts: row.fecha_cambio_ts,
        fecha_cuadrante: row.fecha_cuadrante,
        is_cuadrante_before_created: !!row.is_cuadrante_before_created,
        agente: row.agente,
        usuario: row.usuario,
        accion: row.accion,
      };

      for (let i = 0; i < maxActividadesAntes; i += 1) {
        payload[`servicio_antes_${i + 1}`] = row.serviciosAntes[i] || '-';
      }
      for (let i = 0; i < maxActividadesDespues; i += 1) {
        payload[`servicio_despues_${i + 1}`] = row.serviciosDespues[i] || '-';
      }

      return payload;
    });

    const timelineColumns = [
      {
        title: 'Fecha cambio',
        field: 'fecha_cambio_ts',
        width: 140,
        hozAlign: 'left',
        formatter: (cell) => app.escapeHtml(String(cell.getRow().getData().fecha_cambio || '-')),
        sorter: 'number',
        headerFilter: 'input',
        headerFilterFunc: (v, _v, d) => String(d && d.fecha_cambio ? d.fecha_cambio : '').toLowerCase().includes(String(v || '').toLowerCase()),
      },

      { title: 'Agente', field: 'agente', minWidth: 180, headerFilter: 'input' },
      { title: 'Usuario', field: 'usuario', minWidth: 130, headerFilter: 'input' },
      { title: 'Fecha cuadrante', field: 'fecha_cuadrante', width: 130, headerFilter: 'input' },
      ...Array.from({ length: maxActividadesAntes }).map((_, idx) => ({
        title: maxActividadesAntes === 1 ? 'Servicio antes' : `Servicio antes ${idx + 1}`,
        field: `servicio_antes_${idx + 1}`,
        minWidth: 220,
        headerFilter: 'input',
      })),
      ...Array.from({ length: maxActividadesDespues }).map((_, idx) => ({
        title: maxActividadesDespues === 1 ? 'Servicio después' : `Servicio después ${idx + 1}`,
        field: `servicio_despues_${idx + 1}`,
        minWidth: 220,
        headerFilter: 'input',
      })),
      { title: 'Acción', field: 'accion', minWidth: 140, headerFilter: 'input' },
    ];

    const timelineColumnsKey = `${maxActividadesAntes}:${maxActividadesDespues}`;

    const langs = {
      'es-es': {
        data: { loading: 'Cargando...', error: 'Error' },
        pagination: {
          page_size: 'Por página',
          first: '«',
          last: '»',
          prev: '‹',
          next: '›',
          all: 'Todos',
          counter: { showing: 'Mostrando', of: 'de', rows: 'filas', pages: 'páginas' },
        },
        headerFilters: { default: 'Filtrar...' },
      },
    };

    const needsRebuild =
      !stateIA.timelineTable ||
      !stateIA.timelineTable.element ||
      !document.documentElement.contains(stateIA.timelineTable.element) ||
      stateIA.timelineColumnsKey !== timelineColumnsKey;

    const buildTimelineTable = (rowsData) => {
      // @ts-ignore
      stateIA.timelineTable = new Tabulator('#iaTimelineTable', {
        locale: 'es-es',
        langs,
        layout: 'fitDataFill',
        height: 'calc(52vh - 4px)',
        reactiveData: false,
        pagination: true,
        paginationSize: 50,
        paginationSizeSelector: [25, 50, 100, 250, true],
        placeholder: 'Sin cambios para los filtros actuales.',
        rowHeight: 22,
        rowFormatter: (row) => {
          const dataRow = row.getData();
          const rowEl = row.getElement();
          const isAlert = !!(dataRow && dataRow.is_cuadrante_before_created);
          rowEl.style.background = isAlert ? '#f8d7da' : '';
        },
        columnDefaults: { resizable: true, headerSort: true, headerFilterPlaceholder: 'Filtrar...' },
        initialSort: [{ column: 'fecha_cambio_ts', dir: 'desc' }],
        columns: timelineColumns,
        data: Array.isArray(rowsData) ? rowsData : [],
      });
      stateIA.timelineColumnsKey = timelineColumnsKey;
    };

    if (needsRebuild) {
      if (stateIA.timelineTable && typeof stateIA.timelineTable.destroy === 'function') {
        try {
          stateIA.timelineTable.destroy();
        } catch (_e) {
          // noop
        }
      }
      buildTimelineTable(data);
      return;
    }

    const currentTable = stateIA.timelineTable;
    Promise.resolve(currentTable.replaceData(data)).catch(() => {
      // Error asíncrono de Tabulator (Uncaught in promise): reconstruimos una vez.
      if (stateIA.timelineTable !== currentTable) return;
      try {
        if (stateIA.timelineTable && typeof stateIA.timelineTable.destroy === 'function') {
          stateIA.timelineTable.destroy();
        }
      } catch (_e) {
        // noop
      }
      buildTimelineTable(data);
    });
  }

  function renderIaTableByView(logsOverride) {
    const agentCrossFilterId = Number(stateIA.crossFilters && stateIA.crossFilters.agenteId ? stateIA.crossFilters.agenteId : 0) || null;
    const filteredLogs = (Array.isArray(logsOverride) ? logsOverride : getIaFilteredLogs()).filter((row) => {
      if (!agentCrossFilterId) return true;
      return Number(row && row.agente_id ? row.agente_id : 0) === agentCrossFilterId;
    });
    renderIaTimelineTable(filteredLogs);
  }

  function hydrateIaSelectOptions(id, rows, valueKey, labelKey, placeholder) {
    const sel = /** @type {any} */ (elIA(id));
    if (!sel) return;
    const isMulti = !!sel.multiple;
    const selectedValues = isMulti
      ? new Set(Array.from(sel.selectedOptions || []).map((opt) => String(opt.value || '')))
      : new Set([String(sel.value || '')]);
    const list = Array.isArray(rows) ? rows : [];
    sel.innerHTML = (isMulti ? '' : `<option value="">${placeholder}</option>`) + list
      .map((row) => {
        const value = row && row[valueKey] != null ? String(row[valueKey]) : '';
        const label = row && row[labelKey] != null ? String(row[labelKey]) : value;
        return `<option value="${app.escapeHtml(value)}">${app.escapeHtml(label || value)}</option>`;
      })
      .join('');

    if (isMulti) {
      // @ts-ignore
      Array.from(sel.options || []).forEach((opt) => {
        opt.selected = selectedValues.has(String(opt.value || ''));
      });
    } else {
      const selected = Array.from(selectedValues)[0] || '';
      if (selected && Array.from(sel.options).some((opt) => opt.value === selected)) {
        // @ts-ignore
        sel.value = selected;
      }
    }

    if (IA_CHECKLIST_META[id]) {
      renderIaChecklist(id);
    }
  }

  function hydrateIaAccionesOptions() {
    const sel = /** @type {any} */ (elIA('iaAccion'));
    if (!sel) return;
    sel.multiple = true;
    sel.size = 5;
    const selected = new Set(
      Array.from(sel.selectedOptions || [])
        .map((opt) => String(opt && opt.value ? opt.value : '').trim())
        .filter((value) => value && IA_BASE_ACCIONES_SET.has(value))
    );

    sel.innerHTML = IA_BASE_ACCIONES
      .map((item) => `<option value="${app.escapeHtml(item.value)}">${app.escapeHtml(item.label)}</option>`)
      .join('');

    const defaults = new Set(['BORRADOR_EDITAR', 'BORRADOR_EDITAR_MASIVO']);
    // @ts-ignore
    Array.from(sel.options || []).forEach((opt) => {
      const value = String(opt.value || '').trim();
      if (selected.size) {
        opt.selected = selected.has(value);
        return;
      }
      if (!stateIA.defaultAccionesApplied) {
        opt.selected = defaults.has(value);
      }
    });
    if (!stateIA.defaultAccionesApplied) {
      stateIA.defaultAccionesApplied = true;
    }

    renderIaChecklist('iaAccion');
  }

  async function ejecutarConsultaIA() {
    setIaError(null);
    // @ts-ignore
    const anio = Number(elIA('iaAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elIA('iaMes')?.value || 0);
    if (!anio || !mes) {
      setIaError('Selecciona año y mes para consultar auditoría.');
      return;
    }
    setIaLoading(true, 'Consultando auditoría...');

    try {
      const filters = getIaFilters();
      const insightsQuery = buildIaQueryString(false, filters);
      const timelineQuery = buildIaQueryString(true, filters);
      const [insightsResp, timelineResp, asignacionesExistentesRaw] = await Promise.all([
        fetch(`/api/asignaciones/historial/insights?${insightsQuery}`, {
          headers: getHeaders(),
        }),
        fetch(`/api/asignaciones/historial?${timelineQuery}`, {
          headers: getHeaders(),
        }),
        fetchIaAsignacionesExistentes(filters).catch(() => 0),
      ]);

      if (!insightsResp.ok) throw new Error('No se pudieron cargar insights de auditoría');
      if (!timelineResp.ok) throw new Error('No se pudo cargar timeline de auditoría');

      const insights = await insightsResp.json();
      const timeline = await timelineResp.json();

      stateIA.insights = insights || {};
      stateIA.logs = Array.isArray(timeline.logs) ? timeline.logs : [];
      const timelineDerivedKpis = computeIaTimelineDerivedKpis(stateIA.logs);
      const serverAdvancedKpis = (insights && insights.kpis_avanzados) || {};
      const cambiosEfectivos = Number(serverAdvancedKpis.cambios_efectivos || 0);
      const slotsTocados = Number(serverAdvancedKpis.slots_tocados || 0);
      const slotsConRetrabajo = Number(serverAdvancedKpis.slots_con_retrabajo || 0);
      const retrabajosAdicionales = Number(serverAdvancedKpis.retrabajos_adicionales || 0);
      const baseAsignaciones = Number(asignacionesExistentesRaw || 0);
      const advancedKpis = {
        totalRegistros: Array.isArray(stateIA.logs) ? stateIA.logs.length : 0,
        cambiosEfectivos,
        baseAsignaciones,
        volatilidad: baseAsignaciones > 0 ? (cambiosEfectivos * 100) / baseAsignaciones : Number.NaN,
        slotsTocados,
        slotsConRetrabajo,
        retrabajosAdicionales,
        retrabajoPct: cambiosEfectivos > 0 ? (retrabajosAdicionales * 100) / cambiosEfectivos : 0,
        cambiosTardios: Number(timelineDerivedKpis.cambiosTardios || 0),
        comparablesTardios: Number(timelineDerivedKpis.comparablesTardios || 0),
        tardiosPct: Number(timelineDerivedKpis.tardiosPct || 0),
      };
      renderIaAdvancedKpis(advancedKpis);

      const charts = (insights && insights.charts) || {};
      void charts;

      hydrateIaFiltersFromInsights(insights);

      captureIaMainFiltersSnapshot();

      clearIaCrossFilters();
      renderIaCrossFiltersStatus();

      renderIaSincronizado();
      setIaPendingNotice(false);
    } catch (err) {
      setIaError(err && err.message ? err.message : 'Error en consulta de auditoría');
    } finally {
      setIaLoading(false);
    }
  }

  function limpiarFiltrosIA() {
    const ids = ['iaUsuario', 'iaAgente', 'iaActividad'];
    ids.forEach((id) => {
      const sel = elIA(id);
      if (sel) {
        if (sel.multiple) {
          // @ts-ignore
          Array.from(sel.options || []).forEach((opt) => {
            opt.selected = false;
          });
        } else {
          // @ts-ignore
          sel.value = '';
        }
      }
    });
    const accion = elIA('iaAccion');
    if (accion) {
      // @ts-ignore
      Array.from(accion.options || []).forEach((opt) => {
        opt.selected = false;
      });
    }
    clearIaCrossFilters();
    renderIaCrossFiltersStatus();
    stateIA.applyFechaCambioFilter = false;
    stateIA.fechasCuadrante = Array.isArray(stateIA.rangoCuadrante && stateIA.rangoCuadrante.fechas)
      ? stateIA.rangoCuadrante.fechas
      : [];
    sincronizarRangoIA();
    renderAllIaChecklists();
    renderIaSincronizado();
    setIaPendingNotice(true);
  }

  function bindEventosIA() {
    initIaChecklistUi();
    hydrateIaAccionesOptions();

    const bindOnce = (id, evt, fn) => {
      const node = elIA(id);
      if (!node) return;
      const key = `bound_${evt}`;
      if (node.dataset[key] === '1') return;
      node.dataset[key] = '1';
      node.addEventListener(evt, fn);
    };

    bindOnce('iaFuente', 'change', async () => {
      await refrescarPeriodoYRangoIA(elIA('iaAnio') && elIA('iaAnio').value, elIA('iaMes') && elIA('iaMes').value);
      stateIA.applyFechaCambioFilter = false;
      actualizarEtiquetasFechaIA();
      invalidateIaConsultaState({ resetFilters: true });
    });
    bindOnce('iaAnio', 'change', async () => {
      await refrescarPeriodoYRangoIA(elIA('iaAnio') && elIA('iaAnio').value, null);
      stateIA.applyFechaCambioFilter = false;
      actualizarEtiquetasFechaIA();
      invalidateIaConsultaState({ resetFilters: true });
    });
    bindOnce('iaMes', 'change', async () => {
      await refrescarPeriodoYRangoIA(elIA('iaAnio') && elIA('iaAnio').value, elIA('iaMes') && elIA('iaMes').value);
      stateIA.applyFechaCambioFilter = false;
      actualizarEtiquetasFechaIA();
      invalidateIaConsultaState({ resetFilters: true });
    });
    bindOnce('iaFechaDesde', 'change', () => {
      stateIA.applyFechaCambioFilter = true;
      invalidateIaConsultaState({ resetFilters: false });
    });
    bindOnce('iaFechaHasta', 'change', () => {
      stateIA.applyFechaCambioFilter = true;
      invalidateIaConsultaState({ resetFilters: false });
    });
    bindOnce('iaBorrador', 'change', async () => {
      // @ts-ignore
      stateIA.borradorId = Number(elIA('iaBorrador')?.value || 0) || null;
      await refrescarPeriodoYRangoIA(stateIA.anio, stateIA.mes);
      invalidateIaConsultaState({ resetFilters: true });
    });
    bindOnce('iaUsuario', 'change', () => {
      setIaPendingNotice(true);
    });
    bindOnce('btnIaConsultar', 'click', ejecutarConsultaIA);
    bindOnce('btnIaLimpiar', 'click', limpiarFiltrosIA);
    bindOnce('btnIaCrossFiltersClear', 'click', () => {
      clearIaCrossFilters();
      restoreIaMainFiltersSnapshot();
      renderIaSincronizado();
    });

    const accordionEl = document.getElementById('informesAuditoriaAsignaciones');
    if (accordionEl && !accordionEl.dataset.iaInitBound) {
      accordionEl.dataset.iaInitBound = '1';
      accordionEl.addEventListener('show.bs.collapse', async () => {
        await refrescarPeriodoYRangoIA(state.anio, state.mes);
        actualizarEtiquetasFechaIA();
        renderIaCrossFiltersStatus();
      });
    }
  }

  app.initializeinformes = async function initializeinformes() {
    bindEventos();
    bindEventosRA();
    bindEventosIA();
    setError(null);
    try {
      await cargarPeriodosDisponibles();
      poblarPeriodoDisponible(state.anio, state.mes);
      await cargarPeriodosRA(state.anio, state.mes);
      await actualizarBorradorVisibilidadRA();
      await refrescarPeriodoYRangoIA(state.anio, state.mes);
    } catch (err) {
      setError(
        err.message || 'No se pudieron inicializar los períodos de informes.'
      );
    }

    await actualizarVisibilidadBorrador();
    await poblarFechasCuadrante();
    actualizarModoPorDia();
    actualizarResumenFuente();
    actualizarEtiquetasFechaIA();
    updateExportButtonState();
  };
})();

