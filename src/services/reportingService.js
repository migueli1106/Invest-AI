import { capitalManagerService } from './capitalManagerService.js';
import { portfolioService } from './portfolioService.js';
import { gcsStorageService } from '../storage/gcsStorageService.js';

/**
 * 📊 [INVEST AI] Motor Cuantitativo de Auditoría Financiera y Reportes
 * Consolida P&L, métricas de trading (Win Rate, Profit Factor) y archiva en GCS.
 */

export class ReportingService {
  /**
   * Genera el objeto estandarizado de métricas y telemetría financiera.
   * @param {object} [options={}]
   * @param {Array} [options.overridePositions=null]
   * @param {Array} [options.overrideClosedPositions=null]
   * @returns {Promise<object>}
   */
  async generateReportJson(options = {}) {
    const capitalStatus = capitalManagerService.getCapitalStatus();
    const portfolioPerformance = await portfolioService.calculatePortfolioPerformance(options.overridePositions);
    const closedPositions = options.overrideClosedPositions || await portfolioService.getClosedPositions();

    const totalClosedTrades = closedPositions.length;
    const winningTrades = closedPositions.filter((p) => Number(p.realizedPnL || 0) > 0);
    const losingTrades = closedPositions.filter((p) => Number(p.realizedPnL || 0) < 0);
    const breakEvenTrades = closedPositions.filter((p) => Number(p.realizedPnL || 0) === 0);

    const grossProfit = parseFloat(winningTrades.reduce((acc, p) => acc + Number(p.realizedPnL || 0), 0).toFixed(2));
    const grossLoss = parseFloat(Math.abs(losingTrades.reduce((acc, p) => acc + Number(p.realizedPnL || 0), 0)).toFixed(2));
    const realizedPnLTotal = parseFloat((grossProfit - grossLoss).toFixed(2));

    const winRate = totalClosedTrades > 0
      ? parseFloat(((winningTrades.length / totalClosedTrades) * 100).toFixed(2))
      : 0;

    let profitFactor = 0;
    if (grossLoss === 0) {
      profitFactor = grossProfit > 0 ? 999.99 : 0;
    } else {
      profitFactor = parseFloat((grossProfit / grossLoss).toFixed(2));
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    return {
      reportId: `rep_${Date.now()}`,
      generatedAt: now.toISOString(),
      date: dateStr,
      capital: {
        totalCapital: capitalStatus.totalCapital,
        deployedCapital: capitalStatus.deployedCapital,
        availableCash: capitalStatus.availableCash,
        currency: capitalStatus.currency,
        canTrade: capitalStatus.canTrade,
        policy: capitalStatus.policy,
      },
      metrics: {
        totalClosedTrades,
        winningTradesCount: winningTrades.length,
        losingTradesCount: losingTrades.length,
        breakEvenTradesCount: breakEvenTrades.length,
        winRatePercent: winRate,
        grossProfit,
        grossLoss,
        profitFactor,
        realizedPnLTotal,
        unrealizedPnLTotal: portfolioPerformance.summary.totalUnrealizedPnL,
        unrealizedPnLPercent: portfolioPerformance.summary.totalUnrealizedPnLPercent,
      },
      openPositions: {
        count: portfolioPerformance.summary.count,
        totalCostBasis: portfolioPerformance.summary.totalCostBasis,
        totalMarketValue: portfolioPerformance.summary.totalMarketValue,
        totalUnrealizedPnL: portfolioPerformance.summary.totalUnrealizedPnL,
        totalUnrealizedPnLPercent: portfolioPerformance.summary.totalUnrealizedPnLPercent,
        items: portfolioPerformance.positions,
      },
      closedTrades: {
        count: totalClosedTrades,
        items: closedPositions,
      },
      broker: {
        name: 'Happi',
        status: 'ACTIVE',
        cash: capitalStatus.availableCash,
        portfolioValue: parseFloat((portfolioPerformance.summary.totalMarketValue + capitalStatus.availableCash).toFixed(2)),
        buyingPower: capitalStatus.availableCash,
        currency: capitalStatus.currency,
      },
    };
  }

  /**
   * Genera una presentación ejecutiva en formato Markdown financiero.
   * @param {object} report - Objeto devuelto por generateReportJson
   * @returns {string}
   */
  generateReportMarkdown(report) {
    const { capital, metrics, openPositions, closedTrades, broker } = report;

    const lines = [
      `# 📊 INVEST AI — REPORTE EJECUTIVO DE RENDIMIENTO & AUDITORÍA FINANCIERA`,
      `**Fecha de Emisión:** ${report.date} | **ID:** \`${report.reportId}\` | **Generado:** ${report.generatedAt}`,
      ``,
      `---`,
      ``,
      `## 💰 1. SALUD DEL POOL DE CAPITAL (CERO RE-FONDEO)`,
      `- **Capital Total Autorizado:** $${capital.totalCapital.toFixed(2)} ${capital.currency}`,
      `- **Disponible Líquido:** $${capital.availableCash.toFixed(2)} ${capital.currency}`,
      `- **Capital Desplegado en Mercado:** $${capital.deployedCapital.toFixed(2)} ${capital.currency}`,
      `- **Estado Operativo:** ${capital.canTrade ? '🟢 HABILITADO' : '🔴 BLOQUEADO POR ROTACIÓN'}`,
      `- **Política de Resguardo:** \`${capital.policy}\``,
      ``,
      `---`,
      ``,
      `## 🎯 2. MÉTRICAS CUANTITATIVAS DE TRADING`,
      `| Métrica Financiera | Valor Consolidado |`,
      `| :--- | :--- |`,
      `| **Win Rate (%)** | ${metrics.winRatePercent}% (${metrics.winningTradesCount}/${metrics.totalClosedTrades} operaciones) |`,
      `| **Profit Factor** | ${metrics.profitFactor === 999.99 ? '∞ (Sin pérdidas)' : metrics.profitFactor.toFixed(2)} |`,
      `| **P&L Realizado Total** | ${metrics.realizedPnLTotal >= 0 ? '+' : ''}$${metrics.realizedPnLTotal.toFixed(2)} |`,
      `| **Ganancia Bruta** | +$${metrics.grossProfit.toFixed(2)} |`,
      `| **Pérdida Bruta** | -$${metrics.grossLoss.toFixed(2)} |`,
      `| **P&L Flotante (No Realizado)** | ${metrics.unrealizedPnLTotal >= 0 ? '+' : ''}$${metrics.unrealizedPnLTotal.toFixed(2)} (${metrics.unrealizedPnLPercent >= 0 ? '+' : ''}${metrics.unrealizedPnLPercent}%) |`,
      ``,
      `---`,
      ``,
      `## 💼 3. POSICIONES ABIERTAS EN MERCADO (${openPositions.count})`,
      `- **Costo Base Total:** $${openPositions.totalCostBasis.toFixed(2)}`,
      `- **Valor Actual de Mercado:** $${openPositions.totalMarketValue.toFixed(2)}`,
      ``,
    ];

    if (openPositions.items.length === 0) {
      lines.push(`_No hay posiciones abiertas en este momento._\n`);
    } else {
      lines.push(`| Activo | Broker | Acciones | Compra Prom. | Actual | Valor ($) | P&L ($) | P&L (%) |`);
      lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
      for (const p of openPositions.items) {
        lines.push(
          `| **${p.symbol}** | ${p.broker} | ${p.shares} | $${p.averageBuyPrice.toFixed(2)} | $${p.currentPrice.toFixed(2)} | $${p.currentMarketValue.toFixed(2)} | ${p.unrealizedPnL >= 0 ? '+' : ''}$${p.unrealizedPnL.toFixed(2)} | ${p.unrealizedPnLPercent >= 0 ? '+' : ''}${p.unrealizedPnLPercent.toFixed(2)}% |`
        );
      }
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(``);
    lines.push(`## 🗄️ 4. HISTORIAL DE OPERACIONES CERRADAS (${closedTrades.count})`);

    if (closedTrades.items.length === 0) {
      lines.push(`_No hay operaciones cerradas registradas aún._\n`);
    } else {
      lines.push(`| Activo | Acciones | Compra | Venta/Cierre | P&L ($) | Retorno (%) | Fecha Cierre |`);
      lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
      for (const c of closedTrades.items) {
        lines.push(
          `| **${c.symbol}** | ${c.shares} | $${Number(c.averageBuyPrice || 0).toFixed(2)} | $${Number(c.closePrice || c.currentMarketValue / (c.shares || 1)).toFixed(2)} | ${Number(c.realizedPnL || 0) >= 0 ? '+' : ''}$${Number(c.realizedPnL || 0).toFixed(2)} | ${Number(c.realizedPnLPercent || 0) >= 0 ? '+' : ''}${Number(c.realizedPnLPercent || 0).toFixed(2)}% | ${c.closedAt ? c.closedAt.split('T')[0] : 'N/A'} |`
        );
      }
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(`*Reporte inmutable emitido y certificado por el motor de Invest AI & Deko Labs.*`);

    return lines.join('\n');
  }

  /**
   * Genera el reporte, computa formatos y archiva en Google Cloud Storage.
   * @param {object} [options={}]
   * @param {boolean} [options.uploadGCS=true] - Sube a gs://invest_ia/reports/
   * @param {object} [options.overridePositions=null]
   * @param {object} [options.overrideClosedPositions=null]
   * @returns {Promise<{ report: object, markdown: string, jsonMeta: object, mdMeta: object }>}
   */
  async generateAndArchiveReport(options = {}) {
    const uploadGCS = options.uploadGCS !== false;
    const report = await this.generateReportJson(options);
    const markdown = this.generateReportMarkdown(report);

    const filenameJson = `report_${report.date}.json`;
    const filenameMd = `report_${report.date}.md`;

    let jsonMeta = null;
    let mdMeta = null;

    if (uploadGCS) {
      jsonMeta = await gcsStorageService.uploadReport({
        filename: filenameJson,
        content: report,
        contentType: 'application/json',
      });

      mdMeta = await gcsStorageService.uploadReport({
        filename: filenameMd,
        content: markdown,
        contentType: 'text/markdown',
      });
    }

    return {
      report,
      markdown,
      jsonMeta,
      mdMeta,
    };
  }
}

export const reportingService = new ReportingService();
