const token = localStorage.getItem('token');

fetch('/api/usuarios', {
  headers: {
    Authorization: 'Bearer ' + token,
  },
});
