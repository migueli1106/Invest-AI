import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * 🔒 [INVEST AI] Validación Estricta de Variables de Entorno
 * Garantiza que la aplicación arranque con todas sus dependencias configuradas.
 */

const EnvironmentSchema = z.object({
  GCP_PROJECT_ID: z.string().default('invest-ai-509416'),
  GCP_REGION: z.string().default('us-central1'),
  PORT: z.coerce.number().default(8080),
  FIREBASE_PROJECT_ID: z.string().default('invest-ai-509416'),
  FIRESTORE_DATABASE_ID: z.string().default('invest-ai'),
  GCS_BUCKET_NAME: z.string().default('invest_ia'),
  GCS_REPORTS_PREFIX: z.string().default('reports/'),
  GCS_MEDIA_PREFIX: z.string().default('media/'),
  BROKER_ENVIRONMENT: z.enum(['paper', 'live']).default('paper'),
  ALPACA_API_KEY: z.string().optional(),
  ALPACA_API_SECRET: z.string().optional(),
  ALPACA_BASE_URL: z.string().default('https://paper-api.alpaca.markets'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = EnvironmentSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Error fatal: Variables de entorno inválidas o ausentes:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
