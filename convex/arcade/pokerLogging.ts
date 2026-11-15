/**
 * Poker gambling transaction logging utilities.
 * 
 * Provides comprehensive audit trail for all poker transactions including
 * bets, wins, buy-ins, and cash-outs. Critical for compliance and dispute resolution.
 */
import type { GenericId as Id } from "convex/values";
import type { MutationCtx, QueryCtx } from "../lib/dataModel";

type TransactionEvent =
  | "buy_in"
  | "bet"
  | "call"
  | "raise"
  | "fold"
  | "check"
  | "all_in"
  | "win"
  | "cash_out"
  | "timeout_forfeit"
  | "table_end";

type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "n/a";

/**
 * Log a poker transaction to the audit trail.
 * Should be called for every action that changes chip counts or game state.
 */
export async function logPokerTransaction(
  ctx: MutationCtx,
  params: {
    playerId: Id<"pokerPlayers">;
    playerName: string;
    isBot: boolean;
    tableId: Id<"pokerTables">;
    handNumber: number;
    eventType: TransactionEvent;
    chipsBefore: number;
    chipsChange: number;
    chipsAfter: number;
    street: Street;
    potSize: number;
    reason?: string;
    winningHand?: {
      category: string;
      label: string;
    };
  }
): Promise<Id<"pokerTransactions">> {
  const timestamp = Date.now();
  
  return await ctx.db.insert("pokerTransactions", {
    playerId: params.playerId,
    playerName: params.playerName,
    isBot: params.isBot,
    tableId: params.tableId,
    handNumber: params.handNumber,
    eventType: params.eventType,
    chipsBefore: params.chipsBefore,
    chipsChange: params.chipsChange,
    chipsAfter: params.chipsAfter,
    street: params.street,
    potSize: params.potSize,
    reason: params.reason,
    timestamp,
    winningHand: params.winningHand,
  });
}

/**
 * Initialize or get session stats for a player.
 * Creates a new session record if one doesn't exist.
 */
export async function getOrCreateSessionStats(
  ctx: MutationCtx,
  playerId: Id<"pokerPlayers">,
  playerName: string,
  startingPoints: number
): Promise<Id<"pokerSessionStats">> {
  const existing = await ctx.db
    .query("pokerSessionStats")
    .withIndex("by_player", (q) => q.eq("playerId", playerId))
    .order("desc")
    .first();
  
  // If session exists and was active in the last hour, reuse it
  const oneHour = 60 * 60 * 1000;
  if (existing && !existing.sessionEnd && Date.now() - existing.lastActivity < oneHour) {
    return existing._id;
  }
  
  // Create new session
  const now = Date.now();
  return await ctx.db.insert("pokerSessionStats", {
    playerId,
    playerName,
    sessionStart: now,
    lastActivity: now,
    handsPlayed: 0,
    handsWon: 0,
    handsFolded: 0,
    handsAllIn: 0,
    totalBuyIns: 0,
    totalCashOuts: 0,
    totalWagered: 0,
    totalWon: 0,
    biggestPot: 0,
    netProfit: 0,
    startingPoints,
    currentPoints: startingPoints,
    tablesJoined: [],
  });
}

/**
 * Update session stats after a transaction.
 */
export async function updateSessionStats(
  ctx: MutationCtx,
  playerId: Id<"pokerPlayers">,
  updates: {
    handPlayed?: boolean;
    handWon?: boolean;
    handFolded?: boolean;
    wentAllIn?: boolean;
    wagered?: number;
    won?: number;
    potSize?: number;
    buyIn?: number;
    cashOut?: number;
    tableId?: Id<"pokerTables">;
    currentPoints?: number;
  }
): Promise<void> {
  const session = await ctx.db
    .query("pokerSessionStats")
    .withIndex("by_player", (q) => q.eq("playerId", playerId))
    .order("desc")
    .first();
  
  if (!session) return;
  
  const patch: Partial<typeof session> = {
    lastActivity: Date.now(),
  };
  
  if (updates.handPlayed) {
    patch.handsPlayed = session.handsPlayed + 1;
  }
  if (updates.handWon) {
    patch.handsWon = session.handsWon + 1;
  }
  if (updates.handFolded) {
    patch.handsFolded = session.handsFolded + 1;
  }
  if (updates.wentAllIn) {
    patch.handsAllIn = session.handsAllIn + 1;
  }
  if (updates.wagered) {
    patch.totalWagered = session.totalWagered + updates.wagered;
  }
  if (updates.won) {
    patch.totalWon = session.totalWon + updates.won;
    if (updates.potSize && updates.potSize > session.biggestPot) {
      patch.biggestPot = updates.potSize;
    }
  }
  if (updates.buyIn) {
    patch.totalBuyIns = session.totalBuyIns + updates.buyIn;
  }
  if (updates.cashOut) {
    patch.totalCashOuts = session.totalCashOuts + updates.cashOut;
  }
  if (updates.tableId && !session.tablesJoined.includes(updates.tableId)) {
    patch.tablesJoined = [...session.tablesJoined, updates.tableId];
  }
  if (updates.currentPoints !== undefined) {
    patch.currentPoints = updates.currentPoints;
    patch.netProfit = updates.currentPoints - session.startingPoints;
  }
  
  await ctx.db.patch(session._id, patch);
}

/**
 * Finalize a session when a player leaves or the event ends.
 */
export async function finalizeSession(
  ctx: MutationCtx,
  playerId: Id<"pokerPlayers">
): Promise<void> {
  const session = await ctx.db
    .query("pokerSessionStats")
    .withIndex("by_player", (q) => q.eq("playerId", playerId))
    .order("desc")
    .first();
  
  if (!session || session.sessionEnd) return;
  
  await ctx.db.patch(session._id, {
    sessionEnd: Date.now(),
  });
}

/**
 * Get comprehensive transaction history for a player.
 */
export async function getPlayerTransactionHistory(
  ctx: QueryCtx,
  playerId: Id<"pokerPlayers">,
  limit: number = 100
) {
  return await ctx.db
    .query("pokerTransactions")
    .withIndex("by_player_timestamp", (q) => q.eq("playerId", playerId))
    .order("desc")
    .take(limit);
}

/**
 * Get all transactions for a specific hand.
 */
export async function getHandTransactions(
  ctx: QueryCtx,
  tableId: Id<"pokerTables">,
  handNumber: number
) {
  return await ctx.db
    .query("pokerTransactions")
    .withIndex("by_hand", (q) => q.eq("tableId", tableId).eq("handNumber", handNumber))
    .order("asc")
    .collect();
}

/**
 * Get aggregate statistics across all poker games.
 */
export async function getEventWideStats(ctx: QueryCtx) {
  const allTransactions = await ctx.db.query("pokerTransactions").collect();
  const allSessions = await ctx.db.query("pokerSessionStats").collect();
  
  // Calculate totals
  const totalWagered = allTransactions
    .filter(t => t.chipsChange < 0 && !t.isBot)
    .reduce((sum, t) => sum + Math.abs(t.chipsChange), 0);
  
  const totalWon = allTransactions
    .filter(t => t.eventType === "win" && !t.isBot)
    .reduce((sum, t) => sum + t.chipsChange, 0);
  
  const uniqueHands = new Set(
    allTransactions.map(t => `${t.tableId}-${t.handNumber}`)
  ).size;
  
  const humanSessions = allSessions.filter(s => !s.playerName.startsWith("Bot"));
  
  return {
    totalHands: uniqueHands,
    totalWagered,
    totalWon,
    uniquePlayers: new Set(allTransactions.filter(t => !t.isBot).map(t => t.playerId)).size,
    totalSessions: humanSessions.length,
    activeSessions: humanSessions.filter(s => !s.sessionEnd).length,
    averageHandsPerPlayer: humanSessions.length > 0 
      ? humanSessions.reduce((sum, s) => sum + s.handsPlayed, 0) / humanSessions.length
      : 0,
    biggestPot: Math.max(...humanSessions.map(s => s.biggestPot), 0),
  };
}

/**
 * Verify balance integrity by reconstructing from transaction history.
 * Returns true if the recorded balance matches the calculated balance.
 */
export async function verifyPlayerBalance(
  ctx: QueryCtx,
  playerId: Id<"pokerPlayers">
): Promise<{ valid: boolean; expected: number; actual: number }> {
  const player = await ctx.db.get(playerId);
  if (!player) {
    return { valid: false, expected: 0, actual: 0 };
  }
  
  const session = await ctx.db
    .query("pokerSessionStats")
    .withIndex("by_player", (q) => q.eq("playerId", playerId))
    .order("desc")
    .first();
  
  if (!session) {
    // No session means starting balance
    return { valid: true, expected: player.points, actual: player.points };
  }
  
  // Calculate expected balance from transactions
  const transactions = await ctx.db
    .query("pokerTransactions")
    .withIndex("by_player", (q) => q.eq("playerId", playerId))
    .collect();
  
  const netChange = transactions.reduce((sum, t) => sum + t.chipsChange, 0);
  const expected = session.startingPoints + netChange;
  
  return {
    valid: Math.abs(expected - player.points) < 0.01, // Allow for floating point errors
    expected,
    actual: player.points,
  };
}
