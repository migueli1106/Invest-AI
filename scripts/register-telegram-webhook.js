import dotenv from 'dotenv';

dotenv.config();

/**
 * ✈️ [INVEST AI] Gestor y Registrador de Webhook de Telegram Bot API
 * Vincula el servidor Google Cloud Run con la API de Telegram para recibir callbacks.
 */

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN no está configurado en las variables de entorno.');
  process.exit(1);
}

const baseUrl = `https://api.telegram.org/bot${botToken}`;

async function setWebhook(publicUrl) {
  const cleanUrl = publicUrl.replace(/\/+$/, '');
  const webhookUrl = `${cleanUrl}/webhook/telegram`;

  console.info(`📡 Registrando webhook en Telegram: ${webhookUrl}...`);

  const response = await fetch(`${baseUrl}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    }),
  });

  const data = await response.json();
  if (data.ok) {
    console.info('✅ ¡Webhook registrado exitosamente en Telegram!');
    console.info(`👉 Endpoint activo: ${webhookUrl}`);
  } else {
    console.error('❌ Error al registrar webhook:', data.description);
    process.exit(1);
  }
}

async function getWebhookInfo() {
  console.info('🔍 Consultando estado del webhook en Telegram...');

  const response = await fetch(`${baseUrl}/getWebhookInfo`);
  const data = await response.json();

  if (data.ok) {
    const info = data.result;
    console.info('\n📋 ESTADO DEL WEBHOOK DE TELEGRAM:');
    console.info(`• URL Registrada:             ${info.url || '(Ninguna)'}`);
    console.info(`• Actualizaciones pendientes: ${info.pending_update_count}`);
    console.info(`• Último error:               ${info.last_error_message || 'Ninguno'}`);
    if (info.last_error_date) {
      console.info(`• Fecha último error:         ${new Date(info.last_error_date * 1000).toISOString()}`);
    }
    console.info(`• Conexiones máximas:         ${info.max_connections || 40}\n`);
  } else {
    console.error('❌ Error al consultar webhook info:', data.description);
    process.exit(1);
  }
}

async function deleteWebhook() {
  console.info('🗑️ Eliminando webhook de Telegram...');

  const response = await fetch(`${baseUrl}/deleteWebhook`, {
    method: 'POST',
  });

  const data = await response.json();
  if (data.ok) {
    console.info('✅ Webhook eliminado exitosamente.');
  } else {
    console.error('❌ Error al eliminar webhook:', data.description);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--info')) {
    await getWebhookInfo();
  } else if (args.includes('--delete')) {
    await deleteWebhook();
  } else if (args.includes('--url')) {
    const urlIndex = args.indexOf('--url');
    const url = args[urlIndex + 1];
    if (!url) {
      console.error('❌ Error: Debes especificar la URL después de --url (ej. --url https://mi-servicio.run.app)');
      process.exit(1);
    }
    await setWebhook(url);
    await getWebhookInfo();
  } else {
    console.info('Uso: node scripts/register-telegram-webhook.js [OPCIONES]');
    console.info('  --url <URL>   Registra la URL base de Cloud Run');
    console.info('  --info        Consulta el estado actual del webhook');
    console.info('  --delete      Elimina el webhook registrado');
  }
}

main().catch((err) => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
