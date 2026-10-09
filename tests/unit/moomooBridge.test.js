process.env.NODE_ENV = 'test';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { moomooService } from '../../src/services/broker/moomooService.js';
import { executionBridge } from '../../src/services/broker/executionBridge.js';
import { capitalManagerService } from '../../src/services/capitalManagerService.js';

describe('🐮 Suite de Pruebas Unitarias: Moomoo OpenAPI & Execution Bridge', () => {
  beforeEach(() => {
    capitalManagerService.reset(35.00);
    executionBridge.setExecutionMode('MOOMOO');
  });

  // 1. Normalización de Tickers & Mercados
  it('normalizeCode debe agregar prefijo de mercado US por defecto y respetar prefijos existentes', () => {
    assert.equal(moomooService.normalizeCode('AAPL'), 'US.AAPL');
    assert.equal(moomooService.normalizeCode('nvda'), 'US.NVDA');
    assert.equal(moomooService.normalizeCode('US.MSFT'), 'US.MSFT');
    assert.equal(moomooService.normalizeCode('HK.00700'), 'HK.00700');
    assert.equal(moomooService.normalizeCode('CC.BTCUSD'), 'CC.BTCUSD');
  });

  // 2. Resumen de Cuenta y Portafolio
  it('getAccountSummary debe retornar estructura institucional de cuenta Moomoo en entorno SIMULATE', async () => {
    const summary = await moomooService.getAccountSummary('SIMULATE');
    assert.equal(summary.broker, 'Moomoo');
    assert.equal(summary.trdEnv, 'SIMULATE');
    assert.equal(summary.accId, '2886044');
    assert.ok(summary.buyingPower > 0);
    assert.ok(summary.cash > 0);
    assert.equal(summary.status, 'CONNECTED');
    assert.ok(Array.isArray(summary.positions));
  });

  it('getAccountSummary debe soportar conmutación al entorno REAL', async () => {
    const summary = await moomooService.getAccountSummary('REAL');
    assert.equal(summary.broker, 'Moomoo');
    assert.equal(summary.trdEnv, 'REAL');
    assert.equal(summary.status, 'CONNECTED');
  });

  // 3. Ejecución de Órdenes (place_order)
  it('executeOrder debe despachar orden de compra fraccionada/entera con parámetros oficiales', async () => {
    const orderRes = await moomooService.executeOrder({
      symbol: 'NVDA',
      qty: 0.25,
      price: 140.00,
      side: 'BUY',
      trdEnv: 'SIMULATE',
    });

    assert.equal(orderRes.success, true);
    assert.ok(orderRes.orderId);
    assert.equal(orderRes.symbol, 'NVDA');
    assert.equal(orderRes.code, 'US.NVDA');
    assert.equal(orderRes.side, 'BUY');
    assert.equal(orderRes.status, 'SUBMITTED');
    assert.equal(orderRes.broker, 'Moomoo');
    assert.equal(orderRes.trdEnv, 'SIMULATE');
  });

  it('executeOrder debe permitir conmutar a orden de venta SELL en entorno REAL', async () => {
    const sellRes = await moomooService.executeOrder({
      symbol: 'AAPL',
      qty: 1,
      price: 220.00,
      side: 'SELL',
      trdEnv: 'REAL',
    });

    assert.equal(sellRes.success, true);
    assert.equal(sellRes.side, 'SELL');
    assert.equal(sellRes.trdEnv, 'REAL');
  });

  // 4. Cancelación de Órdenes (cancel_order)
  it('cancelOrder debe solicitar cancelación en OpenD y retornar estado CANCELLED', async () => {
    const cancelRes = await moomooService.cancelOrder('ord_test_999', 'SIMULATE');
    assert.equal(cancelRes.success, true);
    assert.equal(cancelRes.orderId, 'ord_test_999');
    assert.equal(cancelRes.status, 'CANCELLED');
  });

  // 5. Cotizaciones en Tiempo Real (get_stock_quote)
  it('getQuote debe retornar información de precio del activo', async () => {
    const quote = await moomooService.getQuote('MSFT');
    assert.equal(quote.symbol, 'MSFT');
    assert.equal(quote.code, 'US.MSFT');
    assert.ok(quote.price > 0);
  });

  // 6. Integración con Execution Bridge (Estrategia MOOMOO Primaria)
  it('Execution Bridge debe operar con Moomoo como broker activo primario', async () => {
    assert.equal(executionBridge.getExecutionMode(), 'MOOMOO');
    const summary = executionBridge.getBrokerSummary();
    assert.equal(summary.broker, 'Moomoo');
    assert.equal(summary.executionMode, 'MOOMOO');
    assert.equal(summary.status, 'OPERATIONAL');

    const execRes = await executionBridge.executeOrder({
      symbol: 'PLTR',
      currentPrice: 40.00,
      side: 'BUY',
    });

    assert.equal(execRes.success, true);
    assert.equal(execRes.mode, 'MOOMOO');
    assert.equal(execRes.broker, 'Moomoo');
    assert.equal(execRes.symbol, 'PLTR');
    assert.ok(execRes.orderId);
  });

  it('Execution Bridge debe permitir conmutación fluida entre estrategias (MOOMOO, LOCAL_AGENT)', () => {
    executionBridge.setExecutionMode('LOCAL_AGENT');
    assert.equal(executionBridge.getExecutionMode(), 'LOCAL_AGENT');
    assert.equal(executionBridge.getBrokerSummary().broker, 'Moomoo');

    executionBridge.setExecutionMode('MOOMOO');
    assert.equal(executionBridge.getExecutionMode(), 'MOOMOO');
    assert.equal(executionBridge.getBrokerSummary().broker, 'Moomoo');
  });
});
