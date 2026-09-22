import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { webhookHandler } from '../../src/api/webhookHandler.js';
import { whatsappService } from '../../src/services/whatsappService.js';

describe('📱 Suite de Pruebas Unitarias: Meta Cloud API & Webhook de WhatsApp', () => {
  it('Debe validar exitosamente el handshake de verificación de Meta (GET /webhook)', () => {
    const validParams = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'invest_ai_secret_token',
      'hub.challenge': 'CHALLENGE_ACCEPTED_123',
    });

    const result = webhookHandler.handleVerification(validParams);
    assert.equal(result.status, 200);
    assert.equal(result.body, 'CHALLENGE_ACCEPTED_123');
  });

  it('Debe rechazar con 403 cualquier intento de verificación con token incorrecto', () => {
    const invalidParams = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'TOKEN_MALICIOSO',
      'hub.challenge': 'NOPE',
    });

    const result = webhookHandler.handleVerification(invalidParams);
    assert.equal(result.status, 403);
    assert.equal(result.body, 'Forbidden');
  });

  it('Debe procesar el clic del botón APROBAR y retornar acción APPROVED', async () => {
    const approvePayload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '573001234567',
                    type: 'interactive',
                    interactive: {
                      button_reply: {
                        id: 'approve_NVDA_1727000000',
                        title: '✅ APROBAR',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const response = await webhookHandler.handleIncomingEvent(approvePayload, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'APPROVED');
    assert.equal(response.result.symbol, 'NVDA');
  });

  it('Debe procesar el clic del botón RECHAZAR y retornar acción REJECTED', async () => {
    const rejectPayload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '573001234567',
                    type: 'interactive',
                    interactive: {
                      button_reply: {
                        id: 'reject_AAPL_1727000000',
                        title: '❌ RECHAZAR',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const response = await webhookHandler.handleIncomingEvent(rejectPayload, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'REJECTED');
    assert.equal(response.result.symbol, 'AAPL');
  });

  it('whatsappService debe operar en modo simulación seguro cuando no hay token', async () => {
    const mockSignal = {
      symbol: 'MSFT',
      action: 'BUY',
      entryPrice: 420.00,
      targetPrice: 455.00,
      stopLoss: 402.50,
      timeHorizonDays: 5,
      confidence: 88,
      expectedReturnPercent: 8.33,
      riskRewardRatio: 2.0,
      rationale: 'Ruptura alcista con volumen.',
      status: 'PENDING_APPROVAL',
      createdAt: new Date().toISOString(),
    };

    const result = await whatsappService.sendSignalInteractiveCard('573001234567', mockSignal);
    assert.ok(result.simulated, 'Debe indicar modo simulación sin arrojar excepciones no controladas');
    assert.equal(result.signalId, 'MSFT');
  });
});
