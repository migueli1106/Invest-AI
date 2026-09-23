import { env } from '../config/environment.js';
import { getSignalsCollection } from '../db/firestore.js';
import { whatsappService } from '../services/whatsappService.js';
import { twilioService } from '../services/twilioService.js';
import { telegramService } from '../services/telegramService.js';
import { alpacaService } from '../services/alpacaService.js';
import { capitalManagerService } from '../services/capitalManagerService.js';
import { portfolioService } from '../services/portfolioService.js';

/**
 * 📥 [INVEST AI] Controlador Unificado de Webhooks para Mensajería & Trading
 * Soporta Meta, Twilio y Telegram con Human-in-the-Loop, Alpaca y Cero Re-Fondeo.
 */

class WebhookHandler {
  handleVerification(queryParams) {
    const mode = queryParams.get('hub.mode');
    const token = queryParams.get('hub.verify_token');
    const challenge = queryParams.get('hub.challenge');
    const expected = env.META_WHATSAPP_VERIFY_TOKEN || 'invest_ai_secret_token';

    if (mode === 'subscribe' && token === expected) {
      console.info('✅ [WEBHOOK] Handshake con Meta verificado.');
      return { status: 200, body: challenge };
    }
    return { status: 403, body: 'Forbidden' };
  }

  async handleIncomingEvent(payload, options = { updateDb: true }) {
    try {
      const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return { status: 200, result: { ignored: true } };

      const from = message.from;
      if (message.type === 'interactive' && message.interactive?.button_reply) {
        const buttonId = message.interactive.button_reply.id;
        const symbol = buttonId.split('_')[1] || 'ACTIVO';

        if (buttonId.startsWith('approve_')) {
          if (options.updateDb) await this.updateSignalStatus(symbol, 'APPROVED', from);
          await whatsappService.sendTextMessage(from, `✅ *¡OPERACIÓN APROBADA!* \n\nHas autorizado la compra de *${symbol}*. \n📱 Abre Happi/Alpaca para colocar la orden.`);
          return { status: 200, result: { action: 'APPROVED', symbol } };
        } else if (buttonId.startsWith('reject_')) {
          if (options.updateDb) await this.updateSignalStatus(symbol, 'REJECTED', from);
          await whatsappService.sendTextMessage(from, `❌ *OPERACIÓN RECHAZADA*\n\nLa señal para *${symbol}* ha sido descartada.`);
          return { status: 200, result: { action: 'REJECTED', symbol } };
        }
      }
      return { status: 200, result: { received: true } };
    } catch (err) {
      return { status: 200, result: { error: err.message } };
    }
  }

  async handleTwilioIncoming(formParams, options = { updateDb: true }) {
    try {
      const from = formParams.get('From') || '';
      const body = (formParams.get('Body') || '').trim();
      const upper = body.toUpperCase();

      if (upper === 'APROBAR' || upper.startsWith('APROBAR') || upper === 'SI' || upper === 'SÍ') {
        const symbol = upper.includes(' ') ? upper.split(' ')[1] : 'ACTIVO';
        if (options.updateDb) await this.updateSignalStatus(symbol, 'APPROVED', from);
        const text = `✅ *¡OPERACIÓN APROBADA!* \n\nHas autorizado la compra de ${symbol}. \n📱 Revisa tu broker (Happi/Alpaca).`;
        await twilioService.sendTextMessage(from, text);
        return { status: 200, result: { action: 'APPROVED', from, symbol }, twiml: `<Response><Message>${text}</Message></Response>` };
      } else if (upper === 'RECHAZAR' || upper.startsWith('RECHAZAR') || upper === 'NO') {
        const symbol = upper.includes(' ') ? upper.split(' ')[1] : 'ACTIVO';
        if (options.updateDb) await this.updateSignalStatus(symbol, 'REJECTED', from);
        const text = `❌ *OPERACIÓN RECHAZADA*\n\nLa señal de inversión para ${symbol} fue descartada.`;
        await twilioService.sendTextMessage(from, text);
        return { status: 200, result: { action: 'REJECTED', from, symbol }, twiml: `<Response><Message>${text}</Message></Response>` };
      } else if (upper.includes('ESTADO') || upper.includes('STATUS')) {
        const text = `🤖 *Invest AI Status:*\nMotor cuantitativo activo y operando en Google Cloud Run.`;
        await twilioService.sendTextMessage(from, text);
        return { status: 200, result: { action: 'STATUS', from }, twiml: `<Response><Message>${text}</Message></Response>` };
      }
      return { status: 200, result: { action: 'UNKNOWN' }, twiml: '<Response></Response>' };
    } catch (err) {
      return { status: 200, result: { error: err.message }, twiml: '<Response></Response>' };
    }
  }

  async handleTelegramUpdate(update, options = { updateDb: true }) {
    try {
      if (update?.callback_query) {
        const cq = update.callback_query;
        const from = cq.from;
        const data = cq.data || '';
        const callbackQueryId = cq.id;
        const chatId = cq.message?.chat?.id;

        console.info(`📬 [TELEGRAM CLICK] De ${from?.first_name || from?.id}: '${data}' (ID: ${callbackQueryId})`);

        if (data.startsWith('approve_')) {
          const symbol = data.split('_')[1] || 'ACTIVO';
          await telegramService.answerCallbackQuery(callbackQueryId, 'Procesando ejecución...').catch(() => {});

          const signal = await this.findSignal(symbol);
          const currentPrice = signal?.entryPrice || 100.00;
          const takeProfitPrice = signal?.targetPrice || currentPrice * 1.10;
          const stopLossPrice = signal?.stopLoss || currentPrice * 0.95;

          // Regla Cero Re-Fondeo: Dimensionamiento fraccionario con tope de $35 USD
          const sizing = capitalManagerService.calculateFractionalSizing(symbol, currentPrice, 35.00);

          if (!sizing.allowed) {
            const warnMsg = `⚠️ *¡CAPITAL 100% DESPLEGADO ($35.00 USD)!*\n\nNo es posible abrir *${symbol}* bajo la regla de CERO RE-FONDEO.\nEl capital rotará automáticamente al cerrarse una posición en Take-Profit o Stop-Loss.`;
            if (chatId) await telegramService.sendMessage(chatId, warnMsg);
            return { status: 200, result: { action: 'BLOCKED_ZERO_REFUND', symbol, reason: sizing.reason } };
          }

          // Ejecución automática en Alpaca
          const order = await alpacaService.submitBracketOrder({
            symbol,
            qty: sizing.qty,
            notional: sizing.notional,
            takeProfitPrice,
            stopLossPrice,
          });

          capitalManagerService.reserveCapital(order.id, sizing.notional);
          await portfolioService.addPosition({
            symbol,
            shares: sizing.qty,
            buyPrice: currentPrice,
            broker: 'Alpaca',
            stopLoss: stopLossPrice,
            targetPrice: takeProfitPrice,
          });

          if (options.updateDb) {
            await this.updateSignalStatus(symbol, 'EXECUTED', String(from?.id || 'telegram'), order.id);
          }

          if (chatId) {
            const confirmMsg = [
              `🚀 *¡ORDEN EJECUTADA EN ALPACA!*`,
              ``,
              `Se ha colocado la orden Bracket fraccionada para *${symbol}* (${env.BROKER_ENVIRONMENT}).`,
              `• Inversión Nocional: $${sizing.notional.toFixed(2)} USD`,
              `• Cantidad Fraccionada: ${sizing.qty} acc.`,
              `• Target Take-Profit: $${takeProfitPrice.toFixed(2)}`,
              `• Stop-Loss Protección: $${stopLossPrice.toFixed(2)}`,
              `• Order ID: \`${order.id}\``,
              ``,
              `_Tu orden ya está activa en Wall Street con salida automática._`,
            ].join('\n');
            await telegramService.sendMessage(chatId, confirmMsg);
          }

          return { status: 200, result: { action: 'APPROVED', symbol, orderId: order.id, executed: true } };

        } else if (data.startsWith('reject_')) {
          const symbol = data.split('_')[1] || 'ACTIVO';
          await telegramService.answerCallbackQuery(callbackQueryId, 'Operación descartada').catch(() => {});
          if (options.updateDb) await this.updateSignalStatus(symbol, 'REJECTED', String(from?.id || 'telegram'));
          if (chatId) await telegramService.sendMessage(chatId, `❌ *OPERACIÓN RECHAZADA*\n\nLa señal para *${symbol}* ha sido descartada.`);
          return { status: 200, result: { action: 'REJECTED', symbol } };
        }
      }

      if (update?.message?.text) {
        const text = update.message.text.trim();
        const chatId = update.message.chat?.id;

        if (text.startsWith('/status') || text.startsWith('/estado')) {
          const cap = capitalManagerService.getCapitalStatus();
          const msg = `🤖 *Invest AI Status:*\nMotor activo en Google Cloud Run.\n💰 Pool: $${cap.totalCapital} | Libre: $${cap.availableCash} | Invertido: $${cap.deployedCapital}`;
          if (chatId) await telegramService.sendMessage(chatId, msg);
          return { status: 200, result: { action: 'STATUS', chatId } };
        } else if (text.startsWith('/start')) {
          const msg = `👋 *¡Bienvenido a Invest AI Bot!*\n\nTu canal seguro para autorizar inversiones algorítmicas.\n🆔 *Chat ID:* \`${chatId}\``;
          if (chatId) await telegramService.sendMessage(chatId, msg);
          return { status: 200, result: { action: 'START', chatId } };
        }
      }

      return { status: 200, result: { received: true } };
    } catch (err) {
      console.error('❌ [WEBHOOK ERROR]:', err);
      return { status: 200, result: { error: err.message } };
    }
  }

  async findSignal(symbol) {
    if (process.env.NODE_ENV === 'test') return null;
    try {
      const snap = await getSignalsCollection().where('symbol', '==', symbol).where('status', '==', 'PENDING_APPROVAL').limit(1).get();
      if (!snap.empty) return snap.docs[0].data();
    } catch (err) {
      console.warn(`⚠️ Error leyendo señal: ${err.message}`);
    }
    return null;
  }

  async updateSignalStatus(symbol, status, userPhone, orderId = null) {
    if (process.env.NODE_ENV === 'test') return;
    try {
      let query = getSignalsCollection().where('status', '==', 'PENDING_APPROVAL');
      if (symbol && symbol !== 'ACTIVO') query = query.where('symbol', '==', symbol);
      const snap = await query.limit(1).get();

      if (!snap.empty) {
        const updateData = { status, resolvedAt: new Date().toISOString(), resolvedBy: userPhone };
        if (orderId) updateData.alpacaOrderId = orderId;
        await snap.docs[0].ref.update(updateData);
      }
    } catch (err) {
      console.warn(`⚠️ Error actualizando estado de señal: ${err.message}`);
    }
  }
}

export const webhookHandler = new WebhookHandler();
