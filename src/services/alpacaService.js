import { env } from '../config/environment.js';

/**
 * 🦙 [INVEST AI] Adaptador Nativo de Alpaca Trading API (Paper & Live)
 * Conexión REST pura sin librerías externas. Soporta órdenes Bracket y compras fraccionadas.
 */

class AlpacaService {
  constructor() {
    this.baseUrl = (env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets').replace(/\/+$/, '');
  }

  /**
   * Determina si las credenciales de Alpaca están provistas en el entorno.
   */
  isConfigured() {
    return Boolean(env.ALPACA_API_KEY && env.ALPACA_API_SECRET);
  }

  /**
   * Determina si el servicio debe operar en modo simulación segura.
   */
  isSimulation() {
    return (
      process.env.NODE_ENV === 'test' ||
      env.NODE_ENV === 'test' ||
      !this.isConfigured()
    );
  }

  /**
   * Genera las cabeceras de autenticación requeridas por Alpaca REST API.
   */
  getHeaders() {
    return {
      'APCA-API-KEY-ID': env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET || '',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Consulta el estado de la cuenta, efectivo, poder de compra y valor del portafolio.
   */
  async getAccount() {
    if (this.isSimulation()) {
      return {
        simulated: true,
        id: 'sim_acc_invest_ai',
        status: 'ACTIVE',
        currency: 'USD',
        cash: '35.00',
        portfolio_value: '35.00',
        buying_power: '70.00',
        non_marginable_buying_power: '35.00',
        pattern_day_trader: false,
      };
    }

    const response = await fetch(`${this.baseUrl}/v2/account`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Error en Alpaca getAccount (${response.status}): ${JSON.stringify(err)}`);
    }

    return await response.json();
  }

  /**
   * Obtiene la lista de posiciones abiertas actualmente en Alpaca.
   */
  async getPositions() {
    if (this.isSimulation()) {
      return [];
    }

    const response = await fetch(`${this.baseUrl}/v2/positions`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Error en Alpaca getPositions (${response.status}): ${JSON.stringify(err)}`);
    }

    return await response.json();
  }

  /**
   * Envía una orden Bracket a Alpaca con entrada a mercado y salidas automatizadas (TP y SL).
   * Admite compras fraccionadas especificando qty fraccionario.
   * @param {object} params
   * @param {string} params.symbol - Ticker (ej. 'NVDA')
   * @param {number|string} params.qty - Cantidad (puede ser fraccionaria, ej. 0.2917)
   * @param {number} [params.notional] - Monto en dólares si aplica
   * @param {'buy'|'sell'} [params.side='buy'] - Dirección de la orden
   * @param {number} params.takeProfitPrice - Precio límite de toma de ganancia
   * @param {number} params.stopLossPrice - Precio de parada de pérdida
   */
  async submitBracketOrder({ symbol, qty, notional, side = 'buy', takeProfitPrice, stopLossPrice }) {
    const cleanSymbol = symbol.trim().toUpperCase();
    const cleanQty = qty ? String(qty) : undefined;
    const cleanTP = parseFloat(Number(takeProfitPrice).toFixed(2));
    const cleanSL = parseFloat(Number(stopLossPrice).toFixed(2));

    if (this.isSimulation()) {
      const orderId = `sim_ord_${Date.now()}_${cleanSymbol}`;
      console.info(`ℹ️ [SIMULACIÓN ALPACA ORDER] Bracket ${side.toUpperCase()} ${cleanQty || notional + ' USD'} en ${cleanSymbol} (TP: $${cleanTP} | SL: $${cleanSL})`);
      return {
        simulated: true,
        id: orderId,
        client_order_id: `client_${orderId}`,
        symbol: cleanSymbol,
        qty: cleanQty,
        notional: notional ? Number(notional) : undefined,
        side,
        type: 'market',
        time_in_force: 'day',
        order_class: 'bracket',
        status: 'accepted',
        take_profit: { limit_price: cleanTP },
        stop_loss: { stop_price: cleanSL },
        created_at: new Date().toISOString(),
      };
    }

    const payload = {
      symbol: cleanSymbol,
      qty: cleanQty,
      side,
      type: 'market',
      time_in_force: 'day',
      order_class: 'bracket',
      take_profit: { limit_price: cleanTP },
      stop_loss: { stop_price: cleanSL },
    };

    if (!cleanQty && notional) {
      payload.notional = String(notional);
      delete payload.qty;
    }

    const response = await fetch(`${this.baseUrl}/v2/orders`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Error en Alpaca submitBracketOrder (${response.status}): ${JSON.stringify(err)}`);
    }

    return await response.json();
  }

  /**
   * Cierra/liquida una posición abierta en Alpaca por símbolo.
   * @param {string} symbol
   */
  async closePosition(symbol) {
    const cleanSymbol = symbol.trim().toUpperCase();

    if (this.isSimulation()) {
      console.info(`ℹ️ [SIMULACIÓN ALPACA] Liquidación de posición en ${cleanSymbol}`);
      return { simulated: true, symbol: cleanSymbol, status: 'closed' };
    }

    const response = await fetch(`${this.baseUrl}/v2/positions/${cleanSymbol}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Error en Alpaca closePosition (${response.status}): ${JSON.stringify(err)}`);
    }

    return await response.json();
  }

  /**
   * Cancela todas las órdenes activas/pendientes en Alpaca.
   */
  async cancelAllOrders() {
    if (this.isSimulation()) {
      return [{ simulated: true, status: 'all_cancelled' }];
    }

    const response = await fetch(`${this.baseUrl}/v2/orders`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Error en Alpaca cancelAllOrders (${response.status}): ${JSON.stringify(err)}`);
    }

    return await response.json();
  }
}

export const alpacaService = new AlpacaService();
