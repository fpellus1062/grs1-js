// Ejemplo del flujo de creación
window.openNuevoCuadranteModal = function openNuevoCuadranteModal() {
  let app = window.GRS1Dashboard;
  let periodo = app._asig.getPeriodo();

  // Generar preview desde el API
  fetch(
    '/api/cuadrantes/preview?anio=' + periodo.anio + '&mes=' + periodo.mes,
    {
      headers: app._asig.headers(),
    }
  )
    .then(function (res) {
      return res.json();
    })
    .then(function (json) {
      let cuadrante = json.data;

      // Rellenar el formulario
      document.getElementById('cuadranteNombre').value = cuadrante.nombre;
      document.getElementById('cuadranteNumSemanas').value =
        cuadrante.num_semanas;
      document.getElementById('cuadranteRangoInfo').textContent =
        cuadrante.fecha_inicio +
        ' → ' +
        cuadrante.fecha_fin +
        ' (' +
        cuadrante.num_semanas +
        ' semanas, ' +
        cuadrante.dias.length +
        ' días)';

      // Renderizar preview
      window.renderCuadrantePreview('cuadrantePreviewContainer', cuadrante);

      // Mostrar modal
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById('modalNuevoCuadrante')
      ).show();
    });
};
