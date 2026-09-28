const pool = require('../db');
let ensurePromise;

async function ensureAntilinkTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {  await pool.query(`
    CREATE TABLE IF NOT EXISTS antilink_settings (
      account_id TEXT NOT NULL DEFAULT 'primary',
      group_jid TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false,
      action TEXT NOT NULL DEFAULT 'delete',
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (account_id, group_jid)
    )
  `);
  await pool.query(`ALTER TABLE antilink_settings ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'primary'`);
  await pool.query(`ALTER TABLE antilink_settings DROP CONSTRAINT IF EXISTS antilink_settings_pkey`);
  await pool.query(`ALTER TABLE antilink_settings ADD PRIMARY KEY (account_id, group_jid)`);
  })();
  return ensurePromise;
}

async function getSettings(accountId, groupJid) {
  await ensureAntilinkTable();
  const res = await pool.query(
    'SELECT enabled, action FROM antilink_settings WHERE account_id = $1 AND group_jid = $2',
    [accountId, groupJid]
  );
  if (res.rows.length === 0) return { enabled: false, action: 'delete' };
  return res.rows[0];
}

async function setEnabled(accountId, groupJid, enabled) {
  await ensureAntilinkTable();
  await pool.query(
    `INSERT INTO antilink_settings (account_id, group_jid, enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (account_id, group_jid)
     DO UPDATE SET enabled = $3, updated_at = NOW()`,
    [accountId, groupJid, enabled]
  );
}

async function setAction(accountId, groupJid, action) {
  await ensureAntilinkTable();
  await pool.query(
    `INSERT INTO antilink_settings (account_id, group_jid, action, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (account_id, group_jid)
     DO UPDATE SET action = $3, updated_at = NOW()`,
    [accountId, groupJid, action]
  );
}

module.exports = { ensureAntilinkTable, getSettings, setEnabled, setAction };
