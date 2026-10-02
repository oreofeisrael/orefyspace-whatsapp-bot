const pool = require('../db');
let ensurePromise;

async function ensureTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_schedules (
      id BIGSERIAL PRIMARY KEY,
      account_id TEXT NOT NULL,
      group_jid TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('mute', 'unmute')),
      time_local TEXT NOT NULL,
      days TEXT NOT NULL DEFAULT 'daily',
      enabled BOOLEAN NOT NULL DEFAULT true,
      last_run_key TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  return ensurePromise;
}

async function createSchedule(accountId, groupJid, action, timeLocal, days) {
  await ensureTable();
  const result = await pool.query(
    `INSERT INTO moderation_schedules (account_id, group_jid, action, time_local, days)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, account_id, group_jid, action, time_local, days, enabled`,
    [accountId, groupJid, action, timeLocal, days]
  );
  return result.rows[0];
}

async function listSchedules(accountId, groupJid = null) {
  await ensureTable();
  const result = groupJid
    ? await pool.query(
      `SELECT id, account_id, group_jid, action, time_local, days, enabled, last_run_key
       FROM moderation_schedules WHERE account_id = $1 AND group_jid = $2 AND enabled = true ORDER BY time_local, id`,
      [accountId, groupJid]
    )
    : await pool.query(
      `SELECT id, account_id, group_jid, action, time_local, days, enabled, last_run_key
       FROM moderation_schedules WHERE account_id = $1 AND enabled = true ORDER BY time_local, id`,
      [accountId]
    );
  return result.rows;
}

async function deleteSchedule(accountId, scheduleId, groupJid = null) {
  await ensureTable();
  const result = groupJid
    ? await pool.query(
      'DELETE FROM moderation_schedules WHERE account_id = $1 AND id = $2 AND group_jid = $3 RETURNING id',
      [accountId, scheduleId, groupJid]
    )
    : await pool.query(
      'DELETE FROM moderation_schedules WHERE account_id = $1 AND id = $2 RETURNING id',
      [accountId, scheduleId]
    );
  return result.rowCount > 0;
}

async function markScheduleRun(id, runKey) {
  await ensureTable();
  await pool.query(
    'UPDATE moderation_schedules SET last_run_key = $2 WHERE id = $1 AND (last_run_key IS DISTINCT FROM $2)',
    [id, runKey]
  );
}

module.exports = { ensureTable, createSchedule, listSchedules, deleteSchedule, markScheduleRun };
