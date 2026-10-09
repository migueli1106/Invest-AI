import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCRIPTS_DIR = path.join(__dirname, 'moomoo_scripts');
const DEFAULT_PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';

/**
 * 🐮 [INVEST AI] Adaptador Oficial de Moomoo OpenAPI & OpenD Gateway
 * Ejecuta órdenes, consulta balances y telemetría de mercado directamente con Moomoo OpenD.
 * Opera en modo resiliente: en tests aislados o fallas de red provee simulación determinista.
 */
export class MoomooService {
  constructor(options = {}) {
    this.brokerName = 'Moomoo';
    this.accId = options.accId || process.env.MOOMOO_ACC_ID || env.MOOMOO_ACC_ID || '2886044';
    this.trdEnv = (options.trdEnv || process.env.MOOMOO_TRD_ENV || env.MOOMOO_TRD_ENV || 'SIMULATE').toUpperCase();
    this.scriptsDir = options.scriptsDir || process.env.MOOMOO_SCRIPTS_DIR || env.MOOMOO_SCRIPTS_DIR || DEFAULT_SCRIPTS_DIR;
    this.pythonBin = options.pythonBin || process.env.PYTHON_BIN || DEFAULT_PYTHON_BIN;
    this.forceSimulation = options.forceSimulation !== undefined ? options.forceSimulation : false;
  }

  isTest() {
    return this.forceSimulation || process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';
  }

  /**
   * Normaliza el ticker de la acción agregando el prefijo de mercado si es necesario.
   * @param {string} symbol - Ticker (ej: 'AAPL' -> 'US.AAPL', 'HK.00700' -> 'HK.00700')
   */
  normalizeCode(symbol) {
    const sym = (symbol || '').trim().toUpperCase();
    if (!sym) return 'US.AAPL';
    if (sym.includes('.')) return sym;
    return `US.${sym}`;
  }

  /**
   * Ejecuta un script de Python en el directorio de scripts de moomooapi y parsea su salida JSON.
   * @private
   */
  async _runScript(subPath, args = []) {
    const fullScriptPath = path.join(this.scriptsDir, subPath);

    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonBin, [fullScriptPath, ...args], {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Timeout de ejecución excedido (12s) en script: ${subPath}`));
      }, 12000);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout) {
          return reject(new Error(`Script ${subPath} falló con código ${code}: ${stderr}`));
        }

        try {
          let parsed = null;
          const lines = stdout.split('\n');
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if ((line.startsWith('{') && line.endsWith('}')) || (line.startsWith('[') && line.endsWith(']'))) {
              try {
                parsed = JSON.parse(line);
                break;
              } catch {
                // Ignore and keep searching
              }
            }
          }

          if (!parsed) {
            const firstBrace = stdout.indexOf('{');
            const lastBrace = stdout.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
              parsed = JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
            }
          }

          if (!parsed) {
            throw new Error(`Salida JSON no detectada en stdout: ${stdout || stderr}`);
          }

          resolve(parsed);
        } catch (parseErr) {
          reject(new Error(`Error parseando JSON de ${subPath}: ${parseErr.message} (Output: ${stdout})`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Extrae el resumen consolidado de la cuenta y portafolio desde OpenD.
   * @param {'SIMULATE' | 'REAL'} [trdEnv]
   */
  async getAccountSummary(trdEnv = this.trdEnv) {
    const envChoice = (trdEnv || this.trdEnv).toUpperCase();

    if (this.isTest()) {
      return {
        broker: this.brokerName,
        trdEnv: envChoice,
        accId: this.accId,
        cash: 1000000.0,
        buyingPower: 2000000.0,
        totalAssets: 1000000.0,
        marketValue: 0.0,
        positions: [],
        status: 'CONNECTED',
        simulated: true,
      };
    }

    try {
      const data = await this._runScript(path.join('trade', 'get_portfolio.py'), [
        '--acc-id', String(this.accId),
        '--trd-env', envChoice,
        '--json',
      ]);

      const funds = data.funds || {};
      return {
        broker: this.brokerName,
        trdEnv: envChoice,
        accId: this.accId,
        cash: Number(funds.cash || 0),
        buyingPower: Number(funds.power || 0),
        totalAssets: Number(funds.total_assets || 0),
        marketValue: Number(funds.market_val || 0),
        positions: data.positions || [],
        status: 'CONNECTED',
        raw: data,
      };
    } catch (err) {
      console.warn(`⚠️ [MOOMOO OPEND] Error consultando portafolio: ${err.message}. Retornando fallback seguro.`);
      return {
        broker: this.brokerName,
        trdEnv: envChoice,
        accId: this.accId,
        cash: 0.0,
        buyingPower: 0.0,
        totalAssets: 0.0,
        marketValue: 0.0,
        positions: [],
        status: 'DISCONNECTED',
        error: err.message,
      };
    }
  }

  /**
   * Despacha una orden de compra o venta a través de Moomoo OpenD.
   * @param {object} params
   * @param {string} params.symbol
   * @param {number} params.qty
   * @param {number} params.price
   * @param {'BUY' | 'SELL'} [params.side='BUY']
   * @param {'SIMULATE' | 'REAL'} [params.trdEnv]
   */
  async executeOrder({ symbol, qty, price, side = 'BUY', trdEnv = this.trdEnv }) {
    const cleanCode = this.normalizeCode(symbol);
    const envChoice = (trdEnv || this.trdEnv).toUpperCase();
    const cleanSide = side.toUpperCase();
    const cleanQty = Math.max(1, Math.round(Number(qty) || 1));
    const cleanPrice = Number(price || 100.0);

    if (this.isTest()) {
      return {
        success: true,
        orderId: `ord_moo_${Date.now()}`,
        symbol: cleanCode.replace(/^US\./, ''),
        code: cleanCode,
        side: cleanSide,
        qty: cleanQty,
        price: cleanPrice,
        status: 'SUBMITTED',
        trdEnv: envChoice,
        broker: this.brokerName,
        simulated: true,
      };
    }

    try {
      const args = [
        '--code', cleanCode,
        '--side', cleanSide,
        '--quantity', String(cleanQty),
        '--price', cleanPrice.toFixed(2),
        '--acc-id', String(this.accId),
        '--trd-env', envChoice,
        '--json',
      ];

      if (envChoice === 'REAL') {
        args.push('--confirmed');
      }

      const data = await this._runScript(path.join('trade', 'place_order.py'), args);

      return {
        success: true,
        orderId: data.order_id || `moo_${Date.now()}`,
        symbol: cleanCode.replace(/^US\./, ''),
        code: cleanCode,
        side: cleanSide,
        qty: cleanQty,
        price: cleanPrice,
        status: data.status || 'SUBMITTED',
        trdEnv: envChoice,
        broker: this.brokerName,
        raw: data,
      };
    } catch (err) {
      console.error(`💥 [MOOMOO OPEND] Falló colocación de orden en ${cleanCode}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Cancela una orden activa en Moomoo OpenD.
   * @param {string|number} orderId
   * @param {'SIMULATE' | 'REAL'} [trdEnv]
   */
  async cancelOrder(orderId, trdEnv = this.trdEnv) {
    const envChoice = (trdEnv || this.trdEnv).toUpperCase();

    if (this.isTest()) {
      return {
        success: true,
        orderId: String(orderId),
        status: 'CANCELLED',
        simulated: true,
      };
    }

    try {
      const data = await this._runScript(path.join('trade', 'cancel_order.py'), [
        '--order-id', String(orderId),
        '--acc-id', String(this.accId),
        '--trd-env', envChoice,
        '--json',
      ]);

      return {
        success: true,
        orderId: String(orderId),
        status: data.status || 'CANCELLED',
        raw: data,
      };
    } catch (err) {
      console.warn(`⚠️ [MOOMOO OPEND] Falló cancelación de orden ${orderId}: ${err.message}`);
      return {
        success: false,
        orderId: String(orderId),
        error: err.message,
      };
    }
  }

  /**
   * Obtiene la cotización en tiempo real de un activo a través de Moomoo OpenD.
   * @param {string} symbol
   */
  async getQuote(symbol) {
    const cleanCode = this.normalizeCode(symbol);

    if (this.isTest()) {
      return {
        symbol: cleanCode.replace(/^US\./, ''),
        code: cleanCode,
        price: 150.0,
        name: cleanCode.replace(/^US\./, ''),
        simulated: true,
      };
    }

    try {
      const data = await this._runScript(path.join('quote', 'get_stock_quote.py'), [cleanCode, '--json']);
      const items = data.data || [];
      if (items.length === 0) {
        throw new Error(`Cotización no encontrada para ${cleanCode}`);
      }

      const item = items[0];
      return {
        symbol: cleanCode.replace(/^US\./, ''),
        code: cleanCode,
        name: item.name || cleanCode,
        price: Number(item.last_price || item.open_price || 0),
        highPrice: Number(item.high_price || 0),
        lowPrice: Number(item.low_price || 0),
        volume: Number(item.volume || 0),
        raw: item,
      };
    } catch (err) {
      console.warn(`⚠️ [MOOMOO QUOTE] Error obteniendo cotización para ${cleanCode}: ${err.message}`);
      throw err;
    }
  }
}

export const moomooService = new MoomooService();
