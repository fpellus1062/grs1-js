(function () {
  const app = (window.GRS1Dashboard = window.GRS1Dashboard || {});

  const turnoFields = {
    codigo: 'turnoCodigo',
    nombre: 'turnoNombre',
    hora_inicio: 'turnoHoraInicio',
    hora_fin: 'turnoHoraFin',
    color: 'turnoColor',
    observaciones: 'turnoObservaciones',
  };

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

  function getTurnoForm() {
    return document.getElementById('turnoForm');
  }

  app.getTurnoFormData = function getTurnoFormData() {
    const data = Object.entries(turnoFields).reduce(
      (result, [property, fieldId]) => {
        result[property] = getFieldValue(fieldId);
        return result;
      },
      {}
    );

    // Código siempre en mayúsculas
    if (data.codigo) {
      data.codigo = data.codigo.toUpperCase().trim();
    }

    return data;
  };

  app.fillTurnoForm = function fillTurnoForm(turno) {
    Object.entries(turnoFields).forEach(([property, fieldId]) => {
      setFieldValue(fieldId, turno ? turno[property] : '');
    });

    // Sincronizar color picker con input texto
    const colorPicker = document.getElementById('turnoColorPicker');
    const colorInput = document.getElementById('turnoColor');
    if (colorPicker && colorInput) {
      const color = turno && turno.color ? turno.color : '#28a745';
      colorPicker.value = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#28a745';
    }

    // En modo edición, deshabilitar el campo código
    const codigoField = document.getElementById('turnoCodigo');
    if (codigoField) {
      codigoField.disabled = !!(turno && turno.id_turno);
    }

    const form = getTurnoForm();
    if (form) {
      form.classList.remove('was-validated');
    }
  };

  app.validateTurnoForm = function validateTurnoForm() {
    const form = getTurnoForm();
    if (!form) {
      return false;
    }

    const isValid = form.checkValidity();
    form.classList.toggle('was-validated', !isValid);

    if (!isValid) {
      form.reportValidity();
    }

    return isValid;
  };

  app.resetTurnoForm = function resetTurnoForm() {
    const form = getTurnoForm();
    if (form) {
      form.reset();
      form.classList.remove('was-validated');
    }

    const codigoField = document.getElementById('turnoCodigo');
    if (codigoField) {
      codigoField.disabled = false;
    }

    const title = document.getElementById('turnoModalTitle');
    if (title) {
      title.textContent = 'Agregar Nuevo Turno';
    }
  };

  app.hideTurnoModal = function hideTurnoModal() {
    const modalElement = document.getElementById('turnoModal');
    const modal = modalElement
      ? bootstrap.Modal.getInstance(modalElement)
      : null;
    if (modal) {
      modal.hide();
    }
  };

  // Sincronización entre color picker e input de texto
  app.setupTurnoColorSync = function setupTurnoColorSync() {
    const picker = document.getElementById('turnoColorPicker');
    const input = document.getElementById('turnoColor');

    if (picker && input) {
      picker.addEventListener('input', function () {
        input.value = picker.value;
      });
      input.addEventListener('input', function () {
        if (/^#[0-9a-fA-F]{6}$/.test(input.value)) {
          picker.value = input.value;
        }
      });
    }
  };
})();
