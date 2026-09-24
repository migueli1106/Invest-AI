import { capitalManagerService } from '../capitalManagerService.js';
import { portfolioService } from '../portfolioService.js';
import { telegramService } from '../telegramService.js';

/**
 * 📱 [INVEST AI] Servicio Co-Piloto Asistido para Happi Broker (Opción A)
 * Genera deep-links contextuales, tarjetas interactivas de Telegram y asegura
 * la ejecución multi-posición bajo el modelo Capital Flexible (FLEXIBLE_CAPITAL).
 */
class HapiCopilotService {
  constructor() {
    this.brokerName = 'Happi';
    this.baseUrl = 'https://app.hapi.trade';
  }

  /**
   * Construye el Deep-Link directo al activo en la aplicación de Happi.
   * @param {string} symbol - Ticker bursátil (ej: META, SPY)
   * @returns {string} URL formateada
   */
  buildDeepLink(symbol) {
    if (!symbol || symbol === 'ACTIVO') {
      return `${this.baseUrl}/`;
    }
    return `${this.baseUrl}/stock/${symbol.toUpperCase()}`;
  }

  /**
   * Construye la tarjeta ejecutiva enriquecida para Telegram con botón de acción directa.
   * @param {object} params
   */
  generateCopilotCard({ symbol, side = 'BUY', notional, qty, currentPrice, stopLoss, targetPrice, orderId }) {
    const sym = (symbol || 'ACTIVO').toUpperCase();
    const deepLink = this.buildDeepLink(sym);
    const actionLabel = side === 'BUY' ? '🟢 COMPRA FRACCIONADA' : '🔴 VENTA';

    const message = [
      `🚀 *¡OPERACIÓN AUTORIZADA POR MIGUEL JIMENEZ!*`,
      ``,
      `• *Activo:* ${sym} (${actionLabel})`,
      `• *Nocional Autorizado:* $${Number(notional).toFixed(2)} USD`,
      `• *Acciones Estimadas:* ${qty} acc.`,
      `• *Precio Referencia:* $${Number(currentPrice).toFixed(2)}`,
      `• *Target Take-Profit:* $${Number(targetPrice).toFixed(2)}`,
      `• *Stop-Loss Protección:* $${Number(stopLoss).toFixed(2)}`,
      `• *Broker:* ${this.brokerName} (Co-Piloto Asistido)`,
      `• *Order Reference:* \`${orderId}\``,
      ``,
      `📱 Pulsa el botón abajo para confirmar en Happi:`,
      `_Ejecución soberana bajo protocolo FLEXIBLE_CAPITAL._`,
    ].join('\n');

    const inlineKeyboard = [
      [
        { text: '📱 Abrir en Happi', url: deepLink }
      ]
    ];

    return {
      message,
      inlineKeyboard,
      deepLink,
    };
  }

  /**
   * Ejecuta la orden en modo Co-Piloto Asistido:
   * 1. Reserva el capital en el pool ($35 USD).
   * 2. Registra la posición en el portafolio institucional.
   * 3. Despacha la tarjeta interactiva con Deep-Link a Telegram.
   * @param {object} orderData
   */
  async executeOrder({ symbol, qty, notional, currentPrice, stopLoss, targetPrice, side = 'BUY', chatId = null }) {
    const sym = (symbol || 'ACTIVO').toUpperCase();
    const orderId = `hapi_${sym.toLowerCase()}_${Date.now()}`;

    // 1. Reserva preventiva de capital ($35 USD máximo)
    capitalManagerService.reserveCapital(orderId, notional);

    // 2. Registro de posición en portafolio
    let position = null;
    try {
      position = await portfolioService.addPosition({
        symbol: sym,
        shares: qty,
        buyPrice: currentPrice,
        broker: this.brokerName,
        stopLoss,
        targetPrice,
      });
    } catch (err) {
      console.warn(`⚠️ [HAPI COPILOT] Registro secundario en Firestore: ${err.message}`);
    }

    // 3. Generación de tarjeta interactiva con Deep-Link
    const card = this.generateCopilotCard({
      symbol: sym,
      side,
      notional,
      qty,
      currentPrice,
      stopLoss,
      targetPrice,
      orderId,
    });

    // 4. Notificación a Telegram con Inline Keyboard si hay chatId provisto
    let telegramDispatch = null;
    if (chatId) {
      telegramDispatch = await telegramService.sendMessage(chatId, card.message, {
        reply_markup: { inline_keyboard: card.inlineKeyboard },
      }).catch((e) => ({ error: e.message }));
    }

    return {
      success: true,
      mode: 'COPILOT',
      broker: this.brokerName,
      orderId,
      symbol: sym,
      notional,
      qty,
      currentPrice,
      stopLoss,
      targetPrice,
      deepLink: card.deepLink,
      position,
      card,
      telegramDispatch,
    };
  }
}

export const hapiCopilotService = new HapiCopilotService();
