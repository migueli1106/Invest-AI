import { env } from '../config/environment.js';
import { getSignalsCollection } from '../db/firestore.js';
import { whatsappService } from '../services/whatsappService.js';

/**
 * 📥 [INVEST AI] Controlador de Webhook de Meta Cloud API
 * Maneja el apretón de manos (handshake) y procesa los clics de botones interactivos.
 */

class WebhookHandler {
  /**
   * Valida el token de verificación con Meta (GET /webhook).
   * @param {URLSearchParams} queryParams - Parámetros de la URL
   * @returns {{ status: number, body: string }}
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
   * Procesa las respuestas interactivas de botones desde WhatsApp (POST /webhook).
   * @param {object} payload - Cuerpo JSON enviado por Meta
   * @param {object} [options={ updateDb: true }] - Opciones de ejecución (desactivable en tests)
   * @returns {Promise<{ status: number, result: object }>}
   */
  async handleIncomingEvent(payload, options = { updateDb: true }) {
    try {
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) {
        return { status: 200, result: { ignored: true } };
      }

      const from = message.from;

      // 1. Detección de clics en botones interactivos
      if (message.type === 'interactive' && message.interactive?.button_reply) {
        const buttonId = message.interactive.button_reply.id;
        const buttonTitle = message.interactive.button_reply.title;

        console.info(`📬 [WHATSAPP CLICK] De ${from}: Botón presionado '${buttonTitle}' (ID: ${buttonId})`);

        if (buttonId.startsWith('approve_')) {
          const parts = buttonId.split('_');
          const symbol = parts[1] || 'ACTIVO';

          // Actualizar estado en Firestore si updateDb está habilitado
          if (options.updateDb) {
            try {
              const querySnapshot = await getSignalsCollection()
                .where('symbol', '==', symbol)
                .where('status', '==', 'PENDING_APPROVAL')
                .limit(1)
                .get();

              if (!querySnapshot.empty) {
                const doc = querySnapshot.docs[0];
                await doc.ref.update({
                  status: 'APPROVED',
                  approvedAt: new Date().toISOString(),
                  approvedBy: from,
                });
                console.info(`💾 [FIRESTORE] Señal ${doc.id} para ${symbol} marcada como APPROVED.`);
              }
            } catch (dbErr) {
              console.warn(`⚠️ [FIRESTORE] No se pudo actualizar estado en BD: ${dbErr.message}`);
            }
          }

          // Respuesta instantánea al WhatsApp de Miguel
          await whatsappService.sendTextMessage(
            from,
            `✅ *¡OPERACIÓN APROBADA!* \n\nHas autorizado la compra de *${symbol}*. \n\n📱 *Paso siguiente:* Abre Happi para colocar la orden al precio sugerido. \n\n_Invest AI ha registrado tu autorización._`
          );

          return { status: 200, result: { action: 'APPROVED', symbol } };

        } else if (buttonId.startsWith('reject_')) {
          const parts = buttonId.split('_');
          const symbol = parts[1] || 'ACTIVO';

          await whatsappService.sendTextMessage(
            from,
            `❌ *OPERACIÓN RECHAZADA*\n\nLa señal para *${symbol}* ha sido descartada. El capital permanece protegido.`
          );

          return { status: 200, result: { action: 'REJECTED', symbol } };
        }
      }

      // Respuesta a mensajes de texto regulares
      if (message.type === 'text') {
        const text = message.text?.body?.toLowerCase();
        if (text?.includes('estado') || text?.includes('status')) {
          await whatsappService.sendTextMessage(
            from,
            `🤖 *Invest AI Bot:* El motor cuantitativo está activo y monitoreando Wall Street en Cloud Run.`
          );
        }
      }

      return { status: 200, result: { received: true } };

    } catch (err) {
      console.error(`❌ [WEBHOOK] Error procesando mensaje de WhatsApp: ${err.message}`);
      return { status: 200, result: { error: err.message } };
    }
  }
}

export const webhookHandler = new WebhookHandler();
