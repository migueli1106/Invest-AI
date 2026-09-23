import { assetTrackerService } from './services/assetTrackerService.js';
import { predictionEngine } from './services/predictionEngine.js';
import { twilioService } from './services/twilioService.js';
import { telegramService } from './services/telegramService.js';
import { portfolioService } from './services/portfolioService.js';
import { schedulerService } from './services/schedulerService.js';

/**
 * 🚀 [INVEST AI] Orquestador de Operaciones CLI y Cloud Run
 * Gestiona ingesta, monitoreo en vivo, generación algorítmica de señales y portafolio.
 */

// Manejo defensivo de credenciales en entorno local sin ADC
process.on('unhandledRejection', (reason) => {
  if (reason && reason.message && reason.message.includes('Could not load the default credentials')) {
    console.warn('\n⚠️ [GOOGLE AUTH] No se detectaron Application Default Credentials (ADC) locales.');
    console.info('👉 Para sincronizar con Firestore en local, ejecuta: gcloud auth application-default login\n');
  } else {
    console.error('Unhandled Rejection:', reason);
  }
});

function renderSignalCard(signal) {
  const ind = signal.indicators || {};
  const sr = ind.supportResistance || {};
  const actionEmoji = signal.action === 'BUY' ? '🟢 COMPRA (BUY)' : (signal.action === 'SELL' ? '🔴 VENTA (SELL)' : '🟡 NEUTRAL (HOLD)');

  console.info('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.info(`║ 🎯 INVEST AI — TARJETA DE SEÑAL CUANTITATIVA: ${signal.symbol.padEnd(25)}║`);
  console.info('╠════════════════════════════════════════════════════════════════════════╣');
  console.info(`║ Recomendación:    ${actionEmoji.padEnd(52)}║`);
  console.info(`║ Estado:           ${signal.status.padEnd(52)}║`);
  console.info(`║ Precio Entrada:   $${signal.entryPrice.toFixed(2).padEnd(51)}║`);
  console.info(`║ Target Price:     $${signal.targetPrice.toFixed(2)} (${signal.expectedReturnPercent >= 0 ? '+' : ''}${signal.expectedReturnPercent.toFixed(2)}%)${''.padEnd(Math.max(0, 41 - signal.targetPrice.toFixed(2).length - signal.expectedReturnPercent.toFixed(2).length))}║`);
  console.info(`║ Stop Loss:        $${signal.stopLoss.toFixed(2).padEnd(51)}║`);
  console.info(`║ Ratio R/B:        ${signal.riskRewardRatio.toFixed(2)} : 1${''.padEnd(46)}║`);
  console.info(`║ Confianza:        ${signal.confidence}%${''.padEnd(48)}║`);
  console.info(`║ Horizonte:        ${signal.timeHorizonDays} días hábiles${''.padEnd(41)}║`);
  console.info('╠════════════════════════════════════════════════════════════════════════╣');
  console.info('║ 📊 Indicadores Cuantitativos Clave:                                    ║');
  if (ind.ema20 && ind.ema50) {
    console.info(`║ • EMA 20: $${ind.ema20.toFixed(2)} | EMA 50: $${ind.ema50.toFixed(2)}${''.padEnd(Math.max(0, 43 - ind.ema20.toFixed(2).length - ind.ema50.toFixed(2).length))}║`);
  }
  if (ind.rsi !== undefined) {
    console.info(`║ • RSI (14): ${ind.rsi.toFixed(2)}${''.padEnd(50)}║`);
  }
  if (ind.macd) {
    console.info(`║ • MACD Histograma: ${ind.macd.histogram >= 0 ? '+' : ''}${ind.macd.histogram.toFixed(4)} (Línea: ${ind.macd.macdLine.toFixed(4)}, Señal: ${ind.macd.signalLine.toFixed(4)})${''.padEnd(16)}║`);
  }
  if (sr.support && sr.resistance) {
    console.info(`║ • Canal S/R: Soporte $${sr.support.toFixed(2)} | Resistencia $${sr.resistance.toFixed(2)}${''.padEnd(Math.max(0, 24 - sr.support.toFixed(2).length - sr.resistance.toFixed(2).length))}║`);
  }
  console.info('╠════════════════════════════════════════════════════════════════════════╣');
  console.info('║ 💡 Explicabilidad IA:                                                  ║');
  console.info(`║ ${signal.rationale}`);
  console.info('╚════════════════════════════════════════════════════════════════════════╝\n');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '--sync';

  console.info('======================================================================');
  console.info('🛡️  INVEST AI — PLATAFORMA DE ANÁLISIS Y PREDICCIÓN CUANTITATIVA');
  console.info('======================================================================\n');

  if (command === '--analyze' && args[1]) {
    const symbol = args[1];
    const signal = await predictionEngine.generateSignal(symbol);
    renderSignalCard(signal);

  } else if (command === '--portfolio') {
    console.info('💼 [INVEST AI] Calculando rendimiento y valoración en vivo de la cartera...');
    const performance = await portfolioService.calculatePortfolioPerformance();
    const { summary, positions } = performance;

    if (positions.length === 0) {
      console.info('ℹ️ No hay posiciones abiertas registradas en el portafolio.');
    } else {
      console.info(`\n📊 RESUMEN GLOBAL (Posiciones Abiertas: ${summary.count ?? summary.openPositionsCount ?? positions.length}):`);
      console.table([{
        'Inversión Total': `$${summary.totalCostBasis.toFixed(2)}`,
        'Valor Actual': `$${summary.totalMarketValue.toFixed(2)}`,
        'P&L No Realizado ($)': `${summary.totalUnrealizedPnL >= 0 ? '+' : ''}$${summary.totalUnrealizedPnL.toFixed(2)}`,
        'P&L No Realizado (%)': `${summary.totalUnrealizedPnLPercent >= 0 ? '+' : ''}${summary.totalUnrealizedPnLPercent.toFixed(2)}%`,
      }]);

      console.info('\n📋 DETALLE DE POSICIONES ABIERTAS:');
      console.table(positions.map((p) => ({
        ID: (p.id || '').substring(0, 14),
        Broker: p.broker,
        Activo: p.symbol,
        Acciones: p.shares,
        'Compra': `$${p.averageBuyPrice.toFixed(2)}`,
        'Actual': `$${p.currentPrice.toFixed(2)}`,
        'P&L ($)': `${p.unrealizedPnL >= 0 ? '+' : ''}$${p.unrealizedPnL.toFixed(2)}`,
        'P&L (%)': `${p.unrealizedPnLPercent >= 0 ? '+' : ''}${p.unrealizedPnLPercent.toFixed(2)}%`,
        'Target': p.targetPrice ? `$${p.targetPrice.toFixed(2)}` : '-',
        'Stop Loss': p.stopLoss ? `$${p.stopLoss.toFixed(2)}` : '-',
      })));

      const triggers = await portfolioService.checkExitTriggers(positions);
      if (triggers.length > 0) {
        console.info('\n🚨 [ALERTA] DISPARADORES DE SALIDA ACTIVADOS:');
        triggers.forEach((t) => {
          console.info(`  • [${t.trigger || t.type}] ${t.symbol} en ${t.broker}: ${t.message || t.rationale}`);
        });
      }
    }

  } else if (command === '--buy' && args[1] && args[2] && args[3]) {
    const symbol = args[1].toUpperCase();
    const shares = parseFloat(args[2]);
    const buyPrice = parseFloat(args[3]);
    const broker = args[4] || 'Happi';
    const stopLoss = args[5] ? parseFloat(args[5]) : undefined;
    const targetPrice = args[6] ? parseFloat(args[6]) : undefined;

    console.info(`💼 Registrando compra de ${shares} acciones de ${symbol} a $${buyPrice} en ${broker}...`);
    const pos = await portfolioService.addPosition({ symbol, shares, buyPrice, broker, stopLoss, targetPrice });
    console.info(`✅ [PORTFOLIO] Posición creada exitosamente: ID ${pos.id} en ${pos.broker}`);
    console.info(`   Target Price: $${pos.targetPrice} | Stop Loss: $${pos.stopLoss}`);

  } else if (command === '--cron-scan') {
    console.info('🔄 Ejecutando escaneo autónomo programado...');
    const result = await schedulerService.runAutonomousMarketScan(undefined, true);
    console.info(`✅ Escaneo completado: ${result.dispatchedCount} alertas despachadas de ${result.scannedCount} analizados.`);

  } else if (command === '--notify' && args[1]) {
    const symbol = args[1];
    const isTelegramOnly = args.includes('--telegram');
    const targetPhone = !isTelegramOnly && args[2] && !args[2].startsWith('--') ? args[2] : process.env.ADMIN_WHATSAPP_NUMBER;
    const targetChatId = process.env.TELEGRAM_CHAT_ID;

    console.info(`📡 [INVEST AI] Analizando ${symbol} para despacho de alerta...`);
    const signal = await predictionEngine.generateSignal(symbol);
    renderSignalCard(signal);

    if (isTelegramOnly || process.env.TELEGRAM_BOT_TOKEN) {
      console.info(`✈️ [TELEGRAM] Despachando señal a Telegram (${targetChatId || 'SIMULADO'})...`);
      const tgResult = await telegramService.sendSignalAlert(targetChatId, signal);
      console.info('✅ [TELEGRAM] Resultado de despacho:', tgResult.simulated ? 'Simulado' : 'Enviado');
    }

    if (!isTelegramOnly) {
      console.info(`📲 [TWILIO] Despachando señal a WhatsApp (${targetPhone || 'SIMULADO'})...`);
      const twilioResult = await twilioService.sendSignalAlert(targetPhone, signal);
      console.info('✅ [TWILIO] Resultado de despacho:', twilioResult.simulated ? 'Simulado' : 'Enviado');
    }

  } else if (command === '--signals') {
    const defaultWatchlist = ['AAPL', 'NVDA', 'MSFT', 'SPY', 'QQQ'];
    const signals = await predictionEngine.analyzeWatchlist(defaultWatchlist);

    if (signals.length > 0) {
      console.info('\n📋 RESUMEN DE SEÑALES GENERADAS:');
      console.table(signals.map((s) => ({
        Activo: s.symbol,
        Acción: s.action,
        Entrada: `$${s.entryPrice.toFixed(2)}`,
        Target: `$${s.targetPrice.toFixed(2)}`,
        'Stop Loss': `$${s.stopLoss.toFixed(2)}`,
        'R/B': `${s.riskRewardRatio.toFixed(2)}:1`,
        Confianza: `${s.confidence}%`,
        Horizonte: `${s.timeHorizonDays}d`,
      })));
    }

  } else if (command === '--track' && args[1]) {
    const symbol = args[1];
    await assetTrackerService.trackAsset(symbol);

  } else if (command === '--list') {
    const assets = await assetTrackerService.getTrackedAssets();
    if (assets.length === 0) {
      console.info('ℹ️ No hay activos almacenados en Firestore todavía.');
    } else {
      console.info(`📋 Activos en seguimiento (${assets.length}):`);
      console.table(assets.map((a) => ({
        Symbol: a.symbol,
        Name: a.name.substring(0, 20),
        Price: `$${a.currentPrice.toFixed(2)}`,
        Change: `${a.changePercent >= 0 ? '+' : ''}${a.changePercent.toFixed(2)}%`,
        Volume: a.volume.toLocaleString(),
        Updated: a.lastUpdated,
      })));
    }

  } else {
    // Sincronización por defecto de activos de alta liquidez
    const defaultWatchlist = ['AAPL', 'NVDA', 'MSFT', 'SPY', 'QQQ'];
    console.info(`🔄 Ejecutando sincronización de Watchlist: ${defaultWatchlist.join(', ')}\n`);
    await assetTrackerService.syncWatchlist(defaultWatchlist);
  }

  console.info('\n======================================================================');
  console.info('✨ [INVEST AI] Proceso concluido exitosamente.');
  console.info('======================================================================\n');
}

main().catch((err) => {
  console.error(`❌ Error fatal en ejecución: ${err.message}`);
  process.exit(1);
});
