import { assetTrackerService } from './services/assetTrackerService.js';
import { predictionEngine } from './services/predictionEngine.js';
import { twilioService } from './services/twilioService.js';
import { telegramService } from './services/telegramService.js';
import { portfolioService } from './services/portfolioService.js';
import { schedulerService } from './services/schedulerService.js';
import { capitalManagerService } from './services/capitalManagerService.js';
import { reportingService } from './services/reportingService.js';

/**
 * 🚀 [INVEST AI] Orquestador de Operaciones CLI y Cloud Run
 * Gestiona ingesta, monitoreo en vivo, gestor de capital y portafolio.
 */

process.on('unhandledRejection', (reason) => {
  if (reason && reason.message && reason.message.includes('Could not load the default credentials')) {
    console.warn('\n⚠️ [GOOGLE AUTH] Sin credenciales ADC locales. Operando con fallback en memoria.\n');
  } else {
    console.error('Unhandled Rejection:', reason);
  }
});

function renderSignalCard(signal) {
  const ind = signal.indicators || {};
  const actionEmoji = signal.action === 'BUY' ? '🟢 COMPRA (BUY)' : (signal.action === 'SELL' ? '🔴 VENTA (SELL)' : '🟡 NEUTRAL (HOLD)');

  console.info('\n╔════════════════════════════════════════════════════════════════════════╗');
  console.info(`║ 🎯 INVEST AI — TARJETA DE SEÑAL CUANTITATIVA: ${signal.symbol.padEnd(25)}║`);
  console.info('╠════════════════════════════════════════════════════════════════════════╣');
  console.info(`║ Recomendación:    ${actionEmoji.padEnd(52)}║`);
  console.info(`║ Precio Entrada:   $${signal.entryPrice.toFixed(2).padEnd(51)}║`);
  console.info(`║ Target Price:     $${signal.targetPrice.toFixed(2)} (${signal.expectedReturnPercent >= 0 ? '+' : ''}${signal.expectedReturnPercent.toFixed(2)}%)${''.padEnd(Math.max(0, 41 - signal.targetPrice.toFixed(2).length - signal.expectedReturnPercent.toFixed(2).length))}║`);
  console.info(`║ Stop Loss:        $${signal.stopLoss.toFixed(2).padEnd(51)}║`);
  console.info(`║ Ratio R/B:        ${signal.riskRewardRatio.toFixed(2)} : 1${''.padEnd(46)}║`);
  console.info(`║ Confianza:        ${signal.confidence}%${''.padEnd(48)}║`);
  console.info('╠════════════════════════════════════════════════════════════════════════╣');
  console.info(`║ Explicabilidad:   ${signal.rationale.substring(0, 52).padEnd(52)}║`);
  console.info('╚════════════════════════════════════════════════════════════════════════╝\n');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '--sync';

  console.info('======================================================================');
  console.info('🛡️  INVEST AI — PLATAFORMA DE ANÁLISIS Y GESTIÓN DE INVERSIONES');
  console.info('======================================================================\n');

  if (command === '--capital') {
    const status = capitalManagerService.getCapitalStatus();
    console.info('💰 ESTADO DEL POOL DE CAPITAL (CERO RE-FONDEO):');
    console.table([{
      'Capital Total': `$${status.totalCapital.toFixed(2)} USD`,
      'Disponible Líquido': `$${status.availableCash.toFixed(2)} USD`,
      'Desplegado en Mercado': `$${status.deployedCapital.toFixed(2)} USD`,
      'Capacidad Operativa': status.canTrade ? '🟢 HABILITADO' : '🔴 BLOQUEADO (ROTACIÓN)',
      'Política': status.policy,
    }]);

  } else if (command === '--broker-status') {
    console.info('🏦 Consultando estado del Broker Co-Piloto (Happi)...');
    const status = capitalManagerService.getCapitalStatus();
    console.table([{
      Broker: 'Happi (Co-Piloto Asistido)',
      'Efectivo Disponible': `$${status.availableCash.toFixed(2)} USD`,
      'Capital Desplegado': `$${status.deployedCapital.toFixed(2)} USD`,
      'Modo': 'Zero-Trust / Cloud Run Guard',
    }]);

  } else if (command === '--portfolio') {
    console.info('💼 [INVEST AI] Calculando rendimiento y valoración en vivo...');
    const performance = await portfolioService.calculatePortfolioPerformance();
    const { summary, positions } = performance;

    if (positions.length === 0) {
      console.info('ℹ️ No hay posiciones abiertas en el portafolio.');
    } else {
      console.table([{
        'Inversión Total': `$${summary.totalCostBasis.toFixed(2)}`,
        'Valor Actual': `$${summary.totalMarketValue.toFixed(2)}`,
        'P&L No Realizado ($)': `${summary.totalUnrealizedPnL >= 0 ? '+' : ''}$${summary.totalUnrealizedPnL.toFixed(2)}`,
        'P&L No Realizado (%)': `${summary.totalUnrealizedPnLPercent >= 0 ? '+' : ''}${summary.totalUnrealizedPnLPercent.toFixed(2)}%`,
      }]);

      console.table(positions.map((p) => ({
        Broker: p.broker,
        Activo: p.symbol,
        Acciones: p.shares,
        'Compra': `$${p.averageBuyPrice.toFixed(2)}`,
        'Actual': `$${p.currentPrice.toFixed(2)}`,
        'P&L ($)': `${p.unrealizedPnL >= 0 ? '+' : ''}$${p.unrealizedPnL.toFixed(2)}`,
        'P&L (%)': `${p.unrealizedPnLPercent >= 0 ? '+' : ''}${p.unrealizedPnLPercent.toFixed(2)}%`,
      })));
    }

  } else if (command === '--scheduler-status') {
    console.info('⏰ Consultando estado de Cloud Scheduler...');
    const { execSync } = await import('child_process');
    try {
      const output = execSync('node scripts/setup-cloud-scheduler.js --status', { encoding: 'utf-8' });
      console.info(output);
    } catch (err) {
      console.error(`❌ Error consultando Cloud Scheduler: ${err.message}`);
    }

  } else if (command === '--scheduler-trigger') {
    const target = args[1] || 'portfolio';
    const jobName = target === 'scanner' ? 'invest-ai-market-scanner' : 'invest-ai-portfolio-guard';
    console.info(`⚡ Disparando Cloud Scheduler job [${jobName}]...`);
    const { execSync } = await import('child_process');
    try {
      const output = execSync(`node scripts/setup-cloud-scheduler.js --run ${jobName}`, { encoding: 'utf-8' });
      console.info(output);
    } catch (err) {
      console.error(`❌ Error ejecutando Cloud Scheduler job: ${err.message}`);
    }

  } else if (command === '--report') {
    console.info('📊 Generando reporte ejecutivo financiero...');
    const report = await reportingService.generateReportJson();
    const md = reportingService.generateReportMarkdown(report);
    console.info('\n' + md);

  } else if (command === '--report-upload') {
    console.info('☁️ Generando y archivando reporte inmutable en Google Cloud Storage (gs://invest_ia/)...');
    const result = await reportingService.generateAndArchiveReport({ uploadGCS: true });
    console.info(`✅ Reporte JSON archivado: ${result.jsonMeta.publicOrGcsUri}`);
    console.info(`✅ Reporte Markdown archivado: ${result.mdMeta.publicOrGcsUri}`);

  } else if (command === '--report-notify') {
    console.info('📢 Generando reporte y despachando tarjeta ejecutiva a Telegram...');
    const result = await reportingService.generateAndArchiveReport({ uploadGCS: true });
    await telegramService.sendPortfolioReport(undefined, result.report, result.jsonMeta);
    console.info('✅ Reporte enviado a Telegram exitosamente.');

  } else if (command === '--cron-scan') {
    console.info('🔄 Ejecutando escaneo autónomo programado...');
    const result = await schedulerService.runAutonomousMarketScan(undefined, true);
    console.info(`✅ Escaneo completado: ${result.dispatchedCount} alertas despachadas de ${result.scannedCount} analizados.`);

  } else if (command === '--analyze' && args[1]) {
    const signal = await predictionEngine.generateSignal(args[1]);
    renderSignalCard(signal);

  } else if (command === '--signals') {
    const signals = await predictionEngine.analyzeWatchlist(['AAPL', 'NVDA', 'MSFT', 'SPY', 'QQQ']);
    if (signals.length > 0) {
      console.table(signals.map((s) => ({
        Activo: s.symbol, Acción: s.action, Entrada: `$${s.entryPrice.toFixed(2)}`, Target: `$${s.targetPrice.toFixed(2)}`, 'Stop Loss': `$${s.stopLoss.toFixed(2)}`, Confianza: `${s.confidence}%`,
      })));
    }

  } else {
    console.info('🔄 Sincronizando Watchlist por defecto...');
    await assetTrackerService.syncWatchlist(['AAPL', 'NVDA', 'MSFT', 'SPY', 'QQQ']);
  }

  console.info('\n✨ [INVEST AI] Operación finalizada exitosamente.');
}

main().catch((err) => {
  console.error(`❌ Error fatal: ${err.message}`);
  process.exit(1);
});
