import { env } from '../../config/environment.js';
import { capitalManagerService } from '../capitalManagerService.js';
import { hapiCopilotService } from './hapiCopilotService.js';
import { localBridgeService } from './localBridgeService.js';

/**
 * 🎯 [INVEST AI] Orquestador Unificado de Ejecución de Broker (Execution Bridge)
 * Implementa el patrón Strategy para coordinar la ejecución entre:
 * - Opción A: Hapi Copilot Asistido (Cloud Run)
 * - Opción B: Local Automation Bridge (Worker Residencial)
 * 
 * Salvaguarda permanentemente la regla de CERO RE-FONDEO ($35 USD).
 */
class ExecutionBridge {
  constructor() {
    this.brokerName = 'Happi';
    this.mode = (process.env.EXECUTION_MODE || env.EXECUTION_MODE || 'COPILOT').toUpperCase();
    this.strategies = {
      COPILOT: hapiCopilotService,
      LOCAL_AGENT: localBridgeService,
    };
  }

  /**
   * Retorna el modo de ejecución actualmente activo.
   */
  getExecutionMode() {
    return this.mode;
  }

  /**
   * Permite conmutar el modo de ejecución dinámicamente o durante tests.
   * @param {'COPILOT' | 'LOCAL_AGENT'} mode
   */
  setExecutionMode(mode) {
    const norm = (mode || '').toUpperCase();
    if (!this.strategies[norm]) {
      throw new Error(`Modo de ejecución no reconocido: ${mode}. Opciones válidas: COPILOT, LOCAL_AGENT`);
    }
    this.mode = norm;
    console.info(`🔄 [EXECUTION BRIDGE] Modo de ejecución cambiado a: ${this.mode}`);
    return this.mode;
  }

  /**
   * Ejecuta o encola la orden según el patrón Strategy configurado.
   * Valida estrictamente el dimensionamiento del capital con capitalManagerService.
   * @param {object} params
   */
  async executeOrder({ symbol, qty, notional, currentPrice, stopLoss, targetPrice, side = 'BUY', chatId = null }) {
    const sym = (symbol || 'ACTIVO').toUpperCase();
    const price = Number(currentPrice || 100.00);

    // 1. Dimensionamiento y Validación de Cero Re-Fondeo ($35 USD)
    const sizing = capitalManagerService.calculateFractionalSizing(sym, price, 35.00);

    if (!sizing.allowed) {
      console.warn(`🛑 [EXECUTION BRIDGE] Orden bloqueada para ${sym}: ${sizing.reason} (Pool agotado o saldo < $1).`);
      return {
        success: false,
        blocked: true,
        reason: sizing.reason,
        symbol: sym,
        mode: this.mode,
        broker: this.brokerName,
        capitalStatus: capitalManagerService.getCapitalStatus(),
      };
    }

    const effectiveNotional = sizing.notional;
    const effectiveQty = sizing.qty;
    const effectiveStopLoss = Number(stopLoss || price * 0.95);
    const effectiveTargetPrice = Number(targetPrice || price * 1.10);

    const orderPayload = {
      symbol: sym,
      qty: effectiveQty,
      notional: effectiveNotional,
      currentPrice: price,
      stopLoss: effectiveStopLoss,
      targetPrice: effectiveTargetPrice,
      side,
      chatId,
    };

    // 2. Despacho según el modo de ejecución (Strategy)
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

    // Default: COPILOT (Opción A)
    const copilotResult = await this.strategies.COPILOT.executeOrder(orderPayload);
    return {
      success: true,
      mode: 'COPILOT',
      broker: this.brokerName,
      ...copilotResult,
    };
  }

  /**
   * Retorna métricas unificadas del broker activo (Happi) y estado de la cola.
   */
  getBrokerSummary() {
    const capital = capitalManagerService.getCapitalStatus();
    const pendingLocalOrders = this.strategies.LOCAL_AGENT.getPendingOrders();

    return {
      broker: this.brokerName,
      executionMode: this.mode,
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
