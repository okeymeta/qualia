import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    displayName: v.string(),
    operatorId: v.string(),
    tier: v.union(v.literal("Probation"), v.literal("Analyst"), v.literal("Senior")),
    isAdmin: v.boolean(),
    countryCode: v.string(),
    balanceCents: v.number(),
    projectedPayoutCents: v.number(),
    termsAcceptedAt: v.optional(v.number()),
    resourceConsentAt: v.optional(v.number()),
    totalReviewed: v.number(),
    approvedCount: v.number(),
    rejectedCount: v.number(),
    accuracyIndex: v.number(),
    trackedWorkStreamGb: v.number(),
    trackedBandwidthGb: v.number(),
    projectedRevenueCents: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_country", ["countryCode"])
    .index("by_admin", ["isAdmin"]),

  sessions: defineTable({
    userId: v.id("users"),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("completed")),
    activeSeconds: v.number(),
    trackedWorkStreamGb: v.number(),
    trackedBandwidthGb: v.number(),
    utilizationPercent: v.number(),
    countryCode: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"]),

  tasks: defineTable({
    title: v.string(),
    summary: v.string(),
    batchCode: v.string(),
    region: v.string(),
    sourceModel: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    payoutCents: v.number(),
    confidence: v.number(),
    signals: v.array(v.string()),
    assignedUserId: v.optional(v.id("users")),
    reviewedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_batch", ["batchCode"])
    .index("by_assigned_user", ["assignedUserId", "status"]),

  balanceEvents: defineTable({
    userId: v.id("users"),
    taskId: v.optional(v.id("tasks")),
    deltaCents: v.number(),
    reason: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId", "createdAt"]),

  countryReviewPolicies: defineTable({
    countryCode: v.string(),
    enabled: v.boolean(),
    reviewHourUTC: v.number(),
    reviewMinuteUTC: v.number(),
    autoApproveThreshold: v.number(),
    reviewerModel: v.string(),
    updatedAt: v.number(),
  }).index("by_country", ["countryCode"]),

  aiReviewRuns: defineTable({
    countryCode: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    reviewedCount: v.number(),
    approvedCount: v.number(),
    rejectedCount: v.number(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    reviewerModel: v.string(),
    triggeredBy: v.string(),
    notes: v.optional(v.string()),
  }).index("by_country", ["countryCode", "startedAt"]),
});
