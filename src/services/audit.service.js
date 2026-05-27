const db = require('../config/db');

/**
 * Registra un intento de login en audit_login.
 * Se llama desde auth.service.login de forma fire-and-forget.
 */
exports.logLogin = async ({
  usuario_id,
  email,
  ip,
  user_agent,
  resultado,
  detalle,
}) => {
  try {
    await db.query(
      `INSERT INTO audit_login (usuario_id, email, ip, user_agent, resultado, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        usuario_id || null,
        email,
        ip || null,
        user_agent || null,
        resultado,
        detalle || null,
      ]
    );
  } catch (err) {
    // No lanzar: la auditoría no debe romper el flujo de login
    console.error('[audit] Error registrando login:', err.message);
  }
};

/**
 * Consulta el log de auditoría de login con filtros opcionales.
 */
exports.getLoginLog = async ({
  usuario_id,
  resultado,
  desde,
  hasta,
  ip,
  limit = 200,
  offset = 0,
} = {}) => {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (usuario_id) {
    conditions.push(`al.usuario_id = $${idx++}`);
    params.push(usuario_id);
  }
  if (resultado) {
    conditions.push(`al.resultado = $${idx++}`);
    params.push(resultado);
  }
  if (desde) {
    conditions.push(`al.created_at >= $${idx++}`);
    params.push(desde);
  }
  if (hasta) {
    conditions.push(`al.created_at <= $${idx++}`);
    params.push(hasta);
  }
  if (ip) {
    conditions.push(`al.ip = $${idx++}`);
    params.push(ip);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const countResult = await db.query(
    `SELECT COUNT(*) AS total FROM audit_login al ${where}`,
    params
  );

  const dataResult = await db.query(
    `SELECT al.id, al.usuario_id, al.email, al.ip, al.user_agent, al.resultado, al.detalle, al.created_at,
            u.nombre AS usuario_nombre
     FROM audit_login al
     LEFT JOIN usuarios u ON u.id = al.usuario_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return {
    total: parseInt(countResult.rows[0].total, 10),
    data: dataResult.rows,
  };
};
