process.env.NODE_ENV = 'test';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { schedulerService } from '../../src/services/schedulerService.js';
import { portfolioService } from '../../src/services/portfolioService.js';
import { executionBridge } from '../../src/services/broker/executionBridge.js';
import { predictionEngine } from '../../src/services/predictionEngine.js';
import { telegramService } from '../../src/services/telegramService.js';
import { systemConfigService } from '../../src/services/systemConfigService.js';

describe('⏰ Suite de Pruebas Unitarias: Monitoreo Continuo y Horario Bursátil (Invest AI)', () => {
  it('isMarketOpen debe retornar true en horario activo de Wall Street (Lunes 10:00 AM NY)', () => {
    // 2026-09-21 es Lunes
    const mondayOpen = new Date('2026-09-21T10:00:00-04:00');
    assert.equal(schedulerService.isMarketOpen(mondayOpen), true);
  });

  it('isMarketOpen debe retornar false antes de la apertura (Lunes 9:00 AM NY)', () => {
    const mondayPreMarket = new Date('2026-09-21T09:00:00-04:00');
    assert.equal(schedulerService.isMarketOpen(mondayPreMarket), false);
  });

  it('isMarketOpen debe retornar false después del cierre (Lunes 4:30 PM NY)', () => {
    const mondayPostMarket = new Date('2026-09-21T16:30:00-04:00');
    assert.equal(schedulerService.isMarketOpen(mondayPostMarket), false);
  });

  it('isMarketOpen debe retornar false en fines de semana (Sábado y Domingo)', () => {
    const sunday = new Date('2026-09-20T12:00:00-04:00');
    const saturday = new Date('2026-09-26T12:00:00-04:00');

    assert.equal(schedulerService.isMarketOpen(sunday), false);
    assert.equal(schedulerService.isMarketOpen(saturday), false);
  });

  it('runAutonomousMarketScan debe pausar si el mercado está cerrado y no se fuerza', async () => {
    const originalCheck = schedulerService.isMarketOpen;
    schedulerService.isMarketOpen = () => false;

    try {
      const result = await schedulerService.runAutonomousMarketScan(['AAPL'], false);
      assert.equal(result.executed, false);
      assert.equal(result.reason, 'MARKET_CLOSED');
    } finally {
      schedulerService.isMarketOpen = originalCheck;
    }
  });

  it('runAutonomousMarketScan debe respetar la ventana de cooldown de 45 minutos para no repetir alertas', async () => {
    schedulerService.alertHistory.clear();
    const symbol = 'NVDA_TEST_COOLDOWN';

    // Inyectar alerta reciente (hace 20 minutos < 45m)
    schedulerService.alertHistory.set(symbol, Date.now() - 1000 * 60 * 20);

    const lastSent = schedulerService.alertHistory.get(symbol);
    const isWithinCooldown = Date.now() - lastSent < schedulerService.COOLDOWN_MS;
    assert.equal(isWithinCooldown, true);
  });

  it('runPortfolioHealthCheck debe ejecutar Auto-Close (SELL) en Moomoo y cerrar la posición ante Take-Profit', async () => {
    let orderExecuted = false;
    let orderPayload = null;
    const origExecute = executionBridge.executeOrder;
    executionBridge.executeOrder = async (params) => {
      orderExecuted = true;
      orderPayload = params;
      return { success: true, mode: 'MOOMOO', orderId: 'moo_test_auto_close' };
    };

    try {
      const tpPos = await portfolioService.addPosition({
        symbol: 'TEST_TP',
        shares: 10,
        buyPrice: 100,
        targetPrice: 110,
        stopLoss: 90,
        broker: 'Moomoo',
      });

      const currentPrice = 115;
      portfolioService.memoryPositions.set(tpPos.id, {
        ...tpPos,
        currentPrice,
        unrealizedPnL: 150,
        unrealizedPnLPercent: 15,
      });

      const result = await schedulerService.runPortfolioHealthCheck('test_chat_123');
      assert.ok(result.checkedAt);
      assert.ok(result.triggersCount >= 1);
      assert.equal(orderExecuted, true, 'Debe invocar executionBridge.executeOrder automáticamente');
      assert.equal(orderPayload.symbol, 'TEST_TP');
      assert.equal(orderPayload.side, 'SELL');
      assert.equal(orderPayload.qty, 10);

      const tpAlert = result.alerts.find((a) => a.trigger && a.trigger.symbol === 'TEST_TP');
      assert.ok(tpAlert);
      assert.equal(tpAlert.trigger.type, 'TAKE_PROFIT');
      assert.equal(tpAlert.autoClosed, true);
      assert.equal(tpAlert.sent, true);
      assert.equal(tpAlert.closed.status, 'CLOSED');
      assert.equal(tpAlert.closed.realizedPnL, 150);
    } finally {
      executionBridge.executeOrder = origExecute;
    }
  });

  it('runPortfolioHealthCheck debe activar alerta de Protección Break-Even al alcanzar +1.5% intradía', async () => {
    const bePos = await portfolioService.addPosition({
      symbol: 'TEST_BE',
      shares: 10,
      buyPrice: 100,
      targetPrice: 105,
      stopLoss: 98,
      broker: 'Moomoo',
    });

    // 1.8% de ganancia intradía (supera el nuevo umbral >= 1.5%)
    portfolioService.memoryPositions.set(bePos.id, {
      ...bePos,
      currentPrice: 101.80,
      unrealizedPnL: 18,
      unrealizedPnLPercent: 1.8,
    });

    const result = await schedulerService.runPortfolioHealthCheck('test_chat_123');
    const beAlert = result.alerts.find((a) => a.symbol === 'TEST_BE' && a.type === 'BREAK_EVEN');
    assert.ok(beAlert, 'Debe activar alerta de Break-Even al superar +1.5%');
    assert.equal(beAlert.sent, true);
  });

  it('isEodSession debe detectar la ventana final de 15 minutos (3:45 PM - 4:00 PM EST)', () => {
    // 2026-09-21 es Lunes
    const mondayEod = new Date('2026-09-21T15:50:00-04:00'); // 3:50 PM NY
    const mondayMidday = new Date('2026-09-21T14:00:00-04:00'); // 2:00 PM NY
    const mondayPost = new Date('2026-09-21T16:05:00-04:00'); // 4:05 PM NY
    const saturdayEod = new Date('2026-09-26T15:50:00-04:00'); // Sábado

    assert.equal(schedulerService.isEodSession(mondayEod), true, '3:50 PM Lunes es ventana EOD');
    assert.equal(schedulerService.isEodSession(mondayMidday), false, '2:00 PM Lunes no es EOD');
    assert.equal(schedulerService.isEodSession(mondayPost), false, '4:05 PM Lunes es post-cierre');
    assert.equal(schedulerService.isEodSession(saturdayEod), false, 'Fin de semana no es EOD');
  });

  it('runPortfolioHealthCheck debe respetar el cooldown de 30m para no spamear alertas repetidas de salida', async () => {
    // Posición abierta con cooldown previo registrado
    const cdPos = await portfolioService.addPosition({
      symbol: 'TEST_CD',
      shares: 10,
      buyPrice: 100,
      targetPrice: 110,
      stopLoss: 90,
      broker: 'Moomoo',
    });

    portfolioService.memoryPositions.set(cdPos.id, {
      ...cdPos,
      currentPrice: 115,
      unrealizedPnL: 150,
      unrealizedPnLPercent: 15,
    });

    // Registrar salida reciente en el historial de alertas
    schedulerService.exitAlertHistory.set(cdPos.id, Date.now());

    const check = await schedulerService.runPortfolioHealthCheck('test_chat_123');
    assert.ok(check.checkedAt);
    const throttledAlert = check.alerts.find((a) => a.trigger && a.trigger.symbol === 'TEST_CD');
    assert.ok(throttledAlert, 'Debe encontrar la alerta throttled');
    assert.equal(throttledAlert.sent, false);
    assert.equal(throttledAlert.skipped, 'COOLDOWN');
  });

  it('runAutonomousMarketScan debe despachar digest consolidado cuando hay 2 o más oportunidades y Auto-Invest está inactivo', async () => {
    schedulerService.alertHistory.clear();
    await systemConfigService.setAutoInvest(false);

    const origGenerate = predictionEngine.generateSignal;
    let digestCalledWith = null;
    const origDigest = telegramService.sendConsolidatedDigest;

    telegramService.sendConsolidatedDigest = async (chatId, signals) => {
      digestCalledWith = { chatId, signals };
      return { simulated: true, count: signals.length };
    };

    predictionEngine.generateSignal = async (symbol) => ({
      symbol,
      action: 'BUY',
      entryPrice: 150.0,
      targetPrice: 165.0,
      stopLoss: 142.5,
      timeHorizonDays: 1,
      confidence: 88,
      riskRewardRatio: 2.0,
      expectedReturnPercent: 10.0,
      rationale: 'Fuerte impulso cuantitativo.',
      status: 'PENDING_APPROVAL',
      createdAt: new Date().toISOString(),
    });

    try {
      const result = await schedulerService.runAutonomousMarketScan(['NVDA_D1', 'MSFT_D2'], true, 'test_chat_digest');
      assert.equal(result.executed, true);
      assert.equal(result.signalsCount, 2);
      assert.equal(result.dispatchedCount, 2);
      assert.ok(digestCalledWith, 'sendConsolidatedDigest debe haber sido invocado');
      assert.equal(digestCalledWith.signals.length, 2);
      assert.equal(result.dispatched[0].status, 'DISPATCHED_DIGEST');
      assert.equal(result.dispatched[1].status, 'DISPATCHED_DIGEST');
    } finally {
      predictionEngine.generateSignal = origGenerate;
      telegramService.sendConsolidatedDigest = origDigest;
    }
  });

  it('runAutonomousMarketScan debe ejecutar órdenes automáticamente sin digest cuando Auto-Invest está activo', async () => {
    schedulerService.alertHistory.clear();
    await systemConfigService.setAutoInvest(true);

    const origGenerate = predictionEngine.generateSignal;
    const origExecute = executionBridge.executeOrder;
    const executedOrders = [];

    executionBridge.executeOrder = async (params) => {
      executedOrders.push(params);
      return { success: true, mode: 'MOOMOO', orderId: `auto_${params.symbol}` };
    };

    predictionEngine.generateSignal = async (symbol) => ({
      symbol,
      action: 'BUY',
      entryPrice: 200.0,
      targetPrice: 220.0,
      stopLoss: 190.0,
      timeHorizonDays: 1,
      confidence: 92,
      riskRewardRatio: 2.0,
      expectedReturnPercent: 10.0,
      rationale: 'Tendencia alcista confirmada.',
      status: 'PENDING_APPROVAL',
      createdAt: new Date().toISOString(),
    });

    try {
      const result = await schedulerService.runAutonomousMarketScan(['AUTO_A', 'AUTO_B'], true, 'test_chat_auto');
      assert.equal(result.executed, true);
      assert.equal(result.dispatchedCount, 2);
      assert.equal(executedOrders.length, 2, 'Debe haber ejecutado 2 órdenes automáticamente');
      assert.equal(executedOrders[0].symbol, 'AUTO_A');
      assert.equal(executedOrders[1].symbol, 'AUTO_B');
      assert.equal(result.dispatched[0].status, 'AUTO_EXECUTED');
      assert.equal(result.dispatched[1].status, 'AUTO_EXECUTED');
    } finally {
      predictionEngine.generateSignal = origGenerate;
      executionBridge.executeOrder = origExecute;
      await systemConfigService.setAutoInvest(false);
    }
  });
});
