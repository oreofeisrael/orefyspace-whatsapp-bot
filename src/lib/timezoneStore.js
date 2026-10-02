const pool = require('../db');
let ensurePromise;

async function ensureTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = pool.query(`
    CREATE TABLE IF NOT EXISTS account_timezones (
      account_id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  return ensurePromise;
}

async function getTimezone(accountId) {
  await ensureTable();
  const result = await pool.query(
    'SELECT timezone FROM account_timezones WHERE account_id = $1',
    [accountId]
  );
  return result.rows[0]?.timezone || 'UTC';
}

async function setTimezone(accountId, timezone) {
  await ensureTable();
  await pool.query(
    `INSERT INTO account_timezones (account_id, timezone, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (account_id)
     DO UPDATE SET timezone = $2, updated_at = NOW()`,
    [accountId, timezone]
  );
}

module.exports = { ensureTable, getTimezone, setTimezone };
