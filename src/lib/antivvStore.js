const pool = require('../db');
let ensurePromise;

async function ensureTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS anti_view_once_settings (
        account_id TEXT NOT NULL DEFAULT 'primary',
        chat_jid TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (account_id, chat_jid)
      )
    `);
  })();
  return ensurePromise;
}

async function getEnabled(accountId, chatJid) {
  await ensureTable();
  const result = await pool.query(
    'SELECT enabled FROM anti_view_once_settings WHERE account_id = $1 AND chat_jid = $2',
    [accountId, chatJid]
  );
  return Boolean(result.rows[0]?.enabled);
}

async function setEnabled(accountId, chatJid, enabled) {
  await ensureTable();
  await pool.query(
    `INSERT INTO anti_view_once_settings (account_id, chat_jid, enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (account_id, chat_jid)
     DO UPDATE SET enabled = $3, updated_at = NOW()`,
    [accountId, chatJid, enabled]
  );
}

module.exports = { ensureTable, getEnabled, setEnabled };
