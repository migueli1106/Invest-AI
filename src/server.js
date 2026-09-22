import http from 'http';
import { env } from './config/environment.js';
import { webhookHandler } from './api/webhookHandler.js';
import { predictionEngine } from './services/predictionEngine.js';
import { twilioService } from './services/twilioService.js';
import { whatsappService } from './services/whatsappService.js';

/**
 * 🌐 [INVEST AI] Servidor HTTP Autónomo para Google Cloud Run
 * Soporta healthcheck para Cloud Run, webhooks de Twilio y Meta WhatsApp.
 */

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
    let bodyData = '';
    req.on('data', (chunk) => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(bodyData || '{}');
        const response = await webhookHandler.handleIncomingEvent(payload);
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response.result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload JSON inválido' }));
      }
    });
    return;
  }

  // 4. Webhook de Respuestas Entrantes de Twilio WhatsApp (POST /webhook/twilio)
  if (method === 'POST' && url.pathname === '/webhook/twilio') {
    let bodyData = '';
    req.on('data', (chunk) => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        const formParams = new URLSearchParams(bodyData);
        const response = await webhookHandler.handleTwilioIncoming(formParams);
        res.writeHead(response.status, { 'Content-Type': 'application/xml' });
        res.end(response.twiml);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/xml' });
        res.end('<Response></Response>');
      }
    });
    return;
  }

  // 5. Endpoint de Disparo Manual de Alerta por Twilio (POST /api/dispatch/twilio/:symbol)
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

  // 6. Endpoint de Disparo Manual de Alerta por Meta (POST /api/dispatch/:symbol)
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
    console.info(`👉 Healthcheck:      http://localhost:${PORT}/health`);
    console.info(`👉 Webhook Twilio:   http://localhost:${PORT}/webhook/twilio`);
    console.info(`👉 Webhook Meta:     http://localhost:${PORT}/webhook`);
  });
}

export { server };
