(function () {
  const app = window.GRS1Dashboard;

  app.agentesTemplates = {
    alert(message, type) {
      return `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
          ${app.escapeHtml(message)}
          <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
      `;
    },
  };
})();
