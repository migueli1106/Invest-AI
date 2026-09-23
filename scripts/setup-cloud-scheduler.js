import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

/**
 * ⏰ [INVEST AI] Gestor y Aprovisionador de Google Cloud Scheduler
 * Automatiza escaneos de mercado y guardianes de portafolio 24/7.
 */

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'invest-ai-509416';
const REGION = process.env.GCP_REGION || 'us-central1';
const CRON_SECRET = process.env.CRON_SECRET || 'invest_ai_cron_internal_secret';
const SERVICE_NAME = 'invest-ai-engine';

function runGcloud(command, ignoreError = false) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (ignoreError) return null;
    throw err;
  }
}

function getServiceUrl() {
  console.info('🔍 Detectando URL de Google Cloud Run...');
  const cmd = `gcloud run services describe ${SERVICE_NAME} --region=${REGION} --project=${PROJECT_ID} --format="value(status.url)"`;
  const url = runGcloud(cmd, true);
  if (url && url.startsWith('https://')) {
    console.info(`✅ URL detectada: ${url}`);
    return url;
  }
  const fallback = 'https://invest-ai-engine-891662254338.us-central1.run.app';
  console.info(`ℹ️ Usando URL canónica: ${fallback}`);
  return fallback;
}

function listJobs() {
  console.info(`\n📋 Consultando trabajos de Cloud Scheduler en [${REGION}]...`);
  try {
    const output = execSync(`gcloud scheduler jobs list --location=${REGION} --project=${PROJECT_ID}`, { encoding: 'utf-8' });
    console.info(output || 'ℹ️ No hay trabajos registrados.');
  } catch (err) {
    console.error(`❌ Error consultando trabajos: ${err.message}`);
  }
}

function triggerJob(jobName) {
  console.info(`\n⚡ Disparando ejecución manual de [${jobName}] en [${REGION}]...`);
  try {
    const output = execSync(`gcloud scheduler jobs run ${jobName} --location=${REGION} --project=${PROJECT_ID}`, { encoding: 'utf-8' });
    console.info(`✅ Disparo completado con éxito.`);
    if (output) console.info(output);
  } catch (err) {
    console.error(`❌ Error disparando trabajo: ${err.message}`);
  }
}

function upsertJob(job) {
  const { name, schedule, uri, description, bodyStr } = job;
  console.info(`\n⚙️ Configurando trabajo [${name}]...`);

  const checkCmd = `gcloud scheduler jobs describe ${name} --location=${REGION} --project=${PROJECT_ID} --format="value(name)"`;
  const exists = runGcloud(checkCmd, true);

  const headers = `"X-Cron-Secret=${CRON_SECRET},Content-Type=application/json"`;
  const messageBody = `"${bodyStr.replace(/"/g, '\\"')}"`;

  if (exists) {
    console.info(`🔄 Actualizando trabajo existente [${name}]...`);
    const updateCmd = `gcloud scheduler jobs update http ${name} --location=${REGION} --project=${PROJECT_ID} --schedule="${schedule}" --time-zone="America/New_York" --uri="${uri}" --http-method=POST --headers=${headers} --message-body=${messageBody} --description="${description}" --quiet`;
    runGcloud(updateCmd);
    console.info(`✅ [${name}] actualizado.`);
  } else {
    console.info(`🆕 Creando nuevo trabajo [${name}]...`);
    const createCmd = `gcloud scheduler jobs create http ${name} --location=${REGION} --project=${PROJECT_ID} --schedule="${schedule}" --time-zone="America/New_York" --uri="${uri}" --http-method=POST --headers=${headers} --message-body=${messageBody} --description="${description}" --quiet`;
    runGcloud(createCmd);
    console.info(`✅ [${name}] creado exitosamente.`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    listJobs();
    return;
  }

  const runIdx = args.indexOf('--run');
  if (runIdx !== -1 && args[runIdx + 1]) {
    triggerJob(args[runIdx + 1]);
    return;
  }

  console.info('======================================================================');
  console.info('⏰ INVEST AI — APROVISIONAMIENTO DE GOOGLE CLOUD SCHEDULER');
  console.info('======================================================================\n');

  console.info('🔌 Habilitando API de Cloud Scheduler (si no está activa)...');
  runGcloud(`gcloud services enable cloudscheduler.googleapis.com --project=${PROJECT_ID} --quiet`, true);

  const baseUrl = getServiceUrl();

  const jobs = [
    {
      name: 'invest-ai-market-scanner',
      schedule: '*/15 9-16 * * 1-5',
      uri: `${baseUrl}/api/cron/scan`,
      description: 'Invest AI - Escaneo cuantitativo cada 15m en horario Wall Street',
      bodyStr: '{"force":false}',
    },
    {
      name: 'invest-ai-portfolio-guard',
      schedule: '*/5 9-16 * * 1-5',
      uri: `${baseUrl}/api/cron/portfolio`,
      description: 'Invest AI - Guardian de Take-Profit y Stop-Loss cada 5m en Wall Street',
      bodyStr: '{}',
    },
  ];

  for (const job of jobs) {
    upsertJob(job);
  }

  console.info('\n✨ Aprovisionamiento de Cloud Scheduler finalizado con éxito.');
  listJobs();
}

main().catch((err) => {
  console.error(`\n❌ Error fatal en configuración de Scheduler: ${err.message}`);
  process.exit(1);
});
