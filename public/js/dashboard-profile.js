(function () {
  const app = window.GRS1Dashboard;

  function getInitials(name) {
    let parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return 'U';
    return parts
      .slice(0, 2)
      .map(function (w) {
        return w.charAt(0).toUpperCase();
      })
      .join('');
  }

  function renderNavAvatar(avatarEl, name, tip) {
    if (!avatarEl) return;
    let initials = getInitials(name);

    avatarEl.innerHTML = '';
    avatarEl.textContent = initials;
    avatarEl.style.backgroundColor = 'var(--primary-gc-color, #276836)';

    if (!tip) return;

    let avatarUrl = '/avatars/' + encodeURIComponent(tip) + '.jpg';
    let img = document.createElement('img');
    img.alt = name || 'Usuario';
    img.src = avatarUrl;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '50%';

    img.addEventListener('error', function () {
      avatarEl.innerHTML = '';
      avatarEl.textContent = initials;
    });

    img.addEventListener('load', function () {
      avatarEl.innerHTML = '';
      avatarEl.appendChild(img);
    });
  }

  // ── Inicializar: poblar avatar e iniciales en navbar ──────
  app.initProfile = function initProfile() {
    let name = app.globalState.userName || 'Usuario';
    let tip = app.globalState.userTip || '';
    let avatarEl = document.getElementById('navProfileAvatar');
    let nameEl = document.getElementById('navProfileName');

    renderNavAvatar(avatarEl, name, tip);
    if (nameEl) {
      nameEl.textContent = name;
    }

    // Botones de abrir modales
    let btnProfile = document.getElementById('btnOpenProfile');
    if (btnProfile) {
      btnProfile.addEventListener('click', app.openProfileModal);
    }

    let btnChangePass = document.getElementById('btnOpenChangePassword');
    if (btnChangePass) {
      btnChangePass.addEventListener('click', app.openChangePasswordModal);
    }

    // Botón guardar perfil
    let btnSaveProfile = document.getElementById('btnSaveProfile');
    if (btnSaveProfile) {
      btnSaveProfile.addEventListener('click', app.saveProfile);
    }

    // Botón guardar contraseña
    let btnSavePass = document.getElementById('btnSaveChangePassword');
    if (btnSavePass) {
      btnSavePass.addEventListener('click', app.saveChangePassword);
    }

    // Toggle password visibility en change password modal
    document.querySelectorAll('[data-toggle-password]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        let inputId = btn.dataset.togglePassword;
        let input = document.getElementById(inputId);
        if (!input) return;
        let isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.querySelector('i').className = isPassword
          ? 'bi bi-eye-slash'
          : 'bi bi-eye';
      });
    });

    // Password strength on new password
    let newPassInput = document.getElementById('cpNewPassword');
    if (newPassInput) {
      newPassInput.addEventListener('input', function () {
        updateCpPasswordStrength(newPassInput.value);
      });
    }

    // Reset change password form on close
    let cpModal = document.getElementById('changePasswordModal');
    if (cpModal) {
      cpModal.addEventListener('hidden.bs.modal', function () {
        let form = document.getElementById('changePasswordForm');
        if (form) {
          form.reset();
          form.classList.remove('was-validated');
        }
        let container = document.getElementById('cpAlertContainer');
        if (container) container.innerHTML = '';
        let strength = document.getElementById('cpPasswordStrength');
        if (strength) strength.style.display = 'none';
        // Reset toggle icons
        cpModal
          .querySelectorAll('[data-toggle-password]')
          .forEach(function (btn) {
            let icon = btn.querySelector('i');
            if (icon) icon.className = 'bi bi-eye';
            let input = document.getElementById(btn.dataset.togglePassword);
            if (input) input.type = 'password';
          });
      });
    }
  };

  function updateCpPasswordStrength(pwd) {
    let container = document.getElementById('cpPasswordStrength');
    let bar = document.getElementById('cpPasswordStrengthBar');
    let text = document.getElementById('cpPasswordStrengthText');
    if (!container || !bar || !text) return;

    if (!pwd) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';

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
    text.textContent = level.label;
  }

  // ── Abrir modal de perfil ────────────────────────────────
  app.openProfileModal = async function openProfileModal() {
    try {
      let res = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + app.globalState.token },
      });
      if (!res.ok) throw new Error('No se pudo obtener el perfil');
      let data = await res.json();
      let p = data.profile;

      document.getElementById('profileNombre').value = p.nombre || '';
      document.getElementById('profileEmail').value = p.email || '';
      document.getElementById('profileRole').value = p.role || '';

      // Sincronizar TIP desde el perfil (puede haberse asignado después del login)
      if (p.tip) {
        localStorage.setItem('userTip', p.tip);
        app.globalState.userTip = p.tip;
      }
      document.getElementById('profileUltimoLogin').value = p.ultimo_login
        ? new Date(p.ultimo_login).toLocaleString('es-ES')
        : 'Sin accesos';
      document.getElementById('profileCreatedAt').value = p.created_at
        ? new Date(p.created_at).toLocaleString('es-ES')
        : '—';

      let form = document.getElementById('profileForm');
      if (form) form.classList.remove('was-validated');

      bootstrap.Modal.getOrCreateInstance(
        document.getElementById('profileModal')
      ).show();
    } catch (e) {
      console.error('Error cargando perfil:', e);
    }
  };

  // ── Guardar perfil ───────────────────────────────────────
  app.saveProfile = async function saveProfile() {
    let form = document.getElementById('profileForm');
    if (form && !form.checkValidity()) {
      form.classList.add('was-validated');
      form.reportValidity();
      return;
    }

    let nombre = document.getElementById('profileNombre').value.trim();

    try {
      let res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + app.globalState.token,
        },
        body: JSON.stringify({ nombre: nombre }),
      });

      if (!res.ok) {
        let err = await res.json();
        throw new Error(err.message || 'Error al actualizar perfil');
      }

      // Actualizar nombre en localStorage y UI
      localStorage.setItem('userName', nombre);
      app.globalState.userName = nombre;
      app.syncUserInfo();
      app.initProfile();

      bootstrap.Modal.getInstance(
        document.getElementById('profileModal')
      ).hide();
    } catch (e) {
      console.error('Error actualizando perfil:', e);
      alert(e.message);
    }
  };

  // ── Abrir modal cambiar contraseña ────────────────────────
  app.openChangePasswordModal = function openChangePasswordModal() {
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById('changePasswordModal')
    ).show();
  };

  // ── Guardar nueva contraseña ──────────────────────────────
  app.saveChangePassword = async function saveChangePassword() {
    let form = document.getElementById('changePasswordForm');
    let alertContainer = document.getElementById('cpAlertContainer');

    if (alertContainer) alertContainer.innerHTML = '';

    if (form && !form.checkValidity()) {
      form.classList.add('was-validated');
      form.reportValidity();
      return;
    }

    let currentPassword = document.getElementById('cpCurrentPassword').value;
    let newPassword = document.getElementById('cpNewPassword').value;
    let confirmPassword = document.getElementById('cpConfirmPassword').value;

    if (newPassword !== confirmPassword) {
      if (alertContainer) {
        alertContainer.innerHTML =
          '<div class="alert alert-danger py-1 small">Las contraseñas no coinciden</div>';
      }
      return;
    }

    try {
      let res = await fetch('/api/auth/change-password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + app.globalState.token,
        },
        body: JSON.stringify({
          currentPassword: currentPassword,
          newPassword: newPassword,
        }),
      });

      if (!res.ok) {
        let err = await res.json();
        throw new Error(err.message || 'Error al cambiar contraseña');
      }

      bootstrap.Modal.getInstance(
        document.getElementById('changePasswordModal')
      ).hide();
      alert('Contraseña actualizada correctamente');
    } catch (e) {
      console.error('Error cambiando contraseña:', e);
      if (alertContainer) {
        alertContainer.innerHTML =
          '<div class="alert alert-danger py-1 small">' + e.message + '</div>';
      }
    }
  };
})();
