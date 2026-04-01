import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function buildOperatorId(email: string) {
  return `OP-${email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}`;
}

function inferCountry(email: string) {
  if (email.endsWith(".ng")) return "NG";
  if (email.endsWith(".za")) return "ZA";
  if (email.endsWith(".ke")) return "KE";
  return "US";
}

function isAdminEmail(email: string) {
  return email.toLowerCase().endsWith("@okeymeta.com.ng");
}

export const ensureUser = mutation({
  args: { email: v.string(), displayName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", args.email))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return existing;
    }

    const createdId = await ctx.db.insert("users", {
      email: args.email,
      displayName: args.displayName ?? args.email.split("@")[0],
      operatorId: buildOperatorId(args.email),
      tier: "Probation",
      isAdmin: isAdminEmail(args.email),
      countryCode: inferCountry(args.email),
      balanceCents: 0,
      projectedPayoutCents: 0,
      termsAcceptedAt: undefined,
      resourceConsentAt: undefined,
      totalReviewed: 0,
      approvedCount: 0,
      rejectedCount: 0,
      accuracyIndex: 100,
      trackedWorkStreamGb: 0,
      trackedBandwidthGb: 0,
      projectedRevenueCents: 0,
      lastSeenAt: Date.now(),
    });

    return await ctx.db.get(createdId);
  },
});

export const current = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", args.email))
      .unique();
  },
});

export const grantResourceConsent = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", args.email))
      .unique();

    if (!user) {
      throw new Error("User not found.");
    }

    await ctx.db.patch(user._id, {
      resourceConsentAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  },
});

export const acceptTerms = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", args.email))
      .unique();

    if (!user) {
      throw new Error("User not found.");
    }

    await ctx.db.patch(user._id, {
      termsAcceptedAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  },
});
