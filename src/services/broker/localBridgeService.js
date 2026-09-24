import { capitalManagerService } from '../capitalManagerService.js';
import { portfolioService } from '../portfolioService.js';

/**
 * 🌉 [INVEST AI] Adaptador de Bridge para Automatización Local (Opción B)
 * Mantiene la cola de órdenes de despacho hacia agentes locales, con TTL estricto
 * de 5 minutos para salvaguardar el capital contra órdenes huérfanas o tardías.
 */
class LocalBridgeService {
  constructor() {
    this.brokerName = 'Happi';
    this.ttlMs = 5 * 60 * 1000; // TTL: 5 minutos
    this.orders = new Map(); // bridgeOrderId -> OrderRecord
  }

  /**
   * Encola una orden autorizada para ser recogida por el agente de automatización local.
   * Contabiliza preventivamente el capital asignado ($35 USD) bajo la política FLEXIBLE_CAPITAL.
   * @param {object} orderData
   */
  queueOrder({ symbol, qty, notional, currentPrice, stopLoss, targetPrice, side = 'BUY' }) {
    const sym = (symbol || 'ACTIVO').toUpperCase();
    const bridgeOrderId = `bridge_${sym.toLowerCase()}_${Date.now()}`;
    const now = Date.now();
    const expiresAt = now + this.ttlMs;

    // 1. Reserva preventiva de capital
    capitalManagerService.reserveCapital(bridgeOrderId, notional);

    const orderRecord = {
      bridgeOrderId,
      symbol: sym,
      qty,
      notional,
      currentPrice,
      stopLoss,
      targetPrice,
      side,
      status: 'PENDING',
      broker: this.brokerName,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      expiresAtMs: expiresAt,
    };

    this.orders.set(bridgeOrderId, orderRecord);
    console.info(`📥 [LOCAL BRIDGE] Orden encolada: ${bridgeOrderId} para ${sym} ($${notional} USD). TTL: 5 min.`);

    return {
      success: true,
      bridgeOrderId,
      status: 'QUEUED',
      order: orderRecord,
    };
  }

  /**
   * Limpia órdenes vencidas cuyo TTL superó los 5 minutos,
   * liberando de inmediato el capital reservado para evitar fondos bloqueados.
   */
  purgeExpiredOrders() {
    const now = Date.now();
    for (const [orderId, order] of this.orders.entries()) {
      if (order.status === 'PENDING' && order.expiresAtMs <= now) {
        order.status = 'EXPIRED';
        order.expiredAt = new Date().toISOString();
        capitalManagerService.releaseCapital(orderId, order.notional);
        console.warn(`⏳ [LOCAL BRIDGE] Orden ${orderId} (${order.symbol}) expiró por TTL (>5m). Capital de $${order.notional} USD devuelto al pool.`);
      }
    }
  }

  /**
   * Retorna la lista de órdenes activas y pendientes de despacho, tras purgar expiradas.
   */
  getPendingOrders() {
    this.purgeExpiredOrders();
    const pending = [];
    for (const order of this.orders.values()) {
      if (order.status === 'PENDING') {
        pending.push(order);
      }
    }
    return pending;
  }

  /**
   * Consulta una orden específica en memoria.
   * @param {string} bridgeOrderId
   */
  getOrder(bridgeOrderId) {
    this.purgeExpiredOrders();
    return this.orders.get(bridgeOrderId) || null;
  }

  /**
   * Reporta la finalización de una orden por parte del worker local.
   * Sincroniza la posición resultante en el portafolio institucional.
   * @param {string} bridgeOrderId
   * @param {object} executionDetails
   */
  async completeOrder(bridgeOrderId, { fillPrice, executedShares, status = 'FILLED', notes = '' } = {}) {
    this.purgeExpiredOrders();
    const order = this.orders.get(bridgeOrderId);

    if (!order) {
      return { success: false, error: `Orden no encontrada: ${bridgeOrderId}` };
    }

    if (order.status !== 'PENDING') {
      return { success: false, error: `La orden ${bridgeOrderId} ya no está pendiente (Estado: ${order.status})` };
    }

    const normStatus = (status || 'FILLED').toUpperCase();

    if (normStatus === 'CANCELLED' || normStatus === 'REJECTED') {
      order.status = normStatus;
      order.resolvedAt = new Date().toISOString();
      order.notes = notes;
      capitalManagerService.releaseCapital(bridgeOrderId, order.notional);
      return {
        success: true,
        bridgeOrderId,
        status: normStatus,
        capitalReleased: order.notional,
      };
    }

    // Orden ejecutada exitosamente (FILLED)
    const effectivePrice = Number(fillPrice || order.currentPrice);
    const effectiveShares = Number(executedShares || order.qty);

    order.status = 'COMPLETED';
    order.fillPrice = effectivePrice;
    order.executedShares = effectiveShares;
    order.completedAt = new Date().toISOString();

    let position = null;
    try {
      position = await portfolioService.addPosition({
        symbol: order.symbol,
        shares: effectiveShares,
        buyPrice: effectivePrice,
        broker: this.brokerName,
        stopLoss: order.stopLoss,
        targetPrice: order.targetPrice,
      });
    } catch (err) {
      console.warn(`⚠️ [LOCAL BRIDGE] Error registrando posición en portafolio: ${err.message}`);
    }

    console.info(`✅ [LOCAL BRIDGE] Orden ${bridgeOrderId} completada en broker local a $${effectivePrice}.`);

    return {
      success: true,
      bridgeOrderId,
      status: 'COMPLETED',
      execution: {
        fillPrice: effectivePrice,
        executedShares: effectiveShares,
      },
      position,
    };
  }

  /**
   * Limpia toda la cola en memoria (para suites de pruebas).
   */
  clear() {
    this.orders.clear();
  }
}

export const localBridgeService = new LocalBridgeService();
