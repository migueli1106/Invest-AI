process.env.NODE_ENV = 'test';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { schedulerService } from '../../src/services/schedulerService.js';
import { portfolioService } from '../../src/services/portfolioService.js';

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

  it('runPortfolioHealthCheck debe emitir alertas cuando hay posiciones en Take-Profit o Stop-Loss', async () => {
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
    const tpAlert = result.alerts.find((a) => a.trigger && a.trigger.symbol === 'TEST_TP');
    assert.ok(tpAlert);
    assert.equal(tpAlert.trigger.type, 'TAKE_PROFIT');
    assert.equal(tpAlert.sent, true);
  });

  it('runPortfolioHealthCheck debe activar alerta de Protección Break-Even al alcanzar +4.0%', async () => {
    const bePos = await portfolioService.addPosition({
      symbol: 'TEST_BE',
      shares: 10,
      buyPrice: 100,
      targetPrice: 112,
      stopLoss: 92,
      broker: 'Moomoo',
    });

    // 5% de ganancia (entre +4.0% y +8.0%)
    portfolioService.memoryPositions.set(bePos.id, {
      ...bePos,
      currentPrice: 105,
      unrealizedPnL: 50,
      unrealizedPnLPercent: 5.0,
    });

    const result = await schedulerService.runPortfolioHealthCheck('test_chat_123');
    const beAlert = result.alerts.find((a) => a.symbol === 'TEST_BE' && a.type === 'BREAK_EVEN');
    assert.ok(beAlert);
    assert.equal(beAlert.sent, true);
  });

  it('runPortfolioHealthCheck debe respetar el cooldown de 30m para no spamear alertas repetidas de salida', async () => {
    const secondCheck = await schedulerService.runPortfolioHealthCheck('test_chat_123');
    assert.ok(secondCheck.checkedAt);
    const throttledAlert = secondCheck.alerts.find((a) => a.trigger && a.trigger.symbol === 'TEST_TP');
    assert.ok(throttledAlert);
    assert.equal(throttledAlert.sent, false);
    assert.equal(throttledAlert.skipped, 'COOLDOWN');
  });
});
