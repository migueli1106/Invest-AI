import { env } from '../config/environment.js';
import { predictionEngine } from './predictionEngine.js';
import { portfolioService } from './portfolioService.js';
import { telegramService } from './telegramService.js';
import { executionBridge } from './broker/executionBridge.js';

/**
 * ⏰ [INVEST AI] Servicio de Monitoreo Continuo Bursátil y Horario de Wall Street
 * Escanea activos de alta liquidez, audita el portafolio y despacha alertas automáticas.
 */
class SchedulerService {
  constructor() {
    this.alertHistory = new Map(); // symbol -> timestamp en ms
    this.COOLDOWN_MS = 45 * 60 * 1000; // Ventana agresiva de 45 minutos anti-spam para señales intradía
    this.exitAlertHistory = new Map(); // positionId/symbol -> timestamp en ms
    this.EXIT_COOLDOWN_MS = 30 * 60 * 1000; // Ventana de 30 minutos anti-spam para alertas de salida repetidas
  }

  /**
   * Determina determinísticamente si Wall Street (NYSE/NASDAQ) está abierto.
   * Lunes a Viernes entre 9:30 AM y 4:00 PM hora Nueva York (Eastern Time).
   * @param {Date} [date=new Date()]
   * @returns {boolean}
   */
  /** Helper unificado para descomponer la fecha en hora bursátil de Nueva York. */
  getNyParts(date = new Date()) {
    const nyParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(date);
    let weekday = '', hour = 0, minute = 0;
    for (const part of nyParts) {
      if (part.type === 'weekday') weekday = part.value;
      if (part.type === 'hour') hour = parseInt(part.value, 10);
      if (part.type === 'minute') minute = parseInt(part.value, 10);
    }
    return { weekday, totalMinutes: (hour === 24 ? 0 : hour) * 60 + minute };
  }

  isMarketOpen(date = new Date()) {
    try {
      const { weekday, totalMinutes } = this.getNyParts(date);
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday) && totalMinutes >= 570 && totalMinutes < 960;
    } catch {
      return false;
    }
  }

  isEodSession(date = new Date()) {
    try {
      const { weekday, totalMinutes } = this.getNyParts(date);
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday) && totalMinutes >= 945 && totalMinutes < 960;
    } catch {
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
    watchlist = [
      'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD',
      'AVGO', 'PLTR', 'ARM', 'SMH', 'SPY', 'QQQ', 'IWM', 'SMCI',
      'COIN', 'UBER', 'BRK-B', 'JPM'
    ],
    forceMarketOpen = false,
    chatId = null
  ) {
    const marketOpen = this.isMarketOpen();

    if (!marketOpen && !forceMarketOpen) {
      console.info('⏸️ [SCHEDULER] Wall Street cerrado. Escaneo en pausa.');
      return { executed: false, reason: 'MARKET_CLOSED', marketOpen: false, timestamp: new Date().toISOString() };
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

        const isHighProbability = signal.confidence >= 80 && signal.riskRewardRatio >= 2.0 &&
          (signal.action === 'BUY' || signal.action === 'SELL');

        if (!isHighProbability) continue;

        const lastSent = this.alertHistory.get(symbol);
        if (lastSent && now - lastSent < this.COOLDOWN_MS) {
          console.info(`⏳ [SCHEDULER] Omitiendo alerta para ${symbol} (en período de enfriamiento de 45m).`);
          dispatched.push({ symbol, action: signal.action, status: 'SKIPPED_COOLDOWN' });
          continue;
        }

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
   * Audita la salud de las inversiones abiertas, emite Break-Even y alertas TP/SL.
   * @param {string|number} [chatId]
   */
  async runPortfolioHealthCheck(chatId = null) {
    console.info('🏥 [SCHEDULER] Ejecutando chequeo de salud y límites del portafolio...');
    const targetChatId = chatId || env.TELEGRAM_CHAT_ID;

    const performance = await portfolioService.calculatePortfolioPerformance();
    const triggers = await portfolioService.checkExitTriggers(performance.positions);

    const alertResults = [];
    const now = Date.now();

    // 1. Evaluación de Protección Break-Even (+1.5% de ganancia no realizada)
    for (const pos of (performance.positions || [])) {
      const pnlPct = Number(pos.unrealizedPnLPercent || 0);
      if (pnlPct >= 1.5 && pnlPct < 8.0) {
        const beKey = `be_${pos.id || pos.symbol}`;
        const lastBe = this.exitAlertHistory.get(beKey);
        if (!lastBe || now - lastBe >= this.EXIT_COOLDOWN_MS) {
          const buyPrice = Number(pos.averageBuyPrice || pos.buyPrice || 0);
          const beMsg = [
            `🛡️ *¡PROTECCIÓN BREAK-EVEN INTRADÍA!*`,
            ``,
            `Tu posición en *${pos.symbol}* ha alcanzado *+${pnlPct.toFixed(1)}%* intradía.`,
            `🎯 *Acción de Protección:* Ajusta tu Stop-Loss al precio de entrada (*$${buyPrice.toFixed(2)}*).`,
            `Eliminas el riesgo a $0.00 en la misma sesión mientras buscas el Target.`,
          ].join('\n');
          try {
            await telegramService.sendMessage(targetChatId, beMsg, { parse_mode: 'Markdown' });
            this.exitAlertHistory.set(beKey, now);
            alertResults.push({ symbol: pos.symbol, type: 'BREAK_EVEN', sent: true });
          } catch (beErr) {
            console.error(`❌ [SCHEDULER] Error break-even alerta para ${pos.symbol}: ${beErr.message}`);
          }
        }
      }
    }

    // 2. Verificación de Cierre de Sesión EOD (3:45 PM - 4:00 PM EST)
    if (this.isEodSession()) {
      for (const pos of (performance.positions || [])) {
        const pnlPct = Number(pos.unrealizedPnLPercent || 0);
        const eodKey = `eod_${pos.id || pos.symbol}`;
        const lastEod = this.exitAlertHistory.get(eodKey);
        if (!lastEod || now - lastEod >= this.EXIT_COOLDOWN_MS) {
          const eodMsg = [
            `⏰ *¡ALERTA DE CIERRE DE SESIÓN (EOD - 15M RESTANTES)!*`,
            ``,
            `Wall Street cierra en menos de 15 minutos (3:45 PM EST).`,
            `• *Posición:* ${pos.symbol} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% P&L)`,
            `• *Recomendación Day Trading:* Toma utilidades o cierra la orden para evitar riesgo y gaps overnight.`,
          ].join('\n');
          try {
            await telegramService.sendMessage(targetChatId, eodMsg, { parse_mode: 'Markdown' });
            this.exitAlertHistory.set(eodKey, now);
            alertResults.push({ symbol: pos.symbol, type: 'EOD_CLOSE', sent: true });
          } catch (eodErr) {
            console.error(`❌ [SCHEDULER] Error EOD alerta para ${pos.symbol}: ${eodErr.message}`);
          }
        }
      }
    }

    // 3. Ejecución Autónoma de Salidas (Auto-Close por Take-Profit o Stop-Loss)
    for (const trigger of triggers) {
      const posKey = String(trigger.positionId || trigger.symbol);
      const lastExitAlert = this.exitAlertHistory.get(posKey);

      if (lastExitAlert && now - lastExitAlert < this.EXIT_COOLDOWN_MS) {
        console.info(`⏳ [SCHEDULER] Omitiendo salida repetida para ${trigger.symbol} (${trigger.type}) - En enfriamiento.`);
        alertResults.push({ trigger, sent: false, skipped: 'COOLDOWN' });
        continue;
      }

      const motivo = trigger.type === 'TAKE_PROFIT'
        ? '🎯 Target Alcanzado (Take-Profit)'
        : '🛑 Stop-Loss Protector';

      try {
        // 1. Despachar automáticamente orden de venta
        await executionBridge.executeOrder({
          symbol: trigger.symbol,
          qty: trigger.shares,
          currentPrice: trigger.currentPrice,
          side: 'SELL',
        });

        // 2. Cerrar posición en portafolio y rotar capital
        const closed = await portfolioService.closePosition(trigger.positionId, trigger.currentPrice);

        // 3. Notificación informativa a Telegram
        const alertMessage = [
          `🎉 *¡POSICIÓN CERRADA AUTOMÁTICAMENTE EN MOOMOO!*`,
          ``,
          `• *Activo:* ${trigger.symbol}`,
          `• *Motivo:* ${motivo}`,
          `• *Precio Salida:* $${trigger.currentPrice.toFixed(2)}`,
          `• *Resultado P&L:* ${closed.realizedPnL >= 0 ? '🟢 Ganancia: +' : '🔴 Pérdida: '}$${closed.realizedPnL} USD (${closed.realizedPnLPercent >= 0 ? '+' : ''}${closed.realizedPnLPercent}%)`,
          `• *Capital Liberado:* Fondos devueltos a tu saldo disponible para nuevas operaciones.`,
        ].join('\n');

        const sendResult = await telegramService.sendMessage(targetChatId, alertMessage, { parse_mode: 'Markdown' });
        this.exitAlertHistory.set(posKey, now);
        alertResults.push({ trigger, closed, autoClosed: true, sent: true, sendResult });
      } catch (err) {
        console.error(`❌ [SCHEDULER] Error ejecutando auto-close para ${trigger.symbol}: ${err.message}`);
        alertResults.push({ trigger, sent: false, error: err.message });
      }
    }

    return {
      checkedAt: new Date().toISOString(),
      openPositionsCount: (performance.positions || []).length,
      triggersCount: triggers.length,
      alertsDispatched: alertResults.length,
      alerts: alertResults,
      summary: performance.summary,
    };
  }
}

export const schedulerService = new SchedulerService();
