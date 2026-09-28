const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pool = require('../db');

const AUTH_ROOT = path.join(process.cwd(), 'auth_sessions');
const LEGACY_AUTH_FOLDER = path.join(process.cwd(), 'auth_session');
const LEGACY_SESSION_KEY = 'whatsapp_session';
const BACKUP_DEBOUNCE_MS = 3000;
const backupTimers = new Map();
const watchers = new Map();
let schemaPromise;

function accountFolder(accountId) {
  return path.join(AUTH_ROOT, accountId);
}

async function ensureSessionSchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        account_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        phone_number TEXT,
        wa_jid TEXT,
        data BYTEA,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS phone_number TEXT`);
    await pool.query(`ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS wa_jid TEXT`);

    // Preserve the existing single-account deployment as account "primary".
    try {
      const legacy = await pool.query(
        'SELECT data FROM session_backup WHERE key = $1',
        [LEGACY_SESSION_KEY]
      );
      if (legacy.rows.length > 0) {
        await pool.query(
          `INSERT INTO whatsapp_sessions (account_id, label, data, updated_at)
           VALUES ('primary', 'Primary account', $1, NOW())
           ON CONFLICT (account_id) DO UPDATE SET
             data = COALESCE(whatsapp_sessions.data, EXCLUDED.data),
             updated_at = NOW()`,
          [legacy.rows[0].data]
        );
      }
    } catch (error) {
      // The legacy table may not exist on a fresh installation.
      if (error.code !== '42P01') throw error;
    }

    await pool.query(`
      INSERT INTO whatsapp_sessions (account_id, label)
      VALUES ('primary', 'Primary account')
      ON CONFLICT (account_id) DO NOTHING
    `);
  })();

  return schemaPromise;
}

async function listSessionAccounts() {
  await ensureSessionSchema();
  const result = await pool.query(
    `SELECT account_id, label, phone_number, wa_jid, created_at, updated_at
     FROM whatsapp_sessions
     ORDER BY created_at ASC`
  );
  return result.rows;
}

async function updateSessionIdentity(accountId, phoneNumber, waJid) {
  await ensureSessionSchema();
  await pool.query(
    `UPDATE whatsapp_sessions
     SET phone_number = $2, wa_jid = $3, updated_at = NOW()
     WHERE account_id = $1`,
    [accountId, phoneNumber || null, waJid || null]
  );
}

async function createSessionAccount(label = '') {
  await ensureSessionSchema();
  const accountId = `account_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const cleanLabel = String(label || '').trim().slice(0, 80) || `WhatsApp account ${accountId.slice(-4)}`;
  await pool.query(
    'INSERT INTO whatsapp_sessions (account_id, label) VALUES ($1, $2)',
    [accountId, cleanLabel]
  );
  return { accountId, label: cleanLabel };
}

function hasAuthFiles(folder) {
  return fs.existsSync(folder) && fs.readdirSync(folder).length > 0;
}

async function restoreAccount(accountId, folder) {
  const result = await pool.query(
    'SELECT data FROM whatsapp_sessions WHERE account_id = $1',
    [accountId]
  );
  const data = result.rows[0]?.data;
  if (!data || hasAuthFiles(folder)) return;

  fs.mkdirSync(folder, { recursive: true });
  const zip = new AdmZip(data);
  zip.extractAllTo(folder, true);
  console.log(`📥 Restored WhatsApp account ${accountId} from database`);
}

async function backupAccountNow(accountId, folder) {
  try {
    if (!hasAuthFiles(folder)) return;
    const zip = new AdmZip();
    zip.addLocalFolder(folder);
    await pool.query(
      `UPDATE whatsapp_sessions
       SET data = $2, updated_at = NOW()
       WHERE account_id = $1`,
      [accountId, zip.toBuffer()]
    );
    console.log(`💾 Backed up WhatsApp account ${accountId}`);
  } catch (error) {
    console.error(`⚠️ Failed to back up account ${accountId}:`, error.message);
  }
}

function scheduleBackup(accountId, folder) {
  if (backupTimers.has(accountId)) clearTimeout(backupTimers.get(accountId));
  backupTimers.set(accountId, setTimeout(() => {
    backupTimers.delete(accountId);
    backupAccountNow(accountId, folder);
  }, BACKUP_DEBOUNCE_MS));
}

function watchAccountFolder(accountId, folder) {
  if (watchers.has(accountId)) return;
  const watcher = fs.watch(folder, { recursive: true }, (eventType, filename) => {
    if (filename) scheduleBackup(accountId, folder);
  });
  watchers.set(accountId, watcher);
  console.log(`👀 Watching auth folder for account ${accountId}`);
}

async function useDatabaseBackedAuthState(accountId) {
  await ensureSessionSchema();
  fs.mkdirSync(AUTH_ROOT, { recursive: true });
  const folder = accountFolder(accountId);

  // On a local upgrade, move the old folder into the new primary namespace.
  if (accountId === 'primary' && fs.existsSync(LEGACY_AUTH_FOLDER) && !fs.existsSync(folder)) {
    fs.renameSync(LEGACY_AUTH_FOLDER, folder);
  }

  fs.mkdirSync(folder, { recursive: true });
  await restoreAccount(accountId, folder);
  const { state, saveCreds } = await useMultiFileAuthState(folder);
  watchAccountFolder(accountId, folder);

  return {
    state,
    saveCreds: async () => {
      await saveCreds();
      scheduleBackup(accountId, folder);
    },
    folder,
  };
}

async function deleteSessionAccount(accountId) {
  if (accountId === 'primary') {
    throw new Error('The primary account cannot be deleted; reset it instead.');
  }
  await ensureSessionSchema();
  const watcher = watchers.get(accountId);
  if (watcher) watcher.close();
  watchers.delete(accountId);
  if (backupTimers.has(accountId)) clearTimeout(backupTimers.get(accountId));
  backupTimers.delete(accountId);
  fs.rmSync(accountFolder(accountId), { recursive: true, force: true });
  await pool.query('DELETE FROM whatsapp_sessions WHERE account_id = $1', [accountId]);
}

module.exports = {
  ensureSessionSchema,
  listSessionAccounts,
  createSessionAccount,
  updateSessionIdentity,
  useDatabaseBackedAuthState,
  deleteSessionAccount,
};
