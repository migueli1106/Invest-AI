import http from 'http';
import { env } from './config/environment.js';
import { webhookHandler } from './api/webhookHandler.js';
import { predictionEngine } from './services/predictionEngine.js';
import { twilioService } from './services/twilioService.js';
import { whatsappService } from './services/whatsappService.js';
import { telegramService } from './services/telegramService.js';
import { portfolioService } from './services/portfolioService.js';
import { schedulerService } from './services/schedulerService.js';

/**
 * 🌐 [INVEST AI] Servidor HTTP Autónomo para Google Cloud Run
 * Soporta healthcheck, webhooks, endpoints REST de portafolio y triggers cron.
 */

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', (err) => reject(err));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method;

  // 1. Healthcheck probe para Google Cloud Run
  if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'HEALTHY',
      service: 'invest-ai-engine',
      project: env.GCP_PROJECT_ID,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // 2. Webhook Handshake de Meta (GET /webhook)
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

  // 8. Consulta en Vivo de Rendimiento del Portafolio (GET /api/portfolio)
  if (method === 'GET' && url.pathname === '/api/portfolio') {
    try {
      const performance = await portfolioService.calculatePortfolioPerformance();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, performance }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 9. Registro de Nueva Inversión en Portafolio (POST /api/portfolio/buy)
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

  // 10. Cierre de Posición en Portafolio (POST /api/portfolio/close/:id)
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

  // 11. Disparo Manual Telegram (POST /api/dispatch/telegram/:symbol)
  if (method === 'POST' && url.pathname.startsWith('/api/dispatch/telegram/')) {
    const symbol = url.pathname.split('/')[4];
    const targetChatId = url.searchParams.get('chatId') || env.TELEGRAM_CHAT_ID || 'SIMULATED';
    try {
      const signal = await predictionEngine.generateSignal(symbol);
      const telegramResult = await telegramService.sendSignalAlert(targetChatId, signal);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, channel: 'telegram', signal, telegramResult }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 12. Disparo Manual Twilio (POST /api/dispatch/twilio/:symbol)
  if (method === 'POST' && url.pathname.startsWith('/api/dispatch/twilio/')) {
    const symbol = url.pathname.split('/')[4];
    const targetPhone = url.searchParams.get('to') || env.ADMIN_WHATSAPP_NUMBER || 'SIMULATED';
    try {
      const signal = await predictionEngine.generateSignal(symbol);
      const twilioResult = await twilioService.sendSignalAlert(targetPhone, signal);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, channel: 'twilio', signal, twilioResult }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 13. Disparo Manual Meta (POST /api/dispatch/:symbol)
  if (method === 'POST' && url.pathname.startsWith('/api/dispatch/')) {
    const symbol = url.pathname.split('/')[3];
    const targetPhone = url.searchParams.get('to') || env.ADMIN_WHATSAPP_NUMBER || 'SIMULATED';
    try {
      const signal = await predictionEngine.generateSignal(symbol);
      const waResult = await whatsappService.sendSignalInteractiveCard(targetPhone, signal);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, channel: 'meta', signal, waResult }));
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

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.info(`🚀 [CLOUD RUN] Servidor Invest AI activo en el puerto ${PORT}`);
    console.info(`👉 Healthcheck:        http://localhost:${PORT}/health`);
    console.info(`👉 Portfolio Metrics:  http://localhost:${PORT}/api/portfolio`);
    console.info(`👉 Webhook Telegram:   http://localhost:${PORT}/webhook/telegram`);
    console.info(`👉 Webhook Twilio:     http://localhost:${PORT}/webhook/twilio`);
    console.info(`👉 Webhook Meta:       http://localhost:${PORT}/webhook`);
  });
}

export { server };
