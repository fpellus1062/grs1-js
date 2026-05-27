const db = require('../config/db');

exports.getAllHelp = async () => {
  const result = await db.query('SELECT * FROM help_items ORDER BY id DESC');
  return result.rows;
};

exports.getHelpByContext = async (context) => {
  const result = await db.query('SELECT * FROM help_items WHERE context = $1', [
    context,
  ]);
  return result.rows;
};

exports.createHelp = async ({ title, content, type, context }) => {
  const result = await db.query(
    `INSERT INTO help_items (title, content, type, context)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [title, content, type, context]
  );
  return result.rows[0];
};

exports.updateHelp = async (id, { title, content, type, context }) => {
  const result = await db.query(
    `UPDATE help_items SET title=$1, content=$2, type=$3, context=$4
     WHERE id=$5 RETURNING *`,
    [title, content, type, context, id]
  );
  return result.rows[0];
};

exports.deleteHelp = async (id) => {
  const result = await db.query(
    'DELETE FROM help_items WHERE id=$1 RETURNING *',
    [id]
  );
  return result.rows[0];
};
