import http from 'http';
import fs from 'fs';
import path from 'path';
import { env } from './config/environment.js';
import { webhookHandler } from './api/webhookHandler.js';
import { predictionEngine } from './services/predictionEngine.js';
import { twilioService } from './services/twilioService.js';
import { whatsappService } from './services/whatsappService.js';
import { telegramService } from './services/telegramService.js';
import { portfolioService } from './services/portfolioService.js';
import { schedulerService } from './services/schedulerService.js';
import { capitalManagerService } from './services/capitalManagerService.js';
import { reportingService } from './services/reportingService.js';
import { localBridgeService } from './services/broker/localBridgeService.js';
import { executionBridge } from './services/broker/executionBridge.js';

/**
 * 🌐 [INVEST AI] Servidor HTTP Autónomo para Google Cloud Run
 * Soporta healthcheck, webhooks, endpoints REST de portafolio, broker co-piloto y cron.
 */

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

function serveStaticFile(req, res, pathname) {
  const rawUrl = req.url || '';
  if (rawUrl.includes('..') || decodeURI(rawUrl).includes('..')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return true;
  }
  const target = pathname === '/' || pathname === '/dashboard' ? '/index.html' : pathname;
  const safePath = path.normalize(path.join(PUBLIC_DIR, target));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return true;
  }
  if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(safePath).pipe(res);
    return true;
  }
  return false;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', (err) => reject(err));
  });
}

function isCronAuthorized(req) {
  const cronSecret = req.headers['x-cron-secret'];
  const isCloudScheduler = req.headers['x-cloudscheduler'] === 'true';
  return isCloudScheduler || (Boolean(cronSecret) && cronSecret === env.CRON_SECRET);
}

function isBridgeAuthorized(req) {
  const bridgeSecret = req.headers['x-bridge-secret'];
  return Boolean(bridgeSecret) && bridgeSecret === env.BRIDGE_SECRET;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method;

  // 1. Healthcheck probe para Google Cloud Run
  if (method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'HEALTHY',
      service: 'invest-ai-engine',
      project: env.GCP_PROJECT_ID,
      broker: env.BROKER_ENVIRONMENT,
      capital: capitalManagerService.getCapitalStatus(),
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // 2. Terminal Web Institucional y Activos Estáticos PWA (GET / o /dashboard o /public/*)
  if (method === 'GET' && serveStaticFile(req, res, url.pathname)) {
    return;
  }

  // 3. Webhook Handshake de Meta (GET /webhook)
  if (method === 'GET' && url.pathname === '/webhook') {
    const result = webhookHandler.handleVerification(url.searchParams);
    res.writeHead(result.status, { 'Content-Type': 'text/plain' });
    res.end(result.body);
    return;
  }

  // 3. Webhook de Eventos y Botones de Meta (POST /webhook)
  if (method === 'POST' && url.pathname === '/webhook') {
    try {
      const raw = await readRequestBody(req);
      const payload = JSON.parse(raw || '{}');
      const response = await webhookHandler.handleIncomingEvent(payload);
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload JSON inválido' }));
    }
    return;
  }

  // 4. Webhook de Respuestas Entrantes de Twilio WhatsApp (POST /webhook/twilio)
  if (method === 'POST' && url.pathname === '/webhook/twilio') {
    try {
      const raw = await readRequestBody(req);
      const formParams = new URLSearchParams(raw);
      const response = await webhookHandler.handleTwilioIncoming(formParams);
      res.writeHead(response.status, { 'Content-Type': 'application/xml' });
      res.end(response.twiml);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/xml' });
      res.end('<Response></Response>');
    }
    return;
  }

  // 5. Webhook de Telegram Bot API (POST /webhook/telegram)
  if (method === 'POST' && url.pathname === '/webhook/telegram') {
    try {
      const raw = await readRequestBody(req);
      const payload = JSON.parse(raw || '{}');
      const response = await webhookHandler.handleTelegramUpdate(payload);
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload JSON inválido para Telegram' }));
    }
    return;
  }

  // 6. Cloud Scheduler Cron: Escaneo Autónomo (POST /api/cron/scan)
  if (method === 'POST' && url.pathname === '/api/cron/scan') {
    if (!isCronAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing cron secret' }));
      return;
    }
    try {
      const raw = await readRequestBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const watchlist = payload.watchlist || (url.searchParams.get('symbols') ? url.searchParams.get('symbols').split(',') : undefined);
      const force = payload.force ?? (url.searchParams.get('force') === 'true');
      const result = await schedulerService.runAutonomousMarketScan(watchlist, force);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 7. Cloud Scheduler Cron: Auditoría de Portafolio y Alertas de Salida (POST /api/cron/portfolio)
  if (method === 'POST' && url.pathname === '/api/cron/portfolio') {
    if (!isCronAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing cron secret' }));
      return;
    }
    try {
      const result = await schedulerService.runPortfolioHealthCheck();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 8. Consulta de Estado de Capital y Cero Re-Fondeo (GET /api/capital/status)
  if (method === 'GET' && url.pathname === '/api/capital/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, capital: capitalManagerService.getCapitalStatus() }));
    return;
  }

  // 9. Consulta en Vivo de Rendimiento del Portafolio (GET /api/portfolio)
  if (method === 'GET' && url.pathname === '/api/portfolio') {
    try {
      const performance = await portfolioService.calculatePortfolioPerformance();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, performance, capital: capitalManagerService.getCapitalStatus() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 10. Registro Manual de Inversión (POST /api/portfolio/buy)
  if (method === 'POST' && url.pathname === '/api/portfolio/buy') {
    try {
      const raw = await readRequestBody(req);
      const payload = JSON.parse(raw || '{}');
      const position = await portfolioService.addPosition(payload);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, position }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 11. Bridge Local: Consultar Órdenes Pendientes (GET /api/bridge/pending)
  if (method === 'GET' && url.pathname === '/api/bridge/pending') {
    if (!isBridgeAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing bridge secret' }));
      return;
    }
    const orders = localBridgeService.getPendingOrders();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: orders.length, orders }));
    return;
  }

  // 12. Bridge Local: Reportar Ejecución Completada (POST /api/bridge/complete)
  if (method === 'POST' && url.pathname === '/api/bridge/complete') {
    if (!isBridgeAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing bridge secret' }));
      return;
    }
    try {
      const raw = await readRequestBody(req);
      const payload = JSON.parse(raw || '{}');
      const { bridgeOrderId, fillPrice, executedShares, status, notes } = payload;
      const result = await localBridgeService.completeOrder(bridgeOrderId, { fillPrice, executedShares, status, notes });
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 13. Resumen Unificado del Broker / Execution Bridge (GET /api/broker/summary)
  if (method === 'GET' && url.pathname === '/api/broker/summary') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, summary: executionBridge.getBrokerSummary() }));
    return;
  }

  // 14. Cierre de Posición en Portafolio (POST /api/portfolio/close/:id)
  if (method === 'POST' && url.pathname.startsWith('/api/portfolio/close/')) {
    const positionId = url.pathname.split('/')[4];
    try {
      const raw = await readRequestBody(req);
      const payload = JSON.parse(raw || '{}');
      const closePrice = payload.closePrice || parseFloat(url.searchParams.get('closePrice'));
      const closed = await portfolioService.closePosition(positionId, closePrice);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, closed }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 15. Generación y Archivador de Reportes Inmutables (POST /api/reports/generate)
  if (method === 'POST' && url.pathname === '/api/reports/generate') {
    if (!isCronAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing cron secret' }));
      return;
    }
    try {
      const raw = await readRequestBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const uploadGCS = payload.uploadGCS !== false;
      const notify = payload.notify === true;

      const result = await reportingService.generateAndArchiveReport({ uploadGCS });
      let telegramResult = null;

      if (notify) {
        telegramResult = await telegramService.sendPortfolioReport(undefined, result.report, result.jsonMeta);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...result, telegram: telegramResult }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 16. Consulta de Último Reporte Financiero (GET /api/reports/latest)
  if (method === 'GET' && url.pathname === '/api/reports/latest') {
    try {
      const report = await reportingService.generateReportJson();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, report }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Ruta 404 por defecto
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
});

const PORT = env.PORT || 8080;
const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT) || process.argv.some((a) => a.includes('--test'));

if (!isTestEnv) {
  server.listen(PORT, () => {
    console.info(`🚀 [CLOUD RUN] Servidor Invest AI activo en el puerto ${PORT}`);
    console.info(`👉 Healthcheck:        http://localhost:${PORT}/health`);
    console.info(`👉 Capital Pool ($35): http://localhost:${PORT}/api/capital/status`);
    console.info(`👉 Broker Co-Piloto:   Happi (Asistido / Zero-Trust)`);
  });
}

export { server };
