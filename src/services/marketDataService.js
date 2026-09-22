import YahooFinance from 'yahoo-finance2';
import { AssetSchema, FluctuationSchema } from '../models/schemas.js';

/**
 * 📈 [INVEST AI] Servicio de Ingesta y Datos de Mercado
 * Extrae cotizaciones en tiempo real, fluctuaciones y velas históricas.
 */

class MarketDataService {
  constructor() {
    this.yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }

  /**
   * Obtiene la cotización en vivo y métricas clave de un activo.
   * @param {string} symbol - Ticker del activo (ej. 'AAPL', 'NVDA', 'SPY')
   */
  async getQuote(symbol) {
    const rawQuote = await this.yf.quote(symbol.toUpperCase());
    if (!rawQuote || !rawQuote.regularMarketPrice) {
      throw new Error(`No se obtuvieron datos de mercado para el símbolo: ${symbol}`);
    }

    const currentPrice = rawQuote.regularMarketPrice;
    const previousClose = rawQuote.regularMarketPreviousClose || currentPrice;
    const changePercent = rawQuote.regularMarketChangePercent !== undefined
      ? rawQuote.regularMarketChangePercent
      : ((currentPrice - previousClose) / previousClose) * 100;

    const assetData = {
      symbol: rawQuote.symbol,
      name: rawQuote.shortName || rawQuote.longName || rawQuote.symbol,
      exchange: rawQuote.exchange || 'US',
      currency: rawQuote.currency || 'USD',
      currentPrice,
      previousClose,
      changePercent,
      volume: rawQuote.regularMarketVolume || 0,
      dayHigh: rawQuote.regularMarketDayHigh,
      dayLow: rawQuote.regularMarketDayLow,
      marketCap: rawQuote.marketCap,
      lastUpdated: new Date().toISOString(),
      status: 'ACTIVE',
    };

    return AssetSchema.parse(assetData);
  }

  /**
   * Obtiene múltiples cotizaciones en paralelo.
   * @param {string[]} symbols
   */
  async getBatchQuotes(symbols) {
    const promises = symbols.map(async (symbol) => {
      try {
        return await this.getQuote(symbol);
      } catch (err) {
        console.warn(`⚠️ Error al obtener cotización de ${symbol}: ${err.message}`);
        return null;
      }
    });

    const results = await Promise.all(promises);
    return results.filter(Boolean);
  }

  /**
   * Obtiene el historial de velas (OHLCV) de un activo.
   * @param {string} symbol
   * @param {string} interval - '1d', '1h', '5m'
   * @param {number} daysBack - Días de historial
   */
  async getHistoricalCandles(symbol, daysBack = 30, interval = '1d') {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const chartData = await this.yf.chart(symbol.toUpperCase(), {
      period1: startDate.toISOString().split('T')[0],
      interval,
    });

    if (!chartData || !chartData.quotes) {
      return [];
    }

    return chartData.quotes.map((c) => ({
      date: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
  }

  /**
   * Calcula la fluctuación inmediata y volatilidad porcentual de un activo.
   * @param {object} quote - Objeto retornado por getQuote
   * @param {string} interval - Intervalo de muestreo
   */
  buildFluctuationRecord(quote, interval = '1d') {
    const spread = quote.dayHigh && quote.dayLow ? quote.dayHigh - quote.dayLow : 0;
    const volatility = quote.previousClose > 0 ? (spread / quote.previousClose) * 100 : 0;

    const fluctuationData = {
      symbol: quote.symbol,
      timestamp: new Date().toISOString(),
      price: quote.currentPrice,
      changePercent: quote.changePercent,
      volume: quote.volume,
      interval,
      volatility: parseFloat(volatility.toFixed(4)),
    };

    return FluctuationSchema.parse(fluctuationData);
  }
}

export const marketDataService = new MarketDataService();
