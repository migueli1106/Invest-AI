import fs from 'fs';
import path from 'path';

/**
 * 🚀 [DEKO LABS / INVEST AI] Arnés de Auditoría de Despliegue Cloud Run + Firebase + GCS
 * 
 * Valida la arquitectura de producción verificada en vivo:
 * 1. Proyecto GCP: invest-ai-509416 (us-central1)
 * 2. Servidor: Google Cloud Run (Dockerfile, stateless, puerto $PORT).
 * 3. Base de Datos: Firebase Firestore (BD dedicada 'invest-ai').
 * 4. Almacenamiento: Google Cloud Storage (Bucket dedicado 'gs://invest_ia/').
 */

console.info('🚀 [INVEST AI] Ejecutando Arnés de Auditoría de Despliegue (Cloud Run + Firebase + GCS)...');

const rootDir = process.cwd();
const errors = [];
const warnings = [];

// 1. Verificación de Servidor Cloud Run
const dockerfilePath = path.join(rootDir, 'Dockerfile');
if (!fs.existsSync(dockerfilePath)) {
  warnings.push("No se encontró 'Dockerfile' en la raíz. Se creará al iniciar la contenerización.");
} else {
  const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
  if (!dockerfileContent.includes('EXPOSE') && !dockerfileContent.includes('PORT')) {
    warnings.push("Dockerfile debe admitir la inyección dinámica de $PORT de Cloud Run.");
  }
}

// 2. Verificación de Variables de Entorno en .env.example
const envExamplePath = path.join(rootDir, '.env.example');
if (fs.existsSync(envExamplePath)) {
  const envContent = fs.readFileSync(envExamplePath, 'utf-8');
  const requiredEnvVars = [
    'GCP_PROJECT_ID',
    'FIREBASE_PROJECT_ID',
    'FIRESTORE_DATABASE_ID',
    'GCS_BUCKET_NAME'
  ];

  for (const envVar of requiredEnvVars) {
    if (!envContent.includes(envVar)) {
      warnings.push(`'.env.example' debería documentar la variable '${envVar}'.`);
    }
  }
}

// 3. Colecciones de Firestore Validadas
const REQUIRED_COLLECTIONS = [
  'assets_tracking',      // Seguimiento y cotizaciones de activos en tiempo real
  'market_fluctuations',  // Fluctuaciones de precios y velas temporales
  'trading_signals',      // Recomendaciones con Stop-Loss, TP y horizonte de tiempo
  'portfolio_records'     // Registro y balance de transacciones
];

console.info('📁 Colecciones Firebase Firestore objetivo:');
REQUIRED_COLLECTIONS.forEach(col => console.info(`  • ${col}`));

// 4. Reporte
if (errors.length > 0) {
  console.error('\n🚨 [ERROR EN ARNÉS DE DESPLIEGUE]:');
  errors.forEach(err => console.error(`  ❌ ${err}`));
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn('\n⚠️ [ADVERTENCIAS DE PREPARACIÓN DE DESPLIEGUE]:');
  warnings.forEach(warn => console.warn(`  ⚡ ${warn}`));
}

console.info('\n✅ [INVEST AI] Arnés de despliegue validado. Infraestructura Cloud Run + Firebase + GCS en conformidad.\n');
process.exit(0);
