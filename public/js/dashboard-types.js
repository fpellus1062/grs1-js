/**
 * dashboard-types.js
 * Definiciones de tipos JSDoc para los modelos de dominio del dashboard.
 * Este fichero no contiene código ejecutable; sólo anotaciones de tipo
 * que VS Code (y otras herramientas checkJs) consumen para autocompletado
 * y comprobación estática.
 */

/**
 * Sesión y perfil del usuario autenticado.
 * @typedef {Object} GlobalState
 * @property {string} token       - JWT de sesión.
 * @property {string} userRole    - Rol textual ('admin', 'user', …).
 * @property {string} userRoleId  - ID numérico del rol (como string).
 * @property {string} userName    - Nombre visible del usuario.
 * @property {string} userTip     - TIP del usuario.
 * @property {string[]} arsIds    - IDs de las ARS a las que tiene acceso.
 * @property {string} activeArsId - ARS actualmente seleccionada.
 * @property {string[]} arsCatalog - Catálogo de nombres de ARS disponibles.
 * @property {string[]} selectedAgenteIdsForBulk - Agentes seleccionados para acción masiva.
 */

/**
 * Actividad / servicio.
 * @typedef {Object} Actividad
 * @property {number} id_actividad
 * @property {string} actividad    - Código de la actividad.
 * @property {string} nombre       - Nombre descriptivo.
 * @property {string} disponible   - Flag de disponibilidad ('S'/'N').
 * @property {number|null} grupo_id
 * @property {string} horario
 * @property {string} hora_inicio  - HH:MM
 * @property {string} hora_fin     - HH:MM
 * @property {string} color        - Color hexadecimal (#RRGGBB).
 */

/**
 * Agente (miembro del personal).
 * @typedef {Object} Agente
 * @property {number} id_agente
 * @property {string} nombre
 * @property {string} apellido_1
 * @property {string} apellido_2
 * @property {string} email
 * @property {string} tip          - TIP único del agente.
 * @property {string} nif
 * @property {string} telefono
 * @property {number|null} peloton_id
 * @property {number|null} empleo_id
 * @property {number|null} situacion_id
 * @property {number} orden_gc
 * @property {string} aptitudes
 * @property {string} comentarios
 * @property {boolean} pei
 * @property {boolean} paef
 * @property {string|null} fecha_ant_empleo
 * @property {string} domicilio
 * @property {string} codigo_postal
 * @property {string} poblacion
 * @property {string} provincia
 */

/**
 * Turno de trabajo.
 * @typedef {Object} Turno
 * @property {number} id_turno
 * @property {string} nombre
 * @property {string} hora_inicio  - HH:MM
 * @property {string} hora_fin     - HH:MM
 * @property {string} color        - Color hexadecimal (#RRGGBB).
 * @property {string} observaciones
 * @property {string|null} baja_at - ISO date de baja, o null si activo.
 */

/**
 * Una fila del cuadrante (asignación de agente × día × turno/actividad).
 * @typedef {Object} AsignacionRow
 * @property {number} id_asignacion
 * @property {number} agente_id
 * @property {string} tip
 * @property {string} nombre_agente
 * @property {string} peloton_codigo
 * @property {boolean} pei
 * @property {boolean} paef
 * @property {number} orden_gc
 * @property {Object.<string, string>} dias - Mapa día-ISO → código de actividad/turno.
 */

/**
 * Cuadrante mensual completo.
 * @typedef {Object} Cuadrante
 * @property {number} id_borrador
 * @property {number} anio
 * @property {number} mes
 * @property {string} estado        - 'borrador' | 'publicado'
 * @property {AsignacionRow[]} filas
 */
