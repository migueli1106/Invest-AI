import { getPortfolioCollection } from '../db/firestore.js';
import { PortfolioHoldingSchema } from '../models/schemas.js';
import { marketDataService } from './marketDataService.js';
import { env } from '../config/environment.js';

/**
 * 💼 [INVEST AI] Servicio de Gestión y Valoración de Portafolio Real
 * Gestiona posiciones en brokers (Happi/Osmo), computa P&L en vivo y detecta salidas TP/SL.
 */

class PortfolioService {
  constructor() {
    // Almacén en memoria defensivo para tests y entornos locales sin credenciales ADC
    this.localPositions = [];
    this.memoryPositions = {
      set: (id, pos) => {
        const idx = this.localPositions.findIndex((p) => p.id === id);
        if (idx >= 0) {
          this.localPositions[idx] = { id, ...pos };
        } else {
          this.localPositions.push({ id, ...pos });
        }
      },
      get: (id) => this.localPositions.find((p) => p.id === id),
      clear: () => { this.localPositions = []; },
      has: (id) => this.localPositions.some((p) => p.id === id),
    };
  }

  isTest() {
    return process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';
  }

  /**
   * Registra una nueva posición de compra ejecutada en el broker.
   * @param {object} params
   */
  async addPosition({ symbol, shares, buyPrice, broker = 'Happi', stopLoss, targetPrice }) {
    const cleanSymbol = symbol.trim().toUpperCase();
    const cleanShares = Number(shares);
    const cleanBuyPrice = Number(buyPrice);
    const totalCost = parseFloat((cleanShares * cleanBuyPrice).toFixed(2));
    const now = new Date().toISOString();

    const rawPosition = {
      symbol: cleanSymbol,
      shares: cleanShares,
      averageBuyPrice: cleanBuyPrice,
      totalCost,
      currentMarketValue: totalCost,
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,
      broker: broker || 'Happi',
      status: 'OPEN',
      stopLoss: stopLoss !== undefined && stopLoss !== null ? Number(stopLoss) : undefined,
      targetPrice: targetPrice !== undefined && targetPrice !== null ? Number(targetPrice) : undefined,
      openedAt: now,
      lastUpdated: now,
    };

    const validated = PortfolioHoldingSchema.parse(rawPosition);
    let docId = `pos_${cleanSymbol}_${Date.now()}`;

    if (this.isTest()) {
      this.localPositions.push({ id: docId, ...validated });
      return { id: docId, ...validated };
    }

    try {
      const docRef = await getPortfolioCollection().add(validated);
      docId = docRef.id;
      console.info(`💾 [FIRESTORE] Posición ${cleanSymbol} registrada en 'portfolio_records' (ID: ${docId}).`);
    } catch (dbErr) {
      console.warn(`⚠️ [FIRESTORE] Escritura en la nube simulada: ${dbErr.message}`);
      this.localPositions.push({ id: docId, ...validated });
    }

    return { id: docId, ...validated };
  }

  /**
   * Obtiene todas las posiciones actualmente abiertas.
   * @returns {Promise<object[]>}
   */
  async getOpenPositions() {
    if (this.isTest()) {
      return this.localPositions.filter((p) => p.status === 'OPEN');
    }

    try {
      const snapshot = await getPortfolioCollection().where('status', '==', 'OPEN').get();
      if (!snapshot.empty) {
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }
      return this.localPositions.filter((p) => p.status === 'OPEN');
    } catch (err) {
      console.warn(`⚠️ [FIRESTORE] Lectura de portafolio simulada: ${err.message}`);
      return this.localPositions.filter((p) => p.status === 'OPEN');
    }
  }

  /**
   * Cierra una posición abierta, registrando el precio de salida y computando P&L realizado.
   * @param {string} positionId - ID del documento en Firestore
   * @param {number} closePrice - Precio de venta por acción
   */
  async closePosition(positionId, closePrice) {
    const cleanClosePrice = Number(closePrice);
    if (!cleanClosePrice || cleanClosePrice <= 0) {
      throw new Error(`Precio de cierre inválido: ${closePrice}`);
    }

    let currentData = null;
    let docRef = null;

    if (!this.isTest()) {
      try {
        docRef = getPortfolioCollection().doc(positionId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          currentData = docSnap.data();
        }
      } catch (err) {
        console.warn(`⚠️ [FIRESTORE] Consulta fallback para cierre: ${err.message}`);
      }
    }

    if (!currentData) {
      currentData = this.localPositions.find((p) => p.id === positionId);
    }

    if (!currentData) {
      throw new Error(`Posición no encontrada con ID: ${positionId}`);
    }

    if (currentData.status === 'CLOSED') {
      throw new Error(`La posición ${currentData.symbol} ya se encuentra cerrada.`);
    }

    const shares = currentData.shares;
    const buyPrice = currentData.averageBuyPrice;
    const realizedPnL = parseFloat(((cleanClosePrice - buyPrice) * shares).toFixed(2));
    const realizedPnLPercent = parseFloat((((cleanClosePrice - buyPrice) / buyPrice) * 100).toFixed(2));
    const closedAt = new Date().toISOString();

    const updateFields = {
      status: 'CLOSED',
      closedAt,
      realizedPnL,
      realizedPnLPercent,
      currentMarketValue: parseFloat((cleanClosePrice * shares).toFixed(2)),
      lastUpdated: closedAt,
    };

    if (!this.isTest() && docRef) {
      try {
        await docRef.update(updateFields);
        console.info(`💾 [FIRESTORE] Posición ${positionId} cerrada. P&L Realizado: $${realizedPnL} (${realizedPnLPercent >= 0 ? '+' : ''}${realizedPnLPercent}%)`);
      } catch (err) {
        console.warn(`⚠️ [FIRESTORE] Actualización simulada: ${err.message}`);
      }
    }

    const local = this.localPositions.find((p) => p.id === positionId);
    if (local) Object.assign(local, updateFields);

    return {
      id: positionId,
      ...currentData,
      ...updateFields,
    };
  }

  /**
   * Calcula el rendimiento consolidado del portafolio cruzando posiciones abiertas con precios en vivo.
   * @param {object[]} [overridePositions] - Permite inyectar posiciones para testing determinista
   * @returns {Promise<{ positions: object[], summary: object }>}
   */
  async calculatePortfolioPerformance(overridePositions = null) {
    const rawPositions = overridePositions || await this.getOpenPositions();

    if (!rawPositions || rawPositions.length === 0) {
      return {
        positions: [],
        summary: {
          totalCostBasis: 0,
          totalMarketValue: 0,
          totalUnrealizedPnL: 0,
          totalUnrealizedPnLPercent: 0,
          count: 0,
        },
      };
    }

    const enrichedPositions = [];
    let totalCostBasis = 0;
    let totalMarketValue = 0;

    for (const pos of rawPositions) {
      let currentPrice = pos.currentPrice;

      if (currentPrice === undefined || currentPrice === null) {
        try {
          const quote = await marketDataService.getQuote(pos.symbol);
          if (quote && quote.currentPrice > 0) {
            currentPrice = quote.currentPrice;
          }
        } catch (err) {
          console.warn(`⚠️ [MARKET DATA] No se obtuvo cotización fresca para ${pos.symbol}, usando último valor conocido: ${err.message}`);
          if (pos.currentMarketValue && pos.shares > 0) {
            currentPrice = pos.currentMarketValue / pos.shares;
          } else {
            currentPrice = pos.averageBuyPrice;
          }
        }
      }

      const costBasis = parseFloat((pos.averageBuyPrice * pos.shares).toFixed(2));
      const marketValue = parseFloat((currentPrice * pos.shares).toFixed(2));
      const unrealizedPnL = parseFloat((marketValue - costBasis).toFixed(2));
      const unrealizedPnLPercent = parseFloat((((currentPrice - pos.averageBuyPrice) / pos.averageBuyPrice) * 100).toFixed(2));

      const distanceToTarget = pos.targetPrice
        ? parseFloat((((pos.targetPrice - currentPrice) / currentPrice) * 100).toFixed(2))
        : null;

      const distanceToStopLoss = pos.stopLoss
        ? parseFloat((((currentPrice - pos.stopLoss) / currentPrice) * 100).toFixed(2))
        : null;

      totalCostBasis += costBasis;
      totalMarketValue += marketValue;

      enrichedPositions.push({
        ...pos,
        currentPrice: parseFloat(currentPrice.toFixed(2)),
        costBasis,
        currentMarketValue: marketValue,
        unrealizedPnL,
        unrealizedPnLPercent,
        distanceToTarget,
        distanceToStopLoss,
      });
    }

    totalCostBasis = parseFloat(totalCostBasis.toFixed(2));
    totalMarketValue = parseFloat(totalMarketValue.toFixed(2));
    const totalUnrealizedPnL = parseFloat((totalMarketValue - totalCostBasis).toFixed(2));
    const totalUnrealizedPnLPercent = totalCostBasis > 0
      ? parseFloat(((totalUnrealizedPnL / totalCostBasis) * 100).toFixed(2))
      : 0;

    return {
      positions: enrichedPositions,
      summary: {
        totalCostBasis,
        totalMarketValue,
        totalUnrealizedPnL,
        totalUnrealizedPnLPercent,
        count: enrichedPositions.length,
      },
    };
  }

  /**
   * Evalúa disparadores automáticos de salida (Take-Profit / Stop-Loss) sobre posiciones abiertas.
   * @param {object[]} [overridePositions]
   * @returns {Promise<object[]>} Lista de alertas de salida disparadas
   */
  async checkExitTriggers(overridePositions = null) {
    const { positions } = await this.calculatePortfolioPerformance(overridePositions);
    const triggeredAlerts = [];

    for (const pos of positions) {
      if (pos.targetPrice && pos.currentPrice >= pos.targetPrice) {
        triggeredAlerts.push({
          positionId: pos.id,
          symbol: pos.symbol,
          broker: pos.broker,
          shares: pos.shares,
          averageBuyPrice: pos.averageBuyPrice,
          currentPrice: pos.currentPrice,
          thresholdPrice: pos.targetPrice,
          type: 'TAKE_PROFIT',
          trigger: 'TAKE_PROFIT',
          recommendation: 'SELL',
          pnl: pos.unrealizedPnL,
          unrealizedPnL: pos.unrealizedPnL,
          pnlPercent: pos.unrealizedPnLPercent,
          unrealizedPnLPercent: pos.unrealizedPnLPercent,
          rationale: `El precio actual ($${pos.currentPrice}) alcanzó o superó el Target Price ($${pos.targetPrice}).`,
          message: `🎯 *¡TAKE-PROFIT ALCANZADO PARA ${pos.symbol}!* El precio ($${pos.currentPrice}) tocó tu meta ($${pos.targetPrice}). Rendimiento: +${pos.unrealizedPnLPercent}%. Cierra en ${pos.broker}.`,
        });
      } else if (pos.stopLoss && pos.currentPrice <= pos.stopLoss) {
        triggeredAlerts.push({
          positionId: pos.id,
          symbol: pos.symbol,
          broker: pos.broker,
          shares: pos.shares,
          averageBuyPrice: pos.averageBuyPrice,
          currentPrice: pos.currentPrice,
          thresholdPrice: pos.stopLoss,
          type: 'STOP_LOSS',
          trigger: 'STOP_LOSS',
          recommendation: 'SELL',
          pnl: pos.unrealizedPnL,
          unrealizedPnL: pos.unrealizedPnL,
          pnlPercent: pos.unrealizedPnLPercent,
          unrealizedPnLPercent: pos.unrealizedPnLPercent,
          rationale: `El precio actual ($${pos.currentPrice}) rompió a la baja el Stop Loss ($${pos.stopLoss}).`,
          message: `🛑 *¡STOP-LOSS ACTIVADO PARA ${pos.symbol}!* El precio ($${pos.currentPrice}) perforó tu stop ($${pos.stopLoss}). Pérdida: ${pos.unrealizedPnLPercent}%. Ejecuta venta en ${pos.broker} para resguardar capital.`,
        });
      }
    }

    return triggeredAlerts;
  }
}

export const portfolioService = new PortfolioService();
