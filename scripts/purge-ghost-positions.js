import { getPortfolioCollection } from '../src/db/firestore.js';

/**
 * 🧹 [INVEST AI] Script de Purga Forense de Posiciones Fantasma en Firestore
 * Cierra idempotentemente cualquier posición abierta residual heredada de pruebas.
 */
async function purgeGhostPositions() {
  console.info('🧹 [PURGE] Iniciando auditoría forense de posiciones fantasma en Firestore...');

  try {
    const col = getPortfolioCollection();
    const snapshot = await col.where('status', '==', 'OPEN').get();

    if (snapshot.empty) {
      console.info('✅ [PURGE] Cero posiciones abiertas encontradas. Portafolio 100% limpio.');
      return;
    }

    console.info(`🔍 [PURGE] Detectadas ${snapshot.size} posición(es) abierta(s). Procediendo a cierre forense...`);
    const batch = col.firestore.batch();
    const now = new Date().toISOString();

    snapshot.forEach((doc) => {
      const data = doc.data();
      console.info(`  • Cerrando artefacto: ${doc.id} | Símbolo: ${data.symbol || 'N/A'} | Broker: ${data.broker || 'N/A'}`);
      batch.update(doc.ref, {
        status: 'CLOSED',
        closedAt: now,
        lastUpdated: now,
        notes: 'PURGED_TEST_ARTIFACT',
      });
    });

    await batch.commit();
    console.info(`🎉 [PURGE] Éxito: ${snapshot.size} posición(es) cerrada(s). Portafolio reconciliado en 0 posiciones abiertas.`);
  } catch (err) {
    if (err.message && err.message.includes('Could not load the default credentials')) {
      console.warn('⚠️ [PURGE] Credenciales ADC no configuradas localmente. La purga opera de forma nativa en Cloud Run.');
      return;
    }
    throw err;
  }
}

const isDirect = process.argv[1] && process.argv[1].endsWith('purge-ghost-positions.js');
if (isDirect) {
  purgeGhostPositions()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`💥 [PURGE ERROR]: ${err.message}`);
      process.exit(1);
    });
}

export { purgeGhostPositions };
