const SESSION_AUTH_KEYS = [
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

function readSessionValue(key, fallback) {
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

function readSessionJson(key, fallback) {
  let raw = readSessionValue(key, null);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return fallback;
  }
}

window.GRS1Dashboard = {
  sessionAuthKeys: SESSION_AUTH_KEYS,
  /** @type {import('./dashboard-types.js').GlobalState} */
  globalState: {
    token: readSessionValue('token', ''),
    userRole: readSessionValue('userRole', readSessionValue('role', 'user')),
    userRoleId: readSessionValue('userRoleId', readSessionValue('roleId', '')),
    userName: readSessionValue('userName', 'Usuario'),
    userTip: readSessionValue('userTip', ''),
    arsIds: readSessionJson('arsIds', []),
    activeArsId: readSessionValue('activeArsId', ''),
    arsCatalog: readSessionJson('arsCatalog', []),
    selectedAgenteIdsForBulk: [],
  },

  actividadesState: {
    actividades: [],
    filtrados: [],
    originalActividades: [],
    grupos: [],
    disponibilidadOptions: [],
    cambiosPendientes: new Map(),
    editingId: null,
    deleteId: null,
    sortField: null,
    sortOrder: 'asc',
  },

  agentesState: {
    agentes: [],
    filtrados: [],
    originalAgentes: [],
    situaciones: [],
    pelotones: [],
    empleos: [],
    provincias: [],
    cambiosPendientes: new Map(),
    editingId: null,
    deleteId: null,
    qbeFilters: {
      nombre: '',
      apellido_1: '',
      apellido_2: '',
      email: '',
      peloton_id: '',
      tip: '',
      orden_gc: '',
      aptitudes: '',
      pei: '',
      paef: '',
    },
    sortField: null,
    sortOrder: 'asc',
    searchTerm: '',
  },

  usuariosState: {
    usuarios: [],
    filtrados: [],
    originalUsuarios: [],
    cambiosPendientes: new Map(),
    editingId: null,
    deleteId: null,
    sortField: null,
    sortOrder: 'asc',
    roles: [],
    arsCatalog: [],
  },

  turnosState: {
    turnos: [],
    originalTurnos: [],
    cambiosPendientes: new Map(),
    editingId: null,
    deleteId: null,
  },

  asignacionesState: {
    meta: null,
    control: null,
    anio: null,
    mes: null,
    borradorId: null,
    borradores: [],
    cuadrante: [],
    searchTerm: '',
    columnFilters: {
      tip: '',
      nombre: '',
      peloton_codigo: '',
      requisitos_pct: '',
      orden_gc: '',
    },
    selectedActividadIds: [],
    actividadFechaInicio: '',
    actividadFechaFin: '',
    asigCellHistoryMode: false,
    columnFilterFocus: null,
    selectedAgenteIdsVista: [],
  },

  includes: [
    { id: 'dashboardSection', path: 'includes/dashboard/section.html' },
    { id: 'actividadesSection', path: 'includes/actividades/section.html' },
    { id: 'gruposSection', path: 'includes/grupos/section.html' },
    {
      id: 'jerarquiagruposSection',
      path: 'includes/jerarquiagrupos/section.html',
    },
    { id: 'agentesSection', path: 'includes/agentes/section.html' },
    {
      id: 'agentesAccionesSection',
      path: 'includes/agentes-acciones/section.html?v=20260504c',
    },
    {
      id: 'agentesRequisitosSection',
      path: 'includes/agentes-requisitos/section.html?v=20260628a',
    },
    { id: 'configuracionSection', path: 'includes/config/section.html' },
    { id: 'devengosSection', path: 'includes/devengos/section.html' },
    { id: 'ledgerSection', path: 'includes/ledger/section.html' },
    { id: 'actividadModalHost', path: 'includes/actividades/modal.html' },
    { id: 'agenteModalHost', path: 'includes/agentes/modal.html' },
    { id: 'usuarioModalHost', path: 'includes/usuarios/modal.html' },
    { id: 'configModalHost', path: 'includes/config/modal.html' },
    {
      id: 'actividadDeleteModalHost',
      path: 'includes/actividades/delete-modal.html',
    },
    { id: 'agenteDeleteModalHost', path: 'includes/agentes/delete-modal.html' },
    {
      id: 'comentariosAgenteModalHost',
      path: 'includes/agentes/comentarios-modal.html',
    },
    {
      id: 'usuarioDeleteModalHost',
      path: 'includes/usuarios/delete-modal.html',
    },
    { id: 'fichaAgenteModalHost', path: 'includes/agentes/ficha-modal.html' },
    {
      id: 'fichaActividadModalHost',
      path: 'includes/actividades/ficha-modal.html',
    },
    { id: 'turnosSection', path: 'includes/turnos/section.html' },
    { id: 'asignacionesSection', path: 'includes/asignaciones/section.html' },
    {
      id: 'cuadrantesPlanificacionSection',
      path: 'includes/planificacion/cuadrantes-section.html',
    },
    {
      id: 'planificacionSection',
      path: 'includes/planificacion/planificacion-section.html?v=20260630a',
    },
    { id: 'informesSection', path: 'includes/informes/section.html' },
    { id: 'turnoModalHost', path: 'includes/turnos/modal.html' },
    { id: 'turnoDeleteModalHost', path: 'includes/turnos/delete-modal.html' },
    {
      id: 'turnoHistorialModalHost',
      path: 'includes/turnos/historial-modal.html',
    },
    { id: 'profileModalHost', path: 'includes/profile/modal.html' },
    {
      id: 'changePasswordModalHost',
      path: 'includes/profile/change-password-modal.html',
    },
    { id: 'helpAdminSection', path: 'includes/help-admin/section.html' },
    { id: 'helpAdminModalHost', path: 'includes/help-admin/modal.html' },
  ],

  sectionTitles: {
    dashboard: 'Dashboard',
    actividades: 'Lista de Servicios',
    grupos: 'Grupos de Servicio',
    jerarquiagrupos: 'Jerarquía Grupos',
    agentes: 'Lista de Agentes',
    'agentes-acciones': 'Acciones Masivas de Agentes',
    'agentes-requisitos': 'Requisitos Periódicos de Agentes',
    sistema: 'Sistema',
    configuracion: 'Configuración',
    devengos: 'Devengos',
    ledger: 'Ledger de Saldos',
    turnos: 'Catálogo de Turnos',
    asignaciones: 'Asignación por Días',
    cuadrantesPlanificacion: 'Cuadrantes de Planificación',
    planificacion: 'Planificación V2 (días naturales)',
    informes: 'Exportar Cuadrante',
    'help-admin': 'Gestión de Ayuda',
  },

  storageKeys: {
    activeSection: 'grs1.dashboard.activeSection',
    sidebarCollapsed: 'grs1.dashboard.sidebarCollapsed',
  },

  initializedSections: {
    dashboard: false,
    actividades: false,
    grupos: false,
    jerarquiagrupos: false,
    agentes: false,
    'agentes-acciones': false,
    'agentes-requisitos': false,
    sistema: false,
    configuracion: false,
    devengos: false,
    ledger: false,
    turnos: false,
    asignaciones: false,
    cuadrantesPlanificacion: false,
    planificacion: false,
    informes: false,
  },

  currentSection: 'dashboard',
  actividadIdToDelete: null,
  agenteIdToDelete: null,
  usuarioIdToDelete: null,
  actividadModalState: {
    mode: 'create',
    id: null,
  },
  agenteModalState: {
    mode: 'create',
    id: null,
  },
  usuarioModalState: {
    mode: 'create',
    id: null,
  },
  turnoModalState: {
    mode: 'create',
    id: null,
  },
  turnoIdToDelete: null,
  cloneRecords(records) {
    return records.map((record) => ({ ...record }));
  },

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** Headers centralizados para todas las peticiones API */
  getHeaders(includeContentType) {
    let activeArsId = this.ensureActiveArsId();
    let h = { Authorization: 'Bearer ' + this.globalState.token };
    if (activeArsId) {
      h['X-Ars-Id'] = activeArsId;
    }
    if (includeContentType) {
      h['Content-Type'] = 'application/json';
    }
    return h;
  },

  ensureActiveArsId() {
    let arsIds = Array.isArray(this.globalState.arsIds)
      ? this.globalState.arsIds.map(String).filter(Boolean)
      : [];
    let activeArsId = String(this.globalState.activeArsId || '').trim();

    if (!activeArsId && arsIds.length === 1) {
      activeArsId = arsIds[0];
    }

    if (!activeArsId && arsIds.length > 1) {
      activeArsId = arsIds[0];
    }

    if (activeArsId) {
      this.globalState.activeArsId = activeArsId;
      sessionStorage.setItem('activeArsId', activeArsId);
    }

    return activeArsId;
  },

  /** Cambiar la ARS activa y persistir */
  setActiveArs(arsId) {
    let normalizedArsId = String(arsId || '').trim();
    this.globalState.activeArsId = normalizedArsId;
    sessionStorage.setItem('activeArsId', normalizedArsId);
  },
};
