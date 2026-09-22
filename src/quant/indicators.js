/**
 * 📐 [INVEST AI] Biblioteca Matemática de Indicadores Técnicos Cuantitativos
 * Funciones puras, deterministas y de alta precisión sin dependencias externas.
 */

/**
 * Calcula la serie completa de Media Móvil Exponencial (EMA).
 * @param {number[]} prices - Serie temporal cronológica (antiguo -> reciente)
 * @param {number} period - Período de la EMA (ej. 12, 20, 26, 50)
 * @returns {number[]} Serie de valores EMA calculados
 */
export function calculateEMASeries(prices, period) {
  if (!Array.isArray(prices) || prices.length === 0 || period <= 0) {
    return [];
  }

  const cleanPrices = prices.filter((p) => typeof p === 'number' && !isNaN(p));
  if (cleanPrices.length === 0) return [];

  // Adaptación cuando la cantidad de velas es menor al período requerido
  const effectivePeriod = Math.min(period, cleanPrices.length);
  const multiplier = 2 / (period + 1);

  // Semilla: Media Móvil Simple (SMA) del bloque inicial
  let initialSum = 0;
  for (let i = 0; i < effectivePeriod; i++) {
    initialSum += cleanPrices[i];
  }
  let currentEMA = initialSum / effectivePeriod;
  const series = [parseFloat(currentEMA.toFixed(4))];

  // Cálculo iterativo exponencial para los precios restantes
  for (let i = effectivePeriod; i < cleanPrices.length; i++) {
    currentEMA = (cleanPrices[i] - currentEMA) * multiplier + currentEMA;
    series.push(parseFloat(currentEMA.toFixed(4)));
  }

  return series;
}

/**
 * Calcula la Media Móvil Exponencial (EMA).
 * Por defecto retorna el valor más reciente como escalar; si returnSeries=true, retorna la serie completa.
 * @param {number[]} prices - Serie de precios de cierre
 * @param {number} period - Período
 * @param {boolean} [returnSeries=false] - Si es true, retorna number[]
 * @returns {number|number[]}
 */
export function calculateEMA(prices, period, returnSeries = false) {
  const series = calculateEMASeries(prices, period);
  if (returnSeries) return series;
  return series.length > 0 ? series[series.length - 1] : 0;
}

/**
 * Calcula la serie completa de Relative Strength Index (RSI) con suavizado de Wilder.
 * @param {number[]} prices - Serie de precios de cierre
 * @param {number} [period=14] - Período del oscilador (por defecto 14)
 * @returns {number[]} Serie de valores RSI (0 - 100)
 */
export function calculateRSISeries(prices, period = 14) {
  if (!Array.isArray(prices) || prices.length < 2 || period <= 0) {
    return [];
  }

  const cleanPrices = prices.filter((p) => typeof p === 'number' && !isNaN(p));
  if (cleanPrices.length < 2) return [];

  const changes = [];
  for (let i = 1; i < cleanPrices.length; i++) {
    changes.push(cleanPrices[i] - cleanPrices[i - 1]);
  }

  if (changes.length < period) {
    let gainSum = 0;
    let lossSum = 0;
    for (const ch of changes) {
      if (ch > 0) gainSum += ch;
      else lossSum += Math.abs(ch);
    }
    if (lossSum === 0) return [gainSum === 0 ? 50 : 100];
    const rs = gainSum / lossSum;
    const rsi = 100 - 100 / (1 + rs);
    return [parseFloat(rsi.toFixed(2))];
  }

  // Primer promedio: media simple de ganancias y pérdidas de los primeros 'period' cambios
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const ch = changes[i];
    if (ch > 0) avgGain += ch;
    else avgLoss += Math.abs(ch);
  }
  avgGain /= period;
  avgLoss /= period;

  const series = [];
  let rsi;
  if (avgLoss === 0) {
    rsi = avgGain === 0 ? 50 : 100;
  } else {
    const rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);
  }
  series.push(parseFloat(rsi.toFixed(2)));

  // Suavizado exponencial clásico de Wilder para los períodos subsiguientes
  for (let i = period; i < changes.length; i++) {
    const ch = changes[i];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? Math.abs(ch) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsi = avgGain === 0 ? 50 : 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi = 100 - 100 / (1 + rs);
    }
    series.push(parseFloat(rsi.toFixed(2)));
  }

  return series;
}

/**
 * Calcula el Relative Strength Index (RSI).
 * @param {number[]} prices - Serie de precios
 * @param {number} [period=14] - Período
 * @param {boolean} [returnSeries=false] - Si es true, retorna array
 * @returns {number|number[]}
 */
export function calculateRSI(prices, period = 14, returnSeries = false) {
  const series = calculateRSISeries(prices, period);
  if (returnSeries) return series;
  return series.length > 0 ? series[series.length - 1] : 50;
}

/**
 * Calcula el Moving Average Convergence Divergence (MACD).
 * @param {number[]} prices - Serie de precios de cierre
 * @param {number} [fastPeriod=12] - Período EMA rápida
 * @param {number} [slowPeriod=26] - Período EMA lenta
 * @param {number} [signalPeriod=9] - Período EMA de la señal
 * @returns {{ macdLine: number, signalLine: number, histogram: number }}
 */
export function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!Array.isArray(prices) || prices.length === 0) {
    return { macdLine: 0, signalLine: 0, histogram: 0 };
  }

  const fastSeries = calculateEMASeries(prices, fastPeriod);
  const slowSeries = calculateEMASeries(prices, slowPeriod);

  if (slowSeries.length === 0 || fastSeries.length === 0) {
    return { macdLine: 0, signalLine: 0, histogram: 0 };
  }

  // Alineamos las series por el final temporal
  const alignedLength = Math.min(fastSeries.length, slowSeries.length);
  const macdSeries = [];
  const fastOffset = fastSeries.length - alignedLength;
  const slowOffset = slowSeries.length - alignedLength;

  for (let i = 0; i < alignedLength; i++) {
    const diff = fastSeries[fastOffset + i] - slowSeries[slowOffset + i];
    macdSeries.push(parseFloat(diff.toFixed(4)));
  }

  const signalSeries = calculateEMASeries(macdSeries, signalPeriod);
  const latestMacd = macdSeries[macdSeries.length - 1] || 0;
  const latestSignal = signalSeries.length > 0 ? signalSeries[signalSeries.length - 1] : latestMacd;
  const histogram = parseFloat((latestMacd - latestSignal).toFixed(4));

  return {
    macdLine: latestMacd,
    signalLine: latestSignal,
    histogram,
  };
}

/**
 * Calcula niveles dinámicos de Soporte y Resistencia mediante ventana de observación.
 * @param {Array<{high?: number, low?: number, close: number}|number>} candles - Velas OHLC o precios
 * @param {number} [lookback=20] - Ventana retrospectiva en velas
 * @returns {{ support: number, resistance: number, channelWidth: number }}
 */
export function calculateSupportResistance(candles, lookback = 20) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { support: 0, resistance: 0, channelWidth: 0 };
  }

  const windowCandles = candles.slice(-Math.max(1, lookback));

  const lows = windowCandles.map((c) => {
    if (typeof c === 'number') return c;
    if (c && typeof c.low === 'number' && !isNaN(c.low)) return c.low;
    return c?.close ?? 0;
  }).filter((v) => v > 0);

  const highs = windowCandles.map((c) => {
    if (typeof c === 'number') return c;
    if (c && typeof c.high === 'number' && !isNaN(c.high)) return c.high;
    return c?.close ?? 0;
  }).filter((v) => v > 0);

  if (lows.length === 0 || highs.length === 0) {
    return { support: 0, resistance: 0, channelWidth: 0 };
  }

  const support = parseFloat(Math.min(...lows).toFixed(2));
  const resistance = parseFloat(Math.max(...highs).toFixed(2));
  const channelWidth = parseFloat((resistance - support).toFixed(2));

  return {
    support,
    resistance,
    channelWidth,
  };
}
