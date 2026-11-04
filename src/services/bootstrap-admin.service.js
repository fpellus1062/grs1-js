const bcrypt = require('bcrypt');
const db = require('../config/db');
const { PASSWORD_REGEX } = require('../validators/auth.validator');

// Crea el primer admin solo si la tabla usuarios está vacía.
// Credenciales por BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD (opcional BOOTSTRAP_ADMIN_NOMBRE).
exports.bootstrapAdmin = async () => {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!email || !password) return false;

  const count = await db.query('SELECT COUNT(*)::int AS n FROM usuarios');
  if (count.rows[0].n > 0) return false;

  if (
    password.length < 12 ||
    password.length > 72 ||
    (PASSWORD_REGEX && !PASSWORD_REGEX.test(password))
  ) {
    console.error('[bootstrap-admin] BOOTSTRAP_ADMIN_PASSWORD no cumple la política');
    return false;
  }

  const nombre = process.env.BOOTSTRAP_ADMIN_NOMBRE || 'Administrador';
  const hash = await bcrypt.hash(password, 10);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let rol = await client.query(
      "SELECT id FROM roles WHERE nombre = 'admin' LIMIT 1"
    );
    if (!rol.rows.length) {
      rol = await client.query(
        `INSERT INTO roles (nombre, descripcion, es_sistema, activo)
         VALUES ('admin', 'Administrador', true, true) RETURNING id`
      );
    }
    const roleId = rol.rows[0].id;
    await client.query(
      `INSERT INTO roles_permisos (rol_id, permiso_id)
       SELECT $1, id FROM permisos
       ON CONFLICT DO NOTHING`,
      [roleId]
    );
    await client.query(
      'INSERT INTO usuarios(nombre, email, password, role, role_id) VALUES($1,$2,$3,$4,$5)',
      [nombre, email, hash, 'admin', roleId]
    );
    await client.query('COMMIT');
    console.log(`[bootstrap-admin] Usuario admin creado: ${email}`);
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
