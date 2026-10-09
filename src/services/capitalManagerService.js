/**
 * 💰 [INVEST AI] Motor de Capital Dinámico Exponencial & Sizing Proporcional
 * Implementa el modelo de dimensionamiento institucional (Kelly Fraccionario / 10% cash base),
 * permitiendo hasta 10 posiciones simultáneas de alta rotación sin bloqueos artificiales.
 */

class CapitalManagerService {
  constructor(initialCapital = 35.00) {
    this.initialCapital = initialCapital;
    this.totalCapital = initialCapital;
    this.deployedCapital = 0.00;
    this.availableCash = initialCapital;
    this.buyingPower = initialCapital;
    this.maxConcurrentPositions = 10;
    this.reservations = new Map(); // positionId -> allocatedAmount
  }

  /**
   * Retorna el estado consolidado del pool de capital bajo la política dinámica.
   */
  getCapitalStatus() {
    return {
      totalCapital: parseFloat(this.totalCapital.toFixed(2)),
      deployedCapital: parseFloat(this.deployedCapital.toFixed(2)),
      availableCash: parseFloat(this.availableCash.toFixed(2)),
      buyingPower: parseFloat(this.buyingPower.toFixed(2)),
      currency: 'USD',
      canTrade: this.reservations.size < this.maxConcurrentPositions,
      activeReservationsCount: this.reservations.size,
      maxPositions: this.maxConcurrentPositions,
      policy: 'FLEXIBLE_CAPITAL',
      broker: 'Moomoo',
    };
  }

  /**
   * Sincroniza balances reales (cash, buyingPower, totalAssets) obtenidos de Moomoo OpenD.
   * @param {object} accountData
   */
  syncWithMoomoo(accountData) {
    if (!accountData) return;

    const realCash = parseFloat(Number(accountData.cash ?? accountData.availableCash ?? 0).toFixed(2));
    const realBuyingPower = parseFloat(Number(accountData.buyingPower ?? accountData.buying_power ?? realCash).toFixed(2));
    const realTotal = parseFloat(Number(accountData.totalAssets ?? accountData.totalCapital ?? accountData.portfolio_value ?? realCash).toFixed(2));

    this.availableCash = realCash;
    this.buyingPower = realBuyingPower;
    this.totalCapital = realTotal;
    this.deployedCapital = parseFloat(Math.max(0, this.totalCapital - this.availableCash).toFixed(2));

    console.info(`💼 [CAPITAL MOOMOO SYNC] Sincronizado: Total $${this.totalCapital} | Efectivo $${this.availableCash} | Buying Power $${this.buyingPower}`);
  }

  /**
   * Alias de compatibilidad hacia syncWithMoomoo.
   */
  syncWithBrokerBalance(account) {
    return this.syncWithMoomoo(account);
  }

  /**
   * Calcula el dimensionamiento fraccionario dinámico para una orden.
   * Si customAllocation es null/indefinido, calcula el 10% del efectivo disponible:
   * allocation = Math.max(15.00, Math.min(this.availableCash * 0.10, this.availableCash * 0.25))
   * @param {string} symbol - Ticker del activo
   * @param {number} currentPrice - Precio actual de mercado
   * @param {number|null} [customAllocation=null] - Asignación manual opcional
   */
  calculateFractionalSizing(symbol, currentPrice, customAllocation = null) {
    const cleanPrice = Number(currentPrice);
    if (!cleanPrice || cleanPrice <= 0) {
      throw new Error(`Precio de cotización inválido para dimensionamiento: ${currentPrice}`);
    }

    const cleanSymbol = (symbol || 'ACTIVO').toUpperCase();

    // Límite de multi-posiciones simultáneas (máximo 10)
    if (this.reservations.size >= this.maxConcurrentPositions) {
      return {
        allowed: false,
        reason: 'MAX_POSITIONS_REACHED',
        symbol: cleanSymbol,
        maxPositions: this.maxConcurrentPositions,
        activePositions: this.reservations.size,
      };
    }

    let notional = 0;
    if (customAllocation !== null && customAllocation !== undefined) {
      notional = parseFloat(Math.max(1.00, Number(customAllocation)).toFixed(2));
    } else {
      const dynamicAllocation = Math.max(15.00, Math.min(this.availableCash * 0.10, this.availableCash * 0.25));
      notional = parseFloat(dynamicAllocation.toFixed(2));
    }

    // Cálculo fraccionario con 4 decimales
    const qty = parseFloat((notional / cleanPrice).toFixed(4));

    if (qty <= 0) {
      return {
        allowed: false,
        reason: 'QTY_TOO_SMALL',
        symbol: cleanSymbol,
        notional,
      };
    }

    return {
      allowed: true,
      symbol: cleanSymbol,
      currentPrice: cleanPrice,
      notional,
      qty,
      remainingCashAfterTrade: parseFloat(Math.max(0, this.availableCash - notional).toFixed(2)),
    };
  }

  /**
   * Reserva contablemente el capital asignado al emitir una orden de compra.
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

    console.info(`💼 [CAPITAL DINÁMICO] Reservados $${cleanAmount} USD para ${positionId}. Desplegado: $${this.deployedCapital} USD.`);
  }

  /**
   * Libera capital tras el cierre de una posición, reintegrando el retorno a liquidez.
   * @param {string} positionId
   * @param {number} returnedAmount
   */
  releaseCapital(positionId, returnedAmount) {
    const original = this.reservations.get(positionId) || 0;
    const cleanReturned = parseFloat(Number(returnedAmount).toFixed(2));

    this.deployedCapital = parseFloat(Math.max(0, this.deployedCapital - original).toFixed(2));
    this.availableCash = parseFloat((this.availableCash + cleanReturned).toFixed(2));
    this.totalCapital = parseFloat((this.availableCash + this.deployedCapital).toFixed(2));
    this.reservations.delete(positionId);

    const netChange = parseFloat((cleanReturned - original).toFixed(2));
    console.info(`🔄 [CAPITAL ROTACIÓN] Liberados $${cleanReturned} USD de ${positionId} (Neto: ${netChange >= 0 ? '+' : ''}$${netChange}). Disponible: $${this.availableCash} USD.`);

    return {
      totalCapital: this.totalCapital,
      availableCash: this.availableCash,
      deployedCapital: this.deployedCapital,
      netChange,
    };
  }

  /**
   * Reinicia el gestor a su estado inicial (para suites de pruebas).
   * @param {number} [capital=35.00]
   */
  reset(capital = 35.00) {
    this.initialCapital = capital;
    this.totalCapital = capital;
    this.deployedCapital = 0.00;
    this.availableCash = capital;
    this.buyingPower = capital;
    this.reservations.clear();
  }
}

export const capitalManagerService = new CapitalManagerService();
