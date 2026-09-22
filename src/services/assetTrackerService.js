import { getAssetsCollection, getFluctuationsCollection } from '../db/firestore.js';
import { marketDataService } from './marketDataService.js';

/**
 * 🎯 [INVEST AI] Servicio de Seguimiento de Activos y Fluctuaciones en Firestore
 * Gestiona la ingesta de datos de mercado y su persistencia segura en Firebase.
 */

class AssetTrackerService {
  /**
   * Agrega o actualiza un activo en la colección de seguimiento.
   * @param {string} symbol - Ticker del activo
   */
  async trackAsset(symbol) {
    const cleanSymbol = symbol.trim().toUpperCase();
    console.info(`🔍 [INVEST AI] Ingestando datos de mercado en vivo para: ${cleanSymbol}...`);

    // 1. Ingesta de cotización real y cálculo de fluctuación
    const quote = await marketDataService.getQuote(cleanSymbol);
    const fluctuation = marketDataService.buildFluctuationRecord(quote);

    console.info(`📊 Cotización obtenida: ${quote.name} (${quote.symbol}) -> $${quote.currentPrice.toFixed(2)} (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)`);
    console.info(`📈 Rango diario: High $${quote.dayHigh || 'N/A'} | Low $${quote.dayLow || 'N/A'} | Volumen: ${quote.volume.toLocaleString()}`);

    // 2. Persistencia en Firebase Firestore (con manejo de credenciales)
    try {
      const assetRef = getAssetsCollection().doc(cleanSymbol);
      await assetRef.set(quote, { merge: true });
      await getFluctuationsCollection().add(fluctuation);
      console.info(`💾 [FIRESTORE] Documento guardado exitosamente en 'assets_tracking/${cleanSymbol}' y 'market_fluctuations'.`);
    } catch (dbErr) {
      console.warn(`⚠️ [FIRESTORE] Escritura en la nube pendiente: ${dbErr.message}`);
      console.info(`👉 Ejecuta 'gcloud auth application-default login' en PowerShell para habilitar la persistencia local en Firestore.`);
    }

    return { asset: quote, fluctuation };
  }

  /**
   * Sincroniza en lote una lista de activos de vigilancia (Watchlist).
   * @param {string[]} symbols - Lista de símbolos a actualizar
   */
  async syncWatchlist(symbols = ['AAPL', 'NVDA', 'MSFT', 'SPY', 'QQQ']) {
    console.info(`⚡ [INVEST AI] Sincronizando Watchlist (${symbols.length} activos)...`);
    const results = [];

    for (const symbol of symbols) {
      try {
        const res = await this.trackAsset(symbol);
        results.push(res);
      } catch (err) {
        console.error(`❌ Error procesando ${symbol}: ${err.message}`);
      }
    }

    console.info(`\n🎉 [INVEST AI] Ingesta completada: ${results.length}/${symbols.length} activos procesados.`);
    return results;
  }

  /**
   * Obtiene todos los activos actualmente monitoreados en Firestore.
   */
  async getTrackedAssets() {
    try {
      const snapshot = await getAssetsCollection().get();
      if (snapshot.empty) return [];
      return snapshot.docs.map((doc) => doc.data());
    } catch (err) {
      console.warn(`⚠️ Error leyendo activos de Firestore: ${err.message}`);
      return [];
    }
  }

  /**
   * Consulta las fluctuaciones recientes de un activo.
   * @param {string} symbol - Ticker del activo
   * @param {number} limitCount - Cantidad de registros a recuperar
   */
  async getRecentFluctuations(symbol, limitCount = 10) {
    try {
      const cleanSymbol = symbol.trim().toUpperCase();
      const snapshot = await getFluctuationsCollection()
        .where('symbol', '==', cleanSymbol)
        .orderBy('timestamp', 'desc')
        .limit(limitCount)
        .get();

      if (snapshot.empty) return [];
      return snapshot.docs.map((doc) => doc.data());
    } catch (err) {
      console.warn(`⚠️ Error consultando fluctuaciones: ${err.message}`);
      return [];
    }
  }
}

export const assetTrackerService = new AssetTrackerService();
