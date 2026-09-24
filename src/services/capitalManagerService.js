/**
 * 💰 [INVEST AI] Gestor de Capital y Regla Sagrada de CERO RE-FONDEO
 * Controla el pool de capital ($35.00 USD base), compras fraccionadas y rotación continua.
 */

class CapitalManagerService {
  constructor(initialCapital = 35.00) {
    this.initialCapital = initialCapital;
    this.totalCapital = initialCapital;
    this.deployedCapital = 0.00;
    this.availableCash = initialCapital;
    this.reservations = new Map(); // orderId/positionId -> allocatedAmount
  }

  /**
   * Retorna el estado consolidado del pool de capital y capacidad de trading.
   */
  getCapitalStatus() {
    return {
      totalCapital: parseFloat(this.totalCapital.toFixed(2)),
      deployedCapital: parseFloat(this.deployedCapital.toFixed(2)),
      availableCash: parseFloat(this.availableCash.toFixed(2)),
      currency: 'USD',
      canTrade: this.availableCash >= 1.00,
      activeReservationsCount: this.reservations.size,
      policy: 'ZERO_REFUND_STRICT',
    };
  }

  /**
   * Calcula el dimensionamiento fraccionario para una compra con tope de $35 USD.
   * @param {string} symbol - Ticker del activo
   * @param {number} currentPrice - Precio actual de mercado
   * @param {number} [maxAllocation=35.00] - Asignación máxima por trade
   */
  calculateFractionalSizing(symbol, currentPrice, maxAllocation = 35.00) {
    const cleanPrice = Number(currentPrice);
    if (!cleanPrice || cleanPrice <= 0) {
      throw new Error(`Precio de cotización inválido para dimensionamiento: ${currentPrice}`);
    }

    // Regla de Cero Re-Fondeo: Requiere mínimo $1.00 USD libre en el pool
    if (this.availableCash < 1.00) {
      return {
        allowed: false,
        reason: 'INSUFFICIENT_POOL_WAIT_ROTATION',
        availableCash: parseFloat(this.availableCash.toFixed(2)),
        symbol: symbol.toUpperCase(),
        requiredMin: 1.00,
      };
    }

    // Nocional asignado limitado por el efectivo disponible y el tope de la estrategia
    const notional = parseFloat(Math.min(this.availableCash, maxAllocation).toFixed(2));
    
    // Cálculo de cantidad fraccionada con 4 decimales
    const qty = parseFloat((notional / cleanPrice).toFixed(4));

    if (qty <= 0) {
      return {
        allowed: false,
        reason: 'QTY_TOO_SMALL',
        symbol: symbol.toUpperCase(),
        notional,
      };
    }

    return {
      allowed: true,
      symbol: symbol.toUpperCase(),
      currentPrice: cleanPrice,
      notional,
      qty,
      remainingCashAfterTrade: parseFloat((this.availableCash - notional).toFixed(2)),
    };
  }

  /**
   * Reserva y bloquea capital al emitir una orden de compra.
   * @param {string} positionId
   * @param {number} amount
   */
  reserveCapital(positionId, amount) {
    const cleanAmount = parseFloat(Number(amount).toFixed(2));
    if (cleanAmount <= 0) return;

    this.deployedCapital = parseFloat((this.deployedCapital + cleanAmount).toFixed(2));
    this.availableCash = parseFloat(Math.max(0, this.availableCash - cleanAmount).toFixed(2));
    this.reservations.set(positionId, cleanAmount);

    console.info(`🔒 [CAPITAL] Reservados $${cleanAmount} USD para ${positionId}. Disponible restante: $${this.availableCash} USD.`);
  }

  /**
   * Libera capital tras la salida de una posición (Take-Profit o Stop-Loss),
   * rotando los fondos y reintegrando el P&L realizado al pool líquido.
   * @param {string} positionId
   * @param {number} returnedAmount - Valor recuperado al cierre de la posición
   */
  releaseCapital(positionId, returnedAmount) {
    const original = this.reservations.get(positionId) || 0;
    const cleanReturned = parseFloat(Number(returnedAmount).toFixed(2));

    this.deployedCapital = parseFloat(Math.max(0, this.deployedCapital - original).toFixed(2));
    this.availableCash = parseFloat((this.availableCash + cleanReturned).toFixed(2));
    this.totalCapital = parseFloat((this.availableCash + this.deployedCapital).toFixed(2));
    this.reservations.delete(positionId);

    const netChange = parseFloat((cleanReturned - original).toFixed(2));
    console.info(`🔄 [CAPITAL ROTACIÓN] Liberados $${cleanReturned} USD de ${positionId} (Neto: ${netChange >= 0 ? '+' : ''}$${netChange}). Disponible para rotar: $${this.availableCash} USD.`);

    return {
      totalCapital: this.totalCapital,
      availableCash: this.availableCash,
      deployedCapital: this.deployedCapital,
      netChange,
    };
  }

  /**
   * Sincroniza el gestor de capital con los balances reales del broker (Happi/Manual).
   * @param {object} account
   */
  syncWithBrokerBalance(account) {
    if (!account || account.cash === undefined) return;

    const realCash = parseFloat(Number(account.cash).toFixed(2));
    const realPortfolioValue = parseFloat(Number(account.portfolio_value || account.cash).toFixed(2));

    this.availableCash = realCash;
    this.totalCapital = realPortfolioValue;
    this.deployedCapital = parseFloat(Math.max(0, this.totalCapital - this.availableCash).toFixed(2));

    console.info(`💼 [CAPITAL SYNC] Sincronizado con Broker: Total $${this.totalCapital} | Efectivo $${this.availableCash} | Desplegado $${this.deployedCapital}`);
  }

  /**
   * Reinicia el gestor a su estado inicial (utilizado en tests aislados).
   * @param {number} [capital=35.00]
   */
  reset(capital = 35.00) {
    this.initialCapital = capital;
    this.totalCapital = capital;
    this.deployedCapital = 0.00;
    this.availableCash = capital;
    this.reservations.clear();
  }
}

export const capitalManagerService = new CapitalManagerService();
