/**
 * Poker audit and reporting queries for admins. Every query needs an
 * administrator session (`requireAdminRole`): players are real hackers now.
 * 
 * Provides read-only access to gambling logs, transaction history,
 * and analytics for compliance and event management.
 */
import { v, type GenericId } from "convex/values";
import { query } from "../_generated/server";
import { requireAdminRole, sessionTokenArgs } from "../admin/staffAuth";
import {
  getPlayerTransactionHistory,
  getHandTransactions,
  getEventWideStats,
  verifyPlayerBalance,
} from "./pokerLogging";

/**
 * Get comprehensive transaction history for a specific player.
 * Admin only - for audit and dispute resolution.
 */
export const getPlayerHistory = query({
  args: { ...sessionTokenArgs,
    playerId: v.id("pokerPlayers"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { sessionToken, playerId, limit }) => {
    await requireAdminRole(ctx, sessionToken);
    const transactions = await getPlayerTransactionHistory(ctx, playerId, limit ?? 100);
    const player = await ctx.db.get(playerId);
    const session = await ctx.db
      .query("pokerSessionStats")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .order("desc")
      .first();
    
    return {
      player: player ? {
        id: player._id,
        name: player.displayName,
        currentPoints: player.points,
        lastResult: player.lastResult,
      } : null,
      session,
      transactions,
    };
  },
});

/**
 * Get all transactions for a specific poker hand.
 * Useful for reconstructing exactly what happened in a hand.
 */
export const getHandHistory = query({
  args: { ...sessionTokenArgs,
    tableId: v.id("pokerTables"),
    handNumber: v.number(),
  },
  handler: async (ctx, { sessionToken, tableId, handNumber }) => {
    await requireAdminRole(ctx, sessionToken);
    const transactions = await getHandTransactions(ctx, tableId, handNumber);
    const table = await ctx.db.get(tableId);
    
    return {
      table: table ? {
        id: table._id,
        status: table.status,
        handNumber: table.handNumber,
        log: table.log,
        winners: table.winners,
        endedReason: table.endedReason,
      } : null,
      transactions,
    };
  },
});

/**
 * Get event-wide poker statistics.
 * Dashboard view for admins to monitor the poker system.
 */
export const getPokerEventStats = query({
  args: { ...sessionTokenArgs,},
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    const stats = await getEventWideStats(ctx);
    
    // Additional live stats
    const activeTables = await ctx.db
      .query("pokerTables")
      .withIndex("by_status", (q) => q.eq("status", "playing"))
      .collect();
    
    const queueLength = (await ctx.db.query("pokerQueue").collect()).length;
    
    const allSessions = await ctx.db.query("pokerSessionStats").collect();
    const humanSessions = allSessions.filter(s => !s.playerName.startsWith("Bot"));
    
    // Top players by profit
    const topWinners = humanSessions
      .sort((a, b) => b.netProfit - a.netProfit)
      .slice(0, 10)
      .map(s => ({
        name: s.playerName,
        netProfit: s.netProfit,
        handsPlayed: s.handsPlayed,
        handsWon: s.handsWon,
      }));
    
    // Top losers
    const topLosers = humanSessions
      .sort((a, b) => a.netProfit - b.netProfit)
      .slice(0, 10)
      .map(s => ({
        name: s.playerName,
        netProfit: s.netProfit,
        handsPlayed: s.handsPlayed,
      }));
    
    return {
      ...stats,
      activeTables: activeTables.length,
      queueLength,
      topWinners,
      topLosers,
    };
  },
});

/**
 * Get all active poker sessions.
 * Shows who's currently playing.
 */
export const getActiveSessions = query({
  args: { ...sessionTokenArgs,},
  handler: async (ctx, { sessionToken }) => {
    await requireAdminRole(ctx, sessionToken);
    const sessions = await ctx.db
      .query("pokerSessionStats")
      .withIndex("by_last_activity")
      .order("desc")
      .collect();
    
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const activeSessions = sessions.filter(
      s => !s.sessionEnd && s.lastActivity > fiveMinutesAgo
    );
    
    return activeSessions.map(s => ({
      playerId: s.playerId,
      playerName: s.playerName,
      sessionStart: s.sessionStart,
      lastActivity: s.lastActivity,
      handsPlayed: s.handsPlayed,
      netProfit: s.netProfit,
      currentPoints: s.currentPoints,
    }));
  },
});

/**
 * Verify integrity of a player's balance.
 * Checks if recorded balance matches sum of all transactions.
 */
export const verifyBalance = query({
  args: { ...sessionTokenArgs,
    playerId: v.id("pokerPlayers"),
  },
  handler: async (ctx, { sessionToken, playerId }) => {
    await requireAdminRole(ctx, sessionToken);
    return await verifyPlayerBalance(ctx, playerId);
  },
});

/**
 * Get recent transactions across all players.
 * Live feed of all poker activity.
 */
export const getRecentTransactions = query({
  args: { ...sessionTokenArgs,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { sessionToken, limit }) => {
    await requireAdminRole(ctx, sessionToken);
    return await ctx.db
      .query("pokerTransactions")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit ?? 50);
  },
});

/**
 * Get detailed stats for a specific table.
 */
export const getTableStats = query({
  args: { ...sessionTokenArgs,
    tableId: v.id("pokerTables"),
  },
  handler: async (ctx, { sessionToken, tableId }) => {
    await requireAdminRole(ctx, sessionToken);
    const table = await ctx.db.get(tableId);
    if (!table) return null;
    
    const seats = await ctx.db
      .query("pokerSeats")
      .withIndex("by_table", (q) => q.eq("tableId", tableId))
      .collect();
    
    const transactions = await ctx.db
      .query("pokerTransactions")
      .withIndex("by_table", (q) => q.eq("tableId", tableId))
      .collect();
    
    // Calculate table statistics
    const totalPots = transactions
      .filter(t => t.eventType === "win")
      .reduce((sum, t) => sum + t.potSize, 0);
    
    const averagePot = transactions.filter(t => t.eventType === "win").length > 0
      ? totalPots / transactions.filter(t => t.eventType === "win").length
      : 0;
    
    const humanPlayers = new Set(
      transactions.filter(t => !t.isBot).map(t => t.playerId)
    ).size;
    
    return {
      table: {
        id: table._id,
        status: table.status,
        handNumber: table.handNumber,
        pot: table.pot,
        street: table.street,
        createdAt: table.createdAt,
        endedReason: table.endedReason,
      },
      seats: seats.map(s => ({
        name: s.name,
        chips: s.chips,
        isBot: s.isBot,
        sittingOut: s.sittingOut,
      })),
      stats: {
        handsPlayed: table.handNumber,
        totalTransactions: transactions.length,
        totalPots,
        averagePot,
        humanPlayers,
        botPlayers: seats.filter(s => s.isBot).length,
      },
    };
  },
});

/**
 * Search for suspicious activity or anomalies.
 * Flags things like rapid wins, unusual betting patterns, etc.
 */
export const detectAnomalies = query({
  args: { ...sessionTokenArgs,
    thresholdHours: v.optional(v.number()),
  },
  handler: async (ctx, { sessionToken, thresholdHours }) => {
    await requireAdminRole(ctx, sessionToken);
    const hours = thresholdHours ?? 24;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    
    const recentTransactions = await ctx.db
      .query("pokerTransactions")
      .withIndex("by_timestamp")
      .order("desc")
      .filter((q) => q.gt(q.field("timestamp"), cutoff))
      .collect();
    
    const recentSessions = await ctx.db
      .query("pokerSessionStats")
      .withIndex("by_last_activity")
      .order("desc")
      .filter((q) => q.gt(q.field("lastActivity"), cutoff))
      .collect();
    
    const anomalies: Array<{
      type: string;
      severity: "low" | "medium" | "high";
      playerId: string;
      playerName: string;
      details: string;
    }> = [];
    
    // Check for extreme win rates
    for (const session of recentSessions) {
      if (session.handsPlayed < 10) continue; // Need meaningful sample size
      
      const winRate = session.handsWon / session.handsPlayed;
      if (winRate > 0.7 && session.handsPlayed > 20) {
        anomalies.push({
          type: "high_win_rate",
          severity: "medium",
          playerId: session.playerId,
          playerName: session.playerName,
          details: `Win rate: ${(winRate * 100).toFixed(1)}% over ${session.handsPlayed} hands`,
        });
      }
      
      // Check for extreme profits
      if (session.netProfit > 500 && session.handsPlayed > 10) {
        anomalies.push({
          type: "high_profit",
          severity: "low",
          playerId: session.playerId,
          playerName: session.playerName,
          details: `Net profit: ${session.netProfit} over ${session.handsPlayed} hands`,
        });
      }
      
      // Check for extreme losses
      if (session.netProfit < -300 && session.handsPlayed > 10) {
        anomalies.push({
          type: "high_loss",
          severity: "low",
          playerId: session.playerId,
          playerName: session.playerName,
          details: `Net loss: ${session.netProfit} over ${session.handsPlayed} hands`,
        });
      }
    }
    
    // Check for rapid transaction volumes
    const transactionsByPlayer = new Map<string, number>();
    for (const tx of recentTransactions) {
      if (tx.isBot) continue;
      transactionsByPlayer.set(
        tx.playerId,
        (transactionsByPlayer.get(tx.playerId) ?? 0) + 1
      );
    }
    
    for (const [playerId, count] of transactionsByPlayer.entries()) {
      if (count > 200) {
        const playerDoc = await ctx.db.get(playerId as GenericId<"pokerPlayers">);
        const playerName = playerDoc?.displayName ?? "Unknown";
        anomalies.push({
          type: "high_transaction_volume",
          severity: "low",
          playerId,
          playerName,
          details: `${count} transactions in last ${hours} hours`,
        });
      }
    }
    
    return {
      timeWindow: `Last ${hours} hours`,
      anomaliesFound: anomalies.length,
      anomalies,
    };
  },
});

/**
 * Export transaction data for external analysis.
 * Returns all transactions in a format suitable for CSV export.
 */
export const exportTransactionData = query({
  args: { ...sessionTokenArgs,
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, { sessionToken, startTime, endTime }) => {
    await requireAdminRole(ctx, sessionToken);
    let query = ctx.db
      .query("pokerTransactions")
      .withIndex("by_timestamp")
      .order("desc");
    
    if (startTime) {
      query = query.filter((q) => q.gte(q.field("timestamp"), startTime));
    }
    if (endTime) {
      query = query.filter((q) => q.lte(q.field("timestamp"), endTime));
    }
    
    const transactions = await query.collect();
    
    return transactions.map(t => ({
      timestamp: new Date(t.timestamp).toISOString(),
      playerId: t.playerId,
      playerName: t.playerName,
      isBot: t.isBot,
      tableId: t.tableId,
      handNumber: t.handNumber,
      eventType: t.eventType,
      chipsBefore: t.chipsBefore,
      chipsChange: t.chipsChange,
      chipsAfter: t.chipsAfter,
      street: t.street,
      potSize: t.potSize,
      reason: t.reason ?? "",
      winningHand: t.winningHand?.label ?? "",
    }));
  },
});
