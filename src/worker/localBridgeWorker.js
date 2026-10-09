import { env } from '../config/environment.js';
import { moomooService } from '../services/broker/moomooService.js';

/**
 * 🛰️ [INVEST AI] Daemon Worker Residencial para Moomoo OpenD
 * Sondea periódicamente a Cloud Run (/api/bridge/pending) y despacha
 * las órdenes directamente mediante Moomoo OpenD Gateway, reportando el fill.
 */
class LocalBridgeWorker {
  constructor(options = {}) {
    this.cloudRunUrl = options.cloudRunUrl || env.CLOUD_RUN_URL || 'https://invest-ai-engine-891662254338.us-central1.run.app';
    this.bridgeSecret = options.bridgeSecret || env.BRIDGE_SECRET || 'invest_ai_bridge_internal_secret';
    this.intervalMs = Number(options.intervalMs || 4000);
    this.dryRun = options.dryRun !== undefined ? options.dryRun : false;
    this.isRunning = false;
    this.timerHandle = null;
    this.isProcessing = false;
  }

  /**
   * Parsea banderas CLI (`--dry-run`, `--interval <ms>`, `--cloud-url <url>`).
   */
  parseCliArgs(args = process.argv.slice(2)) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--dry-run' || arg === '--simulated') {
        this.dryRun = true;
      } else if (arg === '--interval' && args[i + 1]) {
        this.intervalMs = Math.max(1000, Number(args[i + 1]));
        i++;
      } else if (arg.startsWith('--interval=')) {
        this.intervalMs = Math.max(1000, Number(arg.split('=')[1]));
      } else if (arg === '--cloud-url' && args[i + 1]) {
        this.cloudRunUrl = args[i + 1];
        i++;
      }
    }
  }

  /**
   * Consulta las órdenes pendientes en el endpoint seguro de Cloud Run.
   */
  async fetchPendingOrders() {
    const url = `${this.cloudRunUrl.replace(/\/$/, '')}/api/bridge/pending`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Bridge-Secret': this.bridgeSecret,
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} al consultar órdenes pendientes: ${errText}`);
    }

    const data = await res.json();
    return data.orders || [];
  }

  /**
   * Reporta el resultado de la ejecución (FILLED o CANCELLED) a Cloud Run.
   */
  async reportCompletion(completionPayload) {
    const url = `${this.cloudRunUrl.replace(/\/$/, '')}/api/bridge/complete`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Secret': this.bridgeSecret,
      },
      body: JSON.stringify(completionPayload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} al reportar orden: ${errText}`);
    }

    return await res.json();
  }

  /**
   * Ejecuta un ciclo de sondeo de órdenes pendientes.
   */
  async processPendingCycle() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const pendingOrders = await this.fetchPendingOrders();
      if (pendingOrders.length > 0) {
        console.info(`📬 [WORKER MOOMOO] Detectadas ${pendingOrders.length} orden(es) pendiente(s) en Cloud Run.`);
      }

      for (const order of pendingOrders) {
        await this.handleSingleOrder(order);
      }
    } catch (err) {
      console.warn(`⚠️ [WORKER POLLING]: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Procesa una orden individual enviándola directamente a Moomoo OpenD.
   * Regla FLEXIBLE_CAPITAL: ante cualquier fallo, cancela y concilia fondos de inmediato.
   */
  async handleSingleOrder(order) {
    const { bridgeOrderId, symbol, notional, currentPrice, side, qty } = order;
    console.info(`⚡ [WORKER MOOMOO] Procesando orden ${bridgeOrderId} para ${symbol} ($${notional} USD)...`);

    try {
      const cleanQty = qty || (notional && currentPrice ? Math.max(1, Math.round(notional / currentPrice)) : 1);
      const execution = await moomooService.executeOrder({
        symbol,
        qty: cleanQty,
        price: currentPrice || 100.0,
        side: side || 'BUY',
        trdEnv: this.dryRun ? 'SIMULATE' : (env.MOOMOO_TRD_ENV || 'SIMULATE'),
      });

      const fillPrice = execution.price || currentPrice || 100.0;
      const executedShares = execution.qty || cleanQty;
      const orderId = execution.orderId || `moo_${Date.now()}`;

      await this.reportCompletion({
        bridgeOrderId,
        fillPrice,
        executedShares,
        status: 'FILLED',
        orderId,
        notes: `Ejecutado oficialmente en Moomoo OpenD (Order ID: ${orderId})`,
      });

      console.info(`🎉 [WORKER MOOMOO] Orden ${bridgeOrderId} completada en OpenD (ID: ${orderId}, Fill: $${fillPrice}).`);
    } catch (err) {
      console.error(`💥 [WORKER ERROR] Falló orden ${bridgeOrderId}: ${err.message}`);

      // FLEXIBLE_CAPITAL: Cancelar y conciliar fondos en Cloud Run
      try {
        await this.reportCompletion({
          bridgeOrderId,
          status: 'CANCELLED',
          notes: `Fallo en Moomoo OpenD: ${err.message}. Fondos liberados.`,
        });
        console.info(`🔒 [WORKER] Fondos ($${notional} USD) liberados en Cloud Run para ${bridgeOrderId}.`);
      } catch (reportErr) {
        console.error(`🚨 [CRITICAL] No se pudo notificar cancelación a Cloud Run: ${reportErr.message}`);
      }
    }
  }

  /**
   * Inicia el daemon en segundo plano con bucle de sondeo periódico.
   */
  start() {
    this.parseCliArgs();
    this.isRunning = true;
    console.info('🚀 [INVEST AI] Worker Local Residencial para Moomoo OpenD iniciado.');
    console.info(`   • Destino Cloud Run: ${this.cloudRunUrl}`);
    console.info(`   • Frecuencia de Sondeo: ${this.intervalMs}ms`);
    console.info(`   • Modo: ${this.dryRun ? 'DRY-RUN (Simulado)' : 'LIVE (Moomoo OpenD)'}`);

    this.timerHandle = setInterval(() => {
      this.processPendingCycle();
    }, this.intervalMs);

    this.processPendingCycle();
  }

  /**
   * Detiene el daemon limpiamente.
   */
  stop() {
    this.isRunning = false;
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    console.info('🛑 [INVEST AI] Worker Local Residencial detenido.');
  }
}

export const localBridgeWorker = new LocalBridgeWorker();

// Inicialización si se ejecuta directamente por CLI
const isDirectCli = process.argv[1] && process.argv[1].endsWith('localBridgeWorker.js');
if (isDirectCli && process.env.NODE_ENV !== 'test') {
  localBridgeWorker.start();

  const shutdown = () => {
    localBridgeWorker.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
