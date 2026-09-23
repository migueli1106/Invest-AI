import { getPortfolioCollection } from '../db/firestore.js';
import { PortfolioHoldingSchema } from '../models/schemas.js';
import { marketDataService } from './marketDataService.js';
import { alpacaService } from './alpacaService.js';
import { capitalManagerService } from './capitalManagerService.js';
import { env } from '../config/environment.js';

/**
 * 💼 [INVEST AI] Servicio de Gestión y Valoración de Portafolio Real
 * Gestiona posiciones en brokers (Happi/Osmo/Alpaca), computa P&L y rotación de capital.
 */

class PortfolioService {
  constructor() {
    this.localPositions = [];
    this.memoryPositions = {
      set: (id, val) => {
        const idx = this.localPositions.findIndex((p) => p.id === id);
        if (idx >= 0) this.localPositions[idx] = val;
        else this.localPositions.push({ id, ...val });
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
   * Cierra una posición abierta, registra precio de salida y rota el capital devuelto.
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
        if (docSnap.exists) currentData = docSnap.data();
      } catch (err) {
        console.warn(`⚠️ [FIRESTORE] Consulta fallback para cierre: ${err.message}`);
      }
    }

    if (!currentData) currentData = this.localPositions.find((p) => p.id === positionId);
    if (!currentData) throw new Error(`Posición no encontrada con ID: ${positionId}`);
    if (currentData.status === 'CLOSED') throw new Error(`La posición ${currentData.symbol} ya está cerrada.`);

    const shares = currentData.shares;
    const buyPrice = currentData.averageBuyPrice;
    const realizedPnL = parseFloat(((cleanClosePrice - buyPrice) * shares).toFixed(2));
    const realizedPnLPercent = parseFloat((((cleanClosePrice - buyPrice) / buyPrice) * 100).toFixed(2));
    const closedAt = new Date().toISOString();
    const marketValue = parseFloat((cleanClosePrice * shares).toFixed(2));

    const updateFields = {
      status: 'CLOSED',
      closedAt,
      realizedPnL,
      realizedPnLPercent,
      currentMarketValue: marketValue,
      lastUpdated: closedAt,
    };

    if (!this.isTest() && docRef) {
      try {
        await docRef.update(updateFields);
      } catch (err) {
        console.warn(`⚠️ [FIRESTORE] Actualización simulada: ${err.message}`);
      }
    }

    const local = this.localPositions.find((p) => p.id === positionId);
    if (local) Object.assign(local, updateFields);

    // Rotación de Capital: Reintegrar capital al pool disponible
    capitalManagerService.releaseCapital(positionId, marketValue);

    return { id: positionId, ...currentData, ...updateFields };
  }

  /**
   * Sincroniza posiciones activas en Alpaca con Firestore y el gestor de capital.
   */
  async syncWithAlpaca() {
    try {
      const account = await alpacaService.getAccount();
      capitalManagerService.syncWithAlpacaBalance(account);

      const positions = await alpacaService.getPositions();
      const synced = [];

      for (const p of positions) {
        const symbol = p.symbol;
        const shares = parseFloat(p.qty);
        const buyPrice = parseFloat(p.avg_entry_price);
        const currentPrice = parseFloat(p.current_price);
        const marketValue = parseFloat(p.market_value);

        const posData = {
          symbol,
          shares,
          averageBuyPrice: buyPrice,
          totalCost: parseFloat((shares * buyPrice).toFixed(2)),
          currentMarketValue: marketValue,
          unrealizedPnL: parseFloat(p.unrealized_pl || 0),
          unrealizedPnLPercent: parseFloat((Number(p.unrealized_plpc || 0) * 100).toFixed(2)),
          broker: 'Alpaca',
          status: 'OPEN',
          lastUpdated: new Date().toISOString(),
        };

        const docId = `alpaca_${symbol}`;
        if (this.isTest()) {
          this.memoryPositions.set(docId, { id: docId, ...posData });
          synced.push({ id: docId, ...posData });
        } else {
          try {
            await getPortfolioCollection().doc(docId).set(posData, { merge: true });
            synced.push({ id: docId, ...posData });
          } catch (err) {
            console.warn(`⚠️ Fallo guardando posición Alpaca: ${err.message}`);
          }
        }
      }
      return { syncedCount: synced.length, positions: synced };
    } catch (err) {
      console.warn(`⚠️ [PORTFOLIO SYNC] Error: ${err.message}`);
      return { syncedCount: 0, positions: [], error: err.message };
    }
  }

  /**
   * Calcula el rendimiento consolidado del portafolio.
   */
  async calculatePortfolioPerformance(overridePositions = null) {
    const rawPositions = overridePositions || await this.getOpenPositions();

    if (!rawPositions || rawPositions.length === 0) {
      return {
        positions: [],
        summary: { totalCostBasis: 0, totalMarketValue: 0, totalUnrealizedPnL: 0, totalUnrealizedPnLPercent: 0, count: 0 },
      };
    }

    const enriched = [];
    let totalCost = 0;
    let totalValue = 0;

    for (const pos of rawPositions) {
      let currentPrice = pos.currentPrice;

      if (currentPrice === undefined || currentPrice === null) {
        try {
          const quote = await marketDataService.getQuote(pos.symbol);
          if (quote && quote.currentPrice > 0) currentPrice = quote.currentPrice;
        } catch (err) {
          currentPrice = pos.currentMarketValue && pos.shares > 0 ? pos.currentMarketValue / pos.shares : pos.averageBuyPrice;
        }
      }

      const costBasis = parseFloat((pos.averageBuyPrice * pos.shares).toFixed(2));
      const marketValue = parseFloat((currentPrice * pos.shares).toFixed(2));
      const unrealizedPnL = parseFloat((marketValue - costBasis).toFixed(2));
      const unrealizedPnLPercent = parseFloat((((currentPrice - pos.averageBuyPrice) / pos.averageBuyPrice) * 100).toFixed(2));

      totalCost += costBasis;
      totalValue += marketValue;

      enriched.push({
        ...pos,
        currentPrice: parseFloat(currentPrice.toFixed(2)),
        costBasis,
        currentMarketValue: marketValue,
        unrealizedPnL,
        unrealizedPnLPercent,
      });
    }

    totalCost = parseFloat(totalCost.toFixed(2));
    totalValue = parseFloat(totalValue.toFixed(2));
    const totalPnL = parseFloat((totalValue - totalCost).toFixed(2));
    const totalPnLPercent = totalCost > 0 ? parseFloat(((totalPnL / totalCost) * 100).toFixed(2)) : 0;

    return {
      positions: enriched,
      summary: { totalCostBasis: totalCost, totalMarketValue: totalValue, totalUnrealizedPnL: totalPnL, totalUnrealizedPnLPercent: totalPnLPercent, count: enriched.length },
    };
  }

  /**
   * Evalúa disparadores automáticos de salida (Take-Profit / Stop-Loss).
   */
  async checkExitTriggers(overridePositions = null) {
    const { positions } = await this.calculatePortfolioPerformance(overridePositions);
    const triggered = [];

    for (const pos of positions) {
      if (pos.targetPrice && pos.currentPrice >= pos.targetPrice) {
        triggered.push({
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
          message: `🎯 *¡TAKE-PROFIT ALCANZADO PARA ${pos.symbol}!* El precio ($${pos.currentPrice}) tocó tu meta ($${pos.targetPrice}). Rendimiento: +${pos.unrealizedPnLPercent}%. Cierra en ${pos.broker}.`,
        });
      } else if (pos.stopLoss && pos.currentPrice <= pos.stopLoss) {
        triggered.push({
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
          message: `🛑 *¡STOP-LOSS ACTIVADO PARA ${pos.symbol}!* El precio ($${pos.currentPrice}) perforó tu stop ($${pos.stopLoss}). Pérdida: ${pos.unrealizedPnLPercent}%. Ejecuta venta en ${pos.broker} para resguardar capital.`,
        });
      }
    }

    return triggered;
  }
}

export const portfolioService = new PortfolioService();
