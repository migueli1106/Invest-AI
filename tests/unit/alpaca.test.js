process.env.NODE_ENV = 'test';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { alpacaService } from '../../src/services/alpacaService.js';
import { capitalManagerService } from '../../src/services/capitalManagerService.js';
import { webhookHandler } from '../../src/api/webhookHandler.js';

describe('🦙 Suite de Pruebas Unitarias: Alpaca Trading API & Telegram Integration', () => {
  beforeEach(() => {
    capitalManagerService.reset(35.00);
  });

  it('alpacaService debe operar en modo simulación seguro cuando no hay credenciales o en test', async () => {
    assert.equal(alpacaService.isSimulation(), true);

    const account = await alpacaService.getAccount();
    assert.ok(account.simulated);
    assert.equal(account.status, 'ACTIVE');
    assert.equal(account.currency, 'USD');
    assert.equal(account.cash, '35.00');

    const positions = await alpacaService.getPositions();
    assert.ok(Array.isArray(positions));
  });

  it('alpacaService.getHeaders debe construir las cabeceras requeridas por Alpaca', () => {
    const headers = alpacaService.getHeaders();
    assert.ok('APCA-API-KEY-ID' in headers);
    assert.ok('APCA-API-SECRET-KEY' in headers);
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('submitBracketOrder debe estructurar correctamente la orden Bracket con cantidad fraccionada', async () => {
    const order = await alpacaService.submitBracketOrder({
      symbol: 'NVDA',
      qty: 0.2917,
      notional: 35.00,
      side: 'buy',
      takeProfitPrice: 135.50,
      stopLossPrice: 114.00,
    });

    assert.ok(order.simulated);
    assert.ok(order.id.startsWith('sim_ord_'));
    assert.equal(order.symbol, 'NVDA');
    assert.equal(order.qty, '0.2917');
    assert.equal(order.order_class, 'bracket');
    assert.equal(order.type, 'market');
    assert.equal(order.take_profit.limit_price, 135.50);
    assert.equal(order.stop_loss.stop_price, 114.00);
  });

  it('webhookHandler debe ejecutar orden fraccionada en Alpaca al aprobar señal con capital disponible', async () => {
    const update = {
      update_id: 20001,
      callback_query: {
        id: 'cq_alpaca_approve_1',
        from: { id: 987654321, first_name: 'Miguel' },
        message: { chat: { id: 123456789 } },
        data: 'approve_NVDA_1730000000',
      },
    };

    const response = await webhookHandler.handleTelegramUpdate(update, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'APPROVED');
    assert.equal(response.result.symbol, 'NVDA');
    assert.ok(response.result.orderId);
    assert.equal(response.result.executed, true);

    // El capital debe haberse reservado ($35)
    assert.equal(capitalManagerService.availableCash, 0.00);
    assert.equal(capitalManagerService.deployedCapital, 35.00);
  });

  it('webhookHandler debe bloquear compras adicionales bajo la regla de CERO RE-FONDEO si el capital está agotado', async () => {
    // 1. Agotar capital
    capitalManagerService.reserveCapital('existing_pos', 35.00);

    const update = {
      update_id: 20002,
      callback_query: {
        id: 'cq_alpaca_approve_blocked',
        from: { id: 987654321, first_name: 'Miguel' },
        message: { chat: { id: 123456789 } },
        data: 'approve_MSFT_1730000000',
      },
    };

    const response = await webhookHandler.handleTelegramUpdate(update, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'BLOCKED_ZERO_REFUND');
    assert.equal(response.result.symbol, 'MSFT');
    assert.equal(response.result.reason, 'INSUFFICIENT_POOL_WAIT_ROTATION');
  });

  it('cancelAllOrders y closePosition deben operar limpiamente en modo seguro', async () => {
    const cancelRes = await alpacaService.cancelAllOrders();
    assert.ok(cancelRes[0].simulated);

    const closeRes = await alpacaService.closePosition('NVDA');
    assert.ok(closeRes.simulated);
    assert.equal(closeRes.symbol, 'NVDA');
    assert.equal(closeRes.status, 'closed');
  });
});
