const pool = require('../db');

let ensurePromise;

async function ensureTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = pool.query(`
    CREATE TABLE IF NOT EXISTS account_feature_settings (
      account_id TEXT PRIMARY KEY,
      status_view_emoji BOOLEAN NOT NULL DEFAULT FALSE,
      auto_status_view BOOLEAN NOT NULL DEFAULT FALSE,
      auto_status_download BOOLEAN NOT NULL DEFAULT TRUE,
      auto_status_include_jid BOOLEAN NOT NULL DEFAULT FALSE,
      always_online BOOLEAN NOT NULL DEFAULT FALSE,
      reject_calls BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  return ensurePromise;
}

async function getSettings(accountId) {
  await ensureTable();
  const result = await pool.query(
    `SELECT status_view_emoji, auto_status_view, auto_status_download,
            auto_status_include_jid, always_online, reject_calls
       FROM account_feature_settings
      WHERE account_id = $1`,
    [accountId]
  );
  return result.rows[0] || {
    status_view_emoji: false,
    auto_status_view: false,
    auto_status_download: true,
    auto_status_include_jid: false,
    always_online: false,
    reject_calls: false,
  };
}

async function setSettings(accountId, patch) {
  await ensureTable();
  const current = await getSettings(accountId);
  const next = { ...current, ...patch };
  await pool.query(
    `INSERT INTO account_feature_settings
      (account_id, status_view_emoji, auto_status_view, auto_status_download,
       auto_status_include_jid, always_online, reject_calls, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (account_id) DO UPDATE SET
       status_view_emoji = EXCLUDED.status_view_emoji,
       auto_status_view = EXCLUDED.auto_status_view,
       auto_status_download = EXCLUDED.auto_status_download,
       auto_status_include_jid = EXCLUDED.auto_status_include_jid,
       always_online = EXCLUDED.always_online,
       reject_calls = EXCLUDED.reject_calls,
       updated_at = NOW()`,
    [
      accountId,
      Boolean(next.status_view_emoji),
      Boolean(next.auto_status_view),
      Boolean(next.auto_status_download),
      Boolean(next.auto_status_include_jid),
      Boolean(next.always_online),
      Boolean(next.reject_calls),
    ]
  );
  return next;
}

module.exports = { ensureTable, getSettings, setSettings };
