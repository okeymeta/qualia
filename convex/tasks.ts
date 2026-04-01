import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";

async function findUser(ctx: any, email: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (query: any) => query.eq("email", email))
    .unique();

  if (!user) {
    throw new Error("User not found.");
  }

  return user;
}

export const reviewQueue = query({
  args: { email: v.string(), countryCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await findUser(ctx, args.email);
    if (user.isAdmin) {
      const pending = await ctx.db
        .query("tasks")
        .withIndex("by_status", (query) => query.eq("status", "pending"))
        .take(64);
      return pending.filter((task) => !args.countryCode || task.region === args.countryCode);
    }

    const assigned = await ctx.db
      .query("tasks")
      .withIndex("by_assigned_user", (query) =>
        query.eq("assignedUserId", user._id).eq("status", "pending"),
      )
      .take(24);
    return assigned.filter((task) => !args.countryCode || task.region === args.countryCode);
  },
});

export const approveTask = mutation({
  args: { taskId: v.id("tasks"), reviewerEmail: v.string() },
  handler: async (ctx, args) => {
    const user = await findUser(ctx, args.reviewerEmail);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    const now = Date.now();
    await ctx.db.patch(task._id, {
      status: "approved",
      reviewedBy: user._id,
      reviewedAt: now,
    });

    await ctx.db.patch(user._id, {
      balanceCents: user.balanceCents + task.payoutCents,
      projectedPayoutCents: user.projectedPayoutCents + task.payoutCents,
      totalReviewed: user.totalReviewed + 1,
      approvedCount: user.approvedCount + 1,
      accuracyIndex: Math.min(100, Number((user.accuracyIndex + 0.08).toFixed(2))),
      projectedRevenueCents: user.projectedRevenueCents + Math.round(task.payoutCents * 0.42),
      lastSeenAt: now,
    });

    await ctx.db.insert("balanceEvents", {
      userId: user._id,
      taskId: task._id,
      deltaCents: task.payoutCents,
      reason: "task_approved",
      createdAt: now,
    });
  },
});

export const rejectTask = mutation({
  args: { taskId: v.id("tasks"), reviewerEmail: v.string() },
  handler: async (ctx, args) => {
    const user = await findUser(ctx, args.reviewerEmail);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    const now = Date.now();
    await ctx.db.patch(task._id, {
      status: "rejected",
      reviewedBy: user._id,
      reviewedAt: now,
    });

    await ctx.db.patch(user._id, {
      totalReviewed: user.totalReviewed + 1,
      rejectedCount: user.rejectedCount + 1,
      accuracyIndex: Math.max(92, Number((user.accuracyIndex - 0.16).toFixed(2))),
      lastSeenAt: now,
    });
  },
});

export const seedTaskBatch = mutation({
  args: { email: v.string(), countryCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await findUser(ctx, args.email);
    if (!user.isAdmin) {
      throw new Error("Only admins can seed new task batches.");
    }
    const now = Date.now();
    const countryCode = args.countryCode ?? user.countryCode;

    const tasks = [
      {
        title: "Invoice Entity Resolution",
        summary: "Verify whether issuer and beneficiary belong to the same business family.",
        batchCode: "BATCH_771",
        region: countryCode,
        sourceModel: "groq/default",
        status: "pending" as const,
        payoutCents: 245,
        confidence: 0.91,
        signals: ["ENTITY_MATCH SCORE 0.991", "TAX ID FORMATTED", "LEDGER TRACE CLEARED"],
      },
      {
        title: "Address Record Verification",
        summary: "Review mismatched postal segments against structured export.",
        batchCode: "BATCH_772",
        region: countryCode,
        sourceModel: "groq/default",
        status: "pending" as const,
        payoutCents: 210,
        confidence: 0.88,
        signals: ["ADDRESS VECTOR PASSED", "GEOHASH LOCKED", "ZIP DRIFT FLAGGED"],
      },
    ];

    for (const task of tasks) {
      await ctx.db.insert("tasks", {
        ...task,
        assignedUserId: undefined,
        reviewedBy: undefined,
        createdAt: now,
        reviewedAt: undefined,
      });
    }

    return { created: tasks.length };
  },
});

export const generateTaskBatch = action({
  args: { email: v.string(), count: v.optional(v.number()), countryCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(api.users.current, { email: args.email });
    if (!user?.isAdmin) {
      throw new Error("Only admins can generate task batches.");
    }

    const countryCode = args.countryCode ?? user.countryCode;
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You generate concise, professional human-verification tasks for data analysts. Return JSON with a tasks array.",
          },
          {
            role: "user",
            content: `Create ${args.count ?? 3} review tasks for an analyst in ${countryCode}. Include title, summary, region, payoutCents, confidence, and three signals.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq request failed with ${response.status}.`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content ?? "{}");
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

    for (const [index, task] of tasks.entries()) {
      await ctx.runMutation(api.tasks.ingestGeneratedTask, {
        email: args.email,
        index,
        assignToAdmin: false,
        task,
      });
    }

    return { created: tasks.length };
  },
});

export const ingestGeneratedTask = mutation({
  args: {
    email: v.string(),
    index: v.number(),
    assignToAdmin: v.optional(v.boolean()),
    task: v.object({
      title: v.string(),
      summary: v.string(),
      region: v.string(),
      payoutCents: v.number(),
      confidence: v.number(),
      signals: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await findUser(ctx, args.email);
    await ctx.db.insert("tasks", {
      title: args.task.title,
      summary: args.task.summary,
      batchCode: `BATCH_${String(800 + args.index).padStart(3, "0")}`,
      region: args.task.region,
      sourceModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      status: "pending",
      payoutCents: args.task.payoutCents,
      confidence: args.task.confidence,
      signals: args.task.signals,
      assignedUserId: args.assignToAdmin ? user._id : undefined,
      reviewedBy: undefined,
      createdAt: Date.now(),
      reviewedAt: undefined,
    });
  },
});

export const runCountryAiReview = action({
  args: { email: v.string(), countryCode: v.string() },
  handler: async (ctx, args) => {
    const requester = await ctx.runQuery(api.users.current, { email: args.email });
    if (!requester?.isAdmin) {
      throw new Error("Only admins can run AI reviews.");
    }

    const policy = await ctx.runQuery(api.admin.countryPolicy, { email: args.email, countryCode: args.countryCode });
    const model = policy?.reviewerModel ?? process.env.GROQ_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";
    const pending = await ctx.runQuery(api.tasks.reviewQueue, {
      email: args.email,
      countryCode: args.countryCode,
    });

    if (pending.length === 0) {
      return { reviewed: 0, approved: 0, rejected: 0 };
    }

    const runId = await ctx.runMutation(api.admin.logAiReviewRunStart, {
      email: args.email,
      countryCode: args.countryCode,
      reviewerModel: model,
      triggeredBy: "admin",
    });

    const compactTasks = pending.slice(0, 20).map((task) => ({
      id: task._id,
      title: task.title,
      summary: task.summary,
      region: task.region,
      confidence: task.confidence,
      signals: task.signals,
    }));

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a strict operations QA reviewer. Return JSON with decisions: [{id, decision, note}]. Decision must be approved or rejected.",
          },
          {
            role: "user",
            content: JSON.stringify({
              countryCode: args.countryCode,
              threshold: policy?.autoApproveThreshold ?? 0.9,
              tasks: compactTasks,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      await ctx.runMutation(api.admin.logAiReviewRunFinish, {
        runId,
        status: "failed",
        reviewedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        notes: `Groq request failed with ${response.status}.`,
      });
      throw new Error(`Groq request failed with ${response.status}.`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content ?? "{}");
    const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];

    let approved = 0;
    let rejected = 0;

    for (const decision of decisions) {
      const taskId = decision.id as string;
      if (decision.decision === "approved") {
        approved += 1;
        await ctx.runMutation(api.tasks.approveTask, {
          taskId: taskId as never,
          reviewerEmail: args.email,
        });
      } else {
        rejected += 1;
        await ctx.runMutation(api.tasks.rejectTask, {
          taskId: taskId as never,
          reviewerEmail: args.email,
        });
      }
    }

    await ctx.runMutation(api.admin.logAiReviewRunFinish, {
      runId,
      status: "completed",
      reviewedCount: decisions.length,
      approvedCount: approved,
      rejectedCount: rejected,
      notes: `Country close review executed for ${args.countryCode}.`,
    });

    return { reviewed: decisions.length, approved, rejected };
  },
});
