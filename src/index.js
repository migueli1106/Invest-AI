import { assetTrackerService } from './services/assetTrackerService.js';
import { testFirestoreConnection } from './db/firestore.js';

/**
 * 🚀 [INVEST AI] Punto de Entrada y Orquestador de Ingesta
 * Permite ejecutar sincronizaciones programadas o consultas desde CLI y Cloud Run.
 */

// Manejo defensivo de credenciales en entorno local sin ADC
process.on('unhandledRejection', (reason) => {
  if (reason && reason.message && reason.message.includes('Could not load the default credentials')) {
    console.warn('\n⚠️ [GOOGLE AUTH] No se detectaron Application Default Credentials (ADC) locales.');
    console.info('👉 Para sincronizar con Firestore en local, ejecuta en tu terminal: gcloud auth application-default login\n');
  } else {
    console.error('Unhandled Rejection:', reason);
  }
});

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '--sync';

  console.info('======================================================================');
  console.info('🛡️  INVEST AI — MOTOR DE INGESTA Y SEGUIMIENTO DE MERCADO');
  console.info('======================================================================\n');

  // 1. Procesar comando de ingesta
  if (command === '--track' && args[1]) {
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
  console.info('✨ [INVEST AI] Ingesta y análisis concluidos.');
  console.info('======================================================================\n');
}

main().catch((err) => {
  console.error(`❌ Error fatal en ejecución: ${err.message}`);
  process.exit(1);
});
