const pool = require('../db');

async function ensureMuteTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mutes (
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      muted_until BIGINT NOT NULL,
      reason TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (group_jid, user_jid)
    )
  `);
}

async function setMute(groupJid, userJid, mutedUntil, reason) {
  await ensureMuteTable();
  await pool.query(
    `INSERT INTO mutes (group_jid, user_jid, muted_until, reason, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (group_jid, user_jid)
     DO UPDATE SET muted_until = $3, reason = $4, updated_at = NOW()`,
    [groupJid, userJid, mutedUntil, reason || null]
  );
}

async function getMute(groupJid, userJid) {
  await ensureMuteTable();
  const res = await pool.query(
    'SELECT muted_until, reason FROM mutes WHERE group_jid = $1 AND user_jid = $2',
    [groupJid, userJid]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

async function clearMute(groupJid, userJid) {
  await ensureMuteTable();
  await pool.query(
    'DELETE FROM mutes WHERE group_jid = $1 AND user_jid = $2',
    [groupJid, userJid]
  );
}

module.exports = { ensureMuteTable, setMute, getMute, clearMute };