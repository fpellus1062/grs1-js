(function () {
  const app = (window.GRS1Dashboard = window.GRS1Dashboard || {});
  const PASSWORD_POLICY_REGEX =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,72}$/;
  const PASSWORD_POLICY_MESSAGE =
    'Minimo 12 caracteres con mayuscula, minuscula, numero y caracter especial';

  function getFieldValue(fieldId) {
    const field = document.getElementById(fieldId);
    return field ? field.value : '';
  }

  function setFieldValue(fieldId, value) {
    const field = document.getElementById(fieldId);
    if (field) {
      field.value = value || '';
    }
  }

  function getUsuarioForm() {
    return document.getElementById('usuarioForm');
  }

  function normalizeArsIds(ids) {
    return [
      ...new Set(
        (ids || [])
          .map(function (id) {
            return String(id || '').trim();
          })
          .filter(Boolean)
      ),
    ].sort();
  }

  function getSelectedArsIds() {
    let select = document.getElementById('usuarioArs');
    if (!select) return [];
    return normalizeArsIds(
      Array.from(select.selectedOptions || []).map(function (opt) {
        return opt.value;
      })
    );
  }

  function populateUsuarioArsSelect(selectedArsIds) {
    let select = document.getElementById('usuarioArs');
    if (!select) return;

    let selectedSet = new Set(normalizeArsIds(selectedArsIds));
    let catalog = (app.usuariosState && app.usuariosState.arsCatalog) || [];

    if (!catalog.length) {
      select.innerHTML =
        '<option value="">Sin agrupaciones disponibles</option>';
      return;
    }

    select.innerHTML = catalog
      .map(function (ars) {
        let id = String(ars.id_unidad || '').trim();
        let selected = selectedSet.has(id) ? ' selected' : '';
        return '<option value="' + id + '"' + selected + '>' + id + '</option>';
      })
      .join('');
  }

  function setUsuarioInfoSeguridadVisible(visible) {
    let infoSeg = document.getElementById('usuarioInfoSeguridad');
    if (!infoSeg) return;
    infoSeg.classList.toggle('d-none', !visible);
  }

  // ── Password visibility toggle ──────────────────────────
  app.initUsuarioPasswordToggle = function initUsuarioPasswordToggle() {
    const btn = document.getElementById('btnTogglePassword');
    const input = document.getElementById('usuarioPassword');
    if (!btn || !input) return;

    btn.addEventListener('click', function () {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.querySelector('i').className = isPassword
        ? 'bi bi-eye-slash'
        : 'bi bi-eye';
    });

    input.addEventListener('input', function () {
      app.updatePasswordStrength(input.value);
    });
  };

  // ── Password strength indicator ─────────────────────────
  app.updatePasswordStrength = function updatePasswordStrength(pwd) {
    const container = document.getElementById('passwordStrength');
    const bar = document.getElementById('passwordStrengthBar');
    const text = document.getElementById('passwordStrengthText');
    if (!container || !bar || !text) return;

    if (!pwd) {
      container.classList.add('d-none');
      return;
    }
    container.classList.remove('d-none');

    let score = 0;
    if (pwd.length >= 12) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd)) score++;

    let levels = [
      { pct: 20, cls: 'bg-danger', label: 'Muy débil' },
      { pct: 40, cls: 'bg-danger', label: 'Débil' },
      { pct: 60, cls: 'bg-warning', label: 'Regular' },
      { pct: 80, cls: 'bg-info', label: 'Buena' },
      { pct: 100, cls: 'bg-success', label: 'Fuerte' },
    ];
    let level = levels[Math.min(score, levels.length) - 1] || levels[0];

    bar.style.width = level.pct + '%';
    bar.className = 'progress-bar ' + level.cls;
    bar.setAttribute('aria-valuenow', String(level.pct));
    text.textContent = level.label;
  };

  app.setUsuarioPasswordMode = function setUsuarioPasswordMode(isEditMode) {
    const passwordInput = document.getElementById('usuarioPassword');
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.required = !isEditMode;
      passwordInput.type = 'password';
    }

    const toggleBtn = document.getElementById('btnTogglePassword');
    if (toggleBtn) {
      let icon = toggleBtn.querySelector('i');
      if (icon) icon.className = 'bi bi-eye';
    }

    const strengthContainer = document.getElementById('passwordStrength');
    if (strengthContainer) strengthContainer.classList.add('d-none');

    const passwordLabel = document.getElementById('usuarioPasswordLabel');
    if (passwordLabel) {
      passwordLabel.textContent = isEditMode
        ? 'Contraseña (opcional)'
        : 'Contraseña *';
    }
  };

  app.fillUsuarioForm = function fillUsuarioForm(usuario, arsSeleccionadas) {
    let form = getUsuarioForm();
    if (form) {
      form.classList.remove('was-validated');
    }
    let arsSelect = document.getElementById('usuarioArs');
    if (arsSelect) {
      arsSelect.setCustomValidity('');
    }

    setFieldValue('usuarioNombre', usuario ? usuario.nombre : '');
    setFieldValue('usuarioEmail', usuario ? usuario.email : '');
    setFieldValue('usuarioTip', usuario ? usuario.tip || '' : '');

    // Estado (solo visible en edición)
    let estadoGroup = document.getElementById('usuarioEstadoGroup');
    let estadoSelect = document.getElementById('usuarioActivo');
    if (estadoGroup && estadoSelect) {
      if (usuario) {
        estadoGroup.style.display = '';
        estadoSelect.value = usuario.activo === false ? 'false' : 'true';
      } else {
        estadoGroup.style.display = 'none';
      }
    }

    // Poblar select de roles dinámicamente desde la tabla roles
    const roleSelect = document.getElementById('usuarioRole');
    if (roleSelect) {
      const roles =
        (window.GRS1Dashboard &&
          window.GRS1Dashboard.usuariosState &&
          window.GRS1Dashboard.usuariosState.roles) ||
        [];
      const currentRole = usuario
        ? usuario.role
        : roles.length
          ? roles[0].nombre
          : 'user';
      roleSelect.innerHTML = roles.length
        ? roles
            .map(function (r) {
              return (
                '<option value="' +
                r.nombre +
                '"' +
                (r.nombre === currentRole ? ' selected' : '') +
                '>' +
                r.nombre +
                '</option>'
              );
            })
            .join('')
        : '<option value="user">user</option><option value="admin">admin</option>';
      roleSelect.value = currentRole;
    }

    let arsIds = arsSeleccionadas;
    if (
      !Array.isArray(arsIds) &&
      usuario &&
      Array.isArray(usuario.ars_unidad_ids)
    ) {
      arsIds = usuario.ars_unidad_ids;
    }
    populateUsuarioArsSelect(Array.isArray(arsIds) ? arsIds : []);

    app.setUsuarioPasswordMode(Boolean(usuario));

    // Info de seguridad (solo en edición)
    const infoSeg = document.getElementById('usuarioInfoSeguridad');
    if (infoSeg) {
      if (usuario) {
        setUsuarioInfoSeguridadVisible(true);

        let loginEl = document.getElementById('usuarioUltimoLogin');
        if (loginEl) {
          loginEl.textContent = usuario.ultimo_login
            ? 'Último login: ' +
              new Date(usuario.ultimo_login).toLocaleString('es-ES')
            : 'Sin accesos registrados';
        }

        let estadoEl = document.getElementById('usuarioEstadoCuenta');
        if (estadoEl) {
          if (!usuario.activo) {
            estadoEl.innerHTML =
              '<span class="badge bg-secondary">Inactivo</span>';
          } else if (
            usuario.bloqueado_hasta &&
            new Date(usuario.bloqueado_hasta) > new Date()
          ) {
            estadoEl.innerHTML =
              '<span class="badge bg-danger">Bloqueado</span>';
          } else {
            estadoEl.innerHTML = '<span class="badge bg-success">Activo</span>';
          }
        }
      } else {
        setUsuarioInfoSeguridadVisible(false);
      }
    }
  };

  app.validateUsuarioForm = function validateUsuarioForm() {
    const form = getUsuarioForm();
    if (!form) {
      return false;
    }

    let passwordInput = document.getElementById('usuarioPassword');
    if (passwordInput) {
      let passwordValue = String(passwordInput.value || '');
      let isOptionalEmpty = !passwordInput.required && !passwordValue;
      let isPasswordValid =
        isOptionalEmpty || PASSWORD_POLICY_REGEX.test(passwordValue);
      passwordInput.setCustomValidity(
        isPasswordValid ? '' : PASSWORD_POLICY_MESSAGE
      );
    }

    let arsSelect = document.getElementById('usuarioArs');
    if (arsSelect) {
      let hasArs = getSelectedArsIds().length > 0;
      arsSelect.setCustomValidity(
        hasArs ? '' : 'Selecciona al menos una agrupación'
      );
    }

    const isValid = form.checkValidity();
    form.classList.toggle('was-validated', !isValid);

    if (!isValid) {
      form.reportValidity();
    }

    return isValid;
  };

  app.resetUsuarioForm = function resetUsuarioForm() {
    const form = getUsuarioForm();
    if (form) {
      form.reset();
      form.classList.remove('was-validated');
    }

    const passwordInput = document.getElementById('usuarioPassword');
    if (passwordInput) {
      passwordInput.setCustomValidity('');
    }

    const title = document.getElementById('usuarioModalTitle');
    if (title) {
      title.textContent = 'Agregar Nuevo Usuario';
    }

    // Poblar select de roles dinámicamente también en resetUsuarioForm
    const roleSelect = document.getElementById('usuarioRole');
    if (roleSelect) {
      const roles =
        (window.GRS1Dashboard &&
          window.GRS1Dashboard.usuariosState &&
          window.GRS1Dashboard.usuariosState.roles) ||
        [];
      const defaultRole = roles.length ? roles[0].nombre : 'user';
      roleSelect.innerHTML = roles.length
        ? roles
            .map(function (r) {
              return (
                '<option value="' + r.nombre + '">' + r.nombre + '</option>'
              );
            })
            .join('')
        : '<option value="user">user</option><option value="admin">admin</option>';
      roleSelect.value = defaultRole;
    }

    let catalog = (app.usuariosState && app.usuariosState.arsCatalog) || [];
    let defaultArs = catalog.length ? [catalog[0].id_unidad] : [];
    populateUsuarioArsSelect(defaultArs);

    app.setUsuarioPasswordMode(false);

    // Ocultar info de seguridad
    setUsuarioInfoSeguridadVisible(false);

    // Ocultar estado en creación
    let estadoGroup = document.getElementById('usuarioEstadoGroup');
    if (estadoGroup) estadoGroup.style.display = 'none';
  };

  app.getUsuarioFormData = function getUsuarioFormData(options = {}) {
    const password = getFieldValue('usuarioPassword');
    const data = {
      nombre: getFieldValue('usuarioNombre'),
      email: getFieldValue('usuarioEmail'),
      tip: getFieldValue('usuarioTip') || null,
      role: getFieldValue('usuarioRole'),
      ars_unidad_ids: getSelectedArsIds(),
    };

    if (options.includePassword || password) {
      data.password = password;
    }

    let estadoSelect = document.getElementById('usuarioActivo');
    let estadoGroup = document.getElementById('usuarioEstadoGroup');
    if (estadoSelect && estadoGroup && estadoGroup.style.display !== 'none') {
      data.activo = estadoSelect.value === 'true';
    }

    return data;
  };

  app.hideUsuarioModal = function hideUsuarioModal() {
    const modalElement = document.getElementById('usuarioModal');
    const modal = modalElement
      ? bootstrap.Modal.getInstance(modalElement)
      : null;
    if (modal) {
      modal.hide();
    }
  };
})();
