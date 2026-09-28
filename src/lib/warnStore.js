const pool = require('../db');
let ensurePromise;

async function ensureWarnTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {  await pool.query(`
    CREATE TABLE IF NOT EXISTS warnings (
      account_id TEXT NOT NULL DEFAULT 'primary',
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      count INT NOT NULL DEFAULT 0,
      reasons TEXT[] NOT NULL DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (account_id, group_jid, user_jid)
    )
  `);
  await pool.query(`ALTER TABLE warnings ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'primary'`);
  await pool.query(`ALTER TABLE warnings DROP CONSTRAINT IF EXISTS warnings_pkey`);
  await pool.query(`ALTER TABLE warnings ADD PRIMARY KEY (account_id, group_jid, user_jid)`);
  })();
  return ensurePromise;
}

async function getWarning(accountId, groupJid, userJid) {
  await ensureWarnTable();
  const res = await pool.query(
    'SELECT count, reasons FROM warnings WHERE account_id = $1 AND group_jid = $2 AND user_jid = $3',
    [accountId, groupJid, userJid]
  );
  if (res.rows.length === 0) return { count: 0, reasons: [] };
  return res.rows[0];
}

async function addWarning(accountId, groupJid, userJid, reason) {
  await ensureWarnTable();
  const res = await pool.query(
    `INSERT INTO warnings (account_id, group_jid, user_jid, count, reasons, updated_at)
     VALUES ($1, $2, $3, 1, ARRAY[$4::text], NOW())
     ON CONFLICT (account_id, group_jid, user_jid)
     DO UPDATE SET
       count = warnings.count + 1,
       reasons = array_append(warnings.reasons, $4::text),
       updated_at = NOW()
     RETURNING count, reasons`,
    [accountId, groupJid, userJid, reason || 'No reason provided']
  );
  return res.rows[0];
}

async function resetWarnings(accountId, groupJid, userJid) {
  await ensureWarnTable();
  await pool.query(
    'DELETE FROM warnings WHERE account_id = $1 AND group_jid = $2 AND user_jid = $3',
    [accountId, groupJid, userJid]
  );
}

async function listActiveWarnings(accountId) {
  await ensureWarnTable();
  const params = accountId ? [accountId] : [];
  const where = accountId ? 'WHERE account_id = $1 AND count > 0' : 'WHERE count > 0';
  const res = await pool.query(
    `SELECT account_id, group_jid, user_jid, count, reasons, updated_at
     FROM warnings ${where}
     ORDER BY updated_at DESC`,
    params
  );
  return res.rows;
}

module.exports = { ensureWarnTable, getWarning, addWarning, resetWarnings, listActiveWarnings };
