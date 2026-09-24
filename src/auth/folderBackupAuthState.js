const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pool = require('../db');

const AUTH_FOLDER = path.join(process.cwd(), 'auth_session');
const SESSION_KEY = 'whatsapp_session';
const BACKUP_DEBOUNCE_MS = 8000; // avoid hammering the DB on rapid key updates

let backupTimer = null;

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS session_backup (
      key TEXT PRIMARY KEY,
      data BYTEA NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function restoreSessionFromDb() {
  const res = await pool.query('SELECT data FROM session_backup WHERE key = $1', [SESSION_KEY]);

  if (res.rows.length === 0) {
    console.log('ℹ️ No saved session in database. A QR scan will be needed.');
    return;
  }

  console.log('📥 Restoring WhatsApp session from database...');

  if (fs.existsSync(AUTH_FOLDER)) {
    fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
  }
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });

  const zip = new AdmZip(res.rows[0].data);
  zip.extractAllTo(AUTH_FOLDER, true);

  console.log('✅ Session restored from database.');
}

async function backupSessionToDbNow() {
  try {
    if (!fs.existsSync(AUTH_FOLDER)) return;

    const zip = new AdmZip();
    zip.addLocalFolder(AUTH_FOLDER);
    const buffer = zip.toBuffer();

    await pool.query(
      `INSERT INTO session_backup (key, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = NOW()`,
      [SESSION_KEY, buffer]
    );

    console.log('💾 Session backed up to database.');
  } catch (err) {
    console.error('⚠️ Failed to back up session to database:', err.message);
  }
}

function scheduleBackup() {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(backupSessionToDbNow, BACKUP_DEBOUNCE_MS);
}

async function useDatabaseBackedAuthState() {
  await ensureTable();
  await restoreSessionFromDb();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

  const wrappedSaveCreds = async () => {
    await saveCreds();
    scheduleBackup();
  };

  return { state, saveCreds: wrappedSaveCreds };
}

module.exports = { useDatabaseBackedAuthState };