import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { marketDataService } from '../../src/services/marketDataService.js';
import { AssetSchema, FluctuationSchema, TradingSignalSchema } from '../../src/models/schemas.js';

describe('📊 Suite de Pruebas Unitarias: Ingesta y Modelos Financieros', () => {
  it('Debe obtener una cotización real y estructurarla según AssetSchema', async () => {
    const quote = await marketDataService.getQuote('AAPL');
    assert.equal(quote.symbol, 'AAPL');
    assert.ok(quote.currentPrice > 0, 'El precio actual debe ser positivo');
    assert.ok(typeof quote.name === 'string', 'El nombre debe ser string');
    assert.equal(quote.status, 'ACTIVE');

    // Validación formal con Zod
    const validation = AssetSchema.safeParse(quote);
    assert.ok(validation.success, 'La cotización debe cumplir rigurosamente el AssetSchema');
  });

  it('Debe construir un registro de fluctuación válido según FluctuationSchema', async () => {
    const mockQuote = {
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      exchange: 'US',
      currency: 'USD',
      currentPrice: 120.50,
      previousClose: 118.00,
      changePercent: 2.11,
      volume: 45000000,
      dayHigh: 121.00,
      dayLow: 117.50,
      lastUpdated: new Date().toISOString(),
      status: 'ACTIVE',
    };

    const fluctuation = marketDataService.buildFluctuationRecord(mockQuote, '1d');
    assert.equal(fluctuation.symbol, 'NVDA');
    assert.equal(fluctuation.price, 120.50);
    assert.ok(fluctuation.volatility >= 0, 'La volatilidad estimada debe ser mayor o igual a 0');

    const validation = FluctuationSchema.safeParse(fluctuation);
    assert.ok(validation.success, 'El registro de fluctuación debe cumplir FluctuationSchema');
  });

  it('AssetSchema debe rechazar precios inválidos o símbolos vacíos', () => {
    const invalidAsset = {
      symbol: '',
      name: 'Empresa Ficticia',
      currentPrice: -10, // Inválido: precio negativo
      previousClose: 100,
      changePercent: 0,
      volume: -5,        // Inválido: volumen negativo
      lastUpdated: new Date().toISOString(),
    };

    const result = AssetSchema.safeParse(invalidAsset);
    assert.equal(result.success, false, 'Zod debe rechazar datos financieros negativos o incompletos');
  });

  it('TradingSignalSchema debe validar correctamente una señal generada con Stop-Loss y TP', () => {
    const validSignal = {
      symbol: 'MSFT',
      action: 'BUY',
      entryPrice: 420.00,
      targetPrice: 450.00,
      stopLoss: 405.00,
      timeHorizonDays: 5,
      confidence: 85,
      expectedReturnPercent: 7.14,
      riskRewardRatio: 2.0,
      rationale: 'Superó resistencia técnica con incremento del 20% en volumen diario.',
      status: 'PENDING_APPROVAL',
      createdAt: new Date().toISOString(),
    };

    const result = TradingSignalSchema.safeParse(validSignal);
    assert.ok(result.success, 'La señal de trading debe cumplir con todas las directivas de riesgo');
  });
});
