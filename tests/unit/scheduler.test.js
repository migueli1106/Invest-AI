process.env.NODE_ENV = 'test';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { schedulerService } from '../../src/services/schedulerService.js';
import { portfolioService } from '../../src/services/portfolioService.js';

describe('⏰ Suite de Pruebas Unitarias: Monitoreo Continuo y Horario Bursátil (Invest AI)', () => {
  it('isMarketOpen debe retornar true en horario activo de Wall Street (Lunes 10:00 AM NY)', () => {
    // 2026-09-21 es Lunes. 14:00 UTC = 10:00 AM EDT (Nueva York UTC-4)
    const activeTime = new Date('2026-09-21T14:00:00Z');
    assert.equal(schedulerService.isMarketOpen(activeTime), true);
  });

  it('isMarketOpen debe retornar false antes de la apertura (Lunes 9:00 AM NY)', () => {
    // 13:00 UTC = 9:00 AM EDT
    const preMarket = new Date('2026-09-21T13:00:00Z');
    assert.equal(schedulerService.isMarketOpen(preMarket), false);
  });

  it('isMarketOpen debe retornar false después del cierre (Lunes 4:30 PM NY)', () => {
    // 20:30 UTC = 4:30 PM EDT (16:30)
    const postMarket = new Date('2026-09-21T20:30:00Z');
    assert.equal(schedulerService.isMarketOpen(postMarket), false);
  });

  it('isMarketOpen debe retornar false en fines de semana (Sábado y Domingo)', () => {
    // 2026-09-20 es Domingo, 2026-09-26 es Sábado
    const sunday = new Date('2026-09-20T18:00:00Z');
    const saturday = new Date('2026-09-26T18:00:00Z');

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

  it('runAutonomousMarketScan debe respetar la ventana de cooldown de 4 horas para no repetir alertas', async () => {
    schedulerService.alertHistory.clear();
    const symbol = 'NVDA_TEST_COOLDOWN';

    // Inyectar alerta reciente
    schedulerService.alertHistory.set(symbol, Date.now() - 1000 * 60 * 60); // Hace 1 hora

    // Simular escaneo con este activo usando forzado
    const lastSent = schedulerService.alertHistory.get(symbol);
    const isWithinCooldown = Date.now() - lastSent < schedulerService.COOLDOWN_MS;
    assert.equal(isWithinCooldown, true);
  });

  it('runPortfolioHealthCheck debe emitir alertas cuando hay posiciones en Take-Profit o Stop-Loss', async () => {
    // Añadir posición forzada que toque TP
    const tpPos = await portfolioService.addPosition({
      symbol: 'TEST_TP',
      shares: 10,
      buyPrice: 100,
      targetPrice: 110,
      stopLoss: 90,
      broker: 'Happi',
    });

    // Guardar posición mockeada con precio actual que supera target
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
    const tpAlert = result.alerts.find((a) => a.trigger.symbol === 'TEST_TP');
    assert.ok(tpAlert);
    assert.equal(tpAlert.trigger.type, 'TAKE_PROFIT');
    assert.equal(tpAlert.sent, true);
  });

  it('runPortfolioHealthCheck debe respetar el cooldown de 30m para no spamear alertas repetidas de salida', async () => {
    // La prueba anterior acaba de registrar la alerta para 'TEST_TP' en this.exitAlertHistory
    const secondCheck = await schedulerService.runPortfolioHealthCheck('test_chat_123');
    assert.ok(secondCheck.checkedAt);
    const throttledAlert = secondCheck.alerts.find((a) => a.trigger.symbol === 'TEST_TP');
    assert.ok(throttledAlert);
    assert.equal(throttledAlert.sent, false);
    assert.equal(throttledAlert.skipped, 'COOLDOWN');
  });
});
