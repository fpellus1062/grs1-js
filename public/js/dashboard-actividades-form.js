(function () {
  const app = (window.GRS1Dashboard = window.GRS1Dashboard || {});

  const actividadFields = {
    actividad: 'actividadCodigo',
    nombre: 'actividadNombre',
    disponible: 'actividadDisponible',
    grupo_id: 'actividadGrupoId',
    horario: 'actividadHorario',
    hora_inicio: 'actividadHoraInicio',
    hora_fin: 'actividadHoraFin',
    color: 'actividadColor',
  };

  const DEFAULT_ACTIVIDAD_COLOR = '#6c757d';

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

  function setOptions(selectId, options, getValue, getLabel, emptyLabel) {
    const select = document.getElementById(selectId);
    if (!select) {
      return;
    }

    // @ts-ignore
    const currentValue = select.value;
    const normalizedOptions = Array.isArray(options) ? options : [];

    select.innerHTML = '';

    if (emptyLabel !== undefined) {
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = emptyLabel;
      select.appendChild(emptyOption);
    }

    normalizedOptions.forEach((option) => {
      const optionElement = document.createElement('option');
      optionElement.value = getValue(option);
      optionElement.textContent = getLabel(option);
      select.appendChild(optionElement);
    });

    // @ts-ignore
    select.value = currentValue;
  }

  function getActividadForm() {
    return document.getElementById('actividadForm');
  }

  // @ts-ignore
  app.getActividadFormData = function getActividadFormData() {
    return Object.entries(actividadFields).reduce(
      (data, [property, fieldId]) => {
        if (property === 'color') {
          const field = document.getElementById(fieldId);
          // @ts-ignore
          const rawColor = field ? String(field.value || '').trim() : '';
          data[property] = /^#[0-9a-fA-F]{6}$/.test(rawColor)
            ? rawColor
            : DEFAULT_ACTIVIDAD_COLOR;
        } else {
          data[property] = getFieldValue(fieldId);
        }
        return data;
      },
      {}
    );
  };

  // @ts-ignore
  app.fillActividadForm = function fillActividadForm(actividad) {
    Object.entries(actividadFields).forEach(([property, fieldId]) => {
      if (property === 'color') {
        const field = document.getElementById(fieldId);
        const colorVal = actividad ? actividad[property] || '' : '';
        if (field) {
          if (/^#[0-9a-fA-F]{6}$/.test(colorVal)) {
            // @ts-ignore
            field.value = colorVal;
          } else {
            // @ts-ignore
            field.value = DEFAULT_ACTIVIDAD_COLOR;
          }
        }
      } else {
        setFieldValue(fieldId, actividad ? actividad[property] : '');
      }
    });

    const clearBtn = document.getElementById('btnClearActividadColor');
    if (clearBtn) {
      clearBtn.onclick = function () {
        const field = document.getElementById('actividadColor');
        if (field) {
          // @ts-ignore
          field.value = DEFAULT_ACTIVIDAD_COLOR;
        }
      };
    }

    const form = getActividadForm();
    if (form) {
      form.classList.remove('was-validated');
    }
  };

  // @ts-ignore
  app.populateActividadFormOptions = function populateActividadFormOptions() {
    setOptions(
      'actividadDisponible',
      // @ts-ignore
      app.actividadesState.disponibilidadOptions,
      (option) => option,
      (option) => option || 'Sin marca',
      undefined
    );

    setOptions(
      'actividadGrupoId',
      // @ts-ignore
      app.actividadesState.grupos,
      (grupo) => String(grupo.id_grupo),
      (grupo) => `${grupo.id_grupo} - ${grupo.nombre}`,
      'Sin grupo'
    );
  };

  // @ts-ignore
  app.validateActividadForm = function validateActividadForm() {
    const form = getActividadForm();
    if (!form) {
      return false;
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
  app.resetActividadForm = function resetActividadForm() {
    const form = getActividadForm();
    if (form) {
      // @ts-ignore
      form.reset();
      form.classList.remove('was-validated');
    }

    // @ts-ignore
    app.populateActividadFormOptions();
    setFieldValue('actividadDisponible', '');

    const colorField = document.getElementById('actividadColor');
    if (colorField) {
      // @ts-ignore
      colorField.value = DEFAULT_ACTIVIDAD_COLOR;
    }

    const clearBtn = document.getElementById('btnClearActividadColor');
    if (clearBtn) {
      clearBtn.onclick = function () {
        const field = document.getElementById('actividadColor');
        if (field) {
          // @ts-ignore
          field.value = DEFAULT_ACTIVIDAD_COLOR;
        }
      };
    }

    const title = document.getElementById('actividadModalTitle');
    if (title) {
      title.textContent = 'Agregar Nuevo Servicio';
    }
  };

  // @ts-ignore
  app.hideActividadModal = function hideActividadModal() {
    const modalElement = document.getElementById('actividadModal');
    const modal = modalElement
      ? bootstrap.Modal.getInstance(modalElement)
      : null;
    if (modal) {
      modal.hide();
    }
  };
})();
