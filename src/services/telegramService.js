import { env } from '../config/environment.js';

/**
 * ✈️ [INVEST AI] Adaptador Nativo de Telegram Bot API
 * Envía alertas de trading interactivas con botones táctiles (inline_keyboard)
 * y procesa confirmaciones en 1-clic con 100% costo cero de por vida.
 */

class TelegramService {
  constructor() {
    this.baseUrl = 'https://api.telegram.org';
  }

  /**
   * Determina si el servicio debe operar en modo simulación segura.
   * @param {string|number} [chatId]
   * @returns {boolean}
   */
  isSimulation(chatId) {
    if (
      !env.TELEGRAM_BOT_TOKEN ||
      !chatId ||
      env.NODE_ENV === 'test' ||
      process.env.NODE_ENV === 'test' ||
      String(chatId) === '123456789' ||
      String(chatId).startsWith('test_')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Envía un mensaje de texto a un chat de Telegram.
   * @param {string|number} chatId - ID del chat o usuario
   * @param {string} text - Contenido del mensaje (Markdown o texto plano)
   * @param {object} [options={}] - Opciones adicionales (reply_markup, parse_mode)
   */
  async sendMessage(chatId, text, options = {}) {
    const targetChatId = chatId || env.TELEGRAM_CHAT_ID;

    if (this.isSimulation(targetChatId)) {
      console.info(`ℹ️ [SIMULACIÓN TELEGRAM -> ${targetChatId || 'DESCONOCIDO'}]: ${text.slice(0, 80)}...`);
      return {
        simulated: true,
        chatId: targetChatId,
        text,
        reply_markup: options.reply_markup,
      };
    }

    const url = `${this.baseUrl}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
      chat_id: targetChatId,
      text,
      parse_mode: options.parse_mode || 'Markdown',
    };

    if (options.reply_markup) {
      payload.reply_markup = options.reply_markup;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`Error en Telegram API (${response.status}): ${JSON.stringify(errData)}`);
    }

    return await response.json();
  }

  /**
   * Envía una tarjeta enriquecida de señal de trading con botones táctiles inline.
   * @param {string|number} [chatId] - ID de chat destino
   * @param {object} signal - Objeto de señal cuantitativa validado
   */
  async sendSignalAlert(chatId, signal) {
    const targetChatId = chatId || env.TELEGRAM_CHAT_ID;
    const actionEmoji = signal.action === 'BUY'
      ? '🟢 COMPRA (BUY)'
      : (signal.action === 'SELL' ? '🔴 VENTA (SELL)' : '🟡 HOLD');

    const messageText = [
      `🎯 *INVEST AI — ALERTA DE OPORTUNIDAD*`,
      ``,
      `• *Activo:* ${signal.symbol}`,
      `• *Acción:* ${actionEmoji}`,
      `• *Precio Entrada:* $${signal.entryPrice.toFixed(2)}`,
      `• *Target (Meta):*  $${signal.targetPrice.toFixed(2)} (${signal.expectedReturnPercent >= 0 ? '+' : ''}${signal.expectedReturnPercent.toFixed(2)}%)`,
      `• *Stop Loss:*      $${signal.stopLoss.toFixed(2)}`,
      `• *Ratio R/B:*      ${signal.riskRewardRatio.toFixed(2)} : 1`,
      `• *Horizonte:*      ${signal.timeHorizonDays} días hábiles`,
      `• *Confianza:*      ${signal.confidence}%`,
      ``,
      `💡 *Explicabilidad IA:*`,
      `${signal.rationale}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `👇 *Toca un botón táctil para autorizar o descartar:*`,
    ].join('\n');

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ APROBAR ORDEN', callback_data: `approve_${signal.symbol}_${Date.now()}` },
          { text: '❌ RECHAZAR', callback_data: `reject_${signal.symbol}_${Date.now()}` },
        ],
      ],
    };

    return await this.sendMessage(targetChatId, messageText, {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    });
  }

  /**
   * Confirma a los servidores de Telegram la recepción del clic en un botón callback.
   * @param {string} callbackQueryId - ID de la consulta del callback
   * @param {string} text - Notificación breve tipo toast para el usuario
   * @param {object} [options={}] - Opciones adicionales (showAlert)
   */
  async answerCallbackQuery(callbackQueryId, text, options = {}) {
    if (
      !env.TELEGRAM_BOT_TOKEN ||
      env.NODE_ENV === 'test' ||
      process.env.NODE_ENV === 'test' ||
      String(callbackQueryId).startsWith('cq_test_') ||
      String(callbackQueryId) === 'cq_12345'
    ) {
      console.info(`ℹ️ [SIMULACIÓN TELEGRAM CALLBACK_QUERY -> ${callbackQueryId}]: ${text}`);
      return { simulated: true, callbackQueryId, text };
    }

    const url = `${this.baseUrl}/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
    const payload = {
      callback_query_id: callbackQueryId,
      text,
      show_alert: options.showAlert || false,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.warn(`⚠️ [TELEGRAM] Callback query no pudo responderse: ${errData.description || response.statusText}`);
      return { ok: false, error: errData };
    }

    return await response.json();
  }

  /**
   * Envía un resumen ejecutivo del portafolio y telemetría a Telegram.
   * @param {string|number} [chatId] - ID de chat destino
   * @param {object} report - Objeto de reporte generado por ReportingService
   * @param {object} [gcsMeta] - Metadatos opcionales de archivado en GCS
   */
  async sendPortfolioReport(chatId, report, gcsMeta = null) {
    const targetChatId = chatId || env.TELEGRAM_CHAT_ID;
    const { capital, metrics, openPositions } = report;

    const gcsRef = gcsMeta && gcsMeta.publicOrGcsUri ? gcsMeta.publicOrGcsUri : `gs://${env.GCS_BUCKET_NAME || 'invest_ia'}/reports/report_${report.date}.json`;

    const messageLines = [
      `📊 *INVEST AI — RESUMEN EJECUTIVO DE RENDIMIENTO*`,
      `📅 *Fecha:* ${report.date} | *ID:* \`${report.reportId}\``,
      ``,
      `💰 *Pool de Capital (Cero Re-Fondeo):*`,
      `• Total Autorizado: *$${capital.totalCapital.toFixed(2)} ${capital.currency}*`,
      `• Disponible Libre: *$${capital.availableCash.toFixed(2)} ${capital.currency}*`,
      `• En Mercado: *$${capital.deployedCapital.toFixed(2)} ${capital.currency}*`,
      `• Estado: ${capital.canTrade ? '🟢 Habilitado' : '🔴 Rotando'}`,
      ``,
      `📈 *Rendimiento Cuantitativo:*`,
      `• P&L Realizado: *${metrics.realizedPnLTotal >= 0 ? '+' : ''}$${metrics.realizedPnLTotal.toFixed(2)}*`,
      `• P&L Flotante: *${metrics.unrealizedPnLTotal >= 0 ? '+' : ''}$${metrics.unrealizedPnLTotal.toFixed(2)} (${metrics.unrealizedPnLPercent >= 0 ? '+' : ''}${metrics.unrealizedPnLPercent}%)*`,
      `• Win Rate: *${metrics.winRatePercent}%* (${metrics.winningTradesCount}/${metrics.totalClosedTrades} cerradas)`,
      `• Profit Factor: *${metrics.profitFactor === 999.99 ? '∞' : metrics.profitFactor.toFixed(2)}*`,
      ``,
      `💼 *Posiciones Abiertas:* ${openPositions.count}`,
      `🗄️ *Archivado Inmutable:* \`${gcsRef}\``,
    ];

    return await this.sendMessage(targetChatId, messageLines.join('\n'), {
      parse_mode: 'Markdown',
    });
  }
}

export const telegramService = new TelegramService();
