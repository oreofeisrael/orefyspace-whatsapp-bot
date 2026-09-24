const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const pool = require('../db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_data (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `);
}

async function readData(key) {
  const res = await pool.query('SELECT value FROM auth_data WHERE key = $1', [key]);
  if (res.rows.length === 0) return null;
  return JSON.parse(JSON.stringify(res.rows[0].value), BufferJSON.reviver);
}

async function writeData(key, value) {
  const data = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
  await pool.query(
    `INSERT INTO auth_data (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, data]
  );
}

async function removeData(key) {
  await pool.query('DELETE FROM auth_data WHERE key = $1', [key]);
}

async function usePostgresAuthState() {
  await ensureTable();

  let creds = await readData('creds');
  if (!creds) creds = initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData('creds', creds),
  };
}

module.exports = { usePostgresAuthState };