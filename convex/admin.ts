import { query } from "./_generated/server";
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const overview = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    if (!args.email.toLowerCase().endsWith("@okeymeta.com.ng")) {
      return null;
    }

    const users = await ctx.db.query("users").collect();
    const sessions = await ctx.db.query("sessions").collect();

    const byCountry = new Map<
      string,
      { users: number; projectedRevenueCents: number; trackedBandwidthGb: number }
    >();

    for (const user of users) {
      const entry = byCountry.get(user.countryCode) ?? {
        users: 0,
        projectedRevenueCents: 0,
        trackedBandwidthGb: 0,
      };
      entry.users += 1;
      entry.projectedRevenueCents += user.projectedRevenueCents;
      entry.trackedBandwidthGb += user.trackedBandwidthGb;
      byCountry.set(user.countryCode, entry);
    }

    const projectedRevenueCents = users.reduce((sum, user) => sum + user.projectedRevenueCents, 0);
    const nextPayoutBudgetCents = Math.round(
      users.reduce((sum, user) => sum + user.projectedPayoutCents, 0) * 0.7,
    );

    return {
      userCount: users.length,
      activeSessionCount: sessions.filter((session) => session.status === "active").length,
      projectedRevenueCents,
      nextPayoutBudgetCents,
      topCountries: [...byCountry.entries()]
        .map(([countryCode, metrics]) => ({ countryCode, ...metrics }))
        .sort((left, right) => right.projectedRevenueCents - left.projectedRevenueCents)
        .slice(0, 5),
    };
  },
});

export const countryPolicy = query({
  args: { email: v.string(), countryCode: v.string() },
  handler: async (ctx, args) => {
    if (!args.email.toLowerCase().endsWith("@okeymeta.com.ng")) {
      return null;
    }

    return await ctx.db
      .query("countryReviewPolicies")
      .withIndex("by_country", (query) => query.eq("countryCode", args.countryCode))
      .unique();
  },
});

export const upsertCountryPolicy = mutation({
  args: {
    email: v.string(),
    countryCode: v.string(),
    enabled: v.boolean(),
    reviewHourUTC: v.number(),
    reviewMinuteUTC: v.number(),
    autoApproveThreshold: v.number(),
    reviewerModel: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.email.toLowerCase().endsWith("@okeymeta.com.ng")) {
      throw new Error("Admin access required.");
    }

    const existing = await ctx.db
      .query("countryReviewPolicies")
      .withIndex("by_country", (query) => query.eq("countryCode", args.countryCode))
      .unique();

    const payload = {
      countryCode: args.countryCode,
      enabled: args.enabled,
      reviewHourUTC: args.reviewHourUTC,
      reviewMinuteUTC: args.reviewMinuteUTC,
      autoApproveThreshold: args.autoApproveThreshold,
      reviewerModel: args.reviewerModel,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("countryReviewPolicies", payload);
  },
});

export const logAiReviewRunStart = mutation({
  args: {
    email: v.string(),
    countryCode: v.string(),
    reviewerModel: v.string(),
    triggeredBy: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.email.toLowerCase().endsWith("@okeymeta.com.ng")) {
      throw new Error("Admin access required.");
    }

    return await ctx.db.insert("aiReviewRuns", {
      countryCode: args.countryCode,
      startedAt: Date.now(),
      completedAt: undefined,
      reviewedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      status: "running",
      reviewerModel: args.reviewerModel,
      triggeredBy: args.triggeredBy,
      notes: undefined,
    });
  },
});

export const logAiReviewRunFinish = mutation({
  args: {
    runId: v.id("aiReviewRuns"),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    reviewedCount: v.number(),
    approvedCount: v.number(),
    rejectedCount: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      completedAt: Date.now(),
      status: args.status,
      reviewedCount: args.reviewedCount,
      approvedCount: args.approvedCount,
      rejectedCount: args.rejectedCount,
      notes: args.notes,
    });
  },
});

export const latestAiReviewRuns = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    if (!args.email.toLowerCase().endsWith("@okeymeta.com.ng")) {
      return [];
    }

    return await ctx.db.query("aiReviewRuns").order("desc").take(8);
  },
});

export const allCountryPolicies = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("countryReviewPolicies").collect();
  },
});
