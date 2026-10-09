process.env.NODE_ENV = 'test';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { capitalManagerService } from '../../src/services/capitalManagerService.js';

describe('💰 Suite de Pruebas Unitarias: Motor de Capital Dinámico Exponencial & Sizing Proporcional', () => {
  beforeEach(() => {
    capitalManagerService.reset(35.00);
  });

  it('calculateFractionalSizing debe calcular la cantidad fraccionada con asignación manual', () => {
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

  it('Motor Dinámico: calculateFractionalSizing proporcional con saldos de $50, $500 y $5,000 USD', () => {
    // 1. Saldo $50 USD -> 10% = $5, pero min $15 USD aplica -> $15 USD
    capitalManagerService.reset(50.00);
    const sizing50 = capitalManagerService.calculateFractionalSizing('NVDA', 100.00);
    assert.equal(sizing50.allowed, true);
    assert.equal(sizing50.notional, 15.00);
    assert.equal(sizing50.qty, 0.1500);

    // 2. Saldo $500 USD -> 10% = $50 USD (entre $15 y max 25%=$125) -> $50 USD
    capitalManagerService.reset(500.00);
    const sizing500 = capitalManagerService.calculateFractionalSizing('MSFT', 100.00);
    assert.equal(sizing500.allowed, true);
    assert.equal(sizing500.notional, 50.00);
    assert.equal(sizing500.qty, 0.5000);

    // 3. Saldo $5,000 USD -> 10% = $500 USD (entre $15 y max 25%=$1250) -> $500 USD
    capitalManagerService.reset(5000.00);
    const sizing5000 = capitalManagerService.calculateFractionalSizing('AAPL', 100.00);
    assert.equal(sizing5000.allowed, true);
    assert.equal(sizing5000.notional, 500.00);
    assert.equal(sizing5000.qty, 5.0000);
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

  it('syncWithMoomoo debe calibrar el pool con saldos reales de Moomoo OpenD', () => {
    const moomooAccount = {
      cash: 1250.50,
      totalAssets: 3400.00,
      buyingPower: 2500.00,
    };

    capitalManagerService.syncWithMoomoo(moomooAccount);
    const status = capitalManagerService.getCapitalStatus();
    assert.equal(status.availableCash, 1250.50);
    assert.equal(status.totalCapital, 3400.00);
    assert.equal(status.buyingPower, 2500.00);
    assert.equal(status.broker, 'Moomoo');
    assert.equal(status.canTrade, true);
  });

  it('Multi-Posición Escalable: debe respetar límite de hasta 10 posiciones simultáneas', () => {
    capitalManagerService.reset(10000.00);
    for (let i = 1; i <= 10; i++) {
      capitalManagerService.reserveCapital(`pos_${i}`, 100.00);
    }
    assert.equal(capitalManagerService.getCapitalStatus().activeReservationsCount, 10);
    assert.equal(capitalManagerService.getCapitalStatus().canTrade, false);

    const eleventhTrade = capitalManagerService.calculateFractionalSizing('NVDA', 100.00);
    assert.equal(eleventhTrade.allowed, false);
    assert.equal(eleventhTrade.reason, 'MAX_POSITIONS_REACHED');
  });
});
