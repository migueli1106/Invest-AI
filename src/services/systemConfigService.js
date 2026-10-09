import { getFirestoreDb } from '../db/firestore.js';

/**
 * ⚙️ [INVEST AI] Servicio Central de Configuración del Sistema
 * Gestiona parámetros dinámicos de ejecución como el modo Auto-Invest,
 * con fallback resiliente en memoria y sincronización en Firestore.
 */
class SystemConfigService {
  constructor() {
    this.autoInvestEnabled = false;
  }

  /**
   * Indica si la ejecución 100% autónoma sin confirmación está activa.
   * @returns {boolean}
   */
  isAutoInvestEnabled() {
    return this.autoInvestEnabled;
  }

  /**
   * Actualiza el estado de Auto-Invest y lo persiste en Firestore si está disponible.
   * @param {boolean} enabled
   * @returns {Promise<boolean>}
   */
  async setAutoInvest(enabled) {
    this.autoInvestEnabled = Boolean(enabled);
    if (process.env.NODE_ENV === 'test') {
      return this.autoInvestEnabled;
    }

    try {
      const db = getFirestoreDb();
      await db.collection('system_config').doc('trading').set(
        {
          autoInvestEnabled: this.autoInvestEnabled,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      console.info(`⚙️ [CONFIG] Modo Auto-Invest guardado en Firestore: ${this.autoInvestEnabled ? 'ON' : 'OFF'}`);
    } catch (err) {
      console.warn(`⚠️ [CONFIG] No se pudo persistir en Firestore (usando memoria): ${err.message}`);
    }

    return this.autoInvestEnabled;
  }

  /**
   * Conmuta el estado de Auto-Invest entre encendido y apagado.
   * @returns {Promise<boolean>}
   */
  async toggleAutoInvest() {
    return await this.setAutoInvest(!this.autoInvestEnabled);
  }

  /**
   * Carga la configuración inicial desde Firestore si está disponible.
   */
  async loadConfig() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const db = getFirestoreDb();
      const doc = await db.collection('system_config').doc('trading').get();
      if (doc.exists) {
        const data = doc.data();
        if (typeof data.autoInvestEnabled === 'boolean') {
          this.autoInvestEnabled = data.autoInvestEnabled;
          console.info(`⚙️ [CONFIG] Auto-Invest cargado de Firestore: ${this.autoInvestEnabled ? 'ON' : 'OFF'}`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ [CONFIG] Fallback a configuración en memoria: ${err.message}`);
    }
  }
}

export const systemConfigService = new SystemConfigService();
