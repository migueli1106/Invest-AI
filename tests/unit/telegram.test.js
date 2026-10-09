process.env.NODE_ENV = 'test';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { telegramService } from '../../src/services/telegramService.js';
import { webhookHandler } from '../../src/api/webhookHandler.js';

describe('✈️ Suite de Pruebas Unitarias: Telegram Bot API & Webhook', () => {
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
    rationale: 'Cruce alcista EMA20 > EMA50, RSI en zona de impulso 59.5.',
    status: 'PENDING_APPROVAL',
    createdAt: new Date().toISOString(),
  };

  it('telegramService debe operar en modo simulación seguro cuando no hay credenciales o en entorno test', async () => {
    const result = await telegramService.sendMessage('123456789', 'Mensaje de prueba');
    assert.ok(result.simulated, 'Debe indicar modo simulación sin errores de red');
    assert.equal(result.chatId, '123456789');
  });

  it('telegramService.sendSignalAlert debe estructurar el payload con botones interactivos inline_keyboard', async () => {
    const result = await telegramService.sendSignalAlert('123456789', mockSignal);
    assert.ok(result.simulated);
    assert.ok(result.reply_markup?.inline_keyboard, 'Debe incluir estructura inline_keyboard');

    const buttons = result.reply_markup.inline_keyboard[0];
    assert.equal(buttons.length, 2, 'Debe contener exactamente 2 botones de decisión');
    assert.ok(buttons[0].text.includes('APROBAR'));
    assert.ok(buttons[0].callback_data.startsWith('approve_NVDA_'));
    assert.ok(buttons[1].text.includes('RECHAZAR'));
    assert.ok(buttons[1].callback_data.startsWith('reject_NVDA_'));

    assert.ok(result.text.includes('NVDA'));
    assert.ok(result.text.includes('COMPRA (BUY)'));
    assert.ok(result.text.includes('228.87'));
    assert.ok(result.text.includes('DAY TRADING (INTRADÍA)'), 'Debe titularse ALERTA DAY TRADING (INTRADÍA)');
    assert.ok(result.text.includes('Intradía (Misma Sesión)'), 'Debe indicar horizonte Intradía');
  });

  it('telegramService.answerCallbackQuery debe retornar simulación en ausencia de token', async () => {
    const result = await telegramService.answerCallbackQuery('cq_12345', 'Operación autorizada');
    assert.ok(result.simulated);
    assert.equal(result.callbackQueryId, 'cq_12345');
    assert.equal(result.text, 'Operación autorizada');
  });

  it('handleTelegramUpdate debe procesar callback_query de aprobación (approve_NVDA)', async () => {
    const update = {
      update_id: 10001,
      callback_query: {
        id: 'cq_test_approve_1',
        from: { id: 987654321, first_name: 'Miguel' },
        message: { chat: { id: 123456789 } },
        data: 'approve_NVDA_1720000000',
      },
    };

    const response = await webhookHandler.handleTelegramUpdate(update, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'APPROVED');
    assert.equal(response.result.symbol, 'NVDA');
  });

  it('handleTelegramUpdate debe procesar callback_query de rechazo (reject_AAPL)', async () => {
    const update = {
      update_id: 10002,
      callback_query: {
        id: 'cq_test_reject_1',
        from: { id: 987654321, first_name: 'Miguel' },
        message: { chat: { id: 123456789 } },
        data: 'reject_AAPL_1720000000',
      },
    };

    const response = await webhookHandler.handleTelegramUpdate(update, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'REJECTED');
    assert.equal(response.result.symbol, 'AAPL');
  });

  it('handleTelegramUpdate debe responder al comando /status y /start', async () => {
    const statusUpdate = {
      update_id: 10003,
      message: {
        chat: { id: 123456789 },
        text: '/status',
      },
    };

    const statusResponse = await webhookHandler.handleTelegramUpdate(statusUpdate, { updateDb: false });
    assert.equal(statusResponse.status, 200);
    assert.equal(statusResponse.result.action, 'STATUS');

    const startUpdate = {
      update_id: 10004,
      message: {
        chat: { id: 123456789 },
        text: '/start',
      },
    };

    const startResponse = await webhookHandler.handleTelegramUpdate(startUpdate, { updateDb: false });
    assert.equal(startResponse.status, 200);
    assert.equal(startResponse.result.action, 'START');
  });

  it('telegramService.sendConsolidatedDigest debe estructurar el digest con botones por lote e individuales', async () => {
    const mockSignals = [
      mockSignal,
      {
        symbol: 'MSFT',
        action: 'BUY',
        entryPrice: 420.00,
        targetPrice: 440.00,
        stopLoss: 410.00,
        timeHorizonDays: 1,
        confidence: 90,
        expectedReturnPercent: 4.76,
        riskRewardRatio: 2.0,
        rationale: 'RSI en zona óptima.',
        status: 'PENDING_APPROVAL',
        createdAt: new Date().toISOString(),
      },
    ];

    const result = await telegramService.sendConsolidatedDigest('123456789', mockSignals);
    assert.ok(result.simulated);
    assert.ok(result.text.includes('DIGEST DE OPORTUNIDADES INTRADÍA'));
    assert.ok(result.text.includes('NVDA'));
    assert.ok(result.text.includes('MSFT'));

    const keyboard = result.reply_markup.inline_keyboard;
    assert.equal(keyboard.length, 4, 'Debe contener fila lote, 2 filas individuales y fila rechazo lote');
    assert.ok(keyboard[0][0].text.includes('APROBAR TODAS (2)'));
    assert.ok(keyboard[0][0].callback_data.startsWith('batch_approve_'));
    assert.ok(keyboard[1][0].text.includes('NVDA'));
    assert.ok(keyboard[2][0].text.includes('MSFT'));
    assert.equal(keyboard[3][0].callback_data, 'batch_reject');
  });

  it('handleTelegramUpdate debe procesar callback_query de aprobación por lote (batch_approve)', async () => {
    const update = {
      update_id: 10005,
      callback_query: {
        id: 'cq_test_batch_1',
        from: { id: 987654321, first_name: 'Miguel' },
        message: { chat: { id: 123456789 } },
        data: 'batch_approve_NVDA,MSFT',
      },
    };

    const response = await webhookHandler.handleTelegramUpdate(update, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'BATCH_APPROVED');
    assert.deepEqual(response.result.symbols, ['NVDA', 'MSFT']);
    assert.equal(response.result.count, 2);
  });

  it('handleTelegramUpdate debe procesar callback_query de rechazo por lote (batch_reject)', async () => {
    const update = {
      update_id: 10006,
      callback_query: {
        id: 'cq_test_batch_reject_1',
        from: { id: 987654321, first_name: 'Miguel' },
        message: { chat: { id: 123456789 } },
        data: 'batch_reject',
      },
    };

    const response = await webhookHandler.handleTelegramUpdate(update, { updateDb: false });
    assert.equal(response.status, 200);
    assert.equal(response.result.action, 'BATCH_REJECTED');
  });

  it('handleTelegramUpdate debe alternar modo /autoinvest correctamente', async () => {
    const autoInvestUpdate = {
      update_id: 10007,
      message: {
        chat: { id: 123456789 },
        text: '/autoinvest',
      },
    };

    const res1 = await webhookHandler.handleTelegramUpdate(autoInvestUpdate, { updateDb: false });
    assert.equal(res1.status, 200);
    assert.equal(res1.result.action, 'AUTOINVEST_TOGGLE');
    assert.equal(typeof res1.result.autoInvestEnabled, 'boolean');

    // Segundo toggle debe invertir el valor
    const res2 = await webhookHandler.handleTelegramUpdate(autoInvestUpdate, { updateDb: false });
    assert.equal(res2.status, 200);
    assert.equal(res2.result.autoInvestEnabled, !res1.result.autoInvestEnabled);
  });
});
