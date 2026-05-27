const db = require('../config/db');

exports.getAll = async () => {
  const result = await db.query('SELECT * FROM usuarios');
  return result.rows;
};

exports.create = async (user) => {
  const { nombre, email } = user;

  const result = await db.query(
    'INSERT INTO usuarios(nombre, email) VALUES($1, $2) RETURNING *',
    [nombre, email]
  );

  return result.rows[0];
};
