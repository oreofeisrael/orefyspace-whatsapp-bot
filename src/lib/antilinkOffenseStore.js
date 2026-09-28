const pool = require('../db');
let ensurePromise;

async function ensureTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {  await pool.query(`
    CREATE TABLE IF NOT EXISTS antilink_offenses (
      account_id TEXT NOT NULL DEFAULT 'primary',
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      stage INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (account_id, group_jid, user_jid)
    )
  `);
  await pool.query(`ALTER TABLE antilink_offenses ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'primary'`);
  await pool.query(`ALTER TABLE antilink_offenses DROP CONSTRAINT IF EXISTS antilink_offenses_pkey`);
  await pool.query(`ALTER TABLE antilink_offenses ADD PRIMARY KEY (account_id, group_jid, user_jid)`);
  })();
  return ensurePromise;
}

async function incrementStage(accountId, groupJid, userJid) {
  await ensureTable();
  const res = await pool.query(
    `INSERT INTO antilink_offenses (account_id, group_jid, user_jid, stage, updated_at)
     VALUES ($1, $2, $3, 1, NOW())
     ON CONFLICT (account_id, group_jid, user_jid)
     DO UPDATE SET stage = antilink_offenses.stage + 1, updated_at = NOW()
     RETURNING stage`,
    [accountId, groupJid, userJid]
  );
  return res.rows[0].stage;
}

async function resetStage(accountId, groupJid, userJid) {
  await ensureTable();
  await pool.query(
    'DELETE FROM antilink_offenses WHERE account_id = $1 AND group_jid = $2 AND user_jid = $3',
    [accountId, groupJid, userJid]
  );
}

module.exports = { ensureTable, incrementStage, resetStage };
