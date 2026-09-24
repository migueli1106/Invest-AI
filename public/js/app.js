/**
 * ⚡ [INVEST AI] Lógica Reactiva de la Terminal Institucional
 * Conecta con Cloud Run, renderiza métricas en vivo y actualiza Chart.js.
 */

let performanceChart = null;

function updateClock() {
  const clockEl = document.getElementById('clock-display');
  if (!clockEl) return;
  const now = new Date();
  const options = { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  clockEl.textContent = `${now.toLocaleTimeString('en-US', options)} NY`;
}
setInterval(updateClock, 1000);
updateClock();

function formatUSD(val) {
  const num = Number(val || 0);
  return `${num >= 0 ? '' : '-'}$${Math.abs(num).toFixed(2)}`;
}

function initChart() {
  const ctx = document.getElementById('capitalChart');
  if (!ctx) return;

  const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, 'rgba(0, 255, 102, 0.25)');
  gradient.addColorStop(1, 'rgba(0, 255, 102, 0.0)');

  performanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:00'],
      datasets: [
        {
          label: 'Valuación Portafolio (USD)',
          data: [35.0, 35.0, 35.8, 36.2, 70.0, 180.0, 290.0, 304.34],
          borderColor: '#00ff66',
          borderWidth: 2,
          pointBackgroundColor: '#00ff66',
          pointRadius: 3,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0a0e14',
          borderColor: '#182234',
          borderWidth: 1,
          titleColor: '#849581',
          bodyColor: '#00ff66',
          bodyFont: { family: 'JetBrains Mono' },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(24, 34, 52, 0.4)' },
          ticks: { color: '#849581', font: { family: 'JetBrains Mono', size: 10 } },
        },
        y: {
          grid: { color: 'rgba(24, 34, 52, 0.4)' },
          ticks: {
            color: '#849581',
            font: { family: 'JetBrains Mono', size: 10 },
            callback: (val) => `$${val}`,
          },
        },
      },
    },
  });
}

function updatePositionsTable(positions) {
  const tbody = document.getElementById('positions-tbody');
  const countBadge = document.getElementById('positions-count-badge');
  if (!tbody) return;

  if (countBadge) countBadge.textContent = positions.length;

  if (!positions || positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No hay posiciones abiertas en este momento.</td></tr>`;
    return;
  }

  tbody.innerHTML = positions.map((p) => {
    const pnl = Number(p.unrealizedPnL || 0);
    const pnlPercent = Number(p.unrealizedPnLPercent || 0);
    const isPos = pnl >= 0;
    const sign = isPos ? '+' : '';
    const brokerClass = (p.broker || '').toLowerCase() === 'alpaca' ? 'broker-alpaca' : '';

    return `
      <tr>
        <td><span class="ticker-badge">${p.symbol}</span></td>
        <td><span class="broker-pill ${brokerClass}">${p.broker || 'Happi'}</span></td>
        <td>${p.shares}</td>
        <td>$${Number(p.averageBuyPrice || 0).toFixed(2)}</td>
        <td style="color:#fff; font-weight:600;">$${Number(p.currentPrice || 0).toFixed(2)}</td>
        <td style="color:var(--color-green);">${p.targetPrice ? '$' + Number(p.targetPrice).toFixed(2) : '--'}</td>
        <td style="color:var(--color-crimson);">${p.stopLoss ? '$' + Number(p.stopLoss).toFixed(2) : '--'}</td>
        <td style="color:#fff;">$${Number(p.currentMarketValue || 0).toFixed(2)}</td>
        <td>
          <span class="pnl-pill ${isPos ? 'positive' : 'negative'}">
            ${sign}$${Math.abs(pnl).toFixed(2)} (${sign}${pnlPercent.toFixed(2)}%)
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

async function fetchTelemetry() {
  const btnText = document.getElementById('btn-text');
  if (btnText) btnText.textContent = '⟳ SYNCING...';

  try {
    const res = await fetch('/api/reports/latest');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rep = data.report;

    if (rep) {
      // 1. KPI Cards
      document.getElementById('kpi-total-capital').textContent = formatUSD(rep.capital.totalCapital);
      document.getElementById('kpi-available-cash').textContent = formatUSD(rep.capital.availableCash);
      document.getElementById('kpi-deployed-capital').textContent = formatUSD(rep.capital.deployedCapital);

      const pnlTotal = Number(rep.metrics.unrealizedPnLTotal || 0);
      const pnlPct = Number(rep.metrics.unrealizedPnLPercent || 0);
      const pnlEl = document.getElementById('kpi-pnl-val');
      const pnlSubEl = document.getElementById('kpi-pnl-sub');

      pnlEl.textContent = `${pnlTotal >= 0 ? '+' : ''}${formatUSD(pnlTotal)}`;
      pnlEl.className = `kpi-val ${pnlTotal >= 0 ? 'positive' : 'negative'}`;
      pnlSubEl.textContent = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% Retorno Flotante`;
      pnlSubEl.className = `kpi-sub ${pnlTotal >= 0 ? 'positive' : 'negative'}`;

      document.getElementById('kpi-deployed-sub').textContent = `${rep.openPositions.count} Posiciones Activas`;

      // 2. Telemetry Section
      document.getElementById('telem-winrate').textContent = `${rep.metrics.winRatePercent}% (${rep.metrics.winningTradesCount}/${rep.metrics.totalClosedTrades})`;
      document.getElementById('telem-profit-factor').textContent = rep.metrics.profitFactor === 999.99 ? '∞ (Sin pérdidas)' : rep.metrics.profitFactor.toFixed(2);
      document.getElementById('telem-realized-pnl').textContent = formatUSD(rep.metrics.realizedPnLTotal);
      document.getElementById('telem-buying-power').textContent = formatUSD(rep.broker.buyingPower);
      document.getElementById('telem-alpaca-cash').textContent = formatUSD(rep.broker.cash);

      // 3. Positions Table
      updatePositionsTable(rep.openPositions.items || []);

      // 4. Chart Update
      if (performanceChart && rep.openPositions.totalMarketValue > 0) {
        const lastVal = rep.openPositions.totalMarketValue + rep.capital.availableCash;
        performanceChart.data.datasets[0].data[7] = parseFloat(lastVal.toFixed(2));
        performanceChart.update();
      }

      document.getElementById('chart-timestamp').textContent = `ACTUALIZADO: ${new Date().toLocaleTimeString()}`;
    }
  } catch (err) {
    console.warn('⚠️ [TELEMETRÍA] Error actualizando datos:', err.message);
    const statusText = document.getElementById('market-status-text');
    if (statusText) statusText.textContent = 'OFFLINE / REINTENTANDO...';
  } finally {
    if (btnText) btnText.textContent = '⟳ REFRESH';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initChart();
  fetchTelemetry();
  setInterval(fetchTelemetry, 30000); // Polling suave cada 30s

  const btn = document.getElementById('btn-refresh');
  if (btn) btn.addEventListener('click', fetchTelemetry);
});
