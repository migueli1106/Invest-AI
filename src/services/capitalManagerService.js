/**
 * 💰 [INVEST AI] Gestor de Capital Flexible Multi-Posición
 * Administra el dimensionamiento fraccionario por operación ($35.00 USD nominal)
 * permitiendo la apertura simultánea de múltiples trades sin bloqueos de pool agotado.
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
   * Retorna el estado consolidado del pool de capital bajo la política flexible.
   */
  getCapitalStatus() {
    return {
      totalCapital: parseFloat(this.totalCapital.toFixed(2)),
      deployedCapital: parseFloat(this.deployedCapital.toFixed(2)),
      availableCash: parseFloat(this.availableCash.toFixed(2)),
      currency: 'USD',
      canTrade: true, // Capacidad multi-posición permanente
      activeReservationsCount: this.reservations.size,
      policy: 'FLEXIBLE_CAPITAL',
    };
  }

  /**
   * Calcula el dimensionamiento fraccionario para una compra (por defecto $35.00 USD por operación).
   * En el modelo Capital Flexible, no bloquea por pool agotado, permitiendo multi-posiciones simultáneas.
   * @param {string} symbol - Ticker del activo
   * @param {number} currentPrice - Precio actual de mercado
   * @param {number} [notionalAllocation=35.00] - Asignación nominal por trade
   */
  calculateFractionalSizing(symbol, currentPrice, notionalAllocation = 35.00) {
    const cleanPrice = Number(currentPrice);
    if (!cleanPrice || cleanPrice <= 0) {
      throw new Error(`Precio de cotización inválido para dimensionamiento: ${currentPrice}`);
    }

    const notional = parseFloat(Math.max(1.00, Number(notionalAllocation || 35.00)).toFixed(2));
    
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
      remainingCashAfterTrade: parseFloat(Math.max(0, this.availableCash - notional).toFixed(2)),
    };
  }

  /**
   * Reserva contablemente el capital asignado al emitir una orden de compra.
   * Permite operaciones concurrentes adaptando la base contable.
   * @param {string} positionId
   * @param {number} amount
   */
  reserveCapital(positionId, amount) {
    const cleanAmount = parseFloat(Number(amount).toFixed(2));
    if (cleanAmount <= 0) return;

    this.deployedCapital = parseFloat((this.deployedCapital + cleanAmount).toFixed(2));
    this.availableCash = parseFloat(Math.max(0, this.availableCash - cleanAmount).toFixed(2));
    this.totalCapital = parseFloat((this.availableCash + this.deployedCapital).toFixed(2));
    this.reservations.set(positionId, cleanAmount);

    console.info(`💼 [CAPITAL FLEXIBLE] Reservados $${cleanAmount} USD para ${positionId}. Desplegado: $${this.deployedCapital} USD.`);
  }

  /**
   * Libera capital tras el cierre de una posición (Take-Profit o Stop-Loss),
   * reintegrando el valor liquidado a la liquidez contable.
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
    console.info(`🔄 [CAPITAL LIQUIDACIÓN] Liberados $${cleanReturned} USD de ${positionId} (Neto: ${netChange >= 0 ? '+' : ''}$${netChange}). Disponible: $${this.availableCash} USD.`);

    return {
      totalCapital: this.totalCapital,
      availableCash: this.availableCash,
      deployedCapital: this.deployedCapital,
      netChange,
    };
  }

  /**
   * Sincroniza el gestor con los balances reales del broker (Happi/Manual).
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
