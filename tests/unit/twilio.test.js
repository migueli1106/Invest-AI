import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { twilioService } from '../../src/services/twilioService.js';
import { webhookHandler } from '../../src/api/webhookHandler.js';

describe('📱 Suite de Pruebas Unitarias: Twilio WhatsApp API & Webhook', () => {
  it('twilioService debe operar en modo simulación seguro cuando no hay credenciales', async () => {
    const mockSignal = {
      symbol: 'NVDA',
      action: 'BUY',
      entryPrice: 228.87,
      targetPrice: 251.75,
      stopLoss: 217.43,
      timeHorizonDays: 5,
      confidence: 95,
      expectedReturnPercent: 10.0,
      riskRewardRatio: 2.0,
      rationale: 'Cruce alcista EMA20 > EMA50, RSI en 59.5.',
      status: 'PENDING_APPROVAL',
      createdAt: new Date().toISOString(),
    };

    const result = await twilioService.sendSignalAlert('+573001234567', mockSignal);
    assert.ok(result.simulated, 'Debe indicar modo simulación sin errores de red');
    assert.equal(result.symbol, 'NVDA');
  });

  it('twilioService.sendTextMessage debe retornar simulación en ausencia de credenciales', async () => {
    const result = await twilioService.sendTextMessage('+573001234567', 'Mensaje de prueba');
    assert.ok(result.simulated);
  });

  it('handleTwilioIncoming debe procesar respuesta APROBAR y retornar TwiML de confirmación', async () => {
    const params = new URLSearchParams({
      From: 'whatsapp:+573001234567',
      Body: 'APROBAR NVDA',
      MessageSid: 'SM1234567890abcdef',
    });

    const response = await webhookHandler.handleTwilioIncoming(params, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'APPROVED');
    assert.equal(response.result.symbol, 'NVDA');
    assert.ok(response.twiml.includes('<Response><Message>'));
    assert.ok(response.twiml.includes('OPERACIÓN APROBADA'));
  });

  it('handleTwilioIncoming debe procesar respuesta RECHAZAR y retornar TwiML de cancelación', async () => {
    const params = new URLSearchParams({
      From: 'whatsapp:+573001234567',
      Body: 'RECHAZAR',
      MessageSid: 'SM9876543210fedcba',
    });

    const response = await webhookHandler.handleTwilioIncoming(params, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'REJECTED');
    assert.ok(response.twiml.includes('OPERACIÓN RECHAZADA'));
  });

  it('handleTwilioIncoming debe responder al comando STATUS', async () => {
    const params = new URLSearchParams({
      From: 'whatsapp:+573001234567',
      Body: 'estado',
    });

    const response = await webhookHandler.handleTwilioIncoming(params, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'STATUS');
    assert.ok(response.twiml.includes('Invest AI Status'));
  });
});
