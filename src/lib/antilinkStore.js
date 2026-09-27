const pool = require('../db');

async function ensureAntilinkTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS antilink_settings (
      group_jid TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT false,
      action TEXT NOT NULL DEFAULT 'delete',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getSettings(groupJid) {
  await ensureAntilinkTable();
  const res = await pool.query(
    'SELECT enabled, action FROM antilink_settings WHERE group_jid = $1',
    [groupJid]
  );
  if (res.rows.length === 0) return { enabled: false, action: 'delete' };
  return res.rows[0];
}

async function setEnabled(groupJid, enabled) {
  await ensureAntilinkTable();
  await pool.query(
    `INSERT INTO antilink_settings (group_jid, enabled, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (group_jid)
     DO UPDATE SET enabled = $2, updated_at = NOW()`,
    [groupJid, enabled]
  );
}

async function setAction(groupJid, action) {
  await ensureAntilinkTable();
  await pool.query(
    `INSERT INTO antilink_settings (group_jid, action, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (group_jid)
     DO UPDATE SET action = $2, updated_at = NOW()`,
    [groupJid, action]
  );
}

module.exports = { ensureAntilinkTable, getSettings, setEnabled, setAction };