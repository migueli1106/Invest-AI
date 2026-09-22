import { env } from '../config/environment.js';

/**
 * 📱 [INVEST AI] Adaptador Oficial de Meta Cloud API (WhatsApp Business)
 * Despacha mensajes interactivos con botones de aprobación y confirmaciones.
 */

class WhatsAppService {
  constructor() {
    this.apiVersion = 'v20.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Obtiene la cabecera de autenticación Bearer para Meta.
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${env.META_WHATSAPP_TOKEN || ''}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Envía un mensaje interactivo con botones de aprobación a un número de WhatsApp.
   * @param {string} to - Número de teléfono en formato internacional (ej. '573001234567')
   * @param {object} signal - Objeto de señal cuantitativa validado
   */
  async sendSignalInteractiveCard(to, signal) {
    if (!env.META_WHATSAPP_TOKEN || !env.META_WHATSAPP_PHONE_NUMBER_ID) {
      console.warn('⚠️ [WHATSAPP] META_WHATSAPP_TOKEN o PHONE_NUMBER_ID no configurados. Mostrando payload simulado:');
      console.info(`[SIMULACIÓN WA -> ${to}]: Señal ${signal.action} para ${signal.symbol} a $${signal.entryPrice}`);
      return { simulated: true, signalId: signal.symbol };
    }

    const cleanTo = to.replace(/[^0-9]/g, '');
    const url = `${this.baseUrl}/${env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const bodyText = [
      `🎯 *INVEST AI — ALERTA DE OPORTUNIDAD*`,
      ``,
      `• *Activo:* ${signal.symbol}`,
      `• *Acción:* ${signal.action === 'BUY' ? '🟢 COMPRA (BUY)' : (signal.action === 'SELL' ? '🔴 VENTA (SELL)' : '🟡 HOLD')}`,
      `• *Precio Entrada:* $${signal.entryPrice.toFixed(2)}`,
      `• *Target Price:* $${signal.targetPrice.toFixed(2)} (${signal.expectedReturnPercent >= 0 ? '+' : ''}${signal.expectedReturnPercent.toFixed(2)}%)`,
      `• *Stop Loss:* $${signal.stopLoss.toFixed(2)}`,
      `• *Ratio R/B:* ${signal.riskRewardRatio.toFixed(2)} : 1`,
      `• *Horizonte:* ${signal.timeHorizonDays} días hábiles`,
      `• *Confianza:* ${signal.confidence}%`,
      ``,
      `💡 *Explicabilidad:*`,
      `${signal.rationale}`,
    ].join('\n');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        footer: { text: 'Invest AI — Human-in-the-Loop Gateway' },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: `approve_${signal.symbol}_${Date.now()}`,
                title: '✅ APROBAR',
              },
            },
            {
              type: 'reply',
              reply: {
                id: `reject_${signal.symbol}_${Date.now()}`,
                title: '❌ RECHAZAR',
              },
            },
          ],
        },
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Error en Meta Cloud API (${response.status}): ${JSON.stringify(errorData)}`);
    }

    return await response.json();
  }

  /**
   * Envía un mensaje de texto simple (confirmación o aviso).
   * @param {string} to - Número destino
   * @param {string} messageText - Contenido del mensaje
   */
  async sendTextMessage(to, messageText) {
    if (!env.META_WHATSAPP_TOKEN || !env.META_WHATSAPP_PHONE_NUMBER_ID) {
      console.warn(`[SIMULACIÓN WA -> ${to}]: ${messageText}`);
      return { simulated: true };
    }

    const cleanTo = to.replace(/[^0-9]/g, '');
    const url = `${this.baseUrl}/${env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'text',
      text: { body: messageText },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Error en Meta Cloud API (${response.status}): ${JSON.stringify(errorData)}`);
    }

    return await response.json();
  }
}

export const whatsappService = new WhatsAppService();
