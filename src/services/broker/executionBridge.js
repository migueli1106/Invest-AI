import { env } from '../../config/environment.js';
import { capitalManagerService } from '../capitalManagerService.js';
import { localBridgeService } from './localBridgeService.js';
import { moomooService } from './moomooService.js';

/**
 * 🎯 [INVEST AI] Orquestador Unificado de Ejecución de Broker (Execution Bridge)
 * Implementa el patrón Strategy para coordinar la ejecución soberana con Moomoo:
 * - MOOMOO: Moomoo OpenAPI & OpenD Gateway (Oficial de Producción / Simulación Directa)
 * - LOCAL_AGENT: Local Automation Bridge (Worker Residencial con Moomoo OpenD)
 * 
 * Opera bajo el motor de Capital Dinámico Exponencial (FLEXIBLE_CAPITAL).
 */
class ExecutionBridge {
  constructor() {
    this.strategies = {
      MOOMOO: moomooService,
      LOCAL_AGENT: localBridgeService,
    };
    this.mode = (process.env.EXECUTION_MODE || env.EXECUTION_MODE || 'MOOMOO').toUpperCase();
    if (!this.strategies[this.mode]) this.mode = 'MOOMOO';
    this.brokerName = 'Moomoo';
  }

  /**
   * Retorna el modo de ejecución actualmente activo.
   */
  getExecutionMode() {
    return this.mode;
  }

  /**
   * Permite conmutar el modo de ejecución dinámicamente o durante tests.
   * @param {'MOOMOO' | 'LOCAL_AGENT'} mode
   */
  setExecutionMode(mode) {
    const norm = (mode || '').toUpperCase();
    if (!this.strategies[norm]) {
      throw new Error(`Modo de ejecución no reconocido: ${mode}. Opciones válidas: MOOMOO, LOCAL_AGENT`);
    }
    this.mode = norm;
    this.brokerName = 'Moomoo';
    console.info(`🔄 [EXECUTION BRIDGE] Modo de ejecución cambiado a: ${this.mode} (Broker: ${this.brokerName})`);
    return this.mode;
  }

  /**
   * Ejecuta o encola la orden según el patrón Strategy configurado.
   * Aplica dimensionamiento dinámico proporcional permitiendo multi-posiciones simultáneas.
   * @param {object} params
   */
  async executeOrder({ symbol, qty, notional, currentPrice, stopLoss, targetPrice, side = 'BUY', chatId = null }) {
    const sym = (symbol || 'ACTIVO').toUpperCase();
    const price = Number(currentPrice || 100.00);
    const orderSide = (side || 'BUY').toUpperCase();

    let effectiveQty;
    let effectiveNotional;

    if (orderSide === 'SELL') {
      // Venta: libera liquidez, no consume pool de efectivo
      effectiveQty = Number(qty || (notional && price ? notional / price : 1));
      effectiveNotional = parseFloat((effectiveQty * price).toFixed(2));
    } else {
      // Compra: dimensionamiento proporcional bajo Capital Dinámico
      const sizing = capitalManagerService.calculateFractionalSizing(sym, price, notional || null);
      if (!sizing.allowed) {
        console.warn(`⚠️ [EXECUTION BRIDGE] Parámetros inválidos para orden en ${sym}: ${sizing.reason}`);
        return {
          success: false,
          error: sizing.reason,
          symbol: sym,
          mode: this.mode,
          broker: this.brokerName,
        };
      }
      effectiveNotional = sizing.notional;
      effectiveQty = sizing.qty;
    }

    const effectiveStopLoss = Number(stopLoss || price * 0.95);
    const effectiveTargetPrice = Number(targetPrice || price * 1.10);

    const orderPayload = {
      symbol: sym,
      qty: effectiveQty,
      notional: effectiveNotional,
      currentPrice: price,
      stopLoss: effectiveStopLoss,
      targetPrice: effectiveTargetPrice,
      side: orderSide,
      chatId,
    };

    if (this.mode === 'LOCAL_AGENT') {
      const bridgeResult = this.strategies.LOCAL_AGENT.queueOrder(orderPayload);
      return {
        success: true,
        mode: 'LOCAL_AGENT',
        broker: this.brokerName,
        symbol: sym,
        bridgeOrderId: bridgeResult.bridgeOrderId,
        status: bridgeResult.status,
        notional: effectiveNotional,
        qty: effectiveQty,
        order: bridgeResult.order,
      };
    }

    // Default: Despacho directo a Moomoo OpenD
    const mooRes = await this.strategies.MOOMOO.executeOrder({
      symbol: sym,
      qty: effectiveQty,
      price,
      side: orderSide,
      trdEnv: env.MOOMOO_TRD_ENV || 'SIMULATE',
    });

    return {
      success: true,
      mode: 'MOOMOO',
      broker: this.brokerName,
      ...mooRes,
    };
  }

  /**
   * Retorna métricas unificadas del broker activo y estado de la cola.
   */
  getBrokerSummary() {
    const capital = capitalManagerService.getCapitalStatus();
    const pendingLocalOrders = this.strategies.LOCAL_AGENT.getPendingOrders();

    return {
      broker: this.brokerName,
      executionMode: this.mode,
      trdEnv: env.MOOMOO_TRD_ENV || 'SIMULATE',
      status: 'OPERATIONAL',
      capital,
      localBridge: {
        pendingOrdersCount: pendingLocalOrders.length,
        pendingOrders: pendingLocalOrders,
      },
    };
  }
}

export const executionBridge = new ExecutionBridge();
