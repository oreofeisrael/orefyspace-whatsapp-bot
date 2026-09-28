const pool = require('../db');

async function ensureWarnTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS warnings (
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      count INT NOT NULL DEFAULT 0,
      reasons TEXT[] NOT NULL DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (group_jid, user_jid)
    )
  `);
}

async function getWarning(groupJid, userJid) {
  await ensureWarnTable();
  const res = await pool.query(
    'SELECT count, reasons FROM warnings WHERE group_jid = $1 AND user_jid = $2',
    [groupJid, userJid]
  );
  if (res.rows.length === 0) return { count: 0, reasons: [] };
  return res.rows[0];
}

async function addWarning(groupJid, userJid, reason) {
  await ensureWarnTable();
  const res = await pool.query(
    `INSERT INTO warnings (group_jid, user_jid, count, reasons, updated_at)
     VALUES ($1, $2, 1, ARRAY[$3::text], NOW())
     ON CONFLICT (group_jid, user_jid)
     DO UPDATE SET
       count = warnings.count + 1,
       reasons = array_append(warnings.reasons, $3::text),
       updated_at = NOW()
     RETURNING count, reasons`,
    [groupJid, userJid, reason || 'No reason provided']
  );
  return res.rows[0];
}

async function resetWarnings(groupJid, userJid) {
  await ensureWarnTable();
  await pool.query(
    'DELETE FROM warnings WHERE group_jid = $1 AND user_jid = $2',
    [groupJid, userJid]
  );
}

async function listActiveWarnings() {
  await ensureWarnTable();
  const res = await pool.query(
    `SELECT group_jid, user_jid, count, reasons, updated_at
     FROM warnings
     WHERE count > 0
     ORDER BY updated_at DESC`
  );
  return res.rows;
}

module.exports = {
  ensureWarnTable,
  getWarning,
  addWarning,
  resetWarnings,
  listActiveWarnings,
};
