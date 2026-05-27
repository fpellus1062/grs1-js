const { Pool, types } = require('pg');
require('dotenv').config();

// OID 1082 = DATE → devolver como string 'YYYY-MM-DD' sin pasar por Date de JS
types.setTypeParser(1082, function (val) {
  return val;
});

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: Number(process.env.PG_POOL_MAX || 30),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 60000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT || 10000),
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT || 60000),
  idle_in_transaction_session_timeout: Number(
    process.env.PG_IDLE_IN_TX_TIMEOUT || 30000
  ),
});

// Evitar crash por ECONNRESET u otras pérdidas de conexión del pool
pool.on('error', (err) => {
  console.error('[db.pool] Error inesperado en cliente idle:', err.message);
});

module.exports = pool;
