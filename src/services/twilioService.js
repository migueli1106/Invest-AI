import { env } from '../config/environment.js';

/**
 * 📱 [INVEST AI] Adaptador de Twilio WhatsApp API
 * Envía alertas de trading interactivas y notificaciones al móvil de Miguel.
 */

class TwilioService {
  constructor() {
    this.baseUrl = 'https://api.twilio.com/2010-04-01';
  }

  /**
   * Genera el encabezado de autenticación HTTP Basic para la API de Twilio.
   */
  getAuthHeader() {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null;
    const credentials = `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Envía una alerta de trading interactiva a WhatsApp a través de Twilio.
   * @param {string} to - Número de teléfono en formato E.164 (ej. '+573001234567')
   * @param {object} signal - Objeto de señal cuantitativa validado
   */
  async sendSignalAlert(to, signal) {
    const authHeader = this.getAuthHeader();

    if (!authHeader || !env.TWILIO_ACCOUNT_SID) {
      console.warn('⚠️ [TWILIO] TWILIO_ACCOUNT_SID o AUTH_TOKEN no configurados. Mostrando en modo simulación:');
      console.info(`[SIMULACIÓN TWILIO WA -> ${to}]: Señal ${signal.action} para ${signal.symbol} a $${signal.entryPrice}`);
      return { simulated: true, symbol: signal.symbol };
    }

    const cleanTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to.trim()}`;
    const from = env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

    const messageBody = [
      `🎯 *INVEST AI — ALERTA DE OPORTUNIDAD*`,
      ``,
      `• *Activo:* ${signal.symbol}`,
      `• *Acción:* ${signal.action === 'BUY' ? '🟢 COMPRA (BUY)' : (signal.action === 'SELL' ? '🔴 VENTA (SELL)' : '🟡 HOLD')}`,
      `• *Precio Entrada:* $${signal.entryPrice.toFixed(2)}`,
      `• *Target (Meta):*  $${signal.targetPrice.toFixed(2)} (${signal.expectedReturnPercent >= 0 ? '+' : ''}${signal.expectedReturnPercent.toFixed(2)}%)`,
      `• *Stop Loss:*      $${signal.stopLoss.toFixed(2)}`,
      `• *Ratio R/B:*      ${signal.riskRewardRatio.toFixed(2)} : 1`,
      `• *Horizonte:*      ${signal.timeHorizonDays} días hábiles`,
      `• *Confianza:*      ${signal.confidence}%`,
      ``,
      `💡 *Explicabilidad:*`,
      `${signal.rationale}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━`,
      `👉 *Responde "APROBAR" para autorizar la compra o "RECHAZAR" para descartar.*`,
    ].join('\n');

    const params = new URLSearchParams();
    params.append('To', cleanTo);
    params.append('From', from);
    params.append('Body', messageBody);

    const url = `${this.baseUrl}/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(`Error en Twilio API (${response.status}): ${JSON.stringify(errData)}`);
    }

    return await response.json();
  }

  /**
   * Envía un mensaje de texto simple de confirmación por Twilio WhatsApp.
   * @param {string} to - Destino
   * @param {string} messageText - Contenido
   */
  async sendTextMessage(to, messageText) {
    const authHeader = this.getAuthHeader();

    if (!authHeader || !env.TWILIO_ACCOUNT_SID) {
      console.warn(`[SIMULACIÓN TWILIO WA -> ${to}]: ${messageText}`);
      return { simulated: true };
    }

    const cleanTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to.trim()}`;
    const from = env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

    const params = new URLSearchParams();
    params.append('To', cleanTo);
    params.append('From', from);
    params.append('Body', messageText);

    const url = `${this.baseUrl}/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(`Error en Twilio API (${response.status}): ${JSON.stringify(errData)}`);
    }

    return await response.json();
  }
}

export const twilioService = new TwilioService();
