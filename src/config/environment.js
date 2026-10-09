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
  PRIMARY_BROKER: z.string().default('Moomoo'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // Twilio WhatsApp API (Sandbox / Producción)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().default('whatsapp:+14155238886'),
  ADMIN_WHATSAPP_NUMBER: z.string().optional(),

  // Meta Cloud API (WhatsApp Business - Canal Alternativo)
  META_WHATSAPP_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  META_WHATSAPP_VERIFY_TOKEN: z.string().default('invest_ai_secret_token'),

  // Cloud Scheduler & Automatización Segura
  CRON_SECRET: z.string().default('invest_ai_cron_internal_secret'),

  // Broker Execution Bridge (MOOMOO | COPILOT | LOCAL_AGENT)
  EXECUTION_MODE: z.string().default('MOOMOO').transform((val) => {
    const norm = (val || '').trim().toUpperCase();
    if (norm === 'LOCAL_AGENT' || norm === 'COPILOT') return norm;
    return 'MOOMOO';
  }),
  BRIDGE_SECRET: z.string().default('invest_ai_bridge_internal_secret'),

  // Moomoo OpenAPI & Gateway OpenD
  MOOMOO_ACC_ID: z.string().default('2886044'),
  MOOMOO_TRD_ENV: z.enum(['SIMULATE', 'REAL']).default('SIMULATE'),
  MOOMOO_OPEND_HOST: z.string().default('127.0.0.1'),
  MOOMOO_OPEND_PORT: z.coerce.number().default(11111),
  MOOMOO_SCRIPTS_DIR: z.string().default('C:\\Users\\sebas\\.gemini\\config\\skills\\moomooapi\\scripts'),

  // Worker Residencial de Automatización Local
  CLOUD_RUN_URL: z.string().default('https://invest-ai-engine-891662254338.us-central1.run.app'),
  LOCAL_CHROME_PATH: z.string().optional(),
  LOCAL_CHROME_PROFILE_DIR: z.string().default('./.hapi-profile'),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = EnvironmentSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Error fatal: Variables de entorno inválidas o ausentes:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
