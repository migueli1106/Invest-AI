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
  PRIMARY_BROKER: z.string().default('Happi'),
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

  // Broker Execution Bridge (Co-Piloto Asistido vs Local Agent)
  EXECUTION_MODE: z.enum(['COPILOT', 'LOCAL_AGENT']).default('COPILOT'),
  BRIDGE_SECRET: z.string().default('invest_ai_bridge_internal_secret'),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = EnvironmentSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Error fatal: Variables de entorno inválidas o ausentes:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
