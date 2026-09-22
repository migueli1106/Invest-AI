import { z } from 'zod';

/**
 * 📊 [INVEST AI] Esquemas Declarativos de Dominio Financiero (Zod)
 * Estructuran y validan los documentos almacenados en Firebase Firestore.
 */

// 1. Esquema de Activo Bajo Seguimiento (Collection: assets_tracking)
export const AssetSchema = z.object({
  symbol: z.string().min(1).toUpperCase(),
  name: z.string().min(1),
  exchange: z.string().optional().default('US'),
  currency: z.string().default('USD'),
  currentPrice: z.number().positive(),
  previousClose: z.number().positive(),
  changePercent: z.number(),
  volume: z.number().nonnegative(),
  dayHigh: z.number().positive().optional(),
  dayLow: z.number().positive().optional(),
  marketCap: z.number().nonnegative().optional(),
  lastUpdated: z.string(), // ISO String
  status: z.enum(['ACTIVE', 'WATCHLIST', 'INACTIVE']).default('WATCHLIST'),
});

// 2. Esquema de Fluctuación Temporal (Collection: market_fluctuations)
export const FluctuationSchema = z.object({
  symbol: z.string().min(1).toUpperCase(),
  timestamp: z.string(), // ISO String
  price: z.number().positive(),
  changePercent: z.number(),
  volume: z.number().nonnegative(),
  interval: z.enum(['1m', '5m', '15m', '1h', '1d']).default('1d'),
  volatility: z.number().nonnegative().optional(),
});

// 3. Esquema de Señal Cuantitativa (Collection: trading_signals)
export const TradingSignalSchema = z.object({
  symbol: z.string().min(1).toUpperCase(),
  action: z.enum(['BUY', 'SELL', 'HOLD']),
  entryPrice: z.number().positive(),
  targetPrice: z.number().positive(),
  stopLoss: z.number().positive(),
  timeHorizonDays: z.number().int().positive(),
  confidence: z.number().min(0).max(100), // Score 0-100%
  expectedReturnPercent: z.number(),
  riskRewardRatio: z.number().positive(),
  rationale: z.string().min(10), // Explicabilidad de la IA
  status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED']).default('PENDING_APPROVAL'),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
});

// 4. Esquema de Posición de Cartera (Collection: portfolio_records)
export const PortfolioHoldingSchema = z.object({
  symbol: z.string().min(1).toUpperCase(),
  shares: z.number().positive(),
  averageBuyPrice: z.number().positive(),
  totalCost: z.number().positive(),
  currentMarketValue: z.number().positive(),
  unrealizedPnL: z.number(),
  unrealizedPnLPercent: z.number(),
  lastUpdated: z.string(),
});
