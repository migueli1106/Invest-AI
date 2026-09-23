process.env.NODE_ENV = 'test';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { portfolioService } from '../../src/services/portfolioService.js';
import { PortfolioHoldingSchema } from '../../src/models/schemas.js';

describe('💼 Suite de Pruebas Unitarias: Gestión de Portafolio y Métricas P&L', () => {
  it('Debe calcular matemáticamente el P&L no realizado y el P&L porcentual con exactitud', async () => {
    // 10 acciones compradas a $100, cotizando actualmente a $125
    const mockPositions = [
      {
        id: 'pos_test_1',
        symbol: 'NVDA',
        shares: 10,
        averageBuyPrice: 100,
        totalCost: 1000,
        currentPrice: 125,
        broker: 'Happi',
        status: 'OPEN',
        stopLoss: 95,
        targetPrice: 120,
        openedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    ];

    const { positions, summary } = await portfolioService.calculatePortfolioPerformance(mockPositions);

    assert.equal(positions.length, 1);
    const pos = positions[0];
    assert.equal(pos.symbol, 'NVDA');
    assert.equal(pos.costBasis, 1000.00);
    assert.equal(pos.currentMarketValue, 1250.00);
    assert.equal(pos.unrealizedPnL, 250.00);
    assert.equal(pos.unrealizedPnLPercent, 25.00);

    assert.equal(summary.totalCostBasis, 1000.00);
    assert.equal(summary.totalMarketValue, 1250.00);
    assert.equal(summary.totalUnrealizedPnL, 250.00);
    assert.equal(summary.totalUnrealizedPnLPercent, 25.00);
    assert.equal(summary.count, 1);
  });

  it('checkExitTriggers debe detectar TAKE_PROFIT cuando el precio supera el target', async () => {
    const mockPositions = [
      {
        id: 'pos_tp_1',
        symbol: 'AAPL',
        shares: 5,
        averageBuyPrice: 150,
        totalCost: 750,
        currentPrice: 165, // Supera targetPrice de 160
        broker: 'Happi',
        status: 'OPEN',
        stopLoss: 140,
        targetPrice: 160,
        openedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    ];

    const alerts = await portfolioService.checkExitTriggers(mockPositions);
    assert.equal(alerts.length, 1, 'Debe activar exactamente 1 disparador TAKE_PROFIT');

    const alert = alerts[0];
    assert.equal(alert.trigger, 'TAKE_PROFIT');
    assert.equal(alert.symbol, 'AAPL');
    assert.equal(alert.currentPrice, 165);
    assert.equal(alert.thresholdPrice, 160);
    assert.ok(alert.message.includes('TAKE-PROFIT'));
  });

  it('checkExitTriggers debe detectar STOP_LOSS cuando el precio perfora el stop loss', async () => {
    const mockPositions = [
      {
        id: 'pos_sl_1',
        symbol: 'TSLA',
        shares: 10,
        averageBuyPrice: 200,
        totalCost: 2000,
        currentPrice: 185, // Perfora stopLoss de 190
        broker: 'Osmo',
        status: 'OPEN',
        stopLoss: 190,
        targetPrice: 230,
        openedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    ];

    const alerts = await portfolioService.checkExitTriggers(mockPositions);
    assert.equal(alerts.length, 1, 'Debe activar exactamente 1 disparador STOP_LOSS');

    const alert = alerts[0];
    assert.equal(alert.trigger, 'STOP_LOSS');
    assert.equal(alert.symbol, 'TSLA');
    assert.equal(alert.currentPrice, 185);
    assert.equal(alert.thresholdPrice, 190);
    assert.ok(alert.message.includes('STOP-LOSS'));
  });

  it('closePosition debe transicionar una posición a CLOSED y calcular P&L realizado', async () => {
    const added = await portfolioService.addPosition({
      symbol: 'MSFT',
      shares: 10,
      buyPrice: 300,
      broker: 'Happi',
      stopLoss: 285,
      targetPrice: 330,
    });

    assert.equal(added.status, 'OPEN');

    // Cerrar posición a $340 (ganancia de $40 por acción = $400 / +13.33%)
    const closed = await portfolioService.closePosition(added.id, 340);

    assert.equal(closed.status, 'CLOSED');
    assert.equal(closed.realizedPnL, 400.00);
    assert.equal(closed.realizedPnLPercent, 13.33);
    assert.ok(closed.closedAt, 'Debe registrar fecha de cierre closedAt');

    const validation = PortfolioHoldingSchema.safeParse(closed);
    assert.ok(validation.success, `Documento cerrado debe cumplir PortfolioHoldingSchema: ${JSON.stringify(validation.error)}`);
  });
});
