import { env } from '../config/environment.js';
import { getSignalsCollection } from '../db/firestore.js';
import { whatsappService } from '../services/whatsappService.js';
import { twilioService } from '../services/twilioService.js';
import { telegramService } from '../services/telegramService.js';

/**
 * 📥 [INVEST AI] Controlador Unificado de Webhooks para WhatsApp
 * Soporta tanto Meta Cloud API como Twilio WhatsApp Sandbox para Human-in-the-Loop.
 */

class WebhookHandler {
  /**
   * Valida el token de verificación con Meta (GET /webhook).
   * @param {URLSearchParams} queryParams
   */
  handleVerification(queryParams) {
    const mode = queryParams.get('hub.mode');
    const token = queryParams.get('hub.verify_token');
    const challenge = queryParams.get('hub.challenge');

    const expectedToken = env.META_WHATSAPP_VERIFY_TOKEN || 'invest_ai_secret_token';

    if (mode === 'subscribe' && token === expectedToken) {
      console.info('✅ [WEBHOOK] Handshake con Meta verificado exitosamente.');
      return { status: 200, body: challenge };
    }

    console.warn('❌ [WEBHOOK] Intento de verificación fallido con token inválido.');
    return { status: 403, body: 'Forbidden' };
  }

  /**
   * Procesa respuestas de Meta Cloud API (POST /webhook).
   * @param {object} payload
   * @param {object} [options={ updateDb: true }]
   */
  async handleIncomingEvent(payload, options = { updateDb: true }) {
    try {
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) return { status: 200, result: { ignored: true } };

      const from = message.from;

      if (message.type === 'interactive' && message.interactive?.button_reply) {
        const buttonId = message.interactive.button_reply.id;
        const buttonTitle = message.interactive.button_reply.title;

        console.info(`📬 [WHATSAPP CLICK] De ${from}: Botón presionado '${buttonTitle}' (ID: ${buttonId})`);

        if (buttonId.startsWith('approve_')) {
          const symbol = buttonId.split('_')[1] || 'ACTIVO';
          if (options.updateDb) await this.updateSignalStatus(symbol, 'APPROVED', from);
          await whatsappService.sendTextMessage(from, `✅ *¡OPERACIÓN APROBADA!* \n\nHas autorizado la compra de *${symbol}*. \n\n📱 *Paso siguiente:* Abre Happi para colocar la orden al precio sugerido.`);
          return { status: 200, result: { action: 'APPROVED', symbol } };
        } else if (buttonId.startsWith('reject_')) {
          const symbol = buttonId.split('_')[1] || 'ACTIVO';
          if (options.updateDb) await this.updateSignalStatus(symbol, 'REJECTED', from);
          await whatsappService.sendTextMessage(from, `❌ *OPERACIÓN RECHAZADA*\n\nLa señal para *${symbol}* ha sido descartada. El capital permanece protegido.`);
          return { status: 200, result: { action: 'REJECTED', symbol } };
        }
      }

      return { status: 200, result: { received: true } };
    } catch (err) {
      console.error(`❌ [WEBHOOK] Error procesando Meta: ${err.message}`);
      return { status: 200, result: { error: err.message } };
    }
  }

  /**
   * Procesa mensajes y respuestas entrantes de Twilio WhatsApp (POST /webhook/twilio).
   * @param {URLSearchParams} formParams - Parámetros form-urlencoded de Twilio
   * @param {object} [options={ updateDb: true }]
   */
  async handleTwilioIncoming(formParams, options = { updateDb: true }) {
    try {
      const from = formParams.get('From') || '';
      const body = (formParams.get('Body') || '').trim();
      const upperBody = body.toUpperCase();

      console.info(`📬 [TWILIO WHATSAPP] Mensaje recibido de ${from}: "${body}"`);

      if (upperBody === 'APROBAR' || upperBody === 'SI' || upperBody === 'SÍ' || upperBody.startsWith('APROBAR')) {
        let symbol = 'ACTIVO';
        if (upperBody.includes(' ')) {
          symbol = upperBody.split(' ')[1];
        }

        if (options.updateDb) {
          await this.updateSignalStatus(symbol, 'APPROVED', from);
        }

        const replyText = `✅ *¡OPERACIÓN APROBADA!* \n\nHas autorizado la compra. \n\n📱 *Paso siguiente:* Abre tu broker (Happi) y ejecuta la orden al precio sugerido. \n\n_Invest AI ha registrado tu autorización._`;
        await twilioService.sendTextMessage(from, replyText);

        return {
          status: 200,
          result: { action: 'APPROVED', from, symbol },
          twiml: `<Response><Message>${replyText}</Message></Response>`,
        };

      } else if (upperBody === 'RECHAZAR' || upperBody === 'NO' || upperBody.startsWith('RECHAZAR')) {
        let symbol = 'ACTIVO';
        if (upperBody.includes(' ')) {
          symbol = upperBody.split(' ')[1];
        }

        if (options.updateDb) {
          await this.updateSignalStatus(symbol, 'REJECTED', from);
        }

        const replyText = `❌ *OPERACIÓN RECHAZADA*\n\nLa señal de inversión ha sido descartada. Tu capital permanece 100% protegido.`;
        await twilioService.sendTextMessage(from, replyText);

        return {
          status: 200,
          result: { action: 'REJECTED', from, symbol },
          twiml: `<Response><Message>${replyText}</Message></Response>`,
        };

      } else if (upperBody.includes('ESTADO') || upperBody.includes('STATUS')) {
        const replyText = `🤖 *Invest AI Status:*\nEl motor cuantitativo está activo y monitoreando Wall Street en Google Cloud Run.`;
        await twilioService.sendTextMessage(from, replyText);
        return {
          status: 200,
          result: { action: 'STATUS', from },
          twiml: `<Response><Message>${replyText}</Message></Response>`,
        };
      }

      return {
        status: 200,
        result: { action: 'UNKNOWN', body },
        twiml: `<Response></Response>`,
      };

    } catch (err) {
      console.error(`❌ [TWILIO WEBHOOK] Error: ${err.message}`);
      return { status: 200, result: { error: err.message }, twiml: '<Response></Response>' };
    }
  }

  /**
   * Procesa eventos y actualizaciones entrantes de Telegram Bot API (POST /webhook/telegram).
   * Soporta botones inline táctiles (callback_query) y comandos de texto (/start, /status, /estado).
   * @param {object} update - Objeto Update de Telegram
   * @param {object} [options={ updateDb: true }] - Opciones operativas
   */
  async handleTelegramUpdate(update, options = { updateDb: true }) {
    try {
      // 1. Manejo de botones táctiles inline (Callback Query)
      if (update?.callback_query) {
        const cq = update.callback_query;
        const from = cq.from;
        const data = cq.data || '';
        const callbackQueryId = cq.id;
        const chatId = cq.message?.chat?.id;

        console.info(`📬 [TELEGRAM CLICK] De ${from?.first_name || from?.id}: Botón presionado '${data}' (ID: ${callbackQueryId})`);

        if (data.startsWith('approve_')) {
          const symbol = data.split('_')[1] || 'ACTIVO';
          await telegramService.answerCallbackQuery(callbackQueryId, '¡Operación autorizada!').catch(() => {});
          if (options.updateDb) {
            await this.updateSignalStatus(symbol, 'APPROVED', String(from?.id || 'telegram_user'));
          }
          if (chatId) {
            await telegramService.sendMessage(
              chatId,
              `✅ *¡OPERACIÓN APROBADA!*\n\nHas autorizado la compra de *${symbol}*.\n\n📱 *Paso siguiente:* Abre Happi para colocar la orden al precio sugerido.`
            );
          }
          return { status: 200, result: { action: 'APPROVED', symbol } };

        } else if (data.startsWith('reject_')) {
          const symbol = data.split('_')[1] || 'ACTIVO';
          await telegramService.answerCallbackQuery(callbackQueryId, 'Operación descartada').catch(() => {});
          if (options.updateDb) {
            await this.updateSignalStatus(symbol, 'REJECTED', String(from?.id || 'telegram_user'));
          }
          if (chatId) {
            await telegramService.sendMessage(
              chatId,
              `❌ *OPERACIÓN RECHAZADA*\n\nLa señal para *${symbol}* ha sido descartada. Tu capital permanece protegido.`
            );
          }
          return { status: 200, result: { action: 'REJECTED', symbol } };
        }
      }

      // 2. Manejo de comandos y mensajes de texto
      if (update?.message?.text) {
        const msg = update.message;
        const text = msg.text.trim();
        const chatId = msg.chat?.id;

        console.info(`📬 [TELEGRAM MENSAJE] De ${chatId}: "${text}"`);

        if (text.startsWith('/status') || text.startsWith('/estado')) {
          const statusText = `🤖 *Invest AI Status:*\nEl motor cuantitativo está activo y monitoreando Wall Street en Google Cloud Run.`;
          if (chatId) await telegramService.sendMessage(chatId, statusText);
          return { status: 200, result: { action: 'STATUS', chatId } };

        } else if (text.startsWith('/start')) {
          const welcomeText = `👋 *¡Bienvenido a Invest AI Bot!*\n\nTu canal seguro para recibir señales de inversión y autorizarlas con 1-clic.\n\n🆔 *Tu Chat ID es:* \`${chatId}\`\n\n_Copia este ID en tu variable TELEGRAM_CHAT_ID para recibir alertas personalizadas._`;
          if (chatId) await telegramService.sendMessage(chatId, welcomeText);
          return { status: 200, result: { action: 'START', chatId } };
        }
      }

      return { status: 200, result: { received: true } };

    } catch (err) {
      console.error(`❌ [TELEGRAM WEBHOOK] Error: ${err.message}`);
      return { status: 200, result: { error: err.message } };
    }
  }

  /**
   * Actualiza el estado de la señal en Firestore de forma segura.
   */
  async updateSignalStatus(symbol, status, userPhone) {
    try {
      let query = getSignalsCollection().where('status', '==', 'PENDING_APPROVAL');
      if (symbol && symbol !== 'ACTIVO') {
        query = query.where('symbol', '==', symbol);
      }
      const snapshot = await query.limit(1).get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        await doc.ref.update({
          status,
          resolvedAt: new Date().toISOString(),
          resolvedBy: userPhone,
        });
        console.info(`💾 [FIRESTORE] Señal ${doc.id} actualizada a estado: ${status}`);
      }
    } catch (dbErr) {
      console.warn(`⚠️ [FIRESTORE] No se pudo actualizar estado: ${dbErr.message}`);
    }
  }
}

export const webhookHandler = new WebhookHandler();
