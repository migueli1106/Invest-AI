import fs from 'fs';
import path from 'path';

/**
 * 📏 [DEKO LABS / INVEST AI] Auditor de Monolitos y Regla Anti-Ravioli
 * 
 * Filosofía de Dominio:
 * 1. Cohesión de dominio mata a micro-despiece ciego.
 * 2. Dividir un archivo sano únicamente porque supera 200 líneas produce
 *    "código ravioli" que destruye la mantenibilidad del sistema.
 * 3. Se establecen techos idiomáticos por capa y una matriz DOMAIN_CEILINGS
 *    para archivos cohesivos de inversión y algoritmos.
 */

console.info('📏 [INVEST AI] Auditando límites de tamaño y deuda monolítica con criterios de dominio...');

const rootDir = process.cwd();
const dirsToScan = ['src', 'server', 'lib', 'app', 'services', 'api'];

// 🛡️ 1. Techos específicos por archivo con cohesión autorizada
export const DOMAIN_CEILINGS = {
  // 'src/services/marketAnalyzer.js': { max: 500, reason: 'Servicio central de análisis de fluctuaciones y señales' },
};

// 🛡️ 2. Techos Idiomáticos por Defecto según Capa Arquitectónica
export const LAYER_DEFAULT_CEILINGS = {
  semantic: 800,      // Diccionarios declarativos, constantes financieras y taxonomías
  services: 500,      // Motores cuantitativos, cálculo de riesgo y servicios de dominio
  routes: 500,        // Manifiestos centrales de endpoints / API Gateway
  controllers: 350,   // Controladores HTTP y orquestación Cloud Run
  hooks: 350,         // Hooks de estado complejo React / WebSocket
  validators: 250,    // Esquemas Zod / Joi de validación de órdenes
  components: 280,    // Componentes de interfaz de usuario (Cards de señales, gráficos)
  default: 350,       // Techo general por defecto
};

function getLayerDefaultCeiling(relativePath) {
  const norm = relativePath.replace(/\\/g, '/');
  if (norm.includes('/semantic/') || norm.includes('/constants/')) return LAYER_DEFAULT_CEILINGS.semantic;
  if (norm.includes('/services/') || norm.includes('/quant/')) return LAYER_DEFAULT_CEILINGS.services;
  if (norm.includes('/controllers/')) return LAYER_DEFAULT_CEILINGS.controllers;
  if (norm.includes('/routes/')) return LAYER_DEFAULT_CEILINGS.routes;
  if (norm.includes('/validators/') || norm.includes('/schemas/')) return LAYER_DEFAULT_CEILINGS.validators;
  if (norm.includes('/hooks/') || norm.includes('/context/')) return LAYER_DEFAULT_CEILINGS.hooks;
  if (norm.includes('/components/')) return LAYER_DEFAULT_CEILINGS.components;
  return LAYER_DEFAULT_CEILINGS.default;
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').length;
}

const allViolations = [];
const orphanServiceFiles = [];

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'build', '.git', 'coverage', '.agents', 'tests', 'scripts'].includes(entry.name)) {
        scanDir(fullPath);
      }
    } else if (/\.(js|jsx|ts|tsx|py|vue|svelte)$/i.test(entry.name)) {
      const lines = countLines(fullPath);
      const isCustomCeiling = DOMAIN_CEILINGS[relPath];
      const maxAllowed = isCustomCeiling ? isCustomCeiling.max : getLayerDefaultCeiling(relPath);

      if (lines > maxAllowed) {
        allViolations.push({
          file: relPath,
          lines,
          max: maxAllowed,
          excess: lines - maxAllowed,
          isCustom: !!isCustomCeiling,
          reason: isCustomCeiling ? isCustomCeiling.reason : 'Límite por capa',
        });
      }

      // Alerta anti-ravioli: Si alguien creó un archivo de servicio minúsculo (<40 líneas) solo para evadir líneas
      if (relPath.includes('/services/') && lines < 40 && !entry.name.includes('index')) {
        orphanServiceFiles.push({ file: relPath, lines });
      }
    }
  }
}

for (const dir of dirsToScan) {
  scanDir(path.join(rootDir, dir));
}

// 1. Mostrar archivos con techos autorizados
const customKeys = Object.keys(DOMAIN_CEILINGS);
if (customKeys.length > 0) {
  console.info('\n🟢 Archivos con Cohesión Autorizada:');
  for (const k of customKeys) {
    const p = path.join(rootDir, k);
    if (fs.existsSync(p)) {
      const lines = countLines(p);
      console.info(`  ✅ ${k} (${lines}/${DOMAIN_CEILINGS[k].max} líneas) — ${DOMAIN_CEILINGS[k].reason}`);
    }
  }
}

// 2. Alertas Anti-Ravioli
if (orphanServiceFiles.length > 0) {
  console.info('\n🍝 Alerta Informativa Anti-Ravioli (Servicios micro-fragmentados <40 líneas):');
  for (const o of orphanServiceFiles) {
    console.info(`  ℹ️ ${o.file} (${o.lines} líneas) — Evaluar si pertenece a un servicio cohesivo mayor.`);
  }
}

// 3. Evaluar violaciones reales
if (allViolations.length > 0) {
  console.error('\n🚨 [INVEST AI] Archivos que exceden los límites arquitectónicos permitidos:');
  for (const v of allViolations) {
    console.error(`  ❌ ${v.file}: ${v.lines} líneas (Máximo permitido: ${v.max} | Exceso: +${v.excess} líneas)`);
    console.error(`     Regla: ${v.reason}`);
  }
  console.error('\n👉 Protocolo ante excedentes:');
  console.error('   1. Si el archivo mezcla capas, refactoriza separando responsabilidades.');
  console.error('   2. Si el archivo pertenece 100% a su dominio y no mezcla capas, regístralo con justificación en DOMAIN_CEILINGS.');
  console.error('   3. JAMÁS lo despedaces a ciegas en micro-archivos ravioli.\n');
  process.exit(1);
}

console.info('\n✨ ¡Excelente! Cero archivos exceden sus límites arquitectónicos.');
console.info('💡 Total archivos que exceden su límite: 0\n');
process.exit(0);
