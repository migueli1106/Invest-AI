process.env.NODE_ENV = 'test';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../../src/server.js';
import { env } from '../../src/config/environment.js';
import { executionBridge } from '../../src/services/broker/executionBridge.js';
import { localBridgeService } from '../../src/services/broker/localBridgeService.js';
import { capitalManagerService } from '../../src/services/capitalManagerService.js';
import { webhookHandler } from '../../src/api/webhookHandler.js';

describe('🌉 Suite de Pruebas Unitarias: Execution Bridge & Broker Desacoplado', () => {
  let baseUrl;
  let origInfo;
  let origWarn;

  before(async () => {
    origInfo = console.info;
    origWarn = console.warn;
    console.info = () => {};
    console.warn = () => {};

    if (!server.listening) {
      await new Promise((resolve) => {
        server.listen(0, () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    } else {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
    }
  });

  after(async () => {
    console.info = origInfo;
    console.warn = origWarn;
    executionBridge.setExecutionMode('MOOMOO');
    localBridgeService.clear();
    capitalManagerService.reset(35.00);
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    capitalManagerService.reset(35.00);
    localBridgeService.clear();
    executionBridge.setExecutionMode('MOOMOO');
  });

  // 1. Verificación del Orquestador y Patrón Strategy
  it('Debe inicializar por defecto en modo MOOMOO con Moomoo como broker', () => {
    assert.equal(executionBridge.getExecutionMode(), 'MOOMOO');
    const summary = executionBridge.getBrokerSummary();
    assert.equal(summary.broker, 'Moomoo');
    assert.equal(summary.executionMode, 'MOOMOO');
    assert.equal(summary.capital.totalCapital, 35.00);
  });

  // 2. Ejecución Nativa Directa con Moomoo OpenD
  it('Modo MOOMOO: debe despachar orden oficial a OpenD y confirmar ejecución', async () => {
    const res = await executionBridge.executeOrder({
      symbol: 'MSFT',
      currentPrice: 400.00,
      side: 'BUY',
    });

    assert.equal(res.success, true);
    assert.equal(res.mode, 'MOOMOO');
    assert.equal(res.broker, 'Moomoo');
    assert.equal(res.symbol, 'MSFT');
    assert.ok(res.orderId);
  });

  // 3. Capital Dinámico Multi-Posición: Ejecución fluida sin bloqueos
  it('Debe permitir ejecutar órdenes consecutivas para múltiples activos sin bloquear por pool agotado', async () => {
    capitalManagerService.reserveCapital('ord_prev', 35.00);

    const res = await executionBridge.executeOrder({
      symbol: 'NVDA',
      currentPrice: 120.00,
      side: 'BUY',
    });

    assert.equal(res.success, true);
    assert.equal(res.symbol, 'NVDA');
    assert.equal(res.mode, 'MOOMOO');
    assert.equal(capitalManagerService.getCapitalStatus().policy, 'FLEXIBLE_CAPITAL');
    assert.equal(executionBridge.getBrokerSummary().capital.policy, 'FLEXIBLE_CAPITAL');
  });

  // 4. Modo LOCAL_AGENT: Adaptador de Bridge Residencial (Queue & TTL)
  it('Modo LOCAL_AGENT: debe encolar la orden, reservar capital y asignar TTL de 5 minutos', async () => {
    executionBridge.setExecutionMode('LOCAL_AGENT');
    assert.equal(executionBridge.getExecutionMode(), 'LOCAL_AGENT');

    const res = await executionBridge.executeOrder({
      symbol: 'AAPL',
      currentPrice: 220.00,
      notional: 35.00,
      side: 'BUY',
    });

    assert.equal(res.success, true);
    assert.equal(res.mode, 'LOCAL_AGENT');
    assert.equal(res.status, 'QUEUED');
    assert.match(res.bridgeOrderId, /^bridge_aapl_/);

    const pending = localBridgeService.getPendingOrders();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].symbol, 'AAPL');
    assert.equal(pending[0].notional, 35.00);
    assert.equal(pending[0].broker, 'Moomoo');

    const cap = capitalManagerService.getCapitalStatus();
    assert.equal(cap.availableCash, 0.00);
  });

  it('Modo LOCAL_AGENT: completeOrder (FILLED) debe cerrar la orden y registrar posición', async () => {
    const queueRes = localBridgeService.queueOrder({
      symbol: 'GOOGL',
      qty: 0.2,
      notional: 35.00,
      currentPrice: 175.00,
      stopLoss: 165.00,
      targetPrice: 195.00,
    });

    const compRes = await localBridgeService.completeOrder(queueRes.bridgeOrderId, {
      fillPrice: 175.50,
      executedShares: 0.199,
      status: 'FILLED',
    });

    assert.equal(compRes.success, true);
    assert.equal(compRes.status, 'COMPLETED');
    assert.equal(compRes.execution.fillPrice, 175.50);

    const pending = localBridgeService.getPendingOrders();
    assert.equal(pending.length, 0);
  });

  it('Modo LOCAL_AGENT: completeOrder (CANCELLED) debe liberar el capital al pool disponible', async () => {
    const queueRes = localBridgeService.queueOrder({
      symbol: 'TSLA',
      qty: 0.15,
      notional: 35.00,
      currentPrice: 230.00,
    });

    assert.equal(capitalManagerService.getCapitalStatus().availableCash, 0.00);

    const cancelRes = await localBridgeService.completeOrder(queueRes.bridgeOrderId, {
      status: 'CANCELLED',
      notes: 'Cancelado en Moomoo',
    });

    assert.equal(cancelRes.success, true);
    assert.equal(cancelRes.status, 'CANCELLED');
    assert.equal(cancelRes.capitalReleased, 35.00);
    assert.equal(capitalManagerService.getCapitalStatus().availableCash, 35.00);
  });

  it('Modo LOCAL_AGENT: orden que supera TTL de 5 minutos debe expirar y liberar fondos', async () => {
    const queueRes = localBridgeService.queueOrder({
      symbol: 'AMZN',
      qty: 0.18,
      notional: 35.00,
      currentPrice: 190.00,
    });

    const order = localBridgeService.getOrder(queueRes.bridgeOrderId);
    order.expiresAtMs = Date.now() - 1000;

    const pending = localBridgeService.getPendingOrders();
    assert.equal(pending.length, 0);
    assert.equal(order.status, 'EXPIRED');
    assert.equal(capitalManagerService.getCapitalStatus().availableCash, 35.00);
  });

  // 5. Endpoints REST Seguros del Bridge
  it('GET /api/bridge/pending debe rechazar con 401 si no hay X-Bridge-Secret', async () => {
    const res = await fetch(`${baseUrl}/api/bridge/pending`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/);
  });

  it('GET /api/bridge/pending debe responder 200 con órdenes si X-Bridge-Secret es válido', async () => {
    localBridgeService.queueOrder({ symbol: 'META', qty: 0.05, notional: 35.00, currentPrice: 700 });
    const res = await fetch(`${baseUrl}/api/bridge/pending`, {
      headers: { 'X-Bridge-Secret': env.BRIDGE_SECRET },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.count, 1);
    assert.equal(data.orders[0].symbol, 'META');
  });

  it('POST /api/bridge/complete debe rechazar con 401 si no hay X-Bridge-Secret', async () => {
    const res = await fetch(`${baseUrl}/api/bridge/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bridgeOrderId: 'test' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/);
  });

  it('POST /api/bridge/complete debe aceptar con 200 y completar orden si X-Bridge-Secret es válido', async () => {
    const q = localBridgeService.queueOrder({ symbol: 'SPY', qty: 0.06, notional: 35.00, currentPrice: 580 });
    const res = await fetch(`${baseUrl}/api/bridge/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Secret': env.BRIDGE_SECRET,
      },
      body: JSON.stringify({
        bridgeOrderId: q.bridgeOrderId,
        fillPrice: 581.20,
        executedShares: 0.06,
        status: 'FILLED',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.status, 'COMPLETED');
  });

  it('POST /api/bridge/sync-balance debe calibrar el saldo de Cloud Run con Moomoo', async () => {
    const res = await fetch(`${baseUrl}/api/bridge/sync-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Secret': env.BRIDGE_SECRET,
      },
      body: JSON.stringify({
        cash: 850.00,
        totalAssets: 2100.00,
        buyingPower: 1700.00,
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.capital.availableCash, 850.00);
    assert.equal(data.capital.totalCapital, 2100.00);
    assert.equal(data.capital.broker, 'Moomoo');
  });

  it('GET /api/broker/summary debe retornar estado unificado del broker y capital', async () => {
    const res = await fetch(`${baseUrl}/api/broker/summary`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.summary.broker, 'Moomoo');
  });

  // 6. Integración con Webhook de Telegram
  it('Webhook Telegram: callback approve_NVDA debe invocar executionBridge con éxito', async () => {
    const update = {
      callback_query: {
        id: 'cq_test_phase16',
        from: { id: 123456, first_name: 'Miguel' },
        data: 'approve_NVDA',
        message: { chat: { id: 123456 } },
      },
    };

    const result = await webhookHandler.handleTelegramUpdate(update, { updateDb: false });
    assert.equal(result.status, 200);
    assert.equal(result.result.action, 'APPROVED');
    assert.equal(result.result.symbol, 'NVDA');
    assert.equal(result.result.executed, true);
  });
});
