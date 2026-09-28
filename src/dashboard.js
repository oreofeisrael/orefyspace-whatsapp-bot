const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { listActiveWarnings } = require('./lib/warnStore');
const dashboardEvents = require('./dashboardEvents');

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function credentialsValid(req) {
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    decoded = '';
  }

  const separator = decoded.indexOf(':');
  const suppliedUsername = separator >= 0 ? decoded.slice(0, separator) : '';
  const suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : '';

  return safeEqual(suppliedUsername, username) && safeEqual(suppliedPassword, password);
}

function dashboardAuth(req, res, next) {
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;

  if (!username || !password) {
    res.status(503).send(
      'Dashboard is disabled. Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD first.'
    );
    return;
  }

  if (!credentialsValid(req)) {
    res.set('WWW-Authenticate', 'Basic realm="Orefyspace Dashboard", charset="UTF-8"');
    res.status(401).send('Authentication required or credentials are invalid.');
    return;
  }

  next();
}

async function getWarningsPayload() {
  const warnings = await listActiveWarnings();
  return {
    warnings,
    total: warnings.reduce((sum, warning) => sum + Number(warning.count), 0),
  };
}

function createDashboardRouter({ getStatus }) {
  const router = express.Router();
  const dashboardPath = path.join(__dirname, '..', 'public', 'dashboard.html');

  router.use(dashboardAuth);

  router.get('/', (req, res) => {
    res.sendFile(dashboardPath);
  });

  router.get('/api/status', (req, res) => {
    res.json(getStatus());
  });

  router.get('/api/warnings', async (req, res) => {
    try {
      res.json(await getWarningsPayload());
    } catch (error) {
      console.error('❌ Dashboard warnings error:', error);
      res.status(500).json({ error: 'Unable to load active warnings.' });
    }
  });

  return router;
}

function attachDashboardWebSocket(server, { getStatus }) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname !== '/dashboard/ws') {
      socket.destroy();
      return;
    }
    if (!process.env.DASHBOARD_USERNAME || !process.env.DASHBOARD_PASSWORD || !credentialsValid(request)) {
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\n' +
        'WWW-Authenticate: Basic realm="Orefyspace Dashboard"\r\n' +
        'Connection: close\r\n\r\n'
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });

  const broadcast = (message) => {
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  const broadcastWarnings = async () => {
    try {
      broadcast({ type: 'warnings', data: await getWarningsPayload() });
    } catch (error) {
      console.error('❌ Dashboard WebSocket warnings error:', error);
    }
  };

  dashboardEvents.on('status', () => {
    broadcast({ type: 'status', data: getStatus() });
  });
  dashboardEvents.on('warnings', broadcastWarnings);

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', async (socket) => {
    socket.send(JSON.stringify({ type: 'status', data: getStatus() }));
    try {
      socket.send(JSON.stringify({ type: 'warnings', data: await getWarningsPayload() }));
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', data: 'Unable to load active warnings.' }));
    }
  });

  return wss;
}

module.exports = { createDashboardRouter, attachDashboardWebSocket };
