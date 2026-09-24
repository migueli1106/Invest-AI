process.env.NODE_ENV = 'test';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { server } from '../../src/server.js';

describe('🖥️ Suite de Pruebas Unitarias: Despachador de Archivos Estáticos & PWA (Invest AI)', () => {
  let baseUrl;

  before(async () => {
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
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('GET / debe servir public/index.html con HTTP 200 y Content-Type text/html', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/html'));
    const html = await res.text();
    assert.ok(html.includes('INVEST AI'));
    assert.ok(html.includes('capitalChart'));
  });

  it('GET /dashboard debe servir public/index.html como alias amigable', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/html'));
    const html = await res.text();
    assert.ok(html.includes('ZERO_REFUND'));
  });

  it('GET /css/dashboard.css debe servir la hoja de estilos con Content-Type text/css', async () => {
    const res = await fetch(`${baseUrl}/css/dashboard.css`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/css'));
    const css = await res.text();
    assert.ok(css.includes('--bg-canvas'));
    assert.ok(css.includes('--color-green'));
  });

  it('GET /js/app.js debe servir la lógica reactiva con Content-Type text/javascript', async () => {
    const res = await fetch(`${baseUrl}/js/app.js`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/javascript'));
    const js = await res.text();
    assert.ok(js.includes('fetchTelemetry'));
  });

  it('GET /manifest.json debe servir el manifiesto PWA con Content-Type application/json', async () => {
    const res = await fetch(`${baseUrl}/manifest.json`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('application/json'));
    const manifest = await res.json();
    assert.equal(manifest.short_name, 'Invest AI');
    assert.equal(manifest.display, 'standalone');
  });

  it('GET /icon.svg debe servir el icono vectorial con Content-Type image/svg+xml', async () => {
    const res = await fetch(`${baseUrl}/icon.svg`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('image/svg+xml'));
    const svg = await res.text();
    assert.ok(svg.includes('<svg'));
  });

  it('Seguridad Zero-Trust: Intento de Directory Traversal (GET /../package.json) debe responder 403 Forbidden', async () => {
    const port = Number(new URL(baseUrl).port);
    const status = await new Promise((resolve, reject) => {
      const clientReq = http.get({ host: '127.0.0.1', port, path: '/../package.json' }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            assert.equal(json.error, 'Forbidden');
            resolve(res.statusCode);
          } catch (e) {
            resolve(res.statusCode);
          }
        });
      });
      clientReq.on('error', reject);
    });
    assert.equal(status, 403);
  });

  it('GET a recurso estático inexistente debe responder 404 Ruta no encontrada', async () => {
    const res = await fetch(`${baseUrl}/archivo_inexistente_123.xyz`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'Ruta no encontrada');
  });

  it('GET /health debe mantenerse intacto retornando HTTP 200 JSON con HEALTHY', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('application/json'));
    const data = await res.json();
    assert.equal(data.status, 'HEALTHY');
    assert.equal(data.service, 'invest-ai-engine');
  });
});
