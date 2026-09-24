process.env.NODE_ENV = 'test';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../../src/server.js';
import { env } from '../../src/config/environment.js';
import { localBridgeWorker } from '../../src/worker/localBridgeWorker.js';
import { hapiBrowserAutomation } from '../../src/worker/hapiBrowserAutomation.js';
import { localBridgeService } from '../../src/services/broker/localBridgeService.js';
import { capitalManagerService } from '../../src/services/capitalManagerService.js';

describe('🛰️ Suite de Pruebas Unitarias: Worker Local de Automatización Residencial (Opción B)', () => {
  let baseUrl;
  let origInfo;
  let origWarn;

  before(async () => {
    origInfo = console.info;
    origWarn = console.warn;
    console.info = () => {};
    console.warn = () => {};

    if (!server.listening) {
      await new Promise((resolve) => {
        server.listen(0, () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    } else {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
    }

    localBridgeWorker.cloudRunUrl = baseUrl;
    localBridgeWorker.bridgeSecret = env.BRIDGE_SECRET;
  });

  after(async () => {
    localBridgeWorker.stop();
    localBridgeService.clear();
    capitalManagerService.reset(35.00);

    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }

    console.info = origInfo;
    console.warn = origWarn;
  });

  beforeEach(() => {
    localBridgeWorker.stop();
    localBridgeWorker.dryRun = true;
    localBridgeService.clear();
    capitalManagerService.reset(35.00);
  });

  // 1. Detección y Configuración de Navegador
  it('Debe localizar el ejecutable de Chrome o soportar fallback defensivo', () => {
    const chrome = hapiBrowserAutomation.findChromeExecutable();
    // En Windows debe encontrar el path si existe, o retornar null/string
    assert.ok(chrome === null || typeof chrome === 'string');
    assert.equal(hapiBrowserAutomation.profileDir, './.hapi-profile');
  });

  // 2. Ejecución en Modo Dry-Run / Simulado
  it('Modo --dry-run: debe simular compra calculando acciones sin dinero real', async () => {
    const order = {
      bridgeOrderId: 'bridge_test_dryrun_1',
      symbol: 'AAPL',
      notional: 35.00,
      currentPrice: 220.00,
    };

    const result = await hapiBrowserAutomation.executeBuy(order, { dryRun: true });
    assert.equal(result.success, true);
    assert.equal(result.simulated, true);
    assert.equal(result.status, 'FILLED');
    assert.equal(result.symbol, 'AAPL');
    assert.equal(result.executedShares, 0.1591);
    assert.equal(result.fillPrice, 220.00);
  });

  // 3. Consulta de Órdenes Pendientes vía HTTP a Cloud Run
  it('fetchPendingOrders debe consultar Cloud Run con X-Bridge-Secret', async () => {
    localBridgeService.queueOrder({ symbol: 'MSFT', qty: 0.08, notional: 35.00, currentPrice: 420.00 });
    const orders = await localBridgeWorker.fetchPendingOrders();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].symbol, 'MSFT');
    assert.equal(orders[0].notional, 35.00);
  });

  // 4. Procesamiento Exitoso de Orden (status: FILLED)
  it('handleSingleOrder debe ejecutar compra simulada y reportar status FILLED a Cloud Run', async () => {
    const queued = localBridgeService.queueOrder({
      symbol: 'NVDA',
      qty: 0.25,
      notional: 35.00,
      currentPrice: 140.00,
    });

    await localBridgeWorker.handleSingleOrder(queued.order);

    const pending = localBridgeService.getPendingOrders();
    assert.equal(pending.length, 0); // La orden fue completada y purgada

    const completed = localBridgeService.getOrder(queued.bridgeOrderId);
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.fillPrice, 140.00);
  });

  // 5. FLEXIBLE_CAPITAL: Resiliencia y Liberación Inmediata de Capital ante Fallos
  it('Ante un fallo del navegador, debe reportar CANCELLED y liberar los $35 USD en Cloud Run', async () => {
    const queued = localBridgeService.queueOrder({
      symbol: 'TSLA',
      qty: 0.15,
      notional: 35.00,
      currentPrice: 230.00,
    });

    // Capital preventivo reservado ($0 disponible)
    assert.equal(capitalManagerService.getCapitalStatus().availableCash, 0.00);

    // Forzar fallo simulando excepción en executeBuy
    const originalExecute = hapiBrowserAutomation.executeBuy;
    hapiBrowserAutomation.executeBuy = async () => {
      throw new Error('Timeout al esperar selector de confirmación de Happi');
    };

    try {
      await localBridgeWorker.handleSingleOrder(queued.order);

      // Verificar que se reportó CANCELLED y se liberó el capital
      const order = localBridgeService.getOrder(queued.bridgeOrderId);
      assert.equal(order.status, 'CANCELLED');
      assert.ok(order.notes.includes('Timeout'));

      // Regla FLEXIBLE_CAPITAL: los $35 USD vuelven a estar 100% libres
      const cap = capitalManagerService.getCapitalStatus();
      assert.equal(cap.availableCash, 35.00);
      assert.equal(cap.deployedCapital, 0.00);
    } finally {
      hapiBrowserAutomation.executeBuy = originalExecute;
    }
  });

  // 6. Ciclo Completo de Sondeo (processPendingCycle)
  it('processPendingCycle debe consumir todas las órdenes encoladas', async () => {
    localBridgeService.queueOrder({ symbol: 'AMZN', qty: 0.18, notional: 35.00, currentPrice: 190.00 });
    assert.equal(localBridgeService.getPendingOrders().length, 1);

    await localBridgeWorker.processPendingCycle();

    assert.equal(localBridgeService.getPendingOrders().length, 0);
  });

  // 7. Parsing de Banderas CLI
  it('parseCliArgs debe configurar banderas --dry-run e --interval', () => {
    const testWorker = new (localBridgeWorker.constructor)();
    testWorker.parseCliArgs(['--dry-run', '--interval', '2500', '--cloud-url', 'http://test:9090']);
    assert.equal(testWorker.dryRun, true);
    assert.equal(testWorker.intervalMs, 2500);
    assert.equal(testWorker.cloudRunUrl, 'http://test:9090');
  });

  // 8. Control de Ciclo de Vida del Daemon (start/stop)
  it('start y stop deben administrar el temporizador de polling limpiamente', () => {
    localBridgeWorker.intervalMs = 50000; // intervalo largo para no disparar eventos
    localBridgeWorker.start();
    assert.equal(localBridgeWorker.isRunning, true);
    assert.ok(localBridgeWorker.timerHandle !== null);

    localBridgeWorker.stop();
    assert.equal(localBridgeWorker.isRunning, false);
    assert.equal(localBridgeWorker.timerHandle, null);
  });
});
