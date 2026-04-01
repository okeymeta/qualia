import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    displayName: v.string(),
    fullName: v.string(),
    phone: v.optional(v.string()),
    countryName: v.optional(v.string()),
    city: v.optional(v.string()),
    operatorId: v.string(),
    tier: v.union(v.literal("Probation"), v.literal("Analyst"), v.literal("Senior")),
    isAdmin: v.boolean(),
    countryCode: v.string(),
    paySchedule: v.literal("monthly"),
    monthlyPayCents: v.number(),
    nextPayrollAt: v.optional(v.number()),
    employmentStatus: v.union(
      v.literal("applicant"),
      v.literal("under_review"),
      v.literal("active"),
      v.literal("banned"),
      v.literal("rejected"),
    ),
    onboardingCompleted: v.boolean(),
    applicationSubmittedAt: v.optional(v.number()),
    qualificationScore: v.number(),
    aiDecision: v.optional(v.union(v.literal("pass"), v.literal("fail"))),
    aiDecisionReason: v.optional(v.string()),
    latestAppealStatus: v.optional(
      v.union(v.literal("pending"), v.literal("accepted"), v.literal("rejected")),
    ),
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
    fraudRiskScore: v.number(),
    fraudFlags: v.array(v.string()),
    deviceFingerprint: v.optional(v.string()),
    lastIpRegion: v.optional(v.string()),
    proxyDetected: v.boolean(),
    vpnDetected: v.boolean(),
    integrityStrikeCount: v.number(),
    banReason: v.optional(v.string()),
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

  applications: defineTable({
    userId: v.id("users"),
    fullName: v.string(),
    email: v.string(),
    phone: v.string(),
    countryCode: v.string(),
    countryName: v.string(),
    city: v.string(),
    workType: v.string(),
    experienceSummary: v.string(),
    portfolioLink: v.optional(v.string()),
    testAnswers: v.array(v.object({ prompt: v.string(), answer: v.string() })),
    qualificationScore: v.number(),
    aiDecision: v.union(v.literal("pass"), v.literal("fail")),
    aiReason: v.string(),
    fraudRiskScore: v.number(),
    fraudFlags: v.array(v.string()),
    documentCount: v.number(),
    status: v.union(
      v.literal("submitted"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("banned"),
    ),
    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"]),

  appeals: defineTable({
    userId: v.id("users"),
    message: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("rejected")),
    submittedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolutionNote: v.optional(v.string()),
  }).index("by_user", ["userId", "submittedAt"]),

  applicationDocuments: defineTable({
    userId: v.id("users"),
    applicationId: v.optional(v.id("applications")),
    kind: v.union(
      v.literal("government_id"),
      v.literal("proof_of_address"),
      v.literal("resume"),
      v.literal("certificate"),
    ),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    uploadedAt: v.number(),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
  })
    .index("by_user", ["userId", "uploadedAt"])
    .index("by_application", ["applicationId", "uploadedAt"]),
});
