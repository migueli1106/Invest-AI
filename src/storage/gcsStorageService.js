import { Storage } from '@google-cloud/storage';
import { env } from '../config/environment.js';

/**
 * 🗄️ [INVEST AI] Adaptador de Almacenamiento Inmutable en Google Cloud Storage
 * Persiste reportes financieros, telemetría y auditorías en el bucket 'invest_ia'.
 */

export class GcsStorageService {
  constructor() {
    this.bucketName = env.GCS_BUCKET_NAME || 'invest_ia';
    this.defaultPrefix = env.GCS_REPORTS_PREFIX || 'reports/';
    this._storage = null;
    this.simulatedFiles = new Map();
  }

  /**
   * Determina si el servicio debe operar en modo simulación seguro.
   * @returns {boolean}
   */
  isSimulation() {
    return (
      process.env.NODE_ENV === 'test' ||
      env.NODE_ENV === 'test'
    );
  }

  /**
   * Obtiene la instancia singleton del cliente Google Cloud Storage.
   * @private
   */
  getStorage() {
    if (!this._storage) {
      this._storage = new Storage({
        projectId: env.GCP_PROJECT_ID || 'invest-ai-509416',
      });
    }
    return this._storage;
  }

  /**
   * Sube un reporte inmutable al bucket de GCS especificado.
   * @param {object} params
   * @param {string} params.filename - Nombre del archivo (ej. report_2026-09-23.json)
   * @param {string|Buffer} params.content - Contenido del reporte
   * @param {string} [params.contentType='application/json'] - MIME type
   * @param {string} [params.prefix='reports/'] - Prefijo dentro del bucket
   * @returns {Promise<{ bucket: string, path: string, sizeBytes: number, publicOrGcsUri: string, uploadedAt: string, simulated: boolean }>}
   */
  async uploadReport({ filename, content, contentType = 'application/json', prefix }) {
    if (!filename) {
      throw new Error('El nombre de archivo (filename) es obligatorio para archivar en GCS.');
    }

    const targetPrefix = (prefix || this.defaultPrefix).replace(/^\/+/, '').replace(/\/+$/, '') + '/';
    const filePath = `${targetPrefix}${filename}`;
    const stringContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const buffer = Buffer.from(stringContent, 'utf-8');
    const sizeBytes = buffer.length;
    const now = new Date().toISOString();

    if (this.isSimulation()) {
      this.simulatedFiles.set(filePath, {
        content: stringContent,
        contentType,
        sizeBytes,
        uploadedAt: now,
      });
      console.info(`💾 [GCS SIMULACIÓN] Archivo almacenado: gs://${this.bucketName}/${filePath} (${sizeBytes} bytes)`);
      return {
        bucket: this.bucketName,
        path: filePath,
        sizeBytes,
        publicOrGcsUri: `gs://${this.bucketName}/${filePath}`,
        uploadedAt: now,
        simulated: true,
      };
    }

    try {
      const storage = this.getStorage();
      const bucket = storage.bucket(this.bucketName);
      const file = bucket.file(filePath);

      await file.save(buffer, {
        contentType,
        metadata: {
          cacheControl: 'no-cache',
          metadata: {
            uploadedBy: 'invest-ai-engine',
            uploadedAt: now,
            service: 'invest-ai-reporting-engine',
          },
        },
      });

      console.info(`☁️ [GCS UPLOAD] Reporte inmutable subido: gs://${this.bucketName}/${filePath} (${sizeBytes} bytes)`);
      return {
        bucket: this.bucketName,
        path: filePath,
        sizeBytes,
        publicOrGcsUri: `gs://${this.bucketName}/${filePath}`,
        uploadedAt: now,
        simulated: false,
      };
    } catch (err) {
      console.warn(`⚠️ [GCS FALLBACK] No se pudo escribir en GCS (${err.message}). Operando en fallback simulado.`);
      this.simulatedFiles.set(filePath, {
        content: stringContent,
        contentType,
        sizeBytes,
        uploadedAt: now,
      });
      return {
        bucket: this.bucketName,
        path: filePath,
        sizeBytes,
        publicOrGcsUri: `gs://${this.bucketName}/${filePath}`,
        uploadedAt: now,
        simulated: true,
        fallbackReason: err.message,
      };
    }
  }

  /**
   * Descarga o recupera el contenido de un reporte almacenado.
   * @param {string} filePath - Ruta completa del archivo dentro del bucket
   * @returns {Promise<string>}
   */
  async downloadReport(filePath) {
    if (this.isSimulation() || this.simulatedFiles.has(filePath)) {
      const sim = this.simulatedFiles.get(filePath);
      if (!sim) throw new Error(`Archivo no encontrado en simulación GCS: ${filePath}`);
      return sim.content;
    }

    try {
      const storage = this.getStorage();
      const file = storage.bucket(this.bucketName).file(filePath);
      const [contents] = await file.download();
      return contents.toString('utf-8');
    } catch (err) {
      if (this.simulatedFiles.has(filePath)) {
        return this.simulatedFiles.get(filePath).content;
      }
      throw new Error(`Error descargando reporte de GCS (${filePath}): ${err.message}`);
    }
  }

  /**
   * Limpia los archivos simulados en memoria (útil en teardown de tests).
   */
  clearSimulation() {
    this.simulatedFiles.clear();
  }
}

export const gcsStorageService = new GcsStorageService();
