const pool = require('../db');
let ensurePromise;

async function ensureMuteTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {  await pool.query(`
    CREATE TABLE IF NOT EXISTS mutes (
      account_id TEXT NOT NULL DEFAULT 'primary',
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      muted_until BIGINT NOT NULL,
      reason TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (account_id, group_jid, user_jid)
    )
  `);
  await pool.query(`ALTER TABLE mutes ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'primary'`);
  await pool.query(`ALTER TABLE mutes DROP CONSTRAINT IF EXISTS mutes_pkey`);
  await pool.query(`ALTER TABLE mutes ADD PRIMARY KEY (account_id, group_jid, user_jid)`);
  })();
  return ensurePromise;
}

async function setMute(accountId, groupJid, userJid, mutedUntil, reason) {
  await ensureMuteTable();
  await pool.query(
    `INSERT INTO mutes (account_id, group_jid, user_jid, muted_until, reason, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (account_id, group_jid, user_jid)
     DO UPDATE SET muted_until = $4, reason = $5, updated_at = NOW()`,
    [accountId, groupJid, userJid, mutedUntil, reason || null]
  );
}

async function getMute(accountId, groupJid, userJid) {
  await ensureMuteTable();
  const res = await pool.query(
    'SELECT muted_until, reason FROM mutes WHERE account_id = $1 AND group_jid = $2 AND user_jid = $3',
    [accountId, groupJid, userJid]
  );
  return res.rows.length === 0 ? null : res.rows[0];
}

async function clearMute(accountId, groupJid, userJid) {
  await ensureMuteTable();
  await pool.query(
    'DELETE FROM mutes WHERE account_id = $1 AND group_jid = $2 AND user_jid = $3',
    [accountId, groupJid, userJid]
  );
}

module.exports = { ensureMuteTable, setMute, getMute, clearMute };
