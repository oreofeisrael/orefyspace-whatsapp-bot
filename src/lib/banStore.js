const pool = require('../db');
let ensurePromise;

async function ensureBanTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {  await pool.query(`
    CREATE TABLE IF NOT EXISTS bans (
      account_id TEXT NOT NULL DEFAULT 'primary',
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      reason TEXT,
      banned_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (account_id, group_jid, user_jid)
    )
  `);
  await pool.query(`ALTER TABLE bans ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'primary'`);
  await pool.query(`ALTER TABLE bans DROP CONSTRAINT IF EXISTS bans_pkey`);
  await pool.query(`ALTER TABLE bans ADD PRIMARY KEY (account_id, group_jid, user_jid)`);
  })();
  return ensurePromise;
}

async function addBan(accountId, groupJid, userJid, reason) {
  await ensureBanTable();
  await pool.query(
    `INSERT INTO bans (account_id, group_jid, user_jid, reason, banned_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (account_id, group_jid, user_jid)
     DO UPDATE SET reason = $4, banned_at = NOW()`,
    [accountId, groupJid, userJid, reason || null]
  );
}

async function isBanned(accountId, groupJid, userJid) {
  await ensureBanTable();
  const res = await pool.query(
    'SELECT reason FROM bans WHERE account_id = $1 AND group_jid = $2 AND user_jid = $3',
    [accountId, groupJid, userJid]
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}

async function removeBan(accountId, groupJid, userJid) {
  await ensureBanTable();
  const res = await pool.query(
    'DELETE FROM bans WHERE account_id = $1 AND group_jid = $2 AND user_jid = $3 RETURNING *',
    [accountId, groupJid, userJid]
  );
  return res.rowCount > 0;
}

module.exports = { ensureBanTable, addBan, isBanned, removeBan };
