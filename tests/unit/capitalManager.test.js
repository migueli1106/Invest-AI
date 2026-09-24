process.env.NODE_ENV = 'test';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { capitalManagerService } from '../../src/services/capitalManagerService.js';

describe('💰 Suite de Pruebas Unitarias: Gestor de Capital Flexible Multi-Posición (FLEXIBLE_CAPITAL)', () => {
  beforeEach(() => {
    capitalManagerService.reset(35.00);
  });

  it('calculateFractionalSizing debe calcular exactamente la cantidad fraccionada para acciones caras con $35 USD', () => {
    // NVDA cotizando a $120.00 -> $35 / $120 = 0.29166... -> 0.2917 acciones
    const sizingNVDA = capitalManagerService.calculateFractionalSizing('NVDA', 120.00, 35.00);
    assert.equal(sizingNVDA.allowed, true);
    assert.equal(sizingNVDA.symbol, 'NVDA');
    assert.equal(sizingNVDA.notional, 35.00);
    assert.equal(sizingNVDA.qty, 0.2917);

    // MSFT cotizando a $420.00 -> $35 / $420 = 0.08333... -> 0.0833 acciones
    const sizingMSFT = capitalManagerService.calculateFractionalSizing('MSFT', 420.00, 35.00);
    assert.equal(sizingMSFT.allowed, true);
    assert.equal(sizingMSFT.notional, 35.00);
    assert.equal(sizingMSFT.qty, 0.0833);

    // SPY cotizando a $540.00 -> $35 / $540 = 0.0648 acciones
    const sizingSPY = capitalManagerService.calculateFractionalSizing('SPY', 540.00, 35.00);
    assert.equal(sizingSPY.allowed, true);
    assert.equal(sizingSPY.qty, 0.0648);
  });

  it('Capital Flexible Multi-Posición: debe permitir múltiples compras simultáneas sin bloquear por pool', () => {
    // 1. Reservar los $35 USD para la primera posición
    capitalManagerService.reserveCapital('ord_nvda_1', 35.00);

    const statusAfterReserve = capitalManagerService.getCapitalStatus();
    assert.equal(statusAfterReserve.policy, 'FLEXIBLE_CAPITAL');
    assert.equal(statusAfterReserve.canTrade, true);

    // 2. Compra de un segundo activo (ej. AAPL) - ahora permitido bajo FLEXIBLE_CAPITAL
    const secondTrade = capitalManagerService.calculateFractionalSizing('AAPL', 220.00, 35.00);
    assert.equal(secondTrade.allowed, true);
    assert.equal(secondTrade.symbol, 'AAPL');
    assert.equal(secondTrade.notional, 35.00);
    assert.ok(secondTrade.qty > 0);

    // 3. Reservar la segunda posición y verificar una tercera
    capitalManagerService.reserveCapital('ord_aapl_2', 35.00);
    const thirdTrade = capitalManagerService.calculateFractionalSizing('MSFT', 400.00, 35.00);
    assert.equal(thirdTrade.allowed, true);
    assert.equal(thirdTrade.symbol, 'MSFT');
  });

  it('Rotación de Capital: debe liberar los fondos al pool líquido tras la salida de una posición', () => {
    // 1. Invertir $35 USD
    capitalManagerService.reserveCapital('ord_msft_1', 35.00);
    assert.equal(capitalManagerService.availableCash, 0.00);

    // 2. Simular salida con Take-Profit (+10% -> $38.50 recuperados)
    const rotationProfit = capitalManagerService.releaseCapital('ord_msft_1', 38.50);
    assert.equal(rotationProfit.availableCash, 38.50);
    assert.equal(rotationProfit.deployedCapital, 0.00);
    assert.equal(rotationProfit.totalCapital, 38.50);
    assert.equal(rotationProfit.netChange, 3.50);

    // 3. Ahora el pool puede financiar una nueva operación sin inyección externa
    const nextTrade = capitalManagerService.calculateFractionalSizing('NVDA', 120.00, 35.00);
    assert.equal(nextTrade.allowed, true);
    assert.equal(nextTrade.notional, 35.00);
  });

  it('syncWithBrokerBalance debe calibrar el pool con los balances reales del broker', () => {
    const mockBrokerAccount = {
      cash: '34.80',
      portfolio_value: '34.80',
      buying_power: '69.60',
    };

    capitalManagerService.syncWithBrokerBalance(mockBrokerAccount);
    const status = capitalManagerService.getCapitalStatus();
    assert.equal(status.availableCash, 34.80);
    assert.equal(status.totalCapital, 34.80);
    assert.equal(status.canTrade, true);
  });
});
