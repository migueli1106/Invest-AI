import http from 'http';
import { env } from './config/environment.js';
import { webhookHandler } from './api/webhookHandler.js';
import { predictionEngine } from './services/predictionEngine.js';
import { whatsappService } from './services/whatsappService.js';

/**
 * 🌐 [INVEST AI] Servidor HTTP Autónomo para Google Cloud Run
 * Soporta healthcheck para Cloud Run y webhooks de Meta WhatsApp.
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

  // 4. Endpoint de Disparo Manual de Señal a WhatsApp (POST /api/dispatch/:symbol)
  if (method === 'POST' && url.pathname.startsWith('/api/dispatch/')) {
    const symbol = url.pathname.split('/')[3];
    const targetPhone = url.searchParams.get('to') || env.ADMIN_WHATSAPP_NUMBER || 'SIMULATED';

    try {
      const signal = await predictionEngine.generateSignal(symbol);
      const waResult = await whatsappService.sendSignalInteractiveCard(targetPhone, signal);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, signal, waResult }));
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
    console.info(`👉 Healthcheck: http://localhost:${PORT}/health`);
    console.info(`👉 Webhook Meta: http://localhost:${PORT}/webhook`);
  });
}

export { server };
