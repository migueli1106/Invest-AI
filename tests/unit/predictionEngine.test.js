import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEMA,
  calculateEMASeries,
  calculateRSI,
  calculateRSISeries,
  calculateMACD,
  calculateSupportResistance,
} from '../../src/quant/indicators.js';
import { predictionEngine } from '../../src/services/predictionEngine.js';
import { TradingSignalSchema } from '../../src/models/schemas.js';

describe('📐 Pruebas Matemáticas de Indicadores Técnicos (Pure Math)', () => {
  it('calculateEMA debe calcular el valor determinista exacto de una media exponencial', () => {
    // Para [10, 11, 12, 13, 14] con período 3:
    // SMA inicial de [10, 11, 12] = 11. Multiplier = 2 / (3 + 1) = 0.5.
    // Paso 13: 13 * 0.5 + 11 * 0.5 = 12.
    // Paso 14: 14 * 0.5 + 12 * 0.5 = 13.
    const prices = [10, 11, 12, 13, 14];
    const latestEma = calculateEMA(prices, 3);
    assert.equal(latestEma, 13, 'La EMA final debe ser exactamente 13');

    const series = calculateEMA(prices, 3, true);
    assert.deepEqual(series, [11, 12, 13], 'La serie de EMA debe concordar con el cálculo paso a paso');
  });

  it('calculateEMA debe manejar casos bordes de array vacío y período mayor a la muestra', () => {
    assert.equal(calculateEMA([], 5), 0);
    assert.deepEqual(calculateEMA([], 5, true), []);

    // Con menos precios que el período solicitado, no debe fallar ni emitir NaN
    const shortPrices = [100, 105, 110];
    const result = calculateEMA(shortPrices, 10);
    assert.ok(!isNaN(result) && result > 0, 'Debe degradar graciosamente con datos reducidos');
  });

  it('calculateRSI debe identificar extremos matemáticos: 100 en alza pura, 0 en baja pura y 50 en lateralidad', () => {
    // 1. Alza constante (ganancias puras, 0 pérdidas) -> RSI = 100
    const bullPrices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    const bullRsi = calculateRSI(bullPrices, 14);
    assert.equal(bullRsi, 100, 'RSI debe ser 100 ante subidas continuas sin pérdidas');

    // 2. Baja constante (pérdidas puras, 0 ganancias) -> RSI = 0
    const bearPrices = [25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
    const bearRsi = calculateRSI(bearPrices, 14);
    assert.equal(bearRsi, 0, 'RSI debe ser 0 ante caídas continuas sin ganancias');

    // 3. Precios constantes o fluctuación simétrica balanceada -> RSI = 50
    const flatPrices = Array(20).fill(100);
    const flatRsi = calculateRSI(flatPrices, 14);
    assert.equal(flatRsi, 50, 'RSI debe ser 50 ante precios constantes sin variación');

    const symmetricPrices = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100];
    const symmetricRsi = calculateRSI(symmetricPrices, 14);
    assert.equal(symmetricRsi, 50, 'RSI debe ser 50 ante oscilación perfectamente simétrica');
  });

  it('calculateMACD debe calcular la convergencia y divergencia de medias con histograma', () => {
    // Serie ascendente pronunciada de 45 días
    const uptrend = Array.from({ length: 45 }, (_, i) => 100 + i * 2);
    const macdUp = calculateMACD(uptrend, 12, 26, 9);

    assert.ok(macdUp.macdLine > 0, 'En tendencia alcista prolongada la línea MACD debe ser positiva');
    assert.ok(typeof macdUp.signalLine === 'number');
    assert.ok(typeof macdUp.histogram === 'number');
    assert.equal(
      macdUp.histogram,
      parseFloat((macdUp.macdLine - macdUp.signalLine).toFixed(4)),
      'Histograma debe ser la diferencia exacta entre MACD Line y Signal Line'
    );
  });

  it('calculateSupportResistance debe computar soporte mínimo, resistencia máxima y ancho de canal', () => {
    const candles = [
      { high: 105, low: 98, close: 102 },
      { high: 110, low: 101, close: 108 },
      { high: 108, low: 95, close: 100 },
      { high: 112, low: 100, close: 111 },
      { high: 115, low: 104, close: 114 },
    ];

    const sr = calculateSupportResistance(candles, 5);
    assert.equal(sr.support, 95.00, 'Soporte debe ser el mínimo absoluto de la ventana');
    assert.equal(sr.resistance, 115.00, 'Resistencia debe ser el máximo absoluto de la ventana');
    assert.equal(sr.channelWidth, 20.00, 'Ancho de canal debe ser resistencia - soporte');
  });
});

describe('🔮 Pruebas de Generación de Señales y Gestión de Riesgo (PredictionEngine)', () => {
  it('Debe generar una señal BUY con ratio R/B >= 1:2 cuando convergen los indicadores alcistas', () => {
    // Serie con tendencia alcista sostenida: EMA20 > EMA50, RSI en zona de impulso (40-65) y MACD Histograma > 0
    const candles = [];
    let price = 100;

    // Fase base de 40 velas
    for (let i = 0; i < 40; i++) {
      price += (i % 2 === 0 ? 0.3 : -0.2);
      candles.push({
        high: price + 0.8,
        low: price - 0.5,
        close: parseFloat(price.toFixed(2)),
        volume: 1000000,
      });
    }

    // Fase de impulso controlado (RSI en ~62, EMA20 > EMA50, MACD histograma > 0)
    for (let i = 0; i < 15; i++) {
      price += (i % 2 === 0 ? 0.4 : -0.26);
      candles.push({
        high: price + 0.9,
        low: price - 0.4,
        close: parseFloat(price.toFixed(2)),
        volume: 1500000,
      });
    }

    const signal = predictionEngine.evaluateCandles('BULL_ASSET', candles);

    assert.equal(signal.symbol, 'BULL_ASSET');
    assert.equal(signal.action, 'BUY');
    assert.ok(signal.entryPrice > 0);
    assert.ok(signal.stopLoss < signal.entryPrice, 'Stop-Loss debe estar por debajo del precio de entrada');
    assert.ok(signal.targetPrice > signal.entryPrice, 'Target Price debe estar por encima del precio de entrada');
    assert.ok(signal.riskRewardRatio >= 2.0, `Ratio R/B debe ser al menos 2.0 (actual: ${signal.riskRewardRatio})`);
    assert.ok(signal.confidence >= 60, 'Confianza debe ser de al menos 60% ante convergencia');
    assert.ok(signal.timeHorizonDays >= 3 && signal.timeHorizonDays <= 7, 'Horizonte debe ser de 3 a 7 días');
    assert.ok(signal.rationale.length >= 10, 'La justificación debe tener al menos 10 caracteres');

    // Validación formal con Zod
    const validation = TradingSignalSchema.safeParse(signal);
    assert.ok(validation.success, `La señal debe cumplir TradingSignalSchema: ${JSON.stringify(validation.error)}`);
  });

  it('Debe generar una señal SELL cuando el activo entra en sobrecompra extrema (RSI > 70)', () => {
    // Serie vertical parabólica que dispara RSI a > 75
    const candles = [];
    let price = 50;
    for (let i = 0; i < 45; i++) {
      price += i > 25 ? 4.0 : 0.5;
      candles.push({
        high: price + 2,
        low: price - 0.5,
        close: parseFloat(price.toFixed(2)),
        volume: 2000000,
      });
    }

    const signal = predictionEngine.evaluateCandles('BEAR_OVERBOUGHT', candles);

    assert.equal(signal.symbol, 'BEAR_OVERBOUGHT');
    assert.equal(signal.action, 'SELL');
    assert.ok(signal.stopLoss > signal.entryPrice, 'En SELL el Stop-Loss debe estar por encima de entrada');
    assert.ok(signal.targetPrice < signal.entryPrice, 'En SELL el Target Price debe estar por debajo de entrada');
    assert.ok(signal.riskRewardRatio >= 2.0, 'El ratio R/B debe mantenerse en mínimo 1:2');

    const validation = TradingSignalSchema.safeParse(signal);
    assert.ok(validation.success, 'La señal SELL debe cumplir TradingSignalSchema');
  });

  it('Debe generar una señal SELL ante cruce bajista técnico consolidado', () => {
    // Serie en caída sostenida
    const candles = [];
    let price = 150;
    for (let i = 0; i < 50; i++) {
      price -= 0.8;
      candles.push({
        high: price + 0.5,
        low: price - 1.0,
        close: parseFloat(price.toFixed(2)),
        volume: 1800000,
      });
    }

    const signal = predictionEngine.evaluateCandles('BEAR_TREND', candles);

    assert.equal(signal.symbol, 'BEAR_TREND');
    assert.equal(signal.action, 'SELL');
    assert.ok(signal.stopLoss > signal.entryPrice);
    assert.ok(signal.targetPrice < signal.entryPrice);
    assert.ok(signal.riskRewardRatio >= 2.0);

    const validation = TradingSignalSchema.safeParse(signal);
    assert.ok(validation.success, 'La señal SELL por cruce bajista debe cumplir TradingSignalSchema');
  });

  it('Debe generar una señal HOLD ante mercado lateral o indicadores mixtos', () => {
    // Serie estrictamente plana y oscilante
    const candles = [];
    for (let i = 0; i < 40; i++) {
      const p = 100 + (i % 2 === 0 ? 0.2 : -0.2);
      candles.push({
        high: p + 0.5,
        low: p - 0.5,
        close: parseFloat(p.toFixed(2)),
        volume: 500000,
      });
    }

    const signal = predictionEngine.evaluateCandles('SIDEWAYS_ASSET', candles);

    assert.equal(signal.symbol, 'SIDEWAYS_ASSET');
    assert.equal(signal.action, 'HOLD');
    assert.ok(signal.stopLoss > 0);
    assert.ok(signal.targetPrice > 0);
    assert.equal(signal.confidence, 50, 'En HOLD la confianza debe mantenerse neutral (50%)');

    const validation = TradingSignalSchema.safeParse(signal);
    assert.ok(validation.success, 'La señal HOLD debe cumplir TradingSignalSchema');
  });
});

describe('🛡️ Validación Estricta de Esquemas Zod y Casos Límites', () => {
  it('TradingSignalSchema debe rechazar señales con precios no positivos o ratios corruptos', () => {
    const invalidSignal = {
      symbol: 'FAIL',
      action: 'BUY',
      entryPrice: -100, // Inválido
      targetPrice: 120,
      stopLoss: 90,
      timeHorizonDays: 5,
      confidence: 150, // Inválido: > 100
      expectedReturnPercent: 20,
      riskRewardRatio: 2.0,
      rationale: 'Corto', // Inválido: < 10 caracteres
      status: 'PENDING_APPROVAL',
      createdAt: new Date().toISOString(),
    };

    const result = TradingSignalSchema.safeParse(invalidSignal);
    assert.equal(result.success, false, 'Zod debe rechazar datos incongruentes');
  });

  it('evaluateCandles debe lanzar error si se entregan menos de 10 velas', () => {
    const fewCandles = [{ close: 100 }, { close: 101 }];
    assert.throws(
      () => predictionEngine.evaluateCandles('SHORT_DATA', fewCandles),
      /Muestra de velas insuficiente/
    );
  });
});
