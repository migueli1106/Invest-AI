process.env.NODE_ENV = 'test';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../../src/server.js';
import { env } from '../../src/config/environment.js';
import { schedulerService } from '../../src/services/schedulerService.js';

describe('🔒 Suite de Seguridad y Autenticación de Rutas Cron (Cloud Scheduler)', () => {
  let baseUrl;
  let originalScan;
  let originalCheck;

  before(async () => {
    originalScan = schedulerService.runAutonomousMarketScan;
    originalCheck = schedulerService.runPortfolioHealthCheck;
    schedulerService.runAutonomousMarketScan = async () => ({ executed: true, scannedCount: 5, dispatchedCount: 0 });
    schedulerService.runPortfolioHealthCheck = async () => ({ executed: true, checkedPositions: 2, alertsSent: 0 });

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
  });

  after(async () => {
    schedulerService.runAutonomousMarketScan = originalScan;
    schedulerService.runPortfolioHealthCheck = originalCheck;
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('POST /api/cron/scan debe rechazar con 401 si no hay cabecera de autenticación', async () => {
    const res = await fetch(`${baseUrl}/api/cron/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/);
  });

  it('POST /api/cron/scan debe rechazar con 401 si la cabecera X-Cron-Secret es inválida', async () => {
    const res = await fetch(`${baseUrl}/api/cron/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': 'secreto_falso_invalido',
      },
      body: JSON.stringify({ force: false }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/);
  });

  it('POST /api/cron/scan debe aceptar con 200 cuando X-Cron-Secret es válido', async () => {
    const res = await fetch(`${baseUrl}/api/cron/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': env.CRON_SECRET,
      },
      body: JSON.stringify({ force: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  it('POST /api/cron/scan debe aceptar con 200 cuando X-CloudScheduler es true', async () => {
    const res = await fetch(`${baseUrl}/api/cron/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CloudScheduler': 'true',
      },
      body: JSON.stringify({ force: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  it('POST /api/cron/portfolio debe rechazar con 401 si no hay cabecera de autenticación', async () => {
    const res = await fetch(`${baseUrl}/api/cron/portfolio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/);
  });

  it('POST /api/cron/portfolio debe rechazar con 401 si X-Cron-Secret es incorrecto', async () => {
    const res = await fetch(`${baseUrl}/api/cron/portfolio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': 'hacker_token',
      },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/);
  });

  it('POST /api/cron/portfolio debe aceptar con 200 cuando X-Cron-Secret es válido', async () => {
    const res = await fetch(`${baseUrl}/api/cron/portfolio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': env.CRON_SECRET,
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  it('POST /api/cron/portfolio debe aceptar con 200 cuando X-CloudScheduler es true', async () => {
    const res = await fetch(`${baseUrl}/api/cron/portfolio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CloudScheduler': 'true',
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });
});
