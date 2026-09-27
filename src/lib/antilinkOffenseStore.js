const pool = require('../db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS antilink_offenses (
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      stage INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (group_jid, user_jid)
    )
  `);
}

async function incrementStage(groupJid, userJid) {
  await ensureTable();
  const res = await pool.query(
    `INSERT INTO antilink_offenses (group_jid, user_jid, stage, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (group_jid, user_jid)
     DO UPDATE SET stage = antilink_offenses.stage + 1, updated_at = NOW()
     RETURNING stage`,
    [groupJid, userJid]
  );
  return res.rows[0].stage;
}

async function resetStage(groupJid, userJid) {
  await ensureTable();
  await pool.query(
    'DELETE FROM antilink_offenses WHERE group_jid = $1 AND user_jid = $2',
    [groupJid, userJid]
  );
}

module.exports = { ensureTable, incrementStage, resetStage };