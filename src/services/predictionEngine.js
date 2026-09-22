import { marketDataService } from './marketDataService.js';
import { getSignalsCollection } from '../db/firestore.js';
import { TradingSignalSchema } from '../models/schemas.js';
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateSupportResistance,
} from '../quant/indicators.js';

/**
 * 🔮 [INVEST AI] Motor Cuantitativo y Pronosticador de Señales
 * Analiza series temporales, genera recomendaciones probabilísticas con
 * Stop-Loss/Take-Profit y persiste señales auditadas en Firebase Firestore.
 */

class PredictionEngine {
  /**
   * Evalúa una serie de velas históricas y calcula la señal cuantitativa correspondiente.
   * Método puro/aislado que facilita pruebas unitarias sin llamadas a la red.
   * @param {string} symbol - Ticker del activo
   * @param {Array<{close: number, high?: number, low?: number}>} candles - Velas históricas
   * @returns {object} Señal validada por TradingSignalSchema con metadata de indicadores
   */
  evaluateCandles(symbol, candles) {
    const cleanSymbol = symbol.trim().toUpperCase();

    if (!Array.isArray(candles) || candles.length < 10) {
      throw new Error(`Muestra de velas insuficiente para ${cleanSymbol} (requerido mín 10, recibidas ${candles?.length || 0})`);
    }

    const cleanCandles = candles.filter((c) => c && typeof c.close === 'number' && !isNaN(c.close));
    const closes = cleanCandles.map((c) => c.close);
    const currentPrice = closes[closes.length - 1];

    if (!currentPrice || currentPrice <= 0) {
      throw new Error(`Precio de cierre inválido para ${cleanSymbol}: ${currentPrice}`);
    }

    // 1. Cálculo de indicadores técnicos matemáticos
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes, 12, 26, 9);
    const sr = calculateSupportResistance(cleanCandles, 20);

    // 2. Lógica de Decisión de Señal
    const isBullishTrend = ema20 > ema50;
    const isRsiImpulse = rsi >= 40 && rsi <= 65;
    const isMacdPositive = macd.histogram > 0;
    const isBuy = isBullishTrend && isRsiImpulse && isMacdPositive;

    const isOverbought = rsi > 70;
    const isLateralMarket = Math.abs(ema20 - ema50) / ema50 < 0.005;
    const isStrongBearishCross = (!isLateralMarket && ema20 < ema50 && (macd.histogram < 0 || macd.macdLine < 0)) || (rsi < 30 && ema20 < ema50);
    const isSell = !isBuy && (isOverbought || isStrongBearishCross);

    let action = 'HOLD';
    if (isBuy) {
      action = 'BUY';
    } else if (isSell) {
      action = 'SELL';
    }

    // 3. Modelado de Gestión de Riesgo (Stop-Loss, Target y Ratio R/B >= 1:2)
    const entryPrice = parseFloat(currentPrice.toFixed(2));
    let stopLoss;
    let targetPrice;
    let riskRewardRatio;
    let expectedReturnPercent;
    let confidence;
    let timeHorizonDays;
    let rationale;

    if (action === 'BUY') {
      timeHorizonDays = 5;

      // Stop-loss fijado bajo soporte reciente o entre 3% y 5% de riesgo
      if (sr.support > 0 && sr.support < entryPrice) {
        const supportRisk = (entryPrice - sr.support) / entryPrice;
        if (supportRisk >= 0.01 && supportRisk <= 0.05) {
          stopLoss = parseFloat((sr.support * 0.995).toFixed(2));
        } else if (supportRisk < 0.01) {
          stopLoss = parseFloat((entryPrice * 0.97).toFixed(2)); // 3% riesgo mínimo técnico
        } else {
          stopLoss = parseFloat((entryPrice * 0.95).toFixed(2)); // tope 5% de riesgo
        }
      } else {
        stopLoss = parseFloat((entryPrice * 0.965).toFixed(2)); // 3.5% riesgo por defecto
      }

      if (stopLoss >= entryPrice) {
        stopLoss = parseFloat((entryPrice * 0.965).toFixed(2));
      }

      const riskPerUnit = entryPrice - stopLoss;
      const rewardPerUnit = riskPerUnit * 2.0; // Ratio mínimo 1:2 garantizado
      targetPrice = parseFloat((entryPrice + rewardPerUnit).toFixed(2));
      riskRewardRatio = parseFloat((rewardPerUnit / riskPerUnit).toFixed(2));
      expectedReturnPercent = parseFloat((((targetPrice - entryPrice) / entryPrice) * 100).toFixed(2));

      // Confianza ponderada (0 - 100%)
      let score = 65;
      if (ema20 > ema50 * 1.01) score += 10;
      if (rsi >= 45 && rsi <= 60) score += 10;
      if (macd.histogram > 0.05) score += 10;
      if (entryPrice > sr.support) score += 5;
      confidence = Math.min(95, Math.max(50, score));

      rationale = `Señal de COMPRA para ${cleanSymbol}: Tendencia alcista confirmada (EMA20 $${ema20.toFixed(2)} > EMA50 $${ema50.toFixed(2)}), RSI en ${rsi.toFixed(1)} en zona de impulso e histograma MACD positivo (+${macd.histogram.toFixed(2)}). Stop-Loss en $${stopLoss.toFixed(2)} bajo soporte reciente ($${sr.support.toFixed(2)}) y Target en $${targetPrice.toFixed(2)} (R/B ${riskRewardRatio}:1).`;

    } else if (action === 'SELL') {
      timeHorizonDays = 4;

      // Stop-loss fijado sobre resistencia o entre 3% y 5% por encima
      if (sr.resistance > entryPrice) {
        const resistanceRisk = (sr.resistance - entryPrice) / entryPrice;
        if (resistanceRisk >= 0.01 && resistanceRisk <= 0.05) {
          stopLoss = parseFloat((sr.resistance * 1.005).toFixed(2));
        } else if (resistanceRisk < 0.01) {
          stopLoss = parseFloat((entryPrice * 1.03).toFixed(2));
        } else {
          stopLoss = parseFloat((entryPrice * 1.05).toFixed(2));
        }
      } else {
        stopLoss = parseFloat((entryPrice * 1.035).toFixed(2));
      }

      if (stopLoss <= entryPrice) {
        stopLoss = parseFloat((entryPrice * 1.035).toFixed(2));
      }

      const riskPerUnit = stopLoss - entryPrice;
      const rewardPerUnit = riskPerUnit * 2.0;
      targetPrice = parseFloat(Math.max(0.01, entryPrice - rewardPerUnit).toFixed(2));
      riskRewardRatio = parseFloat((rewardPerUnit / riskPerUnit).toFixed(2));
      expectedReturnPercent = parseFloat(((-rewardPerUnit / entryPrice) * 100).toFixed(2));

      let score = 65;
      if (rsi > 70 || rsi < 30) score += 12;
      if (ema20 < ema50) score += 10;
      if (macd.histogram < -0.05) score += 8;
      confidence = Math.min(95, Math.max(50, score));

      const sellReason = isOverbought
        ? `Sobrecompra extrema con RSI en ${rsi.toFixed(1)}`
        : `Cruce bajista técnico (EMA20 $${ema20.toFixed(2)} < EMA50 $${ema50.toFixed(2)}) e histograma MACD negativo (${macd.histogram.toFixed(2)})`;

      rationale = `Señal de VENTA para ${cleanSymbol}: ${sellReason}. Proyección correctiva hacia objetivo $${targetPrice.toFixed(2)} con Stop-Loss protector en $${stopLoss.toFixed(2)} (R/B ${riskRewardRatio}:1).`;

    } else {
      // HOLD / NEUTRAL
      timeHorizonDays = 5;
      stopLoss = parseFloat((entryPrice * 0.96).toFixed(2));
      const riskPerUnit = entryPrice - stopLoss;
      const rewardPerUnit = riskPerUnit * 2.0;
      targetPrice = parseFloat((entryPrice + rewardPerUnit).toFixed(2));
      riskRewardRatio = 2.0;
      expectedReturnPercent = parseFloat((((targetPrice - entryPrice) / entryPrice) * 100).toFixed(2));
      confidence = 50;

      rationale = `Señal NEUTRAL (HOLD) para ${cleanSymbol}: Mercado en consolidación o señales técnicas mixtas. EMA20 ($${ema20.toFixed(2)}) vs EMA50 ($${ema50.toFixed(2)}), RSI en ${rsi.toFixed(1)} e histograma MACD en ${macd.histogram.toFixed(2)}. Se recomienda prudencia hasta validar ruptura de canal ($${sr.support.toFixed(2)} - $${sr.resistance.toFixed(2)}).`;
    }

    const expiresDate = new Date();
    expiresDate.setDate(expiresDate.getDate() + timeHorizonDays);

    const rawSignal = {
      symbol: cleanSymbol,
      action,
      entryPrice,
      targetPrice,
      stopLoss,
      timeHorizonDays,
      confidence: Math.round(confidence),
      expectedReturnPercent,
      riskRewardRatio,
      rationale,
      status: 'PENDING_APPROVAL',
      createdAt: new Date().toISOString(),
      expiresAt: expiresDate.toISOString(),
    };

    // Validación estricta con el esquema canónico de Zod
    const validatedSignal = TradingSignalSchema.parse(rawSignal);

    return {
      ...validatedSignal,
      indicators: {
        ema20,
        ema50,
        rsi,
        macd,
        supportResistance: sr,
      },
    };
  }

  /**
   * Genera y persiste una señal cuantitativa para un símbolo a partir de datos en vivo.
   * @param {string} symbol - Ticker del activo (ej. 'AAPL', 'NVDA')
   * @returns {Promise<object>} Señal procesada y persistida
   */
  async generateSignal(symbol) {
    const cleanSymbol = symbol.trim().toUpperCase();
    console.info(`🧠 [PREDICTION ENGINE] Analizando activo: ${cleanSymbol}...`);

    // Ingesta de 60 días de velas diarias
    const candles = await marketDataService.getHistoricalCandles(cleanSymbol, 60, '1d');
    if (!candles || candles.length === 0) {
      throw new Error(`No se obtuvieron velas de mercado para ${cleanSymbol}`);
    }

    const evaluated = this.evaluateCandles(cleanSymbol, candles);

    // Persistencia en Firebase Firestore (colección 'trading_signals')
    try {
      // Extraemos solo las propiedades del documento Zod para la BD
      const { indicators, ...signalDoc } = evaluated;
      const docRef = await getSignalsCollection().add(signalDoc);
      console.info(`💾 [FIRESTORE] Señal ${signalDoc.action} guardada para ${cleanSymbol} (ID: ${docRef.id}).`);
    } catch (dbErr) {
      console.warn(`⚠️ [FIRESTORE] Persistencia de señal pendiente: ${dbErr.message}`);
    }

    return evaluated;
  }

  /**
   * Analiza una lista de activos de vigilancia y genera sus señales correspondientes.
   * @param {string[]} symbols - Lista de símbolos
   * @returns {Promise<object[]>} Lista de señales generadas
   */
  async analyzeWatchlist(symbols = ['AAPL', 'NVDA', 'MSFT', 'SPY', 'QQQ']) {
    console.info(`🎯 [INVEST AI] Iniciando análisis cuantitativo de Watchlist (${symbols.length} activos)...`);
    const results = [];

    for (const symbol of symbols) {
      try {
        const signal = await this.generateSignal(symbol);
        results.push(signal);
      } catch (err) {
        console.error(`❌ Error analizando ${symbol}: ${err.message}`);
      }
    }

    console.info(`\n📊 Análisis concluido: ${results.length}/${symbols.length} señales generadas.`);
    return results;
  }

  /**
   * Obtiene las señales más recientes almacenadas en Firestore.
   * @param {number} limitCount - Límite de documentos
   */
  async getRecentSignals(limitCount = 20) {
    try {
      const snapshot = await getSignalsCollection()
        .orderBy('createdAt', 'desc')
        .limit(limitCount)
        .get();

      if (snapshot.empty) return [];
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.warn(`⚠️ Error consultando señales en Firestore: ${err.message}`);
      return [];
    }
  }
}

export const predictionEngine = new PredictionEngine();
