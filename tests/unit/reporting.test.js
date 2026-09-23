process.env.NODE_ENV = 'test';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { reportingService } from '../../src/services/reportingService.js';
import { gcsStorageService } from '../../src/storage/gcsStorageService.js';
import { telegramService } from '../../src/services/telegramService.js';
import { server } from '../../src/server.js';
import { env } from '../../src/config/environment.js';

describe('📊 Suite de Pruebas Unitarias: Motor de Reportería Cuantitativa y GCS (Invest AI)', () => {
  let baseUrl;
  let didStartLocally = false;

  before(async () => {
    if (!server.listening) {
      await new Promise((resolve) => {
        server.listen(0, () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          didStartLocally = true;
          resolve();
        });
      });
    } else {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
    }
  });

  after(async () => {
    gcsStorageService.clearSimulation();
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('📐 1. Métricas Cuantitativas de Trading (Win Rate, Profit Factor, P&L)', () => {
    it('Debe calcular Win Rate y Profit Factor correctamente con operaciones mixtas', async () => {
      const mockClosed = [
        { symbol: 'AAPL', realizedPnL: 15.00, shares: 1, averageBuyPrice: 150 },
        { symbol: 'NVDA', realizedPnL: 25.00, shares: 1, averageBuyPrice: 100 },
        { symbol: 'MSFT', realizedPnL: -10.00, shares: 1, averageBuyPrice: 200 },
        { symbol: 'SPY', realizedPnL: -10.00, shares: 1, averageBuyPrice: 400 },
      ];

      const report = await reportingService.generateReportJson({
        overridePositions: [],
        overrideClosedPositions: mockClosed,
      });

      assert.equal(report.metrics.totalClosedTrades, 4);
      assert.equal(report.metrics.winningTradesCount, 2);
      assert.equal(report.metrics.losingTradesCount, 2);
      assert.equal(report.metrics.winRatePercent, 50.0);
      assert.equal(report.metrics.grossProfit, 40.00);
      assert.equal(report.metrics.grossLoss, 20.00);
      assert.equal(report.metrics.profitFactor, 2.0); // 40 / 20 = 2.0
      assert.equal(report.metrics.realizedPnLTotal, 20.00);
    });

    it('Debe manejar caso borde de CERO operaciones cerradas sin dividir por cero', async () => {
      const report = await reportingService.generateReportJson({
        overridePositions: [],
        overrideClosedPositions: [],
      });

      assert.equal(report.metrics.totalClosedTrades, 0);
      assert.equal(report.metrics.winRatePercent, 0);
      assert.equal(report.metrics.profitFactor, 0);
      assert.equal(report.metrics.realizedPnLTotal, 0);
      assert.equal(report.metrics.grossProfit, 0);
      assert.equal(report.metrics.grossLoss, 0);
    });

    it('Debe retornar Profit Factor 999.99 (infinito) cuando solo hay operaciones ganadoras', async () => {
      const mockClosed = [
        { symbol: 'NVDA', realizedPnL: 30.00, shares: 1, averageBuyPrice: 100 },
        { symbol: 'AAPL', realizedPnL: 20.00, shares: 1, averageBuyPrice: 150 },
      ];

      const report = await reportingService.generateReportJson({
        overridePositions: [],
        overrideClosedPositions: mockClosed,
      });

      assert.equal(report.metrics.winRatePercent, 100.0);
      assert.equal(report.metrics.grossLoss, 0);
      assert.equal(report.metrics.profitFactor, 999.99);
      assert.equal(report.metrics.realizedPnLTotal, 50.00);
    });

    it('Debe calcular métricas con solo operaciones perdedoras', async () => {
      const mockClosed = [
        { symbol: 'TSLA', realizedPnL: -15.00, shares: 1, averageBuyPrice: 200 },
        { symbol: 'AMD', realizedPnL: -5.00, shares: 1, averageBuyPrice: 100 },
      ];

      const report = await reportingService.generateReportJson({
        overridePositions: [],
        overrideClosedPositions: mockClosed,
      });

      assert.equal(report.metrics.winRatePercent, 0.0);
      assert.equal(report.metrics.profitFactor, 0.0);
      assert.equal(report.metrics.realizedPnLTotal, -20.00);
    });
  });

  describe('📄 2. Formato Markdown y Estructura JSON de Reporte', () => {
    it('generateReportJson debe contener secciones obligatorias de capital y broker', async () => {
      const report = await reportingService.generateReportJson({
        overridePositions: [],
        overrideClosedPositions: [],
      });

      assert.ok(report.reportId.startsWith('rep_'));
      assert.ok(report.date);
      assert.equal(report.capital.policy, 'ZERO_REFUND_STRICT');
      assert.ok(typeof report.capital.totalCapital === 'number');
      assert.ok(report.broker);
    });

    it('generateReportMarkdown debe renderizar tablas ejecutivas y emojis financieros', async () => {
      const mockPositions = [
        {
          symbol: 'NVDA',
          broker: 'Alpaca',
          shares: 0.25,
          averageBuyPrice: 100,
          currentPrice: 120,
          currentMarketValue: 30,
          unrealizedPnL: 5,
          unrealizedPnLPercent: 20,
        },
      ];

      const report = await reportingService.generateReportJson({
        overridePositions: mockPositions,
        overrideClosedPositions: [],
      });

      const md = reportingService.generateReportMarkdown(report);

      assert.match(md, /INVEST AI — REPORTE EJECUTIVO/);
      assert.match(md, /SALUD DEL POOL DE CAPITAL/);
      assert.match(md, /MÉTRICAS CUANTITATIVAS DE TRADING/);
      assert.match(md, /POSICIONES ABIERTAS EN MERCADO/);
      assert.match(md, /NVDA/);
    });
  });

  describe('🗄️ 3. Adaptador de Almacenamiento Inmutable en Google Cloud Storage (GCS)', () => {
    it('uploadReport debe operar en modo simulación seguro en entorno de test', async () => {
      const testContent = { test: true, timestamp: Date.now() };
      const result = await gcsStorageService.uploadReport({
        filename: 'test_report.json',
        content: testContent,
      });

      assert.equal(result.bucket, env.GCS_BUCKET_NAME || 'invest_ia');
      assert.equal(result.path, 'reports/test_report.json');
      assert.equal(result.simulated, true);
      assert.ok(result.sizeBytes > 0);

      const downloaded = await gcsStorageService.downloadReport('reports/test_report.json');
      assert.ok(downloaded.includes('test'));
    });

    it('generateAndArchiveReport debe archivar tanto JSON como Markdown en GCS', async () => {
      const result = await reportingService.generateAndArchiveReport({
        uploadGCS: true,
        overridePositions: [],
        overrideClosedPositions: [],
      });

      assert.ok(result.report);
      assert.ok(result.markdown);
      assert.ok(result.jsonMeta.path.endsWith('.json'));
      assert.ok(result.mdMeta.path.endsWith('.md'));
      assert.equal(result.jsonMeta.simulated, true);
    });
  });

  describe('✈️ 4. Despacho Ejecutivo a Telegram', () => {
    it('sendPortfolioReport debe estructurar la tarjeta ejecutiva sin errores', async () => {
      const report = await reportingService.generateReportJson({
        overridePositions: [],
        overrideClosedPositions: [],
      });

      const result = await telegramService.sendPortfolioReport('123456789', report);
      assert.equal(result.simulated, true);
      assert.match(result.text, /RESUMEN EJECUTIVO DE RENDIMIENTO/);
      assert.match(result.text, /Pool de Capital/);
    });
  });

  describe('🔒 5. Endpoints REST de Reportería en Cloud Run', () => {
    it('POST /api/reports/generate debe rechazar con 401 si no hay X-Cron-Secret', async () => {
      const res = await fetch(`${baseUrl}/api/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.match(data.error, /Unauthorized/);
    });

    it('POST /api/reports/generate debe responder con 200 cuando X-Cron-Secret es provisto', async () => {
      const res = await fetch(`${baseUrl}/api/reports/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': env.CRON_SECRET,
        },
        body: JSON.stringify({ uploadGCS: true, notify: true }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.report);
      assert.ok(data.jsonMeta);
      assert.ok(data.mdMeta);
    });

    it('GET /api/reports/latest debe responder con 200 y el JSON del reporte', async () => {
      const res = await fetch(`${baseUrl}/api/reports/latest`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.report);
      assert.ok(data.report.capital);
      assert.ok(data.report.metrics);
    });
  });
});
