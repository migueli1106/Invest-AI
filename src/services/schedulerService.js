import { env } from '../config/environment.js';
import { predictionEngine } from './predictionEngine.js';
import { portfolioService } from './portfolioService.js';
import { telegramService } from './telegramService.js';
import { executionBridge } from './broker/executionBridge.js';
import { systemConfigService } from './systemConfigService.js';

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
      timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
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
    const opportunities = [];

    for (const symbol of watchlist) {
      try {
        const signal = await predictionEngine.generateSignal(symbol);
        signalsEvaluated.push(signal);

        const isHighProbability = signal.confidence >= 80 && signal.riskRewardRatio >= 2.0 &&
          (signal.action === 'BUY' || signal.action === 'SELL');

        if (!isHighProbability) continue;

        const lastSent = this.alertHistory.get(symbol);
        if (lastSent && now - lastSent < this.COOLDOWN_MS) {
          console.info(`⏳ [SCHEDULER] Omitiendo alerta para ${symbol} (en enfriamiento de 45m).`);
          dispatched.push({ symbol, action: signal.action, status: 'SKIPPED_COOLDOWN' });
          continue;
        }

        opportunities.push(signal);
      } catch (err) {
        console.warn(`⚠️ [SCHEDULER] Error analizando activo ${symbol}: ${err.message}`);
      }
    }

    if (opportunities.length > 0) {
      if (systemConfigService.isAutoInvestEnabled()) {
        console.info(`🤖 [AUTO-INVEST] Ejecutando automáticamente ${opportunities.length} órdenes...`);
        for (const sig of opportunities) {
          const exec = await executionBridge.executeOrder({
            symbol: sig.symbol,
            currentPrice: sig.entryPrice,
            stopLoss: sig.stopLoss,
            targetPrice: sig.targetPrice,
            side: sig.action,
            chatId: targetChatId,
          });
          this.alertHistory.set(sig.symbol, now);
          dispatched.push({
            symbol: sig.symbol,
            action: sig.action,
            status: 'AUTO_EXECUTED',
            confidence: sig.confidence,
            ratio: sig.riskRewardRatio,
            executionResult: exec,
          });
        }
        const summary = `⚡ *INVEST AI — EJECUCIÓN AUTÓNOMA (MODO AUTO-INVEST)*\n\n` +
          `Se ejecutaron *${opportunities.length}* órdenes en Moomoo OpenD:\n` +
          opportunities.map((o) => `• *${o.symbol}* (${o.action}): Entrada $${o.entryPrice.toFixed(2)} | Target $${o.targetPrice.toFixed(2)} | SL $${o.stopLoss.toFixed(2)}`).join('\n') +
          `\n\n📱 Posiciones abiertas y gestionadas por el motor algorítmico.`;
        await telegramService.sendMessage(targetChatId, summary, { parse_mode: 'Markdown' });
      } else if (opportunities.length === 1) {
        const sig = opportunities[0];
        console.info(`🚀 [SCHEDULER] Despachando señal: ${sig.symbol} (${sig.action} ${sig.confidence}%)`);
        const sendResult = await telegramService.sendSignalAlert(targetChatId, sig);
        this.alertHistory.set(sig.symbol, now);
        dispatched.push({
          symbol: sig.symbol,
          action: sig.action,
          status: 'DISPATCHED',
          confidence: sig.confidence,
          ratio: sig.riskRewardRatio,
          telegramResult: sendResult,
        });
      } else {
        console.info(`🚀 [SCHEDULER] Despachando digest consolidado con ${opportunities.length} oportunidades...`);
        const sendResult = await telegramService.sendConsolidatedDigest(targetChatId, opportunities);
        for (const sig of opportunities) {
          this.alertHistory.set(sig.symbol, now);
          dispatched.push({
            symbol: sig.symbol,
            action: sig.action,
            status: 'DISPATCHED_DIGEST',
            confidence: sig.confidence,
            ratio: sig.riskRewardRatio,
            telegramResult: sendResult,
          });
        }
      }
    }

    return {
      executed: true,
      marketOpen,
      forced: forceMarketOpen,
      scannedCount: watchlist.length,
      signalsCount: signalsEvaluated.length,
      dispatchedCount: dispatched.filter((d) => d.status === 'DISPATCHED' || d.status === 'DISPATCHED_DIGEST' || d.status === 'AUTO_EXECUTED').length,
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

    // 1. Break-Even 100% automático (+1.5%): ajusta Stop-Loss al precio de entrada (disparo único)
    for (const pos of (performance.positions || [])) {
      const pnlPct = Number(pos.unrealizedPnLPercent || 0);
      const buyPrice = Number(pos.averageBuyPrice || pos.buyPrice || 0);
      if (pnlPct < 1.5 || pnlPct >= 8.0 || pos.breakEvenApplied === true || !(buyPrice > 0)) continue;

      try {
        await portfolioService.updatePositionStopLoss(pos.id, buyPrice);
        pos.stopLoss = buyPrice;
        pos.breakEvenApplied = true;
      } catch (updErr) {
        console.error(`❌ [SCHEDULER] No se pudo ajustar Stop-Loss de ${pos.symbol}: ${updErr.message}`);
        continue;
      }

      const beMsg = telegramService.buildBreakEvenMessage(pos.symbol, pnlPct, buyPrice);
      try {
        await telegramService.sendMessage(targetChatId, beMsg, { parse_mode: 'Markdown' });
        alertResults.push({ symbol: pos.symbol, type: 'BREAK_EVEN', sent: true, stopLoss: buyPrice });
      } catch (beErr) {
        console.error(`❌ [SCHEDULER] Error notificando break-even de ${pos.symbol}: ${beErr.message}`);
        alertResults.push({ symbol: pos.symbol, type: 'BREAK_EVEN', sent: false, stopLoss: buyPrice });
      }
    }

    // 2. Verificación de Cierre de Sesión EOD (3:45 PM - 4:00 PM EST)
    if (this.isEodSession()) {
      for (const pos of (performance.positions || [])) {
        const pnlPct = Number(pos.unrealizedPnLPercent || 0);
        const eodKey = `eod_${pos.id || pos.symbol}`;
        const lastEod = this.exitAlertHistory.get(eodKey);
        if (!lastEod || now - lastEod >= this.EXIT_COOLDOWN_MS) {
          const eodMsg = `⏰ *¡ALERTA DE CIERRE DE SESIÓN (EOD - 15M RESTANTES)!*\n\nWall Street cierra en menos de 15 minutos (3:45 PM EST).\n` +
            `• *Posición:* ${pos.symbol} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% P&L)\n• *Recomendación Day Trading:* Toma utilidades o cierra la orden para evitar riesgo y gaps overnight.`;
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
        const alertMessage = `🎉 *¡POSICIÓN CERRADA AUTOMÁTICAMENTE EN MOOMOO!*\n\n• *Activo:* ${trigger.symbol}\n• *Motivo:* ${motivo}\n` +
          `• *Precio Salida:* $${trigger.currentPrice.toFixed(2)}\n• *Resultado P&L:* ${closed.realizedPnL >= 0 ? '🟢 Ganancia: +' : '🔴 Pérdida: '}$${closed.realizedPnL} USD (${closed.realizedPnLPercent >= 0 ? '+' : ''}${closed.realizedPnLPercent}%)\n• *Capital Liberado:* Fondos devueltos a tu saldo disponible para nuevas operaciones.`;

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
