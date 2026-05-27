(function () {
  const app = window.GRS1Dashboard;

  const SESSION_AUTH_KEYS = Array.isArray(app.sessionAuthKeys)
    ? app.sessionAuthKeys
    : [
        'token',
        'role',
        'roleId',
        'userRole',
        'userRoleId',
        'userName',
        'userNombre',
        'userTip',
        'userPermisos',
        'arsIds',
        'activeArsId',
        'arsCatalog',
      ];

  function normalizeDashboardColor(value) {
    let raw = String(value || '').trim();
    if (!raw) return '';
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
    return '';
  }

  function readSessionAuth(key, fallback) {
    let fromSession = sessionStorage.getItem(key);
    if (fromSession !== null) return fromSession;

    let fromLegacy = localStorage.getItem(key);
    if (fromLegacy !== null) {
      sessionStorage.setItem(key, fromLegacy);
      localStorage.removeItem(key);
      return fromLegacy;
    }

    return fallback;
  }

  function writeSessionAuth(key, value) {
    sessionStorage.setItem(key, value);
  }

  function clearSessionAuth() {
    SESSION_AUTH_KEYS.forEach(function (k) {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    });
  }

  /**
   * @param {string} id
   * @returns {HTMLSelectElement | null}
   */
  function getSelectElement(id) {
    return /** @type {HTMLSelectElement | null} */ (
      document.getElementById(id)
    );
  }

  /**
   * @param {string} id
   * @returns {HTMLInputElement | null}
   */
  function getInputElement(id) {
    return /** @type {HTMLInputElement | null} */ (
      document.getElementById(id)
    );
  }

  /**
   * @param {EventTarget | null} target
   * @returns {target is HTMLElement}
   */
  function isHtmlElement(target) {
    return target instanceof HTMLElement;
  }

  function blurActiveElement() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  /**
   * @param {HTMLElement} el
   * @param {boolean} disabled
   */
  function setElementDisabled(el, disabled) {
    if (
      el instanceof HTMLButtonElement ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLOptGroupElement ||
      el instanceof HTMLOptionElement ||
      el instanceof HTMLFieldSetElement
    ) {
      el.disabled = disabled;
    }
  }

  /**
   * @param {RequestInfo | URL} input
   * @returns {string}
   */
  function getRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.toString();
    return '';
  }

  app.hasPermission = function hasPermission(permissionKey) {
    try {
      if (!permissionKey) return true;
      const raw = readSessionAuth('userPermisos', '[]') || '[]';
      const permisos = JSON.parse(raw);
      if (!Array.isArray(permisos)) return false;

      const normalize = (value) =>
        String(value || '')
          .trim()
          .toLowerCase();
      const requested = normalize(permissionKey);
      const requestedAny = requested
        .split(/[|,]/)
        .map((p) => normalize(p))
        .filter(Boolean);

      const granted = permisos
        .map((p) => {
          if (typeof p === 'string') return normalize(p);
          if (p && typeof p === 'object')
            return normalize(p.clave || p.key || p.permiso || p.nombre);
          return '';
        })
        .filter(Boolean);

      return requestedAny.some((perm) => granted.includes(perm));
    } catch (_e) {
      return false;
    }
  };

  app.applyPermissionGuards = function applyPermissionGuards() {
    document.querySelectorAll('[data-permiso]').forEach((node) => {
      const el = /** @type {HTMLElement} */ (node);
      const permiso = el.getAttribute('data-permiso');
      const accion = el.getAttribute('data-permiso-accion') || 'hide';
      const allowed = app.hasPermission(permiso);

      if (allowed) {
        if (accion === 'disable') {
          setElementDisabled(el, false);
          el.style.opacity = '';
          el.style.pointerEvents = '';
          if (el.dataset.noPermTitle) {
            el.title = el.dataset.noPermTitle;
            delete el.dataset.noPermTitle;
          }
        } else {
          el.style.display = '';
        }
        return;
      }

      switch (accion) {
        case 'disable':
          setElementDisabled(el, true);
          el.style.opacity = '0.45';
          el.style.pointerEvents = 'none';
          if (!el.dataset.noPermTitle) el.dataset.noPermTitle = el.title || '';
          el.title = 'No tiene permiso para esta acción';
          break;
        case 'remove':
          el.remove();
          break;
        case 'hide':
        default:
          el.style.display = 'none';
          break;
      }
    });
  };

  // ── Interceptor global: inyecta X-Ars-Id + Authorization en /api/ y gestiona 401 ──
  const _originalFetch = window.fetch;
  let _handlingUnauthorized = false;
  window.fetch = function (input, init) {
    let url = getRequestUrl(input);
    let isApiRequest = url.indexOf('/api/') !== -1;
    if (isApiRequest) {
      init = init || {};
      let existingHeaders = init.headers || {};
      let token = app.globalState && app.globalState.token;
      // Soportar Headers object o plain object
      if (existingHeaders instanceof Headers) {
        if (token && !existingHeaders.has('Authorization')) {
          existingHeaders.set('Authorization', 'Bearer ' + token);
        }
        if (app.globalState.activeArsId && !existingHeaders.has('X-Ars-Id')) {
          existingHeaders.set('X-Ars-Id', app.globalState.activeArsId);
        }
      } else {
        if (token && !existingHeaders['Authorization']) {
          existingHeaders['Authorization'] = 'Bearer ' + token;
        }
        if (app.globalState.activeArsId && !existingHeaders['X-Ars-Id']) {
          existingHeaders['X-Ars-Id'] = app.globalState.activeArsId;
        }
      }
      init.headers = existingHeaders;
    }
    return _originalFetch.call(window, input, init).then(function (response) {
      if (
        isApiRequest &&
        response &&
        response.status === 401 &&
        !_handlingUnauthorized
      ) {
        _handlingUnauthorized = true;
        try {
          clearSessionAuth();
        } catch (_e) {
          // noop
        }

        // Redirigir al login cuando el token expiró o no es válido.
        window.location.href = 'login.html?reason=unauthorized';
      }
      return response;
    });
  };

  // ── Función de utilidad para fetch con reintentos exponenciales en caso de errores transitorios (e.g. 429, 503) ──
  async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, options);

        // éxito
        if (response.ok) return response;

        // reintentar solo en estos casos
        if (response.status !== 429 && response.status !== 503) {
          throw new Error(`HTTP ${response.status}`);
        }

        throw response;
      } catch (err) {
        const isLast = attempt === retries;
        if (isLast) throw err;

        const baseDelay = 500; // ms
        const exponential = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 300;

        const delay = exponential + jitter;

        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
  app.initializeApp = async function initializeApp() {
    if (!app.globalState.token) {
      window.location.href = 'login.html';
      return;
    }
    //20240425 F.Pellus - Carga de includes con concurrencia limitada para mejorar performance y evitar bloqueos
    try {
      await app.loadIncludes(app.includes, 3);
      if (typeof window.HelpWidget !== 'undefined') window.HelpWidget.init();
      if (typeof app.initSidebar === 'function') {
        app.initSidebar();
      }
      app.applyPermissionGuards();
      app.bindStaticEventListeners();
      app.syncUserInfo();
      await app.initArsSelector();
      app.updateRoleBadges();
      if (typeof app.initProfile === 'function') app.initProfile();
      app.updateDateTime();
      setInterval(app.updateDateTime, 1000);
      app.showSection(app.getInitialSection());
      // Inicializar tooltips de Bootstrap
      app.initializeTooltips();
    } catch (error) {
      console.error('Error initializing dashboard:', error);
      app.renderInitializationError();
    }
  };
  // 20240424 F.Pellus
  // Concurrencia limitada para refresco del dashboard: evita múltiples llamadas simultáneas y controla frecuencia mínima

  const includeCache = new Map();
  app.loadIncludes = async function loadIncludes(items, concurrency) {
    items = Array.isArray(items) ? items : app.includes;
    concurrency = Number(concurrency) > 0 ? Number(concurrency) : 4;
    const results = [];
    const executing = [];
    function sanitizeColorInputDefaults(markup) {
      if (!markup || typeof markup !== 'string') return markup;

      return markup.replace(
        /<input\b[^>]*type=["']color["'][^>]*>/gi,
        function (tag) {
          let hasValueAttr = /\bvalue\s*=\s*["'][^"']*["']/i.test(tag);

          if (!hasValueAttr) {
            return tag.replace(/\s*\/?>$/, ' value="#6c757d"$&');
          }

          return tag.replace(/(\bvalue\s*=\s*["'])\s*(["'])/i, '$1#6c757d$2');
        }
      );
    }
    for (const item of items) {
      const p = (async () => {
        const { id, path } = item;
        const container = document.getElementById(id);
        if (!container) return;
        let html;

        if (includeCache.has(path)) {
          html = includeCache.get(path);
        } else {
          const response = await fetchWithRetry(path, { cache: 'no-store' }, 3);
          if (!response || !response.ok) {
            throw new Error(`No se pudo cargar el include ${path}`);
          }

          html = await response.text();
          includeCache.set(path, html);
        }

        container.innerHTML = sanitizeColorInputDefaults(html);
      })();

      results.push(p);

      if (concurrency <= items.length) {
        const e = p.then(() => executing.splice(executing.indexOf(e), 1));
        executing.push(e);
        if (executing.length >= concurrency) {
          await Promise.race(executing);
        }
      }
    }
    return Promise.all(results);
  };

  app.bindStaticEventListeners = function bindStaticEventListeners() {
    document
      .getElementById('sidebarToggle')
      .addEventListener('click', app.toggleSidebar);
    document.addEventListener('click', app.handleDocumentClick);
    document.addEventListener('change', function (event) {
      let target = event && event.target;
      if (!isHtmlElement(target) || target.id !== 'dashDataSourceSel') return;
      if (typeof app.loadDashboardBorradores === 'function') {
        app.loadDashboardBorradores();
      }
    });
    window.addEventListener('hashchange', app.handleHashChange);

    const configTabs = document.getElementById('configTabs');
    if (configTabs) {
      configTabs.addEventListener('shown.bs.tab', function (event) {
        let target = event && event.target;
        if (!isHtmlElement(target) || !target.id) return;
        app._currentConfigTabId = target.id;
        if (
          app.currentSection === 'configuracion' ||
          app.currentSection === 'sistema'
        ) {
          app.syncSidebarNavigationState(app.currentSection);
        }
      });
    }

    const confirmDeleteButton = document.getElementById(
      'confirmAgenteDeleteBtn'
    );
    if (confirmDeleteButton) {
      confirmDeleteButton.addEventListener('click', app.confirmDeleteAgente);
    }

    const confirmDeleteActividadButton = document.getElementById(
      'confirmActividadDeleteBtn'
    );
    if (confirmDeleteActividadButton) {
      confirmDeleteActividadButton.addEventListener(
        'click',
        app.confirmDeleteActividad
      );
    }

    const confirmDeleteUsuarioButton = document.getElementById(
      'confirmUsuarioDeleteBtn'
    );
    if (confirmDeleteUsuarioButton) {
      confirmDeleteUsuarioButton.addEventListener(
        'click',
        app.confirmDeleteUsuario
      );
    }

    const saveAgenteButton = document.getElementById('btnSaveAgente');
    if (saveAgenteButton) {
      saveAgenteButton.addEventListener('click', app.handleAgenteSaveClick);
    }

    const saveComentariosAgenteButton = document.getElementById(
      'btnSaveComentariosAgente'
    );
    if (saveComentariosAgenteButton) {
      saveComentariosAgenteButton.addEventListener(
        'click',
        app.saveComentariosAgente
      );
    }

    const saveActividadButton = document.getElementById('btnSaveActividad');
    if (saveActividadButton) {
      saveActividadButton.addEventListener(
        'click',
        app.handleActividadSaveClick
      );
    }

    const agenteForm = document.getElementById('agenteForm');
    if (agenteForm) {
      agenteForm.addEventListener('submit', (event) => {
        event.preventDefault();
        app.handleAgenteSaveClick();
      });
    }

    const actividadForm = document.getElementById('actividadForm');
    if (actividadForm) {
      actividadForm.addEventListener('submit', (event) => {
        event.preventDefault();
        app.handleActividadSaveClick();
      });
    }

    const agenteModalElement = document.getElementById('agenteModal');
    if (agenteModalElement) {
      agenteModalElement.addEventListener('hide.bs.modal', () => {
        blurActiveElement();
      });
      agenteModalElement.addEventListener(
        'hidden.bs.modal',
        app.resetAgenteModalState
      );
    }

    const comentariosAgenteModalEl = document.getElementById(
      'comentariosAgenteModal'
    );
    if (comentariosAgenteModalEl) {
      comentariosAgenteModalEl.addEventListener('hide.bs.modal', () => {
        blurActiveElement();
      });
    }

    const actividadModalElement = document.getElementById('actividadModal');
    if (actividadModalElement) {
      actividadModalElement.addEventListener(
        'hidden.bs.modal',
        app.resetActividadModalState
      );
    }

    const actividadDeleteModalElement = document.getElementById(
      'confirmActividadDeleteModal'
    );
    if (actividadDeleteModalElement) {
      actividadDeleteModalElement.addEventListener('hidden.bs.modal', () => {
        app.actividadIdToDelete = null;
      });
    }

    const saveTurnoButton = document.getElementById('btnSaveTurno');
    if (saveTurnoButton) {
      saveTurnoButton.addEventListener('click', app.handleTurnoSaveClick);
    }

    const turnoForm = document.getElementById('turnoForm');
    if (turnoForm) {
      turnoForm.addEventListener('submit', (event) => {
        event.preventDefault();
        app.handleTurnoSaveClick();
      });
    }

    const turnoModalElement = document.getElementById('turnoModal');
    if (turnoModalElement) {
      turnoModalElement.addEventListener(
        'hidden.bs.modal',
        app.resetTurnoModalState
      );
    }

    const confirmDeleteTurnoButton = document.getElementById(
      'confirmTurnoDeleteBtn'
    );
    if (confirmDeleteTurnoButton) {
      confirmDeleteTurnoButton.addEventListener(
        'click',
        app.confirmDeleteTurno
      );
    }

    const turnoDeleteModalElement = document.getElementById(
      'confirmTurnoDeleteModal'
    );
    if (turnoDeleteModalElement) {
      turnoDeleteModalElement.addEventListener('hidden.bs.modal', () => {
        app.turnoIdToDelete = null;
      });
    }
    const saveUsuarioButton = document.getElementById('btnSaveUsuario');
    if (saveUsuarioButton) {
      saveUsuarioButton.addEventListener('click', app.handleUsuarioSaveClick);
    }

    // Password toggle + strength indicator
    if (typeof app.initUsuarioPasswordToggle === 'function') {
      app.initUsuarioPasswordToggle();
    }

    const usuarioForm = document.getElementById('usuarioForm');
    if (usuarioForm) {
      usuarioForm.addEventListener('submit', (event) => {
        event.preventDefault();
        app.handleUsuarioSaveClick();
      });
    }

    const usuarioModalElement = document.getElementById('usuarioModal');
    if (usuarioModalElement) {
      usuarioModalElement.addEventListener(
        'hidden.bs.modal',
        app.resetUsuarioModalState
      );
    }

    const usuarioDeleteModalElement = document.getElementById(
      'confirmUsuarioDeleteModal'
    );
    if (usuarioDeleteModalElement) {
      usuarioDeleteModalElement.addEventListener('hidden.bs.modal', () => {
        app.usuarioIdToDelete = null;
      });
    }
  };

  app.normalizeSection = function normalizeSection(sectionName) {
    if (sectionName === 'sistema-config') {
      return 'sistema';
    }
    return Object.prototype.hasOwnProperty.call(app.sectionTitles, sectionName)
      ? sectionName
      : 'dashboard';
  };

  app.canAccessSection = function canAccessSection(sectionName) {
    if (sectionName === 'sistema' || sectionName === 'configuracion') {
      return app.hasPermission('config:leer');
    }
    if (sectionName === 'devengos') {
      return app.hasPermission('asignaciones-reglas:leer');
    }
    if (sectionName === 'agentes-requisitos') {
      return app.hasPermission('agentes-requisitos:leer');
    }
    if (sectionName === 'help-admin') {
      return app.hasPermission('config:leer');
    }
    return true;
  };

  app.getSectionElementId = function getSectionElementId(sectionName) {
    if (sectionName === 'sistema' || sectionName === 'configuracion') {
      return 'configuracionSection';
    }
    if (sectionName === 'help-admin') {
      return 'helpAdminSection';
    }
    if (sectionName === 'agentes-acciones') {
      return 'agentesAccionesSection';
    }
    if (sectionName === 'agentes-requisitos') {
      return 'agentesRequisitosSection';
    }
    return `${sectionName}Section`;
  };

  app.syncConfigTabGroups = function syncConfigTabGroups(sectionName) {
    if (sectionName !== 'sistema' && sectionName !== 'configuracion') {
      return;
    }

    const visibleGroup = sectionName;
    const defaultTabId =
      sectionName === 'sistema' ? 'tab-ars' : 'tab-calendarios';

    document.querySelectorAll('[data-config-group]').forEach((tabItem) => {
      tabItem.classList.toggle(
        'd-none',
        tabItem.getAttribute('data-config-group') !== visibleGroup
      );
    });

    const titleEl = document.getElementById('configSectionTitle');
    if (titleEl) {
      titleEl.textContent =
        sectionName === 'sistema' ? 'Sistema' : 'Configuración';
    }

    // Si ya hay un tab activo para este grupo, úsalo; evita flash y sobreescritura
    const preferredTabId = app._currentConfigTabId;
    const preferredTrigger = preferredTabId
      ? document.getElementById(preferredTabId)
      : null;
    const preferredContainer = preferredTrigger
      ? preferredTrigger.closest('[data-config-group]')
      : null;
    if (
      preferredContainer &&
      preferredContainer.getAttribute('data-config-group') === visibleGroup
    ) {
      try {
        bootstrap.Tab.getOrCreateInstance(preferredTrigger).show();
      } catch (_e) {
        // noop
      }
      return;
    }

    // Fallback: activar el tab por defecto del grupo
    const activeTabTrigger = document.querySelector(
      '#configTabs .nav-link.active'
    );
    const activeTabContainer = activeTabTrigger
      ? activeTabTrigger.closest('[data-config-group]')
      : null;

    if (
      activeTabContainer &&
      activeTabContainer.getAttribute('data-config-group') === visibleGroup
    ) {
      app._currentConfigTabId = activeTabTrigger ? activeTabTrigger.id : null;
      return;
    }

    const defaultTabTrigger = document.getElementById(defaultTabId);
    if (!defaultTabTrigger) {
      return;
    }

    try {
      bootstrap.Tab.getOrCreateInstance(defaultTabTrigger).show();
      app._currentConfigTabId = defaultTabTrigger.id;
    } catch (_e) {
      // noop
    }
  };

  app.syncSidebarNavigationState = function syncSidebarNavigationState(
    targetSection
  ) {
    const activeConfigTabId =
      app._currentConfigTabId ||
      (document.querySelector('#configTabs .nav-link.active') || {}).id ||
      null;

    document
      .querySelectorAll('.sidebar .nav-link[data-section]')
      .forEach((link) => {
        const navLink = /** @type {HTMLElement} */ (link);
        const linkSection = navLink.dataset.section;
        const linkConfigTab = navLink.getAttribute('data-config-tab');

        let isActive = linkSection === targetSection;
        if (isActive && targetSection === 'configuracion' && linkConfigTab) {
          isActive = linkConfigTab === activeConfigTabId;
        }

        navLink.classList.toggle('active', isActive);
      });

    const accordionGroups = [
      {
        menuId: 'agentesMenu',
        triggerSelector: '[data-bs-target="#agentesMenu"]',
        sections: ['agentes', 'agentes-acciones', 'agentes-requisitos', 'ledger'],
      },
      {
        menuId: 'planificacionMenu',
        triggerSelector: '[data-bs-target="#planificacionMenu"]',
        sections: ['cuadrantesPlanificacion', 'turnos', 'asignaciones'],
      },
      {
        menuId: 'informesMenu',
        triggerSelector: '[data-bs-target="#informesMenu"]',
        sections: ['informes'],
      },
      {
        menuId: 'configuracionMenu',
        triggerSelector: '[data-bs-target="#configuracionMenu"]',
        sections: ['configuracion', 'devengos'],
      },
    ];

    accordionGroups.forEach((group) => {
      const isGroupActive = group.sections.includes(targetSection);
      const trigger = document.querySelector(group.triggerSelector);
      const collapse = document.getElementById(group.menuId);

      if (trigger) {
        trigger.classList.toggle('active', isGroupActive);
        trigger.classList.toggle('collapsed', !isGroupActive);
        trigger.setAttribute('aria-expanded', isGroupActive ? 'true' : 'false');
      }
      if (collapse) {
        collapse.classList.toggle('show', isGroupActive);
      }
    });
  };

  app.getSectionFromHash = function getSectionFromHash() {
    return window.location.hash.replace(/^#/, '');
  };

  app.getInitialSection = function getInitialSection() {
    const sectionFromHash = app.getSectionFromHash();
    const sectionFromStorage = localStorage.getItem(
      app.storageKeys.activeSection
    );
    const requestedSection =
      sectionFromHash || sectionFromStorage || 'dashboard';
    const normalizedSection = app.normalizeSection(requestedSection);

    return app.canAccessSection(normalizedSection)
      ? normalizedSection
      : 'dashboard';
  };

  app.persistActiveSection = function persistActiveSection(
    sectionName,
    updateHash = true
  ) {
    app.currentSection = sectionName;
    localStorage.setItem(app.storageKeys.activeSection, sectionName);

    if (!updateHash) {
      return;
    }

    const url = new URL(window.location.href);
    url.hash = sectionName;
    window.history.replaceState(null, '', url);
  };

  app.handleHashChange = function handleHashChange() {
    const nextSection = app.getInitialSection();

    if (nextSection !== app.currentSection) {
      app.showSection(nextSection, { updateHash: false });
    }
  };

  app.handleDocumentClick = function handleDocumentClick(event) {
    if (!isHtmlElement(event.target)) {
      return;
    }

    const sectionLink = event.target.closest('[data-section]');
    if (sectionLink) {
      const sectionEl = /** @type {HTMLElement} */ (sectionLink);
      event.preventDefault();
      app.showSection(sectionEl.dataset.section);
      const tabId = sectionEl.getAttribute('data-config-tab');
      if (
        tabId &&
        (sectionEl.dataset.section === 'configuracion' ||
          sectionEl.dataset.section === 'sistema')
      ) {
        app._currentConfigTabId = tabId;
        requestAnimationFrame(function () {
          let tabTrigger = document.getElementById(tabId);
          if (!tabTrigger) return;
          try {
            bootstrap.Tab.getOrCreateInstance(tabTrigger).show();
            app._currentConfigTabId = tabId;
            app.syncSidebarNavigationState(sectionEl.dataset.section);
          } catch (_e) {
            // noop
          }
        });
      }
      if (typeof app.closeSidebarMobile === 'function') {
        app.closeSidebarMobile();
      }
      return;
    }

    const sectionTrigger = event.target.closest('[data-section-trigger]');
    if (sectionTrigger) {
      const triggerEl = /** @type {HTMLElement} */ (sectionTrigger);
      event.preventDefault();
      app.showSection(triggerEl.dataset.sectionTrigger);
      return;
    }

    const logoutTrigger = event.target.closest('[data-action="logout"]');
    if (logoutTrigger) {
      event.preventDefault();
      app.logout();
    }
  };

  app.renderInitializationError = function renderInitializationError() {
    document.querySelector('.container-fluid.mt-4').innerHTML = `
      <div class="alert alert-danger" role="alert">
        No se pudieron cargar las vistas del dashboard. Revisa la consola y vuelve a intentarlo.
      </div>
    `;
  };

  app.renderSectionInitializationError =
    function renderSectionInitializationError(sectionName) {
      const sectionElement = document.getElementById(
        app.getSectionElementId(sectionName)
      );
      if (!sectionElement) {
        return;
      }

      sectionElement.innerHTML = `
      <div class="alert alert-danger" role="alert">
        No se pudo inicializar la sección ${sectionName}. Revisa la consola y vuelve a intentarlo.
      </div>
    `;
    };

  app.triggerDashboardRefresh = function triggerDashboardRefresh(options = {}) {
    const { force = false } = options;
    const now = Date.now();
    const minIntervalMs = 15000;

    if (!force && app._dashboardRefreshInFlight) {
      return app._dashboardRefreshInFlight;
    }

    if (
      !force &&
      app._dashboardLastRefreshAt &&
      now - app._dashboardLastRefreshAt < minIntervalMs
    ) {
      return Promise.resolve();
    }

    app._dashboardRefreshInFlight = Promise.allSettled([
      Promise.resolve(app.refreshDashboardStats()),
      Promise.resolve(app.loadDashboardBorradores()),
    ])
      .catch(function () {
        return null;
      })
      .finally(function () {
        app._dashboardLastRefreshAt = Date.now();
        app._dashboardRefreshInFlight = null;
      });

    return app._dashboardRefreshInFlight;
  };

  app.initializeDashboard = async function initializeDashboard() {
    await app.triggerDashboardRefresh({ force: true });
  };

  app.refreshDashboardStats = async function refreshDashboardStats() {
    // Guardar instancias para poder hacer resize
    if (!app._dashCharts) app._dashCharts = {};

    try {
      const headers = { Authorization: `Bearer ${app.globalState.token}` };
      const [agentesResponse, metaResponse] = await Promise.all([
        fetch('/api/agentes', { headers }),
        fetch('/api/agentes/meta', { headers }),
      ]);

      if (!agentesResponse.ok || !metaResponse.ok) {
        throw new Error('No se pudieron cargar las estadísticas de agentes');
      }

      const agentesJson = await agentesResponse.clone().json();
      const metaJson = await metaResponse.clone().json();
      const agentes = Array.isArray(agentesJson.agentes)
        ? agentesJson.agentes
        : [];

      // Catálogos maestros (para etiquetas y colores de los charts)
      const pelotonesMap = new Map(
        (metaJson.pelotones || []).map((p) => [
          String(p.id_peloton),
          { nombre: p.descripcion, color: p.color || null },
        ])
      );
      const empleosMap = new Map(
        (metaJson.empleos || []).map((e) => [
          String(e.id_empleo),
          {
            nombre: e.descripcion,
            color: e.color || null,
            jerarquia: e.jerarquia || '',
          },
        ])
      );
      // ── KPIs: conteos reales de los agentes del ARS ───────────
      let distinctPelotones = new Set();
      let distinctEmpleos = new Set();
      let distinctSituaciones = new Set();
      agentes.forEach(function (ag) {
        if (ag.peloton_id != null) distinctPelotones.add(String(ag.peloton_id));
        if (ag.empleo_id != null) distinctEmpleos.add(String(ag.empleo_id));
        if (ag.situacion_id != null)
          distinctSituaciones.add(String(ag.situacion_id));
      });

      let setKpi = function (id, val) {
        let el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setKpi('kpiTotalAgentes', agentes.length);
      setKpi('kpiTotalPelotones', distinctPelotones.size);
      setKpi('kpiTotalEmpleos', distinctEmpleos.size);
      setKpi('kpiTotalSituaciones', distinctSituaciones.size);

      // ── Agregar conteos ────────────────────────────────────────
      let byEmp = new Map(); // empleo_id    → { nombre, color, count }
      let byPel = new Map(); // peloton_id   → { nombre, color, count }

      agentes.forEach(function (ag) {
        let empKey = String(ag.empleo_id ?? '');
        let pelKey = String(ag.peloton_id ?? '');

        let emp = empleosMap.get(empKey) || {
          nombre: 'Sin empleo',
          color: '#adb5bd',
          jerarquia: '',
        };
        let pel = pelotonesMap.get(pelKey) || {
          nombre: 'Sin pelotón',
          color: '#adb5bd',
        };

        if (!byEmp.has(empKey))
          byEmp.set(empKey, {
            nombre: emp.nombre,
            color: emp.color,
            jerarquia: emp.jerarquia || '',
            count: 0,
          });
        if (!byPel.has(pelKey))
          byPel.set(pelKey, { nombre: pel.nombre, color: pel.color, count: 0 });

        byEmp.get(empKey).count++;
        byPel.get(pelKey).count++;
      });

      // ── Helper charts ─────────────────────────────────────────
      const disposeChart = function (elId) {
        if (app._dashCharts[elId]) {
          try {
            app._dashCharts[elId].dispose();
          } catch (e) {
            // noop
          }
          delete app._dashCharts[elId];
        }
      };
      const getOrCreateChart = function (elId) {
        let el = document.getElementById(elId);
        if (!el) return null;
        disposeChart(elId);
        let chart = echarts.init(el, null, { renderer: 'svg' });
        app._dashCharts[elId] = chart;
        return chart;
      };
      const showEmptyPlaceholder = function (elId, message) {
        let el = document.getElementById(elId);
        if (!el) return;
        disposeChart(elId);
        el.innerHTML =
          '<div class="text-center text-muted py-4" style="font-size:.85rem;">' +
          '<i class="bi bi-bar-chart d-block fs-2 opacity-25 mb-2"></i>' +
          app.escapeHtml(message) +
          '</div>';
      };

      const parseJerarquiaPath = function (value) {
        if (value == null) return [];
        let text = String(value).trim();
        if (!text) return [];
        return text.split('.').map(function (segment) {
          let n = Number(segment);
          return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
        });
      };

      const compareJerarquia = function (a, b) {
        let pa = parseJerarquiaPath(a);
        let pb = parseJerarquiaPath(b);
        let len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i += 1) {
          let av = i < pa.length ? pa[i] : -1;
          let bv = i < pb.length ? pb[i] : -1;
          if (av !== bv) return av - bv;
        }
        return 0;
      };

      let GC_GREEN = app._gcColor || '#276836';

      // ── Si no hay agentes, mostrar placeholders ────────────────
      if (!agentes.length) {
        let noDataMsg = 'No hay agentes para esta agrupación.';
        showEmptyPlaceholder('chartEmpleo', noDataMsg);
        showEmptyPlaceholder('chartPeloton', noDataMsg);
        return;
      }

      // ── Chart 1 (donut actividades): gestionado por refreshDashboardActividadesDonut ──

      // ── Chart 2: Barras horizontales empleo ────────────────────
      let chartEmpEl = document.getElementById('chartEmpleo');
      if (chartEmpEl) chartEmpEl.innerHTML = '';
      let chartEmp = getOrCreateChart('chartEmpleo');
      if (chartEmp) {
        // Ordenar descendente por jerarquia: 0.0.0.0 queda ultimo en el array
        // y en ECharts (eje Y categoria) el ultimo item se muestra arriba.
        let empArr = Array.from(byEmp.values()).sort(function (a, b) {
          let byJerarquia = compareJerarquia(a.jerarquia, b.jerarquia);
          if (byJerarquia !== 0) return -byJerarquia;
          return String(b.nombre || '').localeCompare(
            String(a.nombre || ''),
            'es'
          );
        });
        chartEmp.setOption({
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          grid: { left: 10, right: 20, top: 8, bottom: 8, containLabel: true },
          xAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10 } },
          yAxis: {
            type: 'category',
            data: empArr.map(function (d) {
              return d.nombre;
            }),
            axisLabel: { fontSize: 10 },
          },
          series: [
            {
              type: 'bar',
              barMaxWidth: 22,
              data: empArr.map(function (d) {
                return {
                  value: d.count,
                  itemStyle: { color: d.color || GC_GREEN },
                };
              }),
              label: { show: true, position: 'right', fontSize: 10 },
            },
          ],
        });
      }

      // ── Chart 3: Barras pelotón ────────────────────────────────
      let chartPelEl = document.getElementById('chartPeloton');
      if (chartPelEl) chartPelEl.innerHTML = '';
      let chartPel = getOrCreateChart('chartPeloton');
      if (chartPel) {
        let pelArr = Array.from(byPel.values()).sort(function (a, b) {
          return b.count - a.count;
        });
        chartPel.setOption({
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          grid: { left: 10, right: 20, top: 8, bottom: 30, containLabel: true },
          xAxis: {
            type: 'category',
            data: pelArr.map(function (d) {
              return d.nombre;
            }),
            axisLabel: { fontSize: 10, rotate: pelArr.length > 4 ? 25 : 0 },
          },
          yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10 } },
          series: [
            {
              type: 'bar',
              barMaxWidth: 36,
              data: pelArr.map(function (d) {
                return {
                  value: d.count,
                  itemStyle: { color: d.color || GC_GREEN },
                };
              }),
              label: { show: true, position: 'top', fontSize: 10 },
            },
          ],
        });
      }
    } catch (error) {
      [
        'kpiTotalAgentes',
        'kpiTotalPelotones',
        'kpiTotalEmpleos',
        'kpiTotalSituaciones',
      ].forEach(function (id) {
        let el = document.getElementById(id);
        if (el) el.textContent = '—';
      });
      console.error('[Dashboard] Error cargando estadísticas:', error.message);
    }
  };

  function getDashboardFuenteSeleccionada() {
    let sel = getSelectElement('dashDataSourceSel');
    let value = sel ? String(sel.value || '').toLowerCase() : 'borrador';
    return value === 'definitivo' ? 'definitivo' : 'borrador';
  }

  function getDashboardMesLabel(mes) {
    let meses = getDashboardMesesLabels();
    return Number.isInteger(Number(mes)) && meses[Number(mes)]
      ? meses[Number(mes)]
      : '—';
  }

  function setDashboardBadgeFuente(context) {
    let ctx = context || {};
    let fuente = ctx.fuente || '—';
    let anio = Number(ctx.anio) > 0 ? String(ctx.anio) : '—';
    let mes = Number(ctx.mes) > 0 ? getDashboardMesLabel(ctx.mes) : '—';
    let detalle = ctx.detalle || 'Detalle: —';
    let rango = ctx.rango || '';
    let text =
      'Fuente: ' +
      fuente +
      ' · Año: ' +
      anio +
      ' · Mes: ' +
      mes +
      ' · ' +
      detalle +
      (rango ? ' · Días: ' + rango : '');
    ['dashHeatmap2Info', 'dashGrupoNivel3Info', 'dashMatrixInfo', 'dashActividadInfo'].forEach(
      function (id) {
        let el = document.getElementById(id);
        if (el) el.textContent = text;
      }
    );
  }

  /**
   * @returns {HTMLSelectElement | null}
   */
  function ensureDashboardBorradorControlExists() {
    let existing = /** @type {HTMLSelectElement | null} */ (
      document.getElementById('dashHeatmapBorradorSel')
    );
    if (existing) return existing;

    let header = document.querySelector('#dashboardSection .card-header');
    if (!header) return null;

    let wrap = document.getElementById('dashBorradorWrap');
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.id = 'dashBorradorWrap';
      wrap.className = 'dash-borrador-wrap';
      header.appendChild(wrap);
    }

    let sel = document.createElement('select');
    sel.id = 'dashHeatmapBorradorSel';
    sel.className =
      'form-select form-select-sm dash-borrador-control dash-select-borrador';
    sel.title = 'Borrador';
    sel.innerHTML = '<option value="">Cargando borradores...</option>';
    wrap.appendChild(sel);

    return sel;
  }

  function setDashboardBorradorControlsVisible(visible) {
    ensureDashboardBorradorControlExists();
    let wrap = document.getElementById('dashBorradorWrap');
    if (wrap) wrap.style.display = '';
    document.querySelectorAll('.dash-borrador-control').forEach(function (el) {
      let control = /** @type {HTMLSelectElement} */ (el);
      // Mantener siempre visible para evitar desincronizaciones de display.
      control.style.display = '';
      setElementDisabled(control, !visible);
      if (!visible) {
        control.innerHTML = '<option value="">No aplica para Definitivo</option>';
        control.value = '';
      }
    });
  }

  function ensureDashboardPeriodoControlsVisible() {
    let mesSel = getSelectElement('dashHeatmapMesSel');
    let anioEl = getSelectElement('dashHeatmapAnioSel');
    if (mesSel) mesSel.style.display = '';
    if (anioEl) anioEl.style.display = '';
  }

  function setDashboardNoDataInfo(message) {
    let wrap = document.getElementById('dashNoDataInfoWrap');
    let text = document.getElementById('dashNoDataInfoText');
    if (!wrap || !text) return;
    if (message) {
      text.textContent = message;
      wrap.classList.remove('dash-loading-hidden');
      return;
    }
    text.textContent = '';
    wrap.classList.add('dash-loading-hidden');
  }

  function setDashboardSelectorsNoData() {
    let anioSel = getSelectElement('dashHeatmapAnioSel');
    let mesSel = getSelectElement('dashHeatmapMesSel');
    let borradorSel = getSelectElement('dashHeatmapBorradorSel');
    if (anioSel) anioSel.innerHTML = '<option value="">Sin datos...</option>';
    if (mesSel) mesSel.innerHTML = '<option value="">Sin datos...</option>';
    if (borradorSel)
      borradorSel.innerHTML = '<option value="">Sin datos...</option>';
  }

  function getDashboardMesesLabels() {
    let months =
      window.GRS1Dashboard &&
      window.GRS1Dashboard._asig &&
      Array.isArray(window.GRS1Dashboard._asig.MONTHS)
        ? window.GRS1Dashboard._asig.MONTHS
        : [
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
    return [''].concat(months);
  }

  function buildDashboardPeriodos(cuadrantes) {
    let porAnio = new Map();
    (cuadrantes || []).forEach(function (c) {
      if (!c) return;
      if (c.estado === 'archivado') return;
      let anio = Number(c.anio != null ? c.anio : c.anio_referencia);
      let mes = Number(c.mes != null ? c.mes : c.mes_referencia);
      if (!Number.isInteger(anio) || anio <= 0) return;
      if (!Number.isInteger(mes) || mes < 1 || mes > 12) return;
      if (!porAnio.has(anio)) porAnio.set(anio, new Set());
      porAnio.get(anio).add(mes);
    });

    return Array.from(porAnio.entries())
      .map(function (entry) {
        return {
          anio: entry[0],
          meses: Array.from(entry[1]).sort(function (a, b) {
            return a - b;
          }),
        };
      })
      .sort(function (a, b) {
        return b.anio - a.anio;
      });
  }

  function populateDashboardPeriodoSelectors(
    periodos,
    preferredAnio,
    preferredMes
  ) {
    let anioSel = getSelectElement('dashHeatmapAnioSel');
    let mesSel = getSelectElement('dashHeatmapMesSel');
    if (!anioSel || !mesSel) {
      return { anio: null, mes: null };
    }

    if (!periodos.length) {
      anioSel.innerHTML = '<option value="">Sin años</option>';
      mesSel.innerHTML = '<option value="">Sin meses</option>';
      return { anio: null, mes: null };
    }

    anioSel.innerHTML = periodos
      .map(function (p) {
        return '<option value="' + p.anio + '">' + p.anio + '</option>';
      })
      .join('');

    let selectedAnio = periodos.some(function (p) {
      return p.anio === Number(preferredAnio);
    })
      ? Number(preferredAnio)
      : periodos[0].anio;
    anioSel.value = String(selectedAnio);

    let periodoAnio =
      periodos.find(function (p) {
        return p.anio === selectedAnio;
      }) || periodos[0];
    let mesesLabels = getDashboardMesesLabels();
    mesSel.innerHTML = periodoAnio.meses
      .map(function (m) {
        let label = mesesLabels[m] || String(m);
        return (
          '<option value="' + m + '">' + app.escapeHtml(label) + '</option>'
        );
      })
      .join('');

    let selectedMes =
      periodoAnio.meses.indexOf(Number(preferredMes)) !== -1
        ? Number(preferredMes)
        : periodoAnio.meses[periodoAnio.meses.length - 1];
    mesSel.value = String(selectedMes);

    return { anio: selectedAnio, mes: selectedMes };
  }

  async function refreshDashboardSourceCharts(borradorId, anio, mes) {
    let results = await Promise.allSettled([
      app.refreshDashboardNivelGrupoStack(borradorId, anio, mes),
      app.refreshDashboardPelotonActividadMatrix(borradorId, anio, mes),
      app.refreshDashboardActividadesDonut(borradorId, anio, mes),
      app.refreshDashboardGrupoNivel3Stack(borradorId, anio, mes),
    ]);
    let failed = results.filter(function (r) {
      return r.status === 'rejected';
    });
    if (failed.length) {
      console.error(
        '[Dashboard] Error cargando una o más gráficas de la fuente:',
        failed.map(function (r) {
          return r.reason && r.reason.message
            ? r.reason.message
            : String(r.reason || 'Error');
        })
      );
    }
  }

  async function refreshDashboardFromCurrentFilters() {
    let p = app._dashHeatmapPeriod || {};
    let anio = Number(p.anio);
    let mes = Number(p.mes);
    if (!anio || !mes) return;

    let fuente = getDashboardFuenteSeleccionada();
    let borradorSel = getSelectElement('dashHeatmapBorradorSel');
    let borradorId =
      fuente === 'borrador' && borradorSel && borradorSel.value
        ? String(borradorSel.value)
        : null;

    if (fuente === 'borrador' && !borradorId) {
      renderDashboardNoFuenteData(
        'Selecciona un borrador para visualizar los gráficos.'
      );
      return;
    }

    let detalle =
      fuente === 'borrador'
        ? 'Borrador: ' +
          getSelectOptionText(
            borradorSel,
            borradorId ? 'Borrador seleccionado' : 'Sin selección'
          )
        : 'Asignación: Definitivo';

    let range = getDashboardDateRange(anio, mes);
    setDashboardBadgeFuente({
      fuente: fuente === 'borrador' ? 'Borrador' : 'Definitivo',
      anio: anio,
      mes: mes,
      detalle: detalle,
      rango: getDashboardRangeLabel(range),
    });

    await refreshDashboardSourceCharts(borradorId, anio, mes);
  }

  function getDashboardHeaders() {
    if (typeof app.getHeaders === 'function') return app.getHeaders(false);
    return { Authorization: 'Bearer ' + app.globalState.token };
  }

  /**
   * @param {HTMLSelectElement | null} selectEl
   * @param {string} fallback
   */
  function getSelectOptionText(selectEl, fallback) {
    if (
      !selectEl ||
      selectEl.selectedIndex < 0 ||
      !selectEl.options ||
      !selectEl.options.length
    ) {
      return fallback || '';
    }
    let option = selectEl.options[selectEl.selectedIndex];
    return option && option.textContent ? option.textContent : fallback || '';
  }

  function getDashboardCuadranteFechas() {
    let cuadrante =
      app.asignacionesState && app.asignacionesState.cuadranteSeleccionado;
    if (cuadrante && cuadrante.fecha_inicio && cuadrante.fecha_fin) {
      return {
        fecha_inicio: String(cuadrante.fecha_inicio).split('T')[0],
        fecha_fin: String(cuadrante.fecha_fin).split('T')[0],
      };
    }
    return null;
  }

  function getDashboardMadridTodayIso() {
    let DateTime = window.luxon && window.luxon.DateTime;
    if (DateTime) {
      let dt = DateTime.now().setZone('Europe/Madrid');
      if (dt.isValid) return dt.toISODate();
    }
    return new Date().toISOString().slice(0, 10);
  }

  function getDashboardMonthBounds(anio, mes) {
    let y = Number(anio);
    let m = Number(mes);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      return { start: '', end: '' };
    }
    let start =
      String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-01';
    let endDate = new Date(y, m, 0);
    let end =
      String(endDate.getFullYear()).padStart(4, '0') +
      '-' +
      String(endDate.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(endDate.getDate()).padStart(2, '0');
    return { start: start, end: end };
  }

  function clampIsoDate(value, min, max) {
    let v = String(value || '').slice(0, 10);
    if (!v) return '';
    if (min && v < min) return min;
    if (max && v > max) return max;
    return v;
  }

  function getDashboardRangeBounds(anio, mes) {
    let fechas = getDashboardCuadranteFechas();
    if (fechas && fechas.fecha_inicio && fechas.fecha_fin) {
      return {
        start: String(fechas.fecha_inicio).slice(0, 10),
        end: String(fechas.fecha_fin).slice(0, 10),
      };
    }
    return getDashboardMonthBounds(anio, mes);
  }

  function syncDashboardDateRangeInputs(anio, mes) {
    let fromEl = getInputElement('dashDateFrom');
    let toEl = getInputElement('dashDateTo');
    if (!fromEl || !toEl) return null;

    let bounds = getDashboardRangeBounds(anio, mes);
    let minIso = String(bounds.start || '').slice(0, 10);
    let maxIso = String(bounds.end || '').slice(0, 10);
    if (!minIso || !maxIso) return null;

    fromEl.min = minIso;
    fromEl.max = maxIso;
    toEl.min = minIso;
    toEl.max = maxIso;

    let defaultIso = clampIsoDate(getDashboardMadridTodayIso(), minIso, maxIso);
    let fromVal = clampIsoDate(fromEl.value, minIso, maxIso) || defaultIso;
    let toVal = clampIsoDate(toEl.value, minIso, maxIso) || defaultIso;
    if (fromVal > toVal) toVal = fromVal;

    fromEl.value = fromVal;
    toEl.value = toVal;
    app._dashDateRange = { start: fromVal, end: toVal };
    return app._dashDateRange;
  }

  function getDashboardDateRange(anio, mes) {
    let fromEl = getInputElement('dashDateFrom');
    let toEl = getInputElement('dashDateTo');
    if (!fromEl || !toEl) return syncDashboardDateRangeInputs(anio, mes);

    let bounds = getDashboardRangeBounds(anio, mes);
    let minIso = String(bounds.start || '').slice(0, 10);
    let maxIso = String(bounds.end || '').slice(0, 10);
    if (!minIso || !maxIso) return null;

    let fromVal = clampIsoDate(fromEl.value, minIso, maxIso) || minIso;
    let toVal = clampIsoDate(toEl.value, minIso, maxIso) || maxIso;

    fromEl.value = fromVal;
    toEl.value = toVal;
    app._dashDateRange = { start: fromVal, end: toVal };
    return app._dashDateRange;
  }

  function isoPlusDays(iso, days) {
    let DateTime = window.luxon && window.luxon.DateTime;
    if (DateTime) {
      let dt = DateTime.fromISO(String(iso || ''), { zone: 'Europe/Madrid' });
      if (dt.isValid) return dt.plus({ days: Number(days) || 0 }).toISODate();
    }
    let d = new Date(String(iso || '') + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return String(iso || '');
    d.setDate(d.getDate() + (Number(days) || 0));
    return d.toISOString().slice(0, 10);
  }

  function applyDashboardDatePreset(anio, mes, preset) {
    let fromEl = getInputElement('dashDateFrom');
    let toEl = getInputElement('dashDateTo');
    if (!fromEl || !toEl) return null;

    let bounds = getDashboardRangeBounds(anio, mes);
    let minIso = String(bounds.start || '').slice(0, 10);
    let maxIso = String(bounds.end || '').slice(0, 10);
    if (!minIso || !maxIso) return null;

    let todayIso = clampIsoDate(getDashboardMadridTodayIso(), minIso, maxIso);
    let fromVal = todayIso;
    let toVal = todayIso;

    if (preset === 'all') {
      fromVal = minIso;
      toVal = maxIso;
    } else if (preset === '7d') {
      fromVal = todayIso;
      toVal = clampIsoDate(isoPlusDays(todayIso, 6), minIso, maxIso);
      if (toVal < fromVal) toVal = fromVal;
    }

    fromEl.value = fromVal;
    toEl.value = toVal;
    app._dashDateRange = { start: fromVal, end: toVal };
    return app._dashDateRange;
  }

  function getRowIsoDate(row) {
    if (!row) return '';
    if (row.fecha) return String(row.fecha).slice(0, 10);
    let y = Number(row.anio);
    let m = Number(row.mes);
    let d = Number(row.dia);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
      return '';
    }
    return (
      String(y).padStart(4, '0') +
      '-' +
      String(m).padStart(2, '0') +
      '-' +
      String(d).padStart(2, '0')
    );
  }

  function filterRowsByDashboardDateRange(rows, range) {
    let list = Array.isArray(rows) ? rows : [];
    if (!range || !range.start || !range.end) return list;
    return list.filter(function (row) {
      let iso = getRowIsoDate(row);
      if (!iso) return false;
      return iso >= range.start && iso <= range.end;
    });
  }

  function getDashboardRangeLabel(range) {
    if (!range || !range.start || !range.end) return '';
    return range.start + ' a ' + range.end;
  }

  async function ensureDashboardCuadranteContext(anio, mes, headers) {
    if (!app.asignacionesState) return null;

    let selected = app.asignacionesState.cuadranteSeleccionado;
    if (
      selected &&
      Number(selected.anio_referencia) === Number(anio) &&
      Number(selected.mes_referencia) === Number(mes) &&
      selected.fecha_inicio &&
      selected.fecha_fin
    ) {
      return selected;
    }

    let cacheKey = String(anio) + '-' + String(mes);
    if (
      app._dashCuadranteContextKey === cacheKey &&
      app._dashCuadranteContext &&
      app._dashCuadranteContext.fecha_inicio &&
      app._dashCuadranteContext.fecha_fin
    ) {
      app.asignacionesState.cuadranteSeleccionado = app._dashCuadranteContext;
      return app._dashCuadranteContext;
    }

    let listRes = await fetch('/api/cuadrantes', {
      headers: headers,
      cache: 'no-store',
    });
    if (!listRes.ok) {
      throw new Error('No se pudieron cargar los cuadrantes del período.');
    }

    let listJson = await listRes.json();
    let cuadrantes = Array.isArray(listJson.data) ? listJson.data : [];
    let matches = cuadrantes.filter(function (item) {
      return (
        item &&
        item.estado !== 'archivado' &&
        Number(item.anio_referencia) === Number(anio) &&
        Number(item.mes_referencia) === Number(mes)
      );
    });
    if (!matches.length) {
      app._dashCuadranteContextKey = cacheKey;
      app._dashCuadranteContext = null;
      app.asignacionesState.cuadranteSeleccionado = null;
      return null;
    }

    let preferred =
      matches.find(function (item) {
        return String(item.estado || '').toLowerCase() === 'activo';
      }) || matches[0];

    let detailRes = await fetch('/api/cuadrantes/' + preferred.id, {
      headers: headers,
      cache: 'no-store',
    });
    if (!detailRes.ok) {
      throw new Error('No se pudo cargar el detalle del cuadrante.');
    }

    let detailJson = await detailRes.json();
    let cuadrante = detailJson && detailJson.data ? detailJson.data : null;

    app._dashCuadranteContextKey = cacheKey;
    app._dashCuadranteContext = cuadrante;
    app.asignacionesState.cuadranteSeleccionado = cuadrante || null;
    if (cuadrante) {
      app.asignacionesState.anio = Number(cuadrante.anio_referencia) || null;
      app.asignacionesState.mes = Number(cuadrante.mes_referencia) || null;
    }

    return cuadrante;
  }

  function buildCuadranteDashboardUrl(anio, mes, borradorId) {
    let base = '/api/asignaciones/cuadrante/' + anio + '/' + mes;
    let params = [];

    if (!borradorId) {
      if ((app._dashHeatmapSource || 'borrador') === 'definitivo') {
        params.push('source=definitivo');
      }
    } else {
      params.push('borrador_id=' + encodeURIComponent(String(borradorId)));
    }

    return base + (params.length ? '?' + params.join('&') : '');
  }

  function getDashboardCuadrantePeriodos(anio, mes) {
    let fechas = getDashboardCuadranteFechas();
    let DateTime = window.luxon && window.luxon.DateTime;
    if (!DateTime || !fechas || !fechas.fecha_inicio || !fechas.fecha_fin) {
      return [{ anio: Number(anio), mes: Number(mes) }];
    }

    let inicio = DateTime.fromISO(String(fechas.fecha_inicio), {
      zone: 'Europe/Madrid',
    }).startOf('month');
    let fin = DateTime.fromISO(String(fechas.fecha_fin), {
      zone: 'Europe/Madrid',
    }).startOf('month');

    if (!inicio.isValid || !fin.isValid || inicio > fin) {
      return [{ anio: Number(anio), mes: Number(mes) }];
    }

    let periodos = [];
    let cursor = inicio;
    while (cursor <= fin) {
      periodos.push({ anio: cursor.year, mes: cursor.month });
      cursor = cursor.plus({ months: 1 });
    }

    return periodos.length
      ? periodos
      : [{ anio: Number(anio), mes: Number(mes) }];
  }

  async function fetchDashboardCuadranteData(anio, mes, borradorId, headers) {
    let periodos = getDashboardCuadrantePeriodos(anio, mes);
    let requests = periodos.map(function (p) {
      return fetch(buildCuadranteDashboardUrl(p.anio, p.mes, borradorId), {
        headers: headers,
      });
    });
    let responses = await Promise.all(requests);
    let firstBad = responses.find(function (r) {
      return !r.ok;
    });
    if (firstBad) {
      throw new Error('Error al cargar cuadrante (' + firstBad.status + ')');
    }

    let payloads = await Promise.all(
      responses.map(function (r) {
        return r.json();
      })
    );
    if (!payloads.length) return { ok: true };
    if (payloads.length === 1) return payloads[0];

    let merged = {
      ok: true,
      control: payloads[0].control || {
        estado: 'sin_borrador',
        borrador_id: null,
      },
      borrador: [],
      borradorServicios: [],
      definitivo: [],
      definitivoServicios: [],
    };

    payloads.forEach(function (p) {
      if (Array.isArray(p.borrador)) {
        merged.borrador = merged.borrador.concat(p.borrador);
      }
      if (Array.isArray(p.borradorServicios)) {
        merged.borradorServicios = merged.borradorServicios.concat(
          p.borradorServicios
        );
      }
      if (Array.isArray(p.definitivo)) {
        merged.definitivo = merged.definitivo.concat(p.definitivo);
      }
      if (Array.isArray(p.definitivoServicios)) {
        merged.definitivoServicios = merged.definitivoServicios.concat(
          p.definitivoServicios
        );
      }
    });

    return merged;
  }

  function renderDashboardNoFuenteData(message) {
    ['chartHeatmap2', 'chartGrupoNivel3Stack', 'chartMatrix', 'chartSituacion'].forEach(
      function (elId) {
        let el = document.getElementById(elId);
        if (el) el.style.display = 'none';
        if (app._dashCharts && app._dashCharts[elId]) {
          try {
            app._dashCharts[elId].dispose();
          } catch (e) {
            // noop
          }
          delete app._dashCharts[elId];
        }
      }
    );
    [
      'chartHeatmap2Placeholder',
      'chartGrupoNivel3StackPlaceholder',
      'chartMatrixPlaceholder',
      'chartActividadPlaceholder',
    ].forEach(function (elId) {
      let ph = document.getElementById(elId);
      if (!ph) return;
      let icon = 'bi bi-grid';
      if (elId === 'chartHeatmap2Placeholder') icon = 'bi bi-bar-chart';
      if (elId === 'chartGrupoNivel3StackPlaceholder') icon = 'bi bi-bar-chart';
      if (elId === 'chartMatrixPlaceholder') icon = 'bi bi-grid-3x3-gap';
      if (elId === 'chartActividadPlaceholder') icon = 'bi bi-pie-chart';
      ph.innerHTML =
        '<i class="' +
        icon +
        ' d-block fs-1 opacity-25 mb-2"></i>' +
        app.escapeHtml(message);
      ph.style.display = '';
    });
  }

  // ── Heatmap: cargar select de borradores / fuente ─────────────────────
  app.loadDashboardBorradores = async function loadDashboardBorradores() {
    let sel = ensureDashboardBorradorControlExists();
    if (!sel) return;

    let mesSel = getSelectElement('dashHeatmapMesSel');
    let fuenteSel = getSelectElement('dashDataSourceSel');
    let anioSel = getSelectElement('dashHeatmapAnioSel');

    let now = new Date();
    let source = getDashboardFuenteSeleccionada();
    // Mantener visibilidad del selector alineada con la fuente seleccionada en todo momento.
    setDashboardBorradorControlsVisible(source === 'borrador');

    // Cargar y poblar períodos efectivos disponibles (definitivo y/o borrador con datos)
    let headers = getDashboardHeaders();
    let periodos = [];
    try {
      let periodosRes = await fetch(
        '/api/asignaciones/periodos-disponibles?source=' +
          encodeURIComponent(source),
        { headers: headers, cache: 'no-store' }
      );
      if (!periodosRes.ok)
        throw new Error('No se pudieron cargar períodos efectivos.');
      let periodosJson = await periodosRes.json();
      periodos = buildDashboardPeriodos(
        Array.isArray(periodosJson.periodos) ? periodosJson.periodos : []
      );
    } catch (periodosError) {
      // Fallback de compatibilidad: períodos por cuadrantes
      let cuadrantesRes = await fetch('/api/cuadrantes', {
        headers: headers,
        cache: 'no-store',
      });
      if (!cuadrantesRes.ok)
        throw new Error(
          'No se pudieron cargar los períodos disponibles del dashboard.'
        );
      let cuadrantesJson = await cuadrantesRes.json();
      let cuadrantes = Array.isArray(cuadrantesJson.data)
        ? cuadrantesJson.data
        : [];
      periodos = buildDashboardPeriodos(cuadrantes);
    }

    // Primera carga: vincular eventos
    if (mesSel && !mesSel.dataset.bound) {
      mesSel.dataset.bound = '1';
      mesSel.addEventListener('change', function () {
        app.loadDashboardBorradores();
      });
    }
    if (anioSel && !anioSel.dataset.bound) {
      anioSel.dataset.bound = '1';
      anioSel.addEventListener('change', function () {
        app.loadDashboardBorradores();
      });
    }
    if (fuenteSel && !fuenteSel.dataset.bound) {
      fuenteSel.dataset.bound = '1';
      fuenteSel.addEventListener('change', function () {
        setDashboardBorradorControlsVisible(
          getDashboardFuenteSeleccionada() === 'borrador'
        );
        app.loadDashboardBorradores();
      });
    }
    let fromEl = getInputElement('dashDateFrom');
    let toEl = getInputElement('dashDateTo');
    let presetWrap = document.getElementById('dashDatePresetWrap');
    if (fromEl && !fromEl.dataset.bound) {
      fromEl.dataset.bound = '1';
      fromEl.addEventListener('change', function () {
        // Cuando cambia la fecha inicio, también cambiar la fecha final al mismo valor
        if (toEl && fromEl.value) {
          toEl.value = fromEl.value;
        }
        refreshDashboardFromCurrentFilters();
      });
    }
    if (toEl && !toEl.dataset.bound) {
      toEl.dataset.bound = '1';
      toEl.addEventListener('change', function () {
        refreshDashboardFromCurrentFilters();
      });
    }
    if (presetWrap && !presetWrap.dataset.bound) {
      presetWrap.dataset.bound = '1';
      presetWrap.addEventListener('click', function (ev) {
        if (!isHtmlElement(ev.target)) return;
        let target = ev.target.closest('[data-preset]');
        if (!target) return;
        let preset = String(
          target.getAttribute('data-preset') || ''
        ).toLowerCase();
        let p = app._dashHeatmapPeriod || {};
        let range = applyDashboardDatePreset(p.anio, p.mes, preset);
        if (!range) return;
        refreshDashboardFromCurrentFilters();
      });
    }

    let selected = populateDashboardPeriodoSelectors(
      periodos,
      anioSel ? Number(anioSel.value || 0) : now.getFullYear(),
      mesSel ? Number(mesSel.value || 0) : now.getMonth() + 1
    );
    let anio = selected.anio;
    let mes = selected.mes;

    if (!anio || !mes) {
      setDashboardSelectorsNoData();
      setDashboardNoDataInfo(
        'No hay cuadrantes disponibles para la ARS activa.'
      );
      setDashboardBorradorControlsVisible(source === 'borrador');
      renderDashboardNoFuenteData(
        'No hay períodos disponibles para la ARS activa.'
      );
      setDashboardBadgeFuente({
        fuente: '—',
        anio: null,
        mes: null,
        detalle: 'Detalle: —',
      });
      return;
    }

    app._dashHeatmapPeriod = { anio: anio, mes: mes };
    app._dashHeatmapSource = getDashboardFuenteSeleccionada();

    try {
      await ensureDashboardCuadranteContext(anio, mes, headers);
    } catch (cuadranteError) {
      // Sin contexto de cuadrante, los gráficos siguen operativos por período.
      console.warn('[Dashboard] Contexto de cuadrante no disponible:', {
        anio: anio,
        mes: mes,
        message: cuadranteError && cuadranteError.message,
      });
    }

    let activeRange = syncDashboardDateRangeInputs(anio, mes);

    let fuente = app._dashHeatmapSource;
    let isBorradorSource = fuente === 'borrador';
    setDashboardBorradorControlsVisible(isBorradorSource);
    ensureDashboardPeriodoControlsVisible();
    setDashboardNoDataInfo('');

    if (!isBorradorSource) {
      setDashboardBadgeFuente({
        fuente: 'Definitivo',
        anio: anio,
        mes: mes,
        detalle: 'Asignación: Definitivo',
        rango: getDashboardRangeLabel(activeRange),
      });
      await refreshDashboardSourceCharts(null, anio, mes);
      return;
    }

    let loadingHtml = '<option value="">Cargando borradores...</option>';
    sel.innerHTML = loadingHtml;
    setDashboardBadgeFuente({
      fuente: 'Borrador',
      anio: anio,
      mes: mes,
      detalle: 'Borrador: Cargando...',
      rango: getDashboardRangeLabel(activeRange),
    });
    try {
      let res = await fetch(
        '/api/asignaciones/borradores/' + anio + '/' + mes,
        { headers }
      );
      if (!res.ok) throw new Error('No se pudieron cargar los borradores');
      let data = await res.json();
      let borradores = Array.isArray(data) ? data : data.borradores || [];

      if (!borradores.length) {
        let noDataHtml = '<option value="">Sin datos...</option>';
        sel.innerHTML = noDataHtml;
        setDashboardBorradorControlsVisible(true);

        setDashboardBadgeFuente({
          fuente: 'Borrador',
          anio: anio,
          mes: mes,
          detalle: 'Borrador: Sin datos',
          rango: getDashboardRangeLabel(activeRange),
        });
        setDashboardNoDataInfo(
          'Sin borradores disponibles para el período seleccionado.'
        );
        renderDashboardNoFuenteData('Sin borradores para este período.');
        return;
      }

      let optionsHtml = borradores
        .map(function (b) {
          let label = app.escapeHtml(
            (b.nombre || 'Borrador') +
              ' v' +
              (b.version || 1) +
              (b.estado === 'validado' ? ' ✅' : '')
          );
          return '<option value="' + b.id + '">' + label + '</option>';
        })
        .join('');

      sel.innerHTML = optionsHtml;

      // Vincular evento change (una sola vez)
      if (!sel.dataset.bound) {
        sel.dataset.bound = '1';
        sel.addEventListener('change', function () {
          let p = app._dashHeatmapPeriod || {};
          if (sel.value) {
            setDashboardBadgeFuente({
              fuente: 'Borrador',
              anio: p.anio,
              mes: p.mes,
              detalle: 'Borrador: ' + getSelectOptionText(sel, 'Borrador'),
              rango: getDashboardRangeLabel(getDashboardDateRange(p.anio, p.mes)),
            });
            refreshDashboardSourceCharts(sel.value, p.anio, p.mes);
          } else {
            renderDashboardNoFuenteData(
              'Selecciona un borrador para visualizar los gráficos.'
            );
          }
        });
      }

      // Auto-cargar el primero
      let selectedId = String((borradores[0] && borradores[0].id) || '');
      if (!selectedId) {
        renderDashboardNoFuenteData(
          'No se pudo resolver un borrador válido para este período.'
        );
        return;
      }
      sel.value = selectedId;
      setDashboardNoDataInfo('');
      setDashboardBadgeFuente({
        fuente: 'Borrador',
        anio: anio,
        mes: mes,
        detalle: 'Borrador: ' + getSelectOptionText(sel, 'Borrador'),
        rango: getDashboardRangeLabel(activeRange),
      });
      await refreshDashboardSourceCharts(selectedId, anio, mes);
    } catch (e) {
      let errHtml = '<option value="">Error al cargar borradores</option>';
      sel.innerHTML = errHtml;
      setDashboardBorradorControlsVisible(source === 'borrador');
      setDashboardNoDataInfo(
        'No se pudieron cargar datos para los filtros seleccionados.'
      );
      setDashboardBadgeFuente({
        fuente: 'Borrador',
        anio: anio,
        mes: mes,
        detalle: 'Borrador: Error de carga',
        rango: getDashboardRangeLabel(activeRange),
      });
      renderDashboardNoFuenteData('Error al cargar borradores del período.');
      console.error('[Dashboard][Heatmap]', e.message);
    }
  };

  // ── Donut actividades: renderizar ─────────────────────────────────────
  app.refreshDashboardActividadesDonut =
    async function refreshDashboardActividadesDonut(borradorId, anio, mes) {
      if (!app._dashCharts) app._dashCharts = {};

      let chartEl = document.getElementById('chartSituacion');
      let placeholder = document.getElementById('chartActividadPlaceholder');
      let loading = document.getElementById('chartActividadLoading');
      if (!chartEl) return;

      if (placeholder) placeholder.style.display = 'none';
      if (loading) loading.style.display = 'block';
      chartEl.style.display = 'none';

      try {
        let headers = getDashboardHeaders();
        let [cuadData, actsRes] = await Promise.all([
          fetchDashboardCuadranteData(anio, mes, borradorId, headers),
          fetch('/api/actividades', { headers: headers }),
        ]);

        if (!actsRes.ok) {
          throw new Error('Error al cargar actividades (' + actsRes.status + ')');
        }

        let actsData = await actsRes.json();
        let actsList = Array.isArray(actsData)
          ? actsData
          : Array.isArray(actsData.actividades)
            ? actsData.actividades
            : Array.isArray(actsData.data)
              ? actsData.data
              : [];
        let actMetaMap = new Map();
        actsList.forEach(function (a) {
          let id = Number(a.id_actividad || a.id);
          if (!Number.isInteger(id) || id <= 0) return;
          let codigo = String(a.actividad || a.codigo || '').trim();
          let nombre = String(a.nombre || '').trim();
          let label =
            codigo && nombre && codigo !== nombre
              ? codigo + ' · ' + nombre
              : nombre || codigo || '#' + String(id);
          actMetaMap.set(id, label);
        });

        let isBorrador = !!(
          cuadData &&
          cuadData.control &&
          cuadData.control.borrador_id &&
          cuadData.control.estado !== 'sin_borrador'
        );
        let rows = isBorrador
          ? Array.isArray(cuadData.borrador)
            ? cuadData.borrador
            : []
          : Array.isArray(cuadData.definitivo)
            ? cuadData.definitivo
            : [];
        let dateRange = getDashboardDateRange(anio, mes);
        rows = filterRowsByDashboardDateRange(rows, dateRange);
        let servicios = isBorrador
          ? Array.isArray(cuadData.borradorServicios)
            ? cuadData.borradorServicios
            : []
          : Array.isArray(cuadData.definitivoServicios)
            ? cuadData.definitivoServicios
            : [];
        let servicioKeyField = isBorrador
          ? 'asignacion_borrador_id'
          : 'asignacion_id';

        let serviciosByAsig = new Map();
        servicios.forEach(function (s) {
          let asigId = Number(s && s[servicioKeyField]);
          let actId = Number(s && s.actividad_id);
          if (!Number.isInteger(asigId) || asigId <= 0) return;
          if (!Number.isInteger(actId) || actId <= 0) return;
          if (!serviciosByAsig.has(asigId)) serviciosByAsig.set(asigId, []);
          serviciosByAsig.get(asigId).push(actId);
        });

        let actividadAgents = new Map();
        rows.forEach(function (row) {
          let agenteId = Number(row && row.agente_id);
          if (!Number.isInteger(agenteId) || agenteId <= 0) return;
          let acts = serviciosByAsig.get(Number(row && row.id)) || [];
          let uniqueActs = new Set(acts);
          uniqueActs.forEach(function (actId) {
            if (!actividadAgents.has(actId)) actividadAgents.set(actId, new Set());
            actividadAgents.get(actId).add(agenteId);
          });
        });

        let acts = [];
        actividadAgents.forEach(function (agentsSet, actId) {
          let count = agentsSet ? agentsSet.size : 0;
          if (!count) return;
          acts.push({
            label: actMetaMap.get(actId) || '#' + String(actId),
            count: count,
          });
        });

        if (loading) loading.style.display = 'none';

        if (!acts.length) {
          if (placeholder) {
            placeholder.innerHTML =
              '<i class="bi bi-pie-chart d-block fs-1 opacity-25 mb-2"></i>Sin actividades en el rango de días seleccionado.';
            placeholder.style.display = '';
          }
          return;
        }

        chartEl.style.display = 'block';

        if (app._dashCharts['chartSituacion']) {
          try {
            app._dashCharts['chartSituacion'].dispose();
          } catch (e) {
            // noop
          }
        }
        let chart = echarts.init(chartEl, null, { renderer: 'svg' });
        app._dashCharts['chartSituacion'] = chart;

        acts.sort(function (a, b) {
          return b.count - a.count;
        });

        let actData = acts.map(function (d) {
          return {
            value: d.count,
            name: d.label,
          };
        });

        chart.setOption({
          tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
          series: [
            {
              type: 'pie',
              radius: ['40%', '68%'],
              center: ['50%', '50%'],
              avoidLabelOverlap: true,
              label: {
                show: true,
                formatter: '{b}\n{d}%',
                fontSize: 10,
                lineHeight: 14,
              },
              labelLine: { length: 8, length2: 6 },
              emphasis: {
                label: { show: true, fontSize: 12, fontWeight: 'bold' },
              },
              data: actData,
            },
          ],
        });
      } catch (e) {
        if (loading) loading.style.display = 'none';
        if (placeholder) {
          placeholder.innerHTML =
            '<i class="bi bi-pie-chart d-block fs-1 opacity-25 mb-2"></i>Error al cargar actividades.';
          placeholder.style.display = '';
        }
        console.error('[Dashboard][ActividadesDonut]', e.message);
      }
    };

  async function loadDashboardTemporalContext(borradorId, anio, mes) {
    let headers = getDashboardHeaders();
    let [cuadData, metaRes] = await Promise.all([
      fetchDashboardCuadranteData(anio, mes, borradorId, headers),
      fetch('/api/asignaciones/meta', { headers: headers }),
    ]);

    if (!metaRes.ok) {
      throw new Error(
        'Error al cargar metadatos de actividades (' + metaRes.status + ')'
      );
    }

    let metaData = await metaRes.json();
    let isBorrador = !!(
      cuadData &&
      cuadData.control &&
      cuadData.control.borrador_id &&
      cuadData.control.estado !== 'sin_borrador'
    );

    let rows = isBorrador
      ? Array.isArray(cuadData.borrador)
        ? cuadData.borrador
        : []
      : Array.isArray(cuadData.definitivo)
        ? cuadData.definitivo
        : [];

    let dateRange = getDashboardDateRange(anio, mes);
    rows = filterRowsByDashboardDateRange(rows, dateRange);

    let servicios = isBorrador
      ? Array.isArray(cuadData.borradorServicios)
        ? cuadData.borradorServicios
        : []
      : Array.isArray(cuadData.definitivoServicios)
        ? cuadData.definitivoServicios
        : [];

    return {
      headers: headers,
      cuadData: cuadData,
      metaData: metaData,
      rows: rows,
      servicios: servicios,
      servicioKeyField: isBorrador ? 'asignacion_borrador_id' : 'asignacion_id',
      dateRange: dateRange,
      isBorrador: isBorrador,
    };
  }

  app.refreshDashboardGrupoNivel3Stack =
    async function refreshDashboardGrupoNivel3Stack(borradorId, anio, mes) {
      if (!app._dashCharts) app._dashCharts = {};
      let GC_GREEN = app._gcColor || '#276836';

      let chartId = 'chartGrupoNivel3Stack';
      let chartEl = document.getElementById(chartId);
      let placeholder = document.getElementById('chartGrupoNivel3StackPlaceholder');
      let loading = document.getElementById('chartGrupoNivel3StackLoading');
      if (!chartEl) return;

      function disposeChart() {
        if (app._dashCharts[chartId]) {
          try {
            app._dashCharts[chartId].dispose();
          } catch (_e) {
            // noop
          }
          delete app._dashCharts[chartId];
        }
      }

      function renderPlaceholder(message) {
        disposeChart();
        if (loading) loading.style.display = 'none';
        chartEl.style.display = 'none';
        if (placeholder) {
          placeholder.innerHTML =
            '<i class="bi bi-bar-chart d-block fs-1 opacity-25 mb-2"></i>' +
            app.escapeHtml(message);
          placeholder.style.display = '';
        }
      }

      if (placeholder) placeholder.style.display = 'none';
      if (loading) loading.style.display = 'block';
      chartEl.style.display = 'none';

      try {
        let contexto = await loadDashboardTemporalContext(borradorId, anio, mes);
        let rows = contexto.rows;
        let servicios = contexto.servicios;
        let servicioKeyField = contexto.servicioKeyField;
        let actividades = Array.isArray(contexto.metaData.actividades)
          ? contexto.metaData.actividades
          : [];

        if (!rows.length || !servicios.length) {
          renderPlaceholder(
            'La fuente seleccionada no tiene asignaciones en el rango de días.'
          );
          return;
        }

        let actividadToCategoria = new Map();
        let actividadDetalleMeta = new Map();
        let detailColorByLabel = new Map();
        let categorias = new Map();
        actividades.forEach(function (actividad) {
          let actividadId = Number(actividad && actividad.id_actividad);
          if (!Number.isInteger(actividadId) || actividadId <= 0) return;

          // Solo nivel 3 (NO DISPONIBLES)
          let nivelOrden = Number(actividad && actividad.nivel_grupo_orden);
          if (nivelOrden !== 3) return;

          // Categoría = grupo_actividad (dentro del nivel 3)
          let categoriaNombre = String(
            (actividad && actividad.grupo_nombre) || ''
          ).trim();
          if (!categoriaNombre) categoriaNombre = 'Sin grupo';

          // Color de categoría = color del grupo_actividad
          let categoriaColor =
            normalizeDashboardColor(actividad && actividad.grupo_color) ||
            normalizeDashboardColor(actividad && actividad.nivel_grupo_color) ||
            GC_GREEN;

          let codigo = String(actividad && (actividad.codigo || actividad.actividad) || '').trim();
          let nombre = String(actividad && actividad.nombre || '').trim();
          let detalleLabel =
            codigo && nombre && codigo !== nombre
              ? codigo + ' · ' + nombre
              : nombre || codigo || '#' + String(actividadId);
          let detalleColor =
            normalizeDashboardColor(actividad && actividad.actividad_color) ||
            categoriaColor ||
            GC_GREEN;

          actividadToCategoria.set(actividadId, categoriaNombre);
          actividadDetalleMeta.set(actividadId, {
            label: detalleLabel,
            color: detalleColor,
          });
          if (!detailColorByLabel.has(detalleLabel)) {
            detailColorByLabel.set(detalleLabel, detalleColor);
          }

          if (!categorias.has(categoriaNombre)) {
            categorias.set(categoriaNombre, {
              nombre: categoriaNombre,
              color: categoriaColor,
            });
          }
        });

        if (!categorias.size) {
          renderPlaceholder('No hay grupos de actividades NO DISPONIBLES (nivel 3) en el meta.');
          return;
        }

        let categoriasByAsignacion = new Map();
        servicios.forEach(function (servicio) {
          let asignacionId = Number(servicio && servicio[servicioKeyField]);
          let actividadId = Number(servicio && servicio.actividad_id);
          let categoriaNombre = actividadToCategoria.get(actividadId);
          let detalleMeta = actividadDetalleMeta.get(actividadId);
          if (!Number.isInteger(asignacionId) || asignacionId <= 0) return;
          if (!categoriaNombre) return;
          if (!detalleMeta) return;
          if (!categoriasByAsignacion.has(asignacionId)) {
            categoriasByAsignacion.set(asignacionId, []);
          }
          categoriasByAsignacion.get(asignacionId).push({
            categoriaNombre: categoriaNombre,
            detalleLabel: detalleMeta.label,
          });
        });

        let dayCategoriaDetailAgents = new Map();
        rows.forEach(function (row) {
          let asignacionId = Number(row && row.id);
          let agenteId = Number(row && row.agente_id);
          let iso = String(row && row.fecha || '').slice(0, 10);
          let itemsAsignacion = categoriasByAsignacion.get(asignacionId);
          if (!Number.isInteger(asignacionId) || asignacionId <= 0) return;
          if (!Number.isInteger(agenteId) || agenteId <= 0) return;
          if (!iso) return;
          if (!itemsAsignacion || !itemsAsignacion.length) return;

          if (!dayCategoriaDetailAgents.has(iso)) dayCategoriaDetailAgents.set(iso, new Map());
          itemsAsignacion.forEach(function (item) {
            let dayMap = dayCategoriaDetailAgents.get(iso);
            if (!dayMap.has(item.categoriaNombre)) {
              dayMap.set(item.categoriaNombre, new Map());
            }
            let categoryMap = dayMap.get(item.categoriaNombre);
            if (!categoryMap.has(item.detalleLabel)) {
              categoryMap.set(item.detalleLabel, new Set());
            }
            categoryMap.get(item.detalleLabel).add(agenteId);
          });
        });

        let fechas = Array.from(dayCategoriaDetailAgents.keys()).sort(function (a, b) {
          return a.localeCompare(b);
        });

        if (!fechas.length) {
          renderPlaceholder(
            'Sin agentes asociados a categorías en la fuente seleccionada.'
          );
          return;
        }

        let categoriasArr = Array.from(categorias.entries())
          .map(function (entry) {
            let categoriaNombre = entry[0];
            let meta = entry[1] || {};
            let detailTotals = new Map();

            fechas.forEach(function (iso) {
              let dayMap = dayCategoriaDetailAgents.get(iso);
              let categoryMap = dayMap ? dayMap.get(categoriaNombre) : null;
              if (!categoryMap) return;
              categoryMap.forEach(function (agentsSet, detalleLabel) {
                let current = detailTotals.get(detalleLabel) || 0;
                detailTotals.set(detalleLabel, current + (agentsSet ? agentsSet.size : 0));
              });
            });

            let details = Array.from(detailTotals.entries())
              .map(function (detailEntry) {
                let detailLabel = detailEntry[0];
                let total = detailEntry[1] || 0;
                let detalleColor = detailColorByLabel.get(detailLabel) || GC_GREEN;
                return {
                  label: detailLabel,
                  color: detalleColor,
                  total: total,
                };
              })
              .filter(function (item) {
                return item.total > 0;
              })
              .sort(function (a, b) {
                if (b.total !== a.total) return b.total - a.total;
                return String(a.label || '').localeCompare(
                  String(b.label || ''),
                  'es',
                  { sensitivity: 'base' }
                );
              });

            let total = details.reduce(function (sum, detail) {
              return sum + (detail.total || 0);
            }, 0);

            return {
              id: categoriaNombre,
              nombre: meta.nombre || categoriaNombre,
              color: meta.color || GC_GREEN,
              total: total,
              details: details,
            };
          })
          .filter(function (item) {
            return item.total > 0;
          })
          .sort(function (a, b) {
            if (b.total !== a.total) return b.total - a.total;
            return String(a.nombre || '').localeCompare(
              String(b.nombre || ''),
              'es',
              { sensitivity: 'base' }
            );
          });

        if (!categoriasArr.length) {
          renderPlaceholder(
            'Sin agentes asociados a categorías en la fuente seleccionada.'
          );
          return;
        }

        disposeChart();
        if (loading) loading.style.display = 'none';
        chartEl.style.display = 'block';
        let chart = echarts.init(chartEl, null, { renderer: 'svg' });
        app._dashCharts[chartId] = chart;

        let DateTime = window.luxon && window.luxon.DateTime;
        let xLabels = fechas.map(function (iso) {
          if (!DateTime) return iso;
          let dt = DateTime.fromISO(iso, { zone: 'Europe/Madrid' });
          return dt.isValid ? dt.toFormat('dd/LL') : iso;
        });

        chart.setOption({
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: function (params) {
              let idx = params && params.length ? params[0].dataIndex : 0;
              let fecha = fechas[idx] || '';
              let title = fecha;
              if (DateTime) {
                let dt = DateTime.fromISO(fecha, { zone: 'Europe/Madrid' });
                if (dt.isValid) title = dt.toFormat('dd/LL/yyyy');
              }
              let rows = (params || [])
                .filter(function (p) {
                  return Number(p.value) > 0;
                })
                .map(function (p) {
                  let detalle =
                    p && p.data && typeof p.data === 'object' && p.data.detail
                      ? String(p.data.detail)
                      : '';
                  return (
                    p.marker +
                    ' ' +
                    app.escapeHtml(
                      detalle
                        ? String(p.seriesName || '') + ' · ' + detalle
                        : String(p.seriesName || '')
                    ) +
                    ': <b>' +
                    p.value +
                    '</b>'
                  );
                });
              return (
                '<b>' +
                app.escapeHtml(title) +
                '</b><br/>' +
                (rows.join('<br/>') || 'Sin datos')
              );
            },
          },
          legend: {
            top: 0,
            type: 'scroll',
            textStyle: { fontSize: 10 },
          },
          grid: {
            left: 10,
            right: 12,
            top: 42,
            bottom: xLabels.length > 10 ? 58 : 40,
            containLabel: true,
          },
          xAxis: {
            type: 'category',
            data: xLabels,
            axisLabel: {
              fontSize: 10,
              rotate: xLabels.length > 10 ? 40 : 0,
            },
          },
          yAxis: {
            type: 'value',
            minInterval: 1,
            name: 'Agentes',
            nameTextStyle: { fontSize: 10 },
            axisLabel: { fontSize: 10 },
          },
          series: categoriasArr.reduce(function (seriesList, item) {
            let stackKey = 'categoria-' + String(item.id);
            item.details.forEach(function (detail) {
              seriesList.push({
                name: item.nombre,
                type: 'bar',
                stack: stackKey,
                barMaxWidth: 24,
                itemStyle: { color: detail.color || item.color || GC_GREEN },
                emphasis: { focus: 'series' },
                data: fechas.map(function (iso) {
                  let dayMap = dayCategoriaDetailAgents.get(iso);
                  let categoryMap = dayMap ? dayMap.get(item.id) : null;
                  let agents = categoryMap ? categoryMap.get(detail.label) : null;
                  return {
                    value: agents ? agents.size : 0,
                    detail: detail.label,
                  };
                }),
              });
            });
            return seriesList;
          }, []),
        });
      } catch (error) {
        renderPlaceholder('Error al cargar grupos de actividad de nivel 3.');
        console.error('[Dashboard][GrupoNivel3Stack]', error.message);
      }
    };

  // ── Barras apiladas: fecha × nivel de grupo (agentes) ──────────────────
  app.refreshDashboardNivelGrupoStack =
    async function refreshDashboardNivelGrupoStack(borradorId, anio, mes) {
      if (!app._dashCharts) app._dashCharts = {};

      let chartEl = document.getElementById('chartHeatmap2');

  // ── Matriz: actividad × día (agentes únicos) ─────────────────────────
  app.refreshDashboardPelotonActividadMatrix =
    async function refreshDashboardPelotonActividadMatrix(borradorId, anio, mes) {
      if (!app._dashCharts) app._dashCharts = {};

      let chartEl = document.getElementById('chartMatrix');
      let placeholder = document.getElementById('chartMatrixPlaceholder');
      let loading = document.getElementById('chartMatrixLoading');
      if (!chartEl) return;

      if (placeholder) placeholder.style.display = 'none';
      if (loading) loading.style.display = 'block';
      chartEl.style.display = 'none';

      function normalizeCssColor(value) {
        let raw = String(value || '').trim();
        if (!raw) return '';
        if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
        if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw;
        if (/^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
        return '';
      }

      try {
        let headers = getDashboardHeaders();
        let [cuadData, metaRes] = await Promise.all([
          fetchDashboardCuadranteData(anio, mes, borradorId, headers),
          fetch('/api/asignaciones/meta', { headers: headers }),
        ]);

        let actividadesMeta = [];
        if (metaRes && metaRes.ok) {
          let metaJson = await metaRes.json();
          actividadesMeta = Array.isArray(metaJson && metaJson.actividades)
            ? metaJson.actividades
            : [];
        }

        let actNivelColorById = new Map();
        actividadesMeta.forEach(function (a) {
          let actId = Number(a && a.id_actividad);
          if (!Number.isInteger(actId) || actId <= 0) return;
          let color = normalizeCssColor(a && a.nivel_grupo_color);
          if (color) actNivelColorById.set(actId, color);
        });

        let isBorrador = !!(
          cuadData &&
          cuadData.control &&
          cuadData.control.borrador_id &&
          cuadData.control.estado !== 'sin_borrador'
        );

        let rows = isBorrador
          ? Array.isArray(cuadData.borrador)
            ? cuadData.borrador
            : []
          : Array.isArray(cuadData.definitivo)
            ? cuadData.definitivo
            : [];

        let dateRange = getDashboardDateRange(anio, mes);
        rows = filterRowsByDashboardDateRange(rows, dateRange);

        let servicios = isBorrador
          ? Array.isArray(cuadData.borradorServicios)
            ? cuadData.borradorServicios
            : []
          : Array.isArray(cuadData.definitivoServicios)
            ? cuadData.definitivoServicios
            : [];

        let servicioKeyField = isBorrador
          ? 'asignacion_borrador_id'
          : 'asignacion_id';

        if (!rows.length || !servicios.length) {
          if (loading) loading.style.display = 'none';
          if (placeholder) {
            placeholder.innerHTML =
              '<i class="bi bi-grid-3x3-gap d-block fs-1 opacity-25 mb-2"></i>Sin datos para construir la matriz en el rango seleccionado.';
            placeholder.style.display = '';
          }
          return;
        }

        let actividadColorMap = new Map();
        let serviciosByAsig = new Map();
        servicios.forEach(function (s) {
          let asigId = Number(s && s[servicioKeyField]);
          if (!Number.isInteger(asigId) || asigId <= 0) return;
          let actName =
            String((s && (s.actividad_nombre || s.actividad_codigo)) || '').trim() ||
            (s && s.actividad_id ? '#' + s.actividad_id : 'Sin actividad');
          let actId = Number(s && s.actividad_id);
          let actColor = Number.isInteger(actId) ? actNivelColorById.get(actId) : '';
          if (!serviciosByAsig.has(asigId)) serviciosByAsig.set(asigId, []);
          serviciosByAsig.get(asigId).push(actName);
          if (actColor && !actividadColorMap.has(actName)) {
            actividadColorMap.set(actName, actColor);
          }
        });

        let matrixMap = new Map(); // actividad -> fecha_iso -> Set(agente)
        let DateTime = window.luxon && window.luxon.DateTime;
        rows.forEach(function (row) {
          let agenteId = Number(row && row.agente_id);
          if (!Number.isInteger(agenteId) || agenteId <= 0) return;
          let acts = serviciosByAsig.get(Number(row && row.id)) || [];
          if (!acts.length) return;
          let iso = getRowIsoDate(row);
          if (!iso) return;

          acts.forEach(function (actName) {
            if (!matrixMap.has(actName)) matrixMap.set(actName, new Map());
            let byDia = matrixMap.get(actName);
            if (!byDia.has(iso)) byDia.set(iso, new Set());
            byDia.get(iso).add(agenteId);
          });
        });
        let dias = Array.from(
          new Set(
            rows
              .map(function (row) {
                return getRowIsoDate(row);
              })
              .filter(Boolean)
          )
        ).sort(function (a, b) {
          return a.localeCompare(b, 'es');
        });
        let actividades = Array.from(matrixMap.keys()).sort(function (a, b) {
          return a.localeCompare(b, 'es');
        });

        if (!actividades.length || !dias.length) {
          if (loading) loading.style.display = 'none';
          if (placeholder) {
            placeholder.innerHTML =
              '<i class="bi bi-grid-3x3-gap d-block fs-1 opacity-25 mb-2"></i>No hay combinaciones actividad/día para mostrar.';
            placeholder.style.display = '';
          }
          return;
        }

        let diaLabels = dias.map(function (iso) {
          if (!DateTime) return iso;
          let dt = DateTime.fromISO(iso, { zone: 'Europe/Madrid' });
          return dt.isValid ? dt.toFormat('dd/LL') : iso;
        });

        let data = [];
        let maxValue = 0;
        actividades.forEach(function (actividad, actividadIndex) {
          let byDia = matrixMap.get(actividad) || new Map();
          dias.forEach(function (iso, dayIndex) {
            let value = byDia.has(iso) ? byDia.get(iso).size : 0;
            if (value > maxValue) maxValue = value;
            data.push([dayIndex, actividadIndex, value, iso]);
          });
        });

        let chartH = Math.max(220, Math.min(620, 120 + actividades.length * 24));
        chartEl.style.height = chartH + 'px';

        if (app._dashCharts['chartMatrix']) {
          try {
            app._dashCharts['chartMatrix'].dispose();
          } catch (_e) {
            // noop
          }
        }

        if (loading) loading.style.display = 'none';
        chartEl.style.display = 'block';

        let chart = echarts.init(chartEl, null, { renderer: 'svg' });
        app._dashCharts['chartMatrix'] = chart;

        let fallbackOption = {
          grid: { top: 54, right: 10, bottom: 28, left: 120, containLabel: true },
          xAxis: {
            type: 'category',
            data: diaLabels,
            axisLabel: {
              interval: 0,
              rotate: diaLabels.length > 10 ? 35 : 0,
              fontSize: 8,
              fontWeight: 600,
            },
          },
          yAxis: {
            type: 'category',
            data: actividades,
            axisLabel: {
              fontSize: 8,
              color: function (value) {
                return actividadColorMap.get(String(value)) || '#4b5563';
              },
              fontWeight: 500,
            },
          },
          visualMap: {
            type: 'continuous',
            dimension: 2,
            seriesIndex: 0,
            min: 0,
            max: Math.max(1, maxValue),
            calculable: true,
            orient: 'horizontal',
            top: 6,
            left: 'center',
            inRange: {
              color: ['#f3f6ef', '#cfe3b2', '#88bb6c', '#3f7d32', '#1f4d1c'],
            },
            outOfRange: {
              color: ['#f8fafc'],
            },
            textStyle: { fontSize: 10, color: '#4b5563' },
          },
          tooltip: {
            trigger: 'item',
            formatter: function (params) {
              let v = params && params.value ? params.value : [];
              let iso = String(v[3] || '');
              let diaLabel = diaLabels[Number(v[0]) || 0] || '';
              let actividadLabel = actividades[Number(v[1]) || 0] || '';
              if (DateTime && iso) {
                let dt = DateTime.fromISO(iso, { zone: 'Europe/Madrid' });
                if (dt.isValid) diaLabel = dt.toFormat('dd/LL/yyyy');
              }
              return (
                '<b>' + app.escapeHtml(diaLabel) + '</b><br/>' +
                app.escapeHtml(String(actividadLabel || '')) + ': <b>' + Number(v[2] || 0) + '</b>'
              );
            },
          },
          series: [
            {
              type: 'heatmap',
              coordinateSystem: 'cartesian2d',
              encode: {
                x: 0,
                y: 1,
                value: 2,
                tooltip: [2],
              },
              data: data,
              emphasis: {
                itemStyle: {
                  borderColor: '#1f2937',
                  borderWidth: 1,
                },
              },
              label: {
                show: true,
                formatter: function (params) {
                  let val = Number((params && params.value && params.value[2]) || 0);
                  return val > 0 ? String(val) : '';
                },
              },
              itemStyle: {
                borderColor: '#ffffff',
                borderWidth: 1,
                opacity: 1,
              },
            },
          ],
        };

        chart.setOption(fallbackOption);
      } catch (e) {
        if (loading) loading.style.display = 'none';
        if (placeholder) {
          placeholder.innerHTML =
            '<i class="bi bi-grid-3x3-gap d-block fs-1 opacity-25 mb-2"></i><span class="text-danger">' +
            app.escapeHtml(e.message) +
            '</span>';
          placeholder.style.display = '';
        }
        console.error('[Dashboard][MatrixPelotonActividad]', e.message);
      }
    };
      let placeholder = document.getElementById('chartHeatmap2Placeholder');
      let loading = document.getElementById('chartHeatmap2Loading');
      if (!chartEl) return;

      if (placeholder) placeholder.style.display = 'none';
      if (loading) loading.style.display = 'block';
      chartEl.style.display = 'none';

      function normalizeCssColor(value) {
        let raw = String(value || '').trim();
        if (!raw) return '';
        if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
        if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw;
        if (/^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
        return '';
      }

      try {
        let contexto = await loadDashboardTemporalContext(borradorId, anio, mes);
        let rows = contexto.rows;
        let servicios = contexto.servicios;
        let servicioKeyField = contexto.servicioKeyField;
        let actividades = Array.isArray(contexto.metaData.actividades)
          ? contexto.metaData.actividades
          : [];

        if (!rows.length) {
          if (loading) loading.style.display = 'none';
          if (placeholder) {
            placeholder.innerHTML =
              '<i class="bi bi-bar-chart d-block fs-1 opacity-25 mb-2"></i>La fuente seleccionada no tiene asignaciones en el rango de días.';
            placeholder.style.display = '';
          }
          return;
        }

        let actNivelMap = new Map();
        let nivelMeta = new Map();
        actividades.forEach(function (a) {
          let actId = Number(a.id_actividad);
          if (!Number.isInteger(actId) || actId <= 0) return;

          let ordenRaw = Number(a.nivel_grupo_orden);
          let orden = Number.isFinite(ordenRaw) ? ordenRaw : 9999;
          let nivelNombre =
            String(a.nivel_grupo_nombre || '').trim() || 'Sin nivel';
          let color = normalizeCssColor(a.nivel_grupo_color) || '#64748b';

          actNivelMap.set(actId, nivelNombre);

          if (!nivelMeta.has(nivelNombre)) {
            nivelMeta.set(nivelNombre, { orden: orden, color: color });
          } else {
            let current = nivelMeta.get(nivelNombre);
            if (orden < current.orden) current.orden = orden;
            if (!current.color && color) current.color = color;
          }
        });

        let serviciosByAsig = new Map();
        servicios.forEach(function (s) {
          let asigId = Number(s && s[servicioKeyField]);
          let actId = Number(s && s.actividad_id);
          if (!Number.isInteger(asigId) || asigId <= 0) return;
          if (!Number.isInteger(actId) || actId <= 0) return;
          if (!serviciosByAsig.has(asigId)) serviciosByAsig.set(asigId, []);
          serviciosByAsig.get(asigId).push(actId);
        });

        let DateTime = window.luxon && window.luxon.DateTime;
        let dayLevelAgents = new Map(); // fecha_iso -> Map(nivel -> Set(agente_id))

        rows.forEach(function (row) {
          let iso = String(row.fecha || '').slice(0, 10);
          if (!iso) return;
          let agenteId = Number(row.agente_id);
          if (!Number.isInteger(agenteId) || agenteId <= 0) return;
          let acts = serviciosByAsig.get(Number(row.id)) || [];
          if (!acts.length) return;

          if (!dayLevelAgents.has(iso)) dayLevelAgents.set(iso, new Map());
          let levelsForRow = new Set();
          acts.forEach(function (actId) {
            levelsForRow.add(actNivelMap.get(actId) || 'Sin nivel');
          });

          levelsForRow.forEach(function (nivelNombre) {
            let dayMap = dayLevelAgents.get(iso);
            if (!dayMap.has(nivelNombre)) dayMap.set(nivelNombre, new Set());
            dayMap.get(nivelNombre).add(agenteId);
          });
        });

        let fechas = Array.from(dayLevelAgents.keys()).sort(function (a, b) {
          return a.localeCompare(b);
        });

        if (!fechas.length) {
          if (loading) loading.style.display = 'none';
          if (placeholder) {
            placeholder.innerHTML =
              '<i class="bi bi-bar-chart d-block fs-1 opacity-25 mb-2"></i>No hay servicios con nivel en la fuente seleccionada.';
            placeholder.style.display = '';
          }
          return;
        }

        let niveles = Array.from(nivelMeta.keys()).sort(function (a, b) {
          let ma = nivelMeta.get(a) || { orden: 9999 };
          let mb = nivelMeta.get(b) || { orden: 9999 };
          if (ma.orden !== mb.orden) return ma.orden - mb.orden;
          return a.localeCompare(b, 'es', { sensitivity: 'base' });
        });

        let series = niveles.map(function (nivelNombre) {
          let meta = nivelMeta.get(nivelNombre) || { color: '#64748b' };
          return {
            name: nivelNombre,
            type: 'bar',
            stack: 'agentes',
            barMaxWidth: 24,
            itemStyle: { color: meta.color || '#64748b' },
            emphasis: { focus: 'series' },
            data: fechas.map(function (iso) {
              let dayMap = dayLevelAgents.get(iso);
              let agentSet = dayMap ? dayMap.get(nivelNombre) : null;
              return agentSet ? agentSet.size : 0;
            }),
          };
        });

        let hasValues = series.some(function (s) {
          return (s.data || []).some(function (v) {
            return Number(v) > 0;
          });
        });

        if (!hasValues) {
          if (loading) loading.style.display = 'none';
          if (placeholder) {
            placeholder.innerHTML =
              '<i class="bi bi-bar-chart d-block fs-1 opacity-25 mb-2"></i>Sin datos para representar por niveles.';
            placeholder.style.display = '';
          }
          return;
        }

        if (app._dashCharts['chartHeatmap2']) {
          try {
            app._dashCharts['chartHeatmap2'].dispose();
          } catch (_e) {
            // noop
          }
        }

        if (loading) loading.style.display = 'none';
        chartEl.style.display = 'block';

        let chart = echarts.init(chartEl, null, { renderer: 'svg' });
        app._dashCharts['chartHeatmap2'] = chart;

        let xLabels = fechas.map(function (iso) {
          if (!DateTime) return iso;
          let dt = DateTime.fromISO(iso, { zone: 'Europe/Madrid' });
          return dt.isValid ? dt.toFormat('dd/LL') : iso;
        });

        chart.setOption({
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: function (params) {
              let idx = params && params.length ? params[0].dataIndex : 0;
              let fecha = fechas[idx] || '';
              let title = fecha;
              if (DateTime) {
                let dt = DateTime.fromISO(fecha, { zone: 'Europe/Madrid' });
                if (dt.isValid) title = dt.toFormat('dd/LL/yyyy');
              }
              let rows = (params || [])
                .filter(function (p) {
                  return Number(p.value) > 0;
                })
                .map(function (p) {
                  return (
                    p.marker +
                    ' ' +
                    app.escapeHtml(p.seriesName) +
                    ': <b>' +
                    p.value +
                    '</b>'
                  );
                });
              return (
                '<b>' +
                app.escapeHtml(title) +
                '</b><br/>' +
                (rows.join('<br/>') || 'Sin datos')
              );
            },
          },
          legend: {
            top: 0,
            type: 'scroll',
            textStyle: { fontSize: 10 },
          },
          grid: {
            left: 10,
            right: 12,
            top: 42,
            bottom: xLabels.length > 10 ? 58 : 40,
            containLabel: true,
          },
          xAxis: {
            type: 'category',
            data: xLabels,
            axisLabel: {
              fontSize: 10,
              rotate: xLabels.length > 10 ? 40 : 0,
            },
          },
          yAxis: {
            type: 'value',
            minInterval: 1,
            name: 'Agentes',
            nameTextStyle: { fontSize: 10 },
            axisLabel: { fontSize: 10 },
          },
          series: series,
        });
      } catch (e) {
        if (loading) loading.style.display = 'none';
        if (placeholder) {
          placeholder.innerHTML =
            '<i class="bi bi-bar-chart d-block fs-1 opacity-25 mb-2"></i><span class="text-danger">' +
            app.escapeHtml(e.message) +
            '</span>';
          placeholder.style.display = '';
        }
        console.error('[Dashboard][NivelGrupoStack]', e.message);
      }
    };

  // Redimensionar todos los charts al cambiar el tamaño de ventana
  window.addEventListener('resize', function () {
    if (!app._dashCharts) return;
    Object.values(app._dashCharts).forEach(function (c) {
      try {
        if (c && typeof c.resize === 'function') c.resize();
      } catch (e) {
        // noop
      }
    });
  });

  app.syncUserInfo = function syncUserInfo() {
    let userNameEl = document.getElementById('userName');
    if (userNameEl) {
      userNameEl.textContent = app.globalState.userName;
    }
  };

  app.updateRoleBadges = function updateRoleBadges() {
    const badge = document.getElementById('userRoleBadge');
    if (badge) {
      const role = app.globalState.userRole;
      badge.textContent = role;
      badge.className = `badge ms-1 ${role === 'admin' ? 'bg-danger' : 'bg-secondary'}`;
      badge.style.fontSize = '0.68rem';
    }
  };

  app.updateDateTime = function updateDateTime() {
    let dateTimeEl = document.getElementById('currentDateTime');
    if (!dateTimeEl) return;
    dateTimeEl.textContent = new Date().toLocaleString('es-ES');
  };

  app.toggleSidebar = function toggleSidebar() {
    if (app.isMobileSidebar()) {
      const sidebar = document.getElementById('sidebar');
      if (!sidebar) return;
      if (sidebar.classList.contains('mobile-open')) {
        app.closeSidebarMobile();
      } else {
        app.openSidebarMobile();
      }
      return;
    }

    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('mainContent');
    if (!sidebar || !main) return;

    const collapsed = !sidebar.classList.contains('collapsed');
    app.setSidebarDesktopCollapsed(collapsed);
  };

  app.isMobileSidebar = function isMobileSidebar() {
    return window.matchMedia('(max-width: 991.98px)').matches;
  };

  app.setSidebarDesktopCollapsed = function setSidebarDesktopCollapsed(
    collapsed
  ) {
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('mainContent');
    if (!sidebar || !main) return;

    sidebar.classList.toggle('collapsed', !!collapsed);
    main.classList.toggle('expanded', !!collapsed);
    sidebar.classList.remove('mobile-open');

    localStorage.setItem(
      app.storageKeys.sidebarCollapsed,
      collapsed ? '1' : '0'
    );
  };

  app.openSidebarMobile = function openSidebarMobile() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar || !backdrop) return;

    sidebar.classList.add('mobile-open');
    backdrop.classList.add('show');
  };

  app.closeSidebarMobile = function closeSidebarMobile() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar || !backdrop) return;

    sidebar.classList.remove('mobile-open');
    backdrop.classList.remove('show');
  };

  app.syncSidebarState = function syncSidebarState() {
    const sidebar = document.getElementById('sidebar');
    const main = document.getElementById('mainContent');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar || !main) return;

    if (app.isMobileSidebar()) {
      sidebar.classList.remove('collapsed');
      main.classList.remove('expanded');
      sidebar.classList.remove('mobile-open');
      if (backdrop) backdrop.classList.remove('show');
      return;
    }

    if (backdrop) backdrop.classList.remove('show');
    const stored = localStorage.getItem(app.storageKeys.sidebarCollapsed);
    const collapsed = stored === '1';
    app.setSidebarDesktopCollapsed(collapsed);
  };

  app.logout = function logout() {
    clearSessionAuth();
    window.location.href = 'login.html';
  };

  // ── Selector global de ARS ──────────────────────────────────
  app.initArsSelector = async function initArsSelector() {
    let container = document.getElementById('arsSelectorContainer');
    let select = document.getElementById('arsSelectorGlobal');
    if (!container || !select) return;

    let arsIds = Array.isArray(app.globalState.arsIds)
      ? app.globalState.arsIds.map(String).filter(Boolean)
      : [];
    app.globalState.arsIds = arsIds;

    // Si no hay arsIds en sesión, extraerlos del JWT
    if (!arsIds || !arsIds.length) {
      arsIds = app._getArsIdsFromToken();
      if (arsIds.length) {
        app.globalState.arsIds = arsIds;
        writeSessionAuth('arsIds', JSON.stringify(arsIds));
      }
    }

    let activeArsId = String(app.globalState.activeArsId || '').trim();
    if (!activeArsId || !arsIds.includes(activeArsId)) {
      app.setActiveArs(arsIds[0] || '');
      activeArsId = String(app.globalState.activeArsId || '').trim();
    }

    // Cargar catálogo ARS para etiquetas y título
    await app.loadArsCatalog();

    // Actualizar título del sidebar con la ARS activa
    app._updateSidebarTitle();

    // Si solo tiene una ARS, no mostrar selector — ya queda fija
    if (!arsIds || arsIds.length <= 1) {
      container.style.display = 'none';
      return;
    }

    // Poblar con los IDs que tiene el usuario
    select.innerHTML = arsIds
      .map(function (id) {
        let selected = id === activeArsId ? ' selected' : '';
        return (
          '<option value="' +
          app.escapeHtml(id) +
          '"' +
          selected +
          '>' +
          app.escapeHtml(id) +
          '</option>'
        );
      })
      .join('');

    container.style.display = 'block';
    app._refreshArsSelectorLabels();

    select.addEventListener('change', function (event) {
      let target = /** @type {HTMLSelectElement | null} */ (
        event.currentTarget
      );
      if (!target) return;
      app.onArsChange(target.value);
    });
  };

  app.initSidebar = function initSidebar() {
    app.syncSidebarState();

    const backdrop = document.getElementById('sidebarBackdrop');
    if (backdrop && !backdrop.dataset.bound) {
      backdrop.dataset.bound = '1';
      backdrop.addEventListener('click', function () {
        app.closeSidebarMobile();
      });
    }

    if (!app._sidebarResizeBound) {
      app._sidebarResizeBound = true;
      window.addEventListener('resize', app.syncSidebarState);
    }
  };

  app.initializeTooltips = function initializeTooltips() {
    // Inicializar todos los tooltips de Bootstrap en la página
    if (typeof bootstrap === 'undefined' || !bootstrap.Tooltip) return;
    
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
      try {
        bootstrap.Tooltip.getOrCreateInstance(el);
      } catch (e) {
        console.warn('Error inicializando tooltip:', e);
      }
    });
  };

  app._getArsIdsFromToken = function _getArsIdsFromToken() {
    try {
      let token = app.globalState.token;
      if (!token) return [];
      let payload = JSON.parse(atob(token.split('.')[1]));
      return Array.isArray(payload.ars_ids)
        ? payload.ars_ids.map(String).filter(Boolean)
        : [];
    } catch (e) {
      return [];
    }
  };

  app._updateSidebarTitle = function _updateSidebarTitle() {
    let activeId = app.globalState.activeArsId;
    let catalog = app.globalState.arsCatalog || [];
    let found = catalog.find(function (a) {
      return String(a && a.id_unidad) === String(activeId);
    });
    let label = found ? found.id_unidad : activeId || 'Dashboard';
    let color = app.normalizeHexColor(found && found.color, '#276836');
    app.applyArsTheme(color);

    let el = document.getElementById('sidebarTitle');
    if (el) el.textContent = label;

    let logoEl = /** @type {HTMLImageElement | null} */ (
      document.getElementById('sidebarArsLogo')
    );
    if (logoEl) {
      let sourceId = String((found && found.id_unidad) || activeId || '').trim();
      let match = sourceId.match(/\d+/);
      let logoSuffix = match
        ? match[0]
        : sourceId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      let nextLogo = logoSuffix ? `logogrs${logoSuffix}_.png` : 'logogrs1_.png';

      if (!logoEl.dataset.fallbackBound) {
        logoEl.dataset.fallbackBound = '1';
        logoEl.addEventListener('error', function () {
          let fallbackTarget = /** @type {HTMLImageElement | null} */ (
            this instanceof HTMLImageElement ? this : null
          );
          if (fallbackTarget) {
            fallbackTarget.src = 'logogrs1_.png';
          }
        });
      }

      logoEl.src = nextLogo;
      logoEl.alt = label ? `Logo ${label}` : 'Logo ARS';
    }

    let badge = document.getElementById('navArsBadge');
    let badgeLabel = document.getElementById('navArsLabel');
    if (badge && badgeLabel) {
      badgeLabel.textContent = found ? found.id_unidad : activeId || '';
      if (found && found.poblacion)
        badgeLabel.textContent += ' — ' + found.poblacion;
      badge.style.backgroundColor = color;
      badge.style.color = app._contrastColor(color);
      badge.classList.toggle('d-none', !activeId);
    }
  };

  app.normalizeHexColor = function normalizeHexColor(color, fallback) {
    let raw = String(color || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
    return fallback || '#276836';
  };

  app.applyArsTheme = function applyArsTheme(color) {
    let effective = app.normalizeHexColor(color, '#276836');

    // Calcular hover (-15% brillo)
    let hex = effective.replace('#', '');
    if (hex.length === 3)
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    let r = Math.max(0, parseInt(hex.substring(0, 2), 16) - 38);
    let g = Math.max(0, parseInt(hex.substring(2, 4), 16) - 38);
    let b = Math.max(0, parseInt(hex.substring(4, 6), 16) - 38);
    let hover =
      '#' +
      r.toString(16).padStart(2, '0') +
      g.toString(16).padStart(2, '0') +
      b.toString(16).padStart(2, '0');

    document.documentElement.style.setProperty('--primary-gc-color', effective);
    document.documentElement.style.setProperty(
      '--primary-gc-color-hover',
      hover
    );

    // Color de texto para el sidebar según contraste con el fondo
    let sidebarFg = app._contrastColor(effective);
    document.documentElement.style.setProperty('--sidebar-fg', sidebarFg);
    // Variante atenuada (72% opacidad sobre el fondo) para items no activos
    document.documentElement.style.setProperty(
      '--sidebar-fg-muted',
      sidebarFg === '#ffffff' ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.6)'
    );
    document.documentElement.style.setProperty(
      '--sidebar-item-hover-bg',
      sidebarFg === '#ffffff' ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)'
    );
    document.documentElement.style.setProperty(
      '--sidebar-item-active-bg',
      sidebarFg === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.14)'
    );
    document.documentElement.style.setProperty(
      '--sidebar-user-bg',
      sidebarFg === '#ffffff' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
    );
    document.documentElement.style.setProperty(
      '--sidebar-border-muted',
      sidebarFg === '#ffffff' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)'
    );
    // Filtro para la flecha del accordion (invert si fondo oscuro, sin filtro si claro)
    document.documentElement.style.setProperty(
      '--sidebar-accordion-filter',
      sidebarFg === '#ffffff' ? 'invert(1)' : 'none'
    );

    // Guardar para uso en JS (charts, borders)
    app._gcColor = effective;
    app._gcColorHover = hover;

    // Variante clara para gradientes (mezcla con blanco al 80%)
    let rl = Math.round(parseInt(hex.substring(0, 2), 16) * 0.15 + 255 * 0.85);
    let gl = Math.round(parseInt(hex.substring(2, 4), 16) * 0.15 + 255 * 0.85);
    let bl = Math.round(parseInt(hex.substring(4, 6), 16) * 0.15 + 255 * 0.85);
    app._gcColorLight =
      '#' +
      rl.toString(16).padStart(2, '0') +
      gl.toString(16).padStart(2, '0') +
      bl.toString(16).padStart(2, '0');

    let mid =
      '#' +
      Math.round(parseInt(hex.substring(0, 2), 16) * 0.55 + 255 * 0.45)
        .toString(16)
        .padStart(2, '0') +
      Math.round(parseInt(hex.substring(2, 4), 16) * 0.55 + 255 * 0.45)
        .toString(16)
        .padStart(2, '0') +
      Math.round(parseInt(hex.substring(4, 6), 16) * 0.55 + 255 * 0.45)
        .toString(16)
        .padStart(2, '0');
    app._gcColorMid = mid;
  };

  app._contrastColor = function _contrastColor(hex) {
    if (!hex) return '#fff';
    hex = hex.replace('#', '');
    if (hex.length === 3)
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    let lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 150 ? '#212529' : '#ffffff';
  };

  app.loadArsCatalog = async function loadArsCatalog() {
    try {
      let cached = JSON.parse(readSessionAuth('arsCatalog', '[]') || '[]');
      if (Array.isArray(cached) && cached.length) {
        app.globalState.arsCatalog = cached;
      }
    } catch (_e) {
      // noop
    }

    let canReadConfig =
      typeof app.hasPermission === 'function'
        ? app.hasPermission('config:leer')
        : false;

    if (!canReadConfig) {
      try {
        let meRes = await fetchWithRetry(
          '/api/auth/me',
          { headers: app.getHeaders() },
          2
        );
        if (!meRes.ok) return;
        let meJson = await meRes.json();
        let profile = meJson && meJson.profile ? meJson.profile : {};
        let profileCatalog = Array.isArray(profile.ars_catalog)
          ? profile.ars_catalog
          : [];
        if (profileCatalog.length) {
          app.globalState.arsCatalog = profileCatalog;
          writeSessionAuth('arsCatalog', JSON.stringify(profileCatalog));
          return;
        }
      } catch (_e) {
        return;
      }
      return;
    }

    try {
      let res = await fetch('/api/config/ars', { headers: app.getHeaders() });
      if (!res.ok) {
        if (res.status !== 403) {
          console.warn('No se pudo cargar catálogo ARS. HTTP', res.status);
        }
        return;
      }
      let json = await res.json();
      app.globalState.arsCatalog = Array.isArray(json.data) ? json.data : [];
      writeSessionAuth(
        'arsCatalog',
        JSON.stringify(app.globalState.arsCatalog)
      );
    } catch (e) {
      console.warn('No se pudo cargar catálogo ARS:', e.message);
    }
  };

  app._refreshArsSelectorLabels = function _refreshArsSelectorLabels() {
    let select = getSelectElement('arsSelectorGlobal');
    if (!select || !app.globalState.arsCatalog.length) return;

    let catalog = app.globalState.arsCatalog;
    Array.from(select.options).forEach(function (opt) {
      let found = catalog.find(function (a) {
        return a.id_unidad === opt.value;
      });
      if (found) {
        let label = found.id_unidad;
        if (found.poblacion) label += ' — ' + found.poblacion;
        opt.textContent = label;
      }
    });
  };

  app.onArsChange = function onArsChange(newArsId) {
    if (newArsId === app.globalState.activeArsId) return;

    app.setActiveArs(newArsId);
    app._updateSidebarTitle();

    // Limpiar estado de secciones que dependen de ARS
    if (app.asignacionesState) {
      app.asignacionesState.meta = null;
      app.asignacionesState.control = null;
      app.asignacionesState.cuadrante = null;
      app.asignacionesState.borradores = [];
      app.asignacionesState.borradorId = null;
    }
    if (app.agentesState) {
      app.agentesState.agentes = [];
      app.agentesState.filtrados = [];
      app.agentesState.originalAgentes = [];
    }
    if (typeof app.resetPlanificacionState === 'function') {
      app.resetPlanificacionState();
    }

    // Resetear solo secciones que dependen de ARS para que se recarguen
    [
      'dashboard',
      'agentes',
      'agentes-requisitos',
      'asignaciones',
      'cuadrantesPlanificacion',
      'devengos',
      'planificacion',
    ].forEach(function (key) {
      app.initializedSections[key] = false;
    });

    // Recargar la sección activa
    app.showSection(app.currentSection);
  };

  app.showSection = function showSection(sectionName, options = {}) {
    const { updateHash = true } = options;
    const normalizedSection = app.normalizeSection(sectionName);
    const targetSection = app.canAccessSection(normalizedSection)
      ? normalizedSection
      : 'dashboard';

    document.querySelectorAll('.section').forEach((section) => {
      section.classList.remove('active');
    });

    const activeSection = document.getElementById(
      app.getSectionElementId(targetSection)
    );
    if (!activeSection) {
      return;
    }

    activeSection.classList.add('active');

    app.syncConfigTabGroups(targetSection);
    app.syncSidebarNavigationState(targetSection);

    const pageTitleEl = document.getElementById('pageTitle');
    if (pageTitleEl) {
      pageTitleEl.textContent = app.sectionTitles[targetSection] || 'Dashboard';
    }
    app.persistActiveSection(targetSection, updateHash);

    if (
      targetSection === 'dashboard' &&
      app.initializedSections[targetSection] &&
      typeof app.triggerDashboardRefresh === 'function'
    ) {
      Promise.resolve(app.triggerDashboardRefresh()).catch((error) => {
        console.error('Error refreshing dashboard stats:', error);
      });
    }

    if (
      targetSection === 'asignaciones' &&
      app.initializedSections[targetSection] &&
      typeof app.loadAsignacionesCuadrante === 'function'
    ) {
      Promise.resolve(app.loadAsignacionesCuadrante()).catch((error) => {
        console.error('Error refreshing asignaciones grid:', error);
      });
    }

    if (!app.initializedSections[targetSection]) {
      let initializer = null;

      if (targetSection === 'dashboard') {
        initializer = app.initializeDashboard;
      }

      if (targetSection === 'actividades') {
        initializer = app.initializeActividades;
      }

      if (targetSection === 'grupos') {
        initializer = app.initializeGrupos;
      }

      if (targetSection === 'jerarquiagrupos') {
        initializer = app.initializeJerarquiaGrupos;
      }

      if (targetSection === 'agentes') {
        initializer = app.initializeAgentes;
      }
      if (targetSection === 'agentes-acciones') {
        initializer = app.initializeAgentesAcciones;
      }
      if (targetSection === 'agentes-requisitos') {
        initializer = app.initializeAgentesRequisitos;
      }

      if (targetSection === 'sistema') {
        initializer = app.initializeConfiguracion;
      }
      if (targetSection === 'configuracion') {
        initializer = app.initializeConfiguracion;
      }
      if (targetSection === 'devengos') {
        initializer = app.initializeDevengos;
      }
      if (targetSection === 'ledger') {
        initializer = app.initializeLedger;
      }
      if (targetSection === 'turnos') {
        initializer = app.initializeTurnos;
      }
      if (targetSection === 'asignaciones') {
        initializer = app.initializeAsignaciones;
      }
      if (targetSection === 'cuadrantesPlanificacion') {
        initializer = app.initializeCuadrantesPlanificacion;
      }
      if (targetSection === 'planificacion') {
        initializer = app.initializePlanificacion;
      }
      if (targetSection === 'informes') {
        initializer = app.initializeinformes;
      }
      if (targetSection === 'help-admin') {
        initializer = app.initializeHelpAdmin;
      }
      if (!initializer) {
        app.initializedSections[targetSection] = true;
        return;
      }

      Promise.resolve(initializer())
        .then(() => {
          app.initializedSections[targetSection] = true;
          if (targetSection === 'sistema') {
            app.initializedSections.configuracion = true;
          }
          if (targetSection === 'configuracion') {
            app.initializedSections.sistema = true;
          }
          if (
            targetSection === 'asignaciones' &&
            typeof app.loadAsignacionesCuadrante === 'function'
          ) {
            Promise.resolve(app.loadAsignacionesCuadrante()).catch((error) => {
              console.error('Error refreshing asignaciones grid:', error);
            });
          }
        })
        .catch((error) => {
          console.error(`Error initializing section ${targetSection}:`, error);
          app.renderSectionInitializationError(targetSection);
        });
    }
  };

  app.initializeActividades = async function initializeActividades() {
    if (typeof app.loadActividadesMeta === 'function') {
      await app.loadActividadesMeta();
    }

    if (
      typeof app.loadActividades !== 'function' ||
      typeof app.setupActividadesEventListeners !== 'function'
    ) {
      throw new Error('El módulo de servicios no está cargado correctamente');
    }

    app.initTabulatorActividades();
    await app.loadActividades();
    app.setupActividadesEventListeners();
  };

  app.initializeAgentes = async function initializeAgentes() {
    if (typeof app.initializeAgentesTabulator === 'function') {
      return app.initializeAgentesTabulator();
    }
    throw new Error(
      'El módulo de agentes (tabulator) no está cargado correctamente'
    );
  };

  app.initializeAgentesAcciones = async function initializeAgentesAcciones() {
    if (typeof app.initializeAgentesAccionesSection === 'function') {
      return app.initializeAgentesAccionesSection();
    }
    throw new Error(
      'El módulo de acciones masivas de agentes no está cargado correctamente'
    );
  };

  app.initializeAgentesRequisitos = async function initializeAgentesRequisitos() {
    if (typeof app.initializeAgentesRequisitosSection === 'function') {
      return app.initializeAgentesRequisitosSection();
    }
    throw new Error(
      'El módulo de requisitos periódicos de agentes no está cargado correctamente'
    );
  };

  app.initializeTurnos = async function initializeTurnos() {
    if (
      typeof app.loadTurnos !== 'function' ||
      typeof app.setupTurnosEventListeners !== 'function'
    ) {
      throw new Error('El módulo de turnos no está cargado correctamente');
    }

    app.initTabulatorTurnos();
    await app.loadTurnos();
    app.setupTurnosEventListeners();
  };

  app.initializeAsignaciones = async function initializeAsignaciones() {
    if (app._initializeAsignacionesPromise) {
      return app._initializeAsignacionesPromise;
    }

    if (
      typeof app.loadAsignacionesMeta !== 'function' ||
      typeof app.loadAsignacionesCuadrante !== 'function' ||
      typeof app.setupAsignacionesEventListeners !== 'function'
    ) {
      throw new Error(
        'El módulo de asignaciones no está cargado correctamente'
      );
    }

    app._initializeAsignacionesPromise = (async function () {
      await Promise.resolve(app.setupAsignacionesEventListeners());
      await app.loadAsignacionesMeta();
    })();

    try {
      await app._initializeAsignacionesPromise;
    } finally {
      app._initializeAsignacionesPromise = null;
    }
  };
})();
