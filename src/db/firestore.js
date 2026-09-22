import { Firestore } from '@google-cloud/firestore';
import { env } from '../config/environment.js';

/**
 * 🗄️ [INVEST AI] Conector Lazy de Firebase Firestore Native
 * Conecta a la base de datos 'invest-ai' en el proyecto 'invest-ai-509416'.
 * Implementa instanciación perezosa (lazy) e ignora propiedades 'undefined' (ETFs/métricas opcionales).
 */

let firestoreInstance = null;

export function getFirestoreDb() {
  if (!firestoreInstance) {
    firestoreInstance = new Firestore({
      projectId: env.GCP_PROJECT_ID,
      databaseId: env.FIRESTORE_DATABASE_ID,
      ignoreUndefinedProperties: true,
    });
  }
  return firestoreInstance;
}

export const COLLECTIONS = {
  ASSETS: 'assets_tracking',
  FLUCTUATIONS: 'market_fluctuations',
  SIGNALS: 'trading_signals',
  PORTFOLIO: 'portfolio_records',
};

export function getAssetsCollection() {
  return getFirestoreDb().collection(COLLECTIONS.ASSETS);
}

export function getFluctuationsCollection() {
  return getFirestoreDb().collection(COLLECTIONS.FLUCTUATIONS);
}

export function getSignalsCollection() {
  return getFirestoreDb().collection(COLLECTIONS.SIGNALS);
}

export function getPortfolioCollection() {
  return getFirestoreDb().collection(COLLECTIONS.PORTFOLIO);
}

/**
 * Prueba la conectividad en vivo con la base de datos Firestore.
 */
export async function testFirestoreConnection() {
  try {
    const db = getFirestoreDb();
    const collections = await db.listCollections();
    return {
      connected: true,
      databaseId: env.FIRESTORE_DATABASE_ID,
      projectId: env.GCP_PROJECT_ID,
      activeCollections: collections.map((col) => col.id),
    };
  } catch (error) {
    return {
      connected: false,
      databaseId: env.FIRESTORE_DATABASE_ID,
      projectId: env.GCP_PROJECT_ID,
      error: error.message,
    };
  }
}
