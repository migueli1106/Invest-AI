import { env } from '../config/environment.js';
import { moomooService } from '../services/broker/moomooService.js';

/**
 * 🛰️ [INVEST AI] Daemon Worker Residencial para Moomoo OpenD
 * Sondea a Cloud Run (/api/bridge/pending), despacha órdenes vía OpenD y
 * sincroniza periódicamente el saldo real de la cuenta (cada 5m).
 */
class LocalBridgeWorker {
  constructor(options = {}) {
    this.cloudRunUrl = options.cloudRunUrl || env.CLOUD_RUN_URL || 'https://invest-ai-engine-891662254338.us-central1.run.app';
    this.bridgeSecret = options.bridgeSecret || env.BRIDGE_SECRET || 'invest_ai_bridge_internal_secret';
    this.intervalMs = Number(options.intervalMs || 4000);
    this.syncIntervalMs = Number(options.syncIntervalMs || 5 * 60 * 1000);
    this.dryRun = options.dryRun !== undefined ? options.dryRun : false;
    this.isRunning = false;
    this.timerHandle = null;
    this.syncTimerHandle = null;
    this.isProcessing = false;
  }

  parseCliArgs(args = process.argv.slice(2)) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--dry-run' || arg === '--simulated') this.dryRun = true;
      else if (arg === '--interval' && args[i + 1]) { this.intervalMs = Math.max(1000, Number(args[++i])); }
      else if (arg.startsWith('--interval=')) { this.intervalMs = Math.max(1000, Number(arg.split('=')[1])); }
      else if (arg === '--cloud-url' && args[i + 1]) { this.cloudRunUrl = args[++i]; }
    }
  }

  async fetchPendingOrders() {
    const url = `${this.cloudRunUrl.replace(/\/$/, '')}/api/bridge/pending`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json', 'X-Bridge-Secret': this.bridgeSecret } });
    if (!res.ok) throw new Error(`HTTP ${res.status} al consultar órdenes: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    return data.orders || [];
  }

  async reportCompletion(payload) {
    const url = `${this.cloudRunUrl.replace(/\/$/, '')}/api/bridge/complete`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': this.bridgeSecret },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al reportar orden: ${await res.text().catch(() => '')}`);
    return await res.json();
  }

  async syncBalance() {
    try {
      const summary = await moomooService.getAccountSummary(this.dryRun ? 'SIMULATE' : (env.MOOMOO_TRD_ENV || 'SIMULATE'));
      const url = `${this.cloudRunUrl.replace(/\/$/, '')}/api/bridge/sync-balance`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': this.bridgeSecret },
        body: JSON.stringify(summary),
      });
      if (res.ok) {
        console.info(`💼 [WORKER SYNC] Saldo Moomoo sincronizado con Cloud Run ($${summary.cash} USD efectivo).`);
      }
      return summary;
    } catch (err) {
      console.warn(`⚠️ [WORKER SYNC] Error sincronizando balance con Cloud Run: ${err.message}`);
      return null;
    }
  }

  async processPendingCycle() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const pendingOrders = await this.fetchPendingOrders();
      if (pendingOrders.length > 0) {
        console.info(`📬 [WORKER MOOMOO] Detectadas ${pendingOrders.length} orden(es) en Cloud Run.`);
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
      try {
        await this.reportCompletion({
          bridgeOrderId,
          status: 'CANCELLED',
          notes: `Fallo en Moomoo OpenD: ${err.message}. Fondos liberados.`,
        });
        console.info(`🔒 [WORKER] Fondos ($${notional} USD) liberados en Cloud Run para ${bridgeOrderId}.`);
      } catch (reportErr) {
        console.error(`🚨 [CRITICAL] Error notificando cancelación: ${reportErr.message}`);
      }
    }
  }

  start() {
    this.parseCliArgs();
    this.isRunning = true;
    console.info('🚀 [INVEST AI] Worker Local Residencial para Moomoo OpenD iniciado.');
    this.timerHandle = setInterval(() => this.processPendingCycle(), this.intervalMs);
    this.syncTimerHandle = setInterval(() => this.syncBalance(), this.syncIntervalMs);
    this.processPendingCycle();
    this.syncBalance();
  }

  stop() {
    this.isRunning = false;
    if (this.timerHandle) { clearInterval(this.timerHandle); this.timerHandle = null; }
    if (this.syncTimerHandle) { clearInterval(this.syncTimerHandle); this.syncTimerHandle = null; }
    console.info('🛑 [INVEST AI] Worker Local Residencial detenido.');
  }
}

export const localBridgeWorker = new LocalBridgeWorker();

const isDirectCli = process.argv[1] && process.argv[1].endsWith('localBridgeWorker.js');
if (isDirectCli && process.env.NODE_ENV !== 'test') {
  localBridgeWorker.start();
  const shutdown = () => { localBridgeWorker.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
