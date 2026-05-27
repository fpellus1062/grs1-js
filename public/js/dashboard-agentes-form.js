(function () {
  const app = (window.GRS1Dashboard = window.GRS1Dashboard || {});

  function validateNifNie(value) {
    if (!value) return true; // campo opcional
    const v = value.trim().toUpperCase();
    return /^[XYZ]?\d{7,8}[A-Z]$/.test(v);
  }

  const agenteFields = {
    nombre: 'agenteNombre',
    apellido_1: 'agenteApellido1',
    apellido_2: 'agenteApellido2',
    email: 'agenteEmail',
    nif: 'agenteNif',
    telefono: 'agenteTelefono',
    peloton_id: 'agentePelotonId',
    empleo_id: 'agenteEmpleoId',
    orden_gc: 'agenteOrdenGc',
    tip: 'agenteTip',
    aptitudes: 'agenteAptitudes',
    situacion_id: 'agenteSituacionId',
    fecha_ant_empleo: 'agenteFechaAntEmpleo',
    domicilio: 'agenteDomicilio',
    poblacion: 'agentePoblacion',
    codigo_postal: 'agenteCodigoPostal',
    provincia: 'agenteProvincia',
  };

  function getFieldValue(fieldId) {
    const field = document.getElementById(fieldId);
    // @ts-ignore
    return field ? field.value : '';
  }

  function setFieldValue(fieldId, value) {
    const field = document.getElementById(fieldId);
    if (field) {
      // @ts-ignore
      field.value = value || '';
    }
  }

  function getAgenteForm() {
    return document.getElementById('agenteForm');
  }

  function normalizeTip(value) {
    return (value || '').trim().toUpperCase();
  }

  function getAvatarInput() {
    return document.getElementById('agenteAvatarFile');
  }

  function getAvatarPreview() {
    return document.getElementById('agenteAvatarPreview');
  }

  function getAvatarPlaceholder() {
    return document.getElementById('agenteAvatarPlaceholder');
  }

  function getAvatarUrlByTip(tip) {
    const safeTip = normalizeTip(tip);
    if (!safeTip) return '';
    const v = app._agentesAvatarVersion || 1;
    return '/avatars/' + encodeURIComponent(safeTip) + '.webp?v=' + encodeURIComponent(String(v));
  }

  function setAvatarPreviewUrl(url) {
    const img = getAvatarPreview();
    const placeholder = getAvatarPlaceholder();
    if (!(img instanceof HTMLImageElement) || !(placeholder instanceof HTMLElement)) {
      return;
    }
    if (!url) {
      img.removeAttribute('src');
      img.classList.add('d-none');
      placeholder.classList.remove('d-none');
      return;
    }

    img.onerror = function () {
      img.classList.add('d-none');
      placeholder.classList.remove('d-none');
    };

    img.src = url;
    img.classList.remove('d-none');
    placeholder.classList.add('d-none');
  }

  function clearAvatarSelection() {
    const avatarInput = getAvatarInput();
    if (avatarInput instanceof HTMLInputElement) {
      avatarInput.value = '';
    }
  }

  function bindAvatarControlsOnce() {
    const avatarInput = getAvatarInput();
    const btnClear = document.getElementById('btnAgenteAvatarClear');
    const preview = getAvatarPreview();

    if (avatarInput instanceof HTMLInputElement && !avatarInput.dataset.ttBound) {
      avatarInput.dataset.ttBound = '1';
      avatarInput.addEventListener('change', function () {
        const file = avatarInput.files && avatarInput.files[0];
        if (!file) {
          const tipField = document.getElementById('agenteTip');
          const tip = tipField instanceof HTMLInputElement ? tipField.value : '';
          setAvatarPreviewUrl(getAvatarUrlByTip(tip));
          return;
        }
        if (!String(file.type || '').toLowerCase().startsWith('image/')) {
          avatarInput.value = '';
          setAvatarPreviewUrl('');
          return;
        }
        const objectUrl = URL.createObjectURL(file);
        setAvatarPreviewUrl(objectUrl);
        if (preview instanceof HTMLImageElement) {
          preview.onload = function () {
            URL.revokeObjectURL(objectUrl);
          };
        }
      });
    }

    if (btnClear instanceof HTMLButtonElement && !btnClear.dataset.ttBound) {
      btnClear.dataset.ttBound = '1';
      btnClear.addEventListener('click', function () {
        clearAvatarSelection();
        const tipField = document.getElementById('agenteTip');
        const tip = tipField instanceof HTMLInputElement ? tipField.value : '';
        setAvatarPreviewUrl(getAvatarUrlByTip(tip));
      });
    }
  }

  // @ts-ignore
  app.getAgenteFormData = function getAgenteFormData() {
    return Object.entries(agenteFields).reduce((data, [property, fieldId]) => {
      const raw = getFieldValue(fieldId);
      if (property === 'tip') {
        data[property] = normalizeTip(raw);
      } else {
        data[property] = raw;
      }
      return data;
    }, {});
  };

  // @ts-ignore
  app.fillAgenteForm = function fillAgenteForm(agente) {
    Object.entries(agenteFields).forEach(([property, fieldId]) => {
      if (property === 'tip') {
        setFieldValue(fieldId, agente ? normalizeTip(agente[property]) : '');
      } else {
        setFieldValue(fieldId, agente ? agente[property] : '');
      }
    });

    // Sync badge dropdown buttons
    _syncBadgeBtn('agentePelotonId', 'btnDropdownPeloton', '-- Sin pelotón --');
    _syncBadgeBtn('agenteEmpleoId', 'btnDropdownEmpleo', '-- Sin empleo --');
    _syncBadgeBtn(
      'agenteSituacionId',
      'btnDropdownSituacion',
      '-- Sin situación --'
    );

    const form = getAgenteForm();
    if (form) {
      form.classList.remove('was-validated');
    }

    bindAvatarControlsOnce();
    clearAvatarSelection();
    setAvatarPreviewUrl(getAvatarUrlByTip(agente ? agente.tip : ''));
  };

  function _syncBadgeBtn(inputId, btnId, emptyLabel) {
    let input = document.getElementById(inputId);
    let btn = document.getElementById(btnId);
    let menu = btn ? btn.nextElementSibling : null;
    if (!input || !btn || !menu) return;
    // @ts-ignore
    let val = input.value;
    if (!val) {
      btn.innerHTML = '<span class="text-muted">' + emptyLabel + '</span>';
      return;
    }
    let item = menu.querySelector('[data-value="' + val + '"]');
    if (item) {
      let color = item.getAttribute('data-color') || '';
      let label = item.getAttribute('data-label') || '';
      if (color) {
        btn.innerHTML =
          '<span class="badge me-1" style="background:' +
          escapeAttr(color) +
          ';font-size:.82em;padding:.35em .55em">' +
          escapeAttr(label) +
          '</span>';
      } else {
        btn.innerHTML = '<span>' + escapeAttr(label) + '</span>';
      }
    }
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // @ts-ignore
  app.validateAgenteForm = function validateAgenteForm() {
    const form = getAgenteForm();
    if (!form) {
      return false;
    }

    // Custom NIF/NIE validation
    const nifField = document.getElementById('agenteNif');
    // @ts-ignore
    if (nifField && nifField.value.trim()) {
      // @ts-ignore
      if (!validateNifNie(nifField.value)) {
        // @ts-ignore
        nifField.setCustomValidity('NIF/NIE no válido');
      } else {
        // @ts-ignore
        nifField.setCustomValidity('');
      }
    } else if (nifField) {
      // @ts-ignore
      nifField.setCustomValidity('');
    }

    const tipField = document.getElementById('agenteTip');
    // @ts-ignore
    if (tipField && tipField.value.trim()) {
      // @ts-ignore
      if (!/^[A-Z][0-9]{5}[A-Z]$/.test(tipField.value.trim())) {
        // @ts-ignore
        tipField.setCustomValidity('El TIP debe tener formato A99999A');
      } else {
        // @ts-ignore
        tipField.setCustomValidity('');
      }
    } else if (tipField) {
      // @ts-ignore
      tipField.setCustomValidity('');
    }

    const avatarInput = getAvatarInput();
    const avatarSelected =
      avatarInput instanceof HTMLInputElement &&
      avatarInput.files &&
      avatarInput.files.length > 0;
    if (avatarSelected && tipField instanceof HTMLInputElement) {
      if (!tipField.value.trim()) {
        tipField.setCustomValidity('Debe indicar TIP para guardar el avatar');
      }
    }

    // @ts-ignore
    const isValid = form.checkValidity();
    form.classList.toggle('was-validated', !isValid);

    if (!isValid) {
      // @ts-ignore
      form.reportValidity();
    }

    return isValid;
  };

  // @ts-ignore
  app.resetAgenteForm = function resetAgenteForm() {
    const form = getAgenteForm();
    if (form) {
      // @ts-ignore
      form.reset();
      form.classList.remove('was-validated');
    }

    // Reset badge dropdown buttons
    _resetBadgeBtn(
      'agentePelotonId',
      'btnDropdownPeloton',
      '-- Sin pelotón --'
    );
    _resetBadgeBtn('agenteEmpleoId', 'btnDropdownEmpleo', '-- Sin empleo --');
    _resetBadgeBtn(
      'agenteSituacionId',
      'btnDropdownSituacion',
      '-- Sin situación --'
    );

    const title = document.getElementById('agenteModalTitle');
    if (title) {
      title.textContent = 'Agregar Nuevo Agente';
    }

    bindAvatarControlsOnce();
    clearAvatarSelection();
    setAvatarPreviewUrl('');
  };

  function _resetBadgeBtn(inputId, btnId, emptyLabel) {
    let input = document.getElementById(inputId);
    let btn = document.getElementById(btnId);
    // @ts-ignore
    if (input) input.value = '';
    if (btn)
      btn.innerHTML = '<span class="text-muted">' + emptyLabel + '</span>';
  }

  // @ts-ignore
  app.hideAgenteModal = function hideAgenteModal() {
    const modalElement = document.getElementById('agenteModal');
    const modal = modalElement
      ? bootstrap.Modal.getInstance(modalElement)
      : null;
    if (modal) {
      modal.hide();
    }
  };

  // @ts-ignore
  app.uploadAgenteAvatarIfSelected = async function uploadAgenteAvatarIfSelected(tipInput) {
    const avatarInput = getAvatarInput();
    const file =
      avatarInput instanceof HTMLInputElement && avatarInput.files
        ? avatarInput.files[0]
        : null;

    if (!file) return false;

    const tip = normalizeTip(tipInput);
    if (!/^[A-Z][0-9]{5}[A-Z]$/.test(tip)) {
      throw new Error('No se pudo subir el avatar: TIP inválido');
    }

    const headers =
      app && typeof app.getHeaders === 'function'
        ? app.getHeaders(false)
        : {};

    const formData = new FormData();
    formData.append('tip', tip);
    formData.append('avatar', file);

    const response = await fetch('/api/agentes/avatar', {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(function () {
        return null;
      });
      throw new Error(
        (error && error.message) || 'No se pudo subir el avatar del agente'
      );
    }

    app._agentesAvatarVersion = Date.now();
    clearAvatarSelection();
    setAvatarPreviewUrl(getAvatarUrlByTip(tip));
    return true;
  };

  document.addEventListener('input', function (event) {
    // @ts-ignore
    if (event && event.target && event.target.id === 'agenteTip') {
      // @ts-ignore
      event.target.value = normalizeTip(event.target.value);
    }
  });
})();
