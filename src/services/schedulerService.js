import { env } from '../config/environment.js';
import { predictionEngine } from './predictionEngine.js';
import { portfolioService } from './portfolioService.js';
import { telegramService } from './telegramService.js';

/**
 * ⏰ [INVEST AI] Servicio de Monitoreo Continuo Bursátil y Horario de Wall Street
 * Escanea activos de alta liquidez, audita el portafolio y despacha alertas automáticas.
 */
class SchedulerService {
  constructor() {
    this.alertHistory = new Map(); // symbol -> timestamp en ms
    this.COOLDOWN_MS = 4 * 60 * 60 * 1000; // Ventana de 4 horas anti-spam
  }

  /**
   * Determina determinísticamente si Wall Street (NYSE/NASDAQ) está abierto.
   * Lunes a Viernes entre 9:30 AM y 4:00 PM hora Nueva York (Eastern Time).
   * @param {Date} [date=new Date()]
   * @returns {boolean}
   */
  isMarketOpen(date = new Date()) {
    try {
      const nyParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(date);

      let weekday = '';
      let hour = 0;
      let minute = 0;

      for (const part of nyParts) {
        if (part.type === 'weekday') weekday = part.value;
        if (part.type === 'hour') hour = parseInt(part.value, 10);
        if (part.type === 'minute') minute = parseInt(part.value, 10);
      }

      // Si hour es 24 (puede suceder en ciertas implementaciones para medianoche), normalizar a 0
      if (hour === 24) hour = 0;

      const businessDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      if (!businessDays.includes(weekday)) {
        return false;
      }

      const totalMinutes = hour * 60 + minute;
      const openMinutes = 9 * 60 + 30; // 9:30 AM = 570
      const closeMinutes = 16 * 60;    // 4:00 PM = 960

      return totalMinutes >= openMinutes && totalMinutes < closeMinutes;
    } catch (err) {
      console.warn(`⚠️ [SCHEDULER] Error al evaluar horario bursátil: ${err.message}`);
      return false;
    }
  }

  /**
   * Ejecuta un ciclo de escaneo autónomo en la lista de activos.
   * @param {string[]} [watchlist] - Lista de símbolos
   * @param {boolean} [forceMarketOpen=false] - Forzar escaneo ignorando horario
   * @param {string|number} [chatId] - Chat ID destino para alertas
   */
  async runAutonomousMarketScan(
    watchlist = ['AAPL', 'NVDA', 'MSFT', 'SPY', 'QQQ'],
    forceMarketOpen = false,
    chatId = null
  ) {
    const marketOpen = this.isMarketOpen();

    if (!marketOpen && !forceMarketOpen) {
      console.info('⏸️ [SCHEDULER] Wall Street cerrado. Escaneo en pausa.');
      return {
        executed: false,
        reason: 'MARKET_CLOSED',
        marketOpen: false,
        timestamp: new Date().toISOString(),
      };
    }

    console.info(`🔍 [SCHEDULER] Iniciando escaneo autónomo de ${watchlist.length} activos...`);
    const targetChatId = chatId || env.TELEGRAM_CHAT_ID;
    const now = Date.now();
    const signalsEvaluated = [];
    const dispatched = [];

    for (const symbol of watchlist) {
      try {
        const signal = await predictionEngine.generateSignal(symbol);
        signalsEvaluated.push(signal);

        // Filtro de Alta Probabilidad: Confianza >= 80%, Ratio R/B >= 2:1, Acción BUY o SELL
        const isHighProbability =
          signal.confidence >= 80 &&
          signal.riskRewardRatio >= 2.0 &&
          (signal.action === 'BUY' || signal.action === 'SELL');

        if (!isHighProbability) {
          continue;
        }

        // Control de Cooldown Anti-Spam (4 horas)
        const lastSent = this.alertHistory.get(symbol);
        if (lastSent && now - lastSent < this.COOLDOWN_MS) {
          console.info(`⏳ [SCHEDULER] Omitiendo alerta para ${symbol} (en período de enfriamiento de 4h).`);
          dispatched.push({ symbol, action: signal.action, status: 'SKIPPED_COOLDOWN' });
          continue;
        }

        // Despachar alerta a Telegram
        console.info(`🚀 [SCHEDULER] Despachando señal de alta probabilidad: ${symbol} (${signal.action} ${signal.confidence}%)`);
        const sendResult = await telegramService.sendSignalAlert(targetChatId, signal);
        this.alertHistory.set(symbol, now);

        dispatched.push({
          symbol,
          action: signal.action,
          status: 'DISPATCHED',
          confidence: signal.confidence,
          ratio: signal.riskRewardRatio,
          telegramResult: sendResult,
        });
      } catch (err) {
        console.warn(`⚠️ [SCHEDULER] Error analizando activo ${symbol}: ${err.message}`);
      }
    }

    return {
      executed: true,
      marketOpen,
      forced: forceMarketOpen,
      scannedCount: watchlist.length,
      signalsCount: signalsEvaluated.length,
      dispatchedCount: dispatched.filter((d) => d.status === 'DISPATCHED').length,
      dispatched,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Audita la salud de las inversiones abiertas y alerta si tocan TP o SL.
   * @param {string|number} [chatId]
   */
  async runPortfolioHealthCheck(chatId = null) {
    console.info('🏥 [SCHEDULER] Ejecutando chequeo de salud y límites del portafolio...');
    const targetChatId = chatId || env.TELEGRAM_CHAT_ID;

    const performance = await portfolioService.calculatePortfolioPerformance();
    const triggers = await portfolioService.checkExitTriggers(performance.positions);

    const alertResults = [];

    for (const trigger of triggers) {
      const brokerName = (trigger.broker || 'HAPPI').toUpperCase();
      let alertMessage = '';

      if (trigger.type === 'TAKE_PROFIT') {
        alertMessage = [
          `🚨 *¡OBJETIVO ALCANZADO EN ${brokerName}!*`,
          ``,
          `Tu posición en *${trigger.symbol}* ha tocado el Target Price ($${trigger.thresholdPrice.toFixed(2)}).`,
          `📈 Ganancia: +${trigger.unrealizedPnLPercent.toFixed(1)}% ($${trigger.unrealizedPnL.toFixed(2)} USD).`,
          `📱 *Acción recomendada:* Abre tu broker (${brokerName}) y ejecuta la VENTA para asegurar beneficios.`,
        ].join('\n');
      } else {
        alertMessage = [
          `⚠️ *¡STOP LOSS ACTIVADO EN ${brokerName}!*`,
          ``,
          `Tu posición en *${trigger.symbol}* ha tocado el Stop Loss ($${trigger.thresholdPrice.toFixed(2)}).`,
          `📉 Pérdida controlada: ${trigger.unrealizedPnLPercent.toFixed(1)}% ($${trigger.unrealizedPnL.toFixed(2)} USD).`,
          `📱 *Acción recomendada:* Abre tu broker (${brokerName}) y ejecuta la VENTA para proteger tu capital.`,
        ].join('\n');
      }

      try {
        const sendResult = await telegramService.sendMessage(targetChatId, alertMessage, {
          parse_mode: 'Markdown',
        });
        alertResults.push({
          trigger,
          sent: true,
          sendResult,
        });
      } catch (err) {
        console.error(`❌ [SCHEDULER] Error enviando alerta de salida para ${trigger.symbol}: ${err.message}`);
        alertResults.push({
          trigger,
          sent: false,
          error: err.message,
        });
      }
    }

    return {
      checkedAt: new Date().toISOString(),
      openPositionsCount: performance.positions.length,
      triggersCount: triggers.length,
      alertsDispatched: alertResults.length,
      alerts: alertResults,
      summary: performance.summary,
    };
  }
}

export const schedulerService = new SchedulerService();
