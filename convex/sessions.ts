import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function getUserByEmail(ctx: any, email: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (query: any) => query.eq("email", email))
    .unique();

  if (!user) {
    throw new Error("User not found.");
  }

  return user;
}

export const startShift = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByEmail(ctx, args.email);
    const now = Date.now();

    const activeSessions = await ctx.db
      .query("sessions")
      .withIndex("by_status", (query) => query.eq("status", "active"))
      .collect();

    const existing = activeSessions.find((session: any) => session.userId === user._id);
    if (existing) {
      return { sessionId: existing._id, operatorId: user.operatorId };
    }

    const sessionId = await ctx.db.insert("sessions", {
      userId: user._id,
      startedAt: now,
      endedAt: undefined,
      status: "active",
      activeSeconds: 0,
      trackedWorkStreamGb: 0,
      trackedBandwidthGb: 0,
      utilizationPercent: 0,
      countryCode: user.countryCode,
    });

    await ctx.db.patch(user._id, { lastSeenAt: now });

    return { sessionId, operatorId: user.operatorId };
  },
});

export const stopShift = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByEmail(ctx, args.email);
    const activeSessions = await ctx.db
      .query("sessions")
      .withIndex("by_status", (query) => query.eq("status", "active"))
      .collect();

    const session = activeSessions.find((entry: any) => entry.userId === user._id);
    if (!session) return null;

    const endedAt = Date.now();
    const activeSeconds = Math.max(0, Math.round((endedAt - session.startedAt) / 1000));

    await ctx.db.patch(session._id, {
      endedAt,
      activeSeconds,
      status: "completed",
    });

    return { sessionId: session._id, activeSeconds };
  },
});

export const auditFeed = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByEmail(ctx, args.email);
    const recentTasks = await ctx.db.query("tasks").order("desc").take(4);

    return recentTasks
      .map((task) => {
        const stamp = new Date(task.createdAt).toISOString().slice(11, 16);
        const verb = task.status === "pending" ? "SYNCED" : task.status.toUpperCase();
        return `[${stamp}] ${task.batchCode} ${verb}`;
      })
      .concat([`[LIVE] ${user.operatorId} NODE LINKED`]);
  },
});
