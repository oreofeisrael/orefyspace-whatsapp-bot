const pool = require('../db');

async function ensureBanTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bans (
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      reason TEXT,
      banned_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (group_jid, user_jid)
    )
  `);
}

async function addBan(groupJid, userJid, reason) {
  await ensureBanTable();
  await pool.query(
    `INSERT INTO bans (group_jid, user_jid, reason, banned_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (group_jid, user_jid)
     DO UPDATE SET reason = $3, banned_at = NOW()`,
    [groupJid, userJid, reason || null]
  );
}

async function isBanned(groupJid, userJid) {
  await ensureBanTable();
  const res = await pool.query(
    'SELECT reason FROM bans WHERE group_jid = $1 AND user_jid = $2',
    [groupJid, userJid]
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}

async function removeBan(groupJid, userJid) {
  await ensureBanTable();
  const res = await pool.query(
    'DELETE FROM bans WHERE group_jid = $1 AND user_jid = $2 RETURNING *',
    [groupJid, userJid]
  );
  return res.rowCount > 0;
}

module.exports = { ensureBanTable, addBan, isBanned, removeBan };