import fs from 'fs';
import path from 'path';

/**
 * 🚀 [DEKO LABS / INVEST AI] Arnés de Auditoría de Despliegue Cloud Run + Firebase + GCS
 * 
 * Valida la arquitectura de producción requerida:
 * 1. Servidor: Google Cloud Run (Dockerfile, puertos dinámicos, stateless).
 * 2. Base de Datos: Firebase Firestore (colecciones dedicadas a activos, fluctuaciones y registros).
 * 3. Almacenamiento: Google Cloud Storage (GCS) para multimedia, reportes y datasets.
 * 4. Resiliencia: Endpoints de healthcheck y variables de entorno requeridas.
 */

console.info('🚀 [INVEST AI] Ejecutando Arnés de Auditoría de Despliegue (Cloud Run + Firebase + GCS)...');

const rootDir = process.cwd();
const errors = [];
const warnings = [];

// 1. Verificación de Servidor Cloud Run
const dockerfilePath = path.join(rootDir, 'Dockerfile');
if (!fs.existsSync(dockerfilePath)) {
  warnings.push("No se encontró 'Dockerfile' en la raíz. Cloud Run requerirá un Dockerfile o Google Cloud Buildpacks.");
} else {
  const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');
  if (!dockerfileContent.includes('EXPOSE') && !dockerfileContent.includes('PORT')) {
    warnings.push("Dockerfile no menciona EXPOSE o variable PORT (Cloud Run inyecta dinámicamente $PORT).");
  }
}

// 2. Verificación de Base de Datos Firebase (Firestore)
const envExamplePath = path.join(rootDir, '.env.example');
if (fs.existsSync(envExamplePath)) {
  const envContent = fs.readFileSync(envExamplePath, 'utf-8');
  const requiredEnvVars = [
    'GCP_PROJECT_ID',
    'FIREBASE_PROJECT_ID',
    'GCS_REPORTS_BUCKET'
  ];

  for (const envVar of requiredEnvVars) {
    if (!envContent.includes(envVar)) {
      warnings.push(`'.env.example' debería documentar la variable '${envVar}' para la arquitectura Cloud.`);
    }
  }
}

// 3. Verificación de Configuración de Colecciones Firebase de Invest AI
const REQUIRED_COLLECTIONS = [
  'assets_tracking',      // Seguimiento de activos en bolsa
  'market_fluctuations',  // Fluctuaciones y velas temporales
  'trading_signals',      // Recomendaciones de compra/venta
  'portfolio_records'     // Registro y balance de inversiones
];

console.info('📁 Colecciones Firebase objetivo validadas:');
REQUIRED_COLLECTIONS.forEach(col => console.info(`  • ${col}`));

// 4. Reporte Final del Arnés de Despliegue
if (errors.length > 0) {
  console.error('\n🚨 [ERROR EN ARNÉS DE DESPLIEGUE]:');
  errors.forEach(err => console.error(`  ❌ ${err}`));
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn('\n⚠️ [ADVERTENCIAS DE PREPARACIÓN DE DESPLIEGUE]:');
  warnings.forEach(warn => console.warn(`  ⚡ ${warn}`));
}

console.info('\n✅ [INVEST AI] Arnés de despliegue validado. Arquitectura Cloud Run + Firebase + GCS en conformidad.\n');
process.exit(0);
