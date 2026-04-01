import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

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
      fullName: args.displayName ?? args.email.split("@")[0],
      phone: undefined,
      countryName: undefined,
      city: undefined,
      operatorId: buildOperatorId(args.email),
      tier: "Probation",
      isAdmin: isAdminEmail(args.email),
      countryCode: inferCountry(args.email),
      paySchedule: "monthly",
      monthlyPayCents: isAdminEmail(args.email) ? 0 : 85000,
      nextPayrollAt: undefined,
      employmentStatus: isAdminEmail(args.email) ? "active" : "applicant",
      onboardingCompleted: isAdminEmail(args.email),
      applicationSubmittedAt: undefined,
      qualificationScore: 0,
      aiDecision: undefined,
      aiDecisionReason: undefined,
      latestAppealStatus: undefined,
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
      fraudRiskScore: 0,
      fraudFlags: [],
      deviceFingerprint: undefined,
      lastIpRegion: undefined,
      proxyDetected: false,
      vpnDetected: false,
      integrityStrikeCount: 0,
      banReason: undefined,
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

export const submitApplication = mutation({
  args: {
    email: v.string(),
    fullName: v.string(),
    phone: v.string(),
    countryCode: v.string(),
    countryName: v.string(),
    city: v.string(),
    workType: v.string(),
    experienceSummary: v.string(),
    portfolioLink: v.optional(v.string()),
    qualificationScore: v.number(),
    aiDecision: v.union(v.literal("pass"), v.literal("fail")),
    aiReason: v.string(),
    fraudRiskScore: v.number(),
    fraudFlags: v.array(v.string()),
    deviceFingerprint: v.optional(v.string()),
    lastIpRegion: v.optional(v.string()),
    proxyDetected: v.boolean(),
    vpnDetected: v.boolean(),
    testAnswers: v.array(v.object({ prompt: v.string(), answer: v.string() })),
    documentCount: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", args.email))
      .unique();

    if (!user) {
      throw new Error("User not found.");
    }

    const now = Date.now();
    const employmentStatus = args.aiDecision === "pass" && args.fraudRiskScore < 60 ? "active" : "under_review";

    await ctx.db.patch(user._id, {
      fullName: args.fullName,
      displayName: args.fullName,
      phone: args.phone,
      countryCode: args.countryCode,
      countryName: args.countryName,
      city: args.city,
      onboardingCompleted: true,
      applicationSubmittedAt: now,
      qualificationScore: args.qualificationScore,
      aiDecision: args.aiDecision,
      aiDecisionReason: args.aiReason,
      employmentStatus,
      fraudRiskScore: args.fraudRiskScore,
      fraudFlags: args.fraudFlags,
      deviceFingerprint: args.deviceFingerprint,
      lastIpRegion: args.lastIpRegion,
      proxyDetected: args.proxyDetected,
      vpnDetected: args.vpnDetected,
      lastSeenAt: now,
    });

    await ctx.db.insert("applications", {
      userId: user._id,
      fullName: args.fullName,
      email: args.email,
      phone: args.phone,
      countryCode: args.countryCode,
      countryName: args.countryName,
      city: args.city,
      workType: args.workType,
      experienceSummary: args.experienceSummary,
      portfolioLink: args.portfolioLink,
      testAnswers: args.testAnswers,
      qualificationScore: args.qualificationScore,
      aiDecision: args.aiDecision,
      aiReason: args.aiReason,
      fraudRiskScore: args.fraudRiskScore,
      fraudFlags: args.fraudFlags,
      documentCount: args.documentCount,
      status: employmentStatus === "active" ? "approved" : "submitted",
      createdAt: now,
      reviewedAt: employmentStatus === "active" ? now : undefined,
    });

    return { employmentStatus, qualificationScore: args.qualificationScore };
  },
});

export const submitAppeal = mutation({
  args: { email: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (query) => query.eq("email", args.email))
      .unique();
    if (!user) throw new Error("User not found.");

    await ctx.db.insert("appeals", {
      userId: user._id,
      message: args.message,
      status: "pending",
      submittedAt: Date.now(),
      resolvedAt: undefined,
      resolutionNote: undefined,
    });

    await ctx.db.patch(user._id, {
      latestAppealStatus: "pending",
      lastSeenAt: Date.now(),
    });
  },
});

export const banUser = mutation({
  args: { adminEmail: v.string(), userId: v.id("users"), reason: v.string() },
  handler: async (ctx, args) => {
    if (!isAdminEmail(args.adminEmail)) {
      throw new Error("Admin access required.");
    }

    await ctx.db.patch(args.userId, {
      employmentStatus: "banned",
      banReason: args.reason,
      latestAppealStatus: undefined,
      lastSeenAt: Date.now(),
    });
  },
});

export const reviewAppeal = mutation({
  args: {
    adminEmail: v.string(),
    appealId: v.id("appeals"),
    status: v.union(v.literal("accepted"), v.literal("rejected")),
    resolutionNote: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isAdminEmail(args.adminEmail)) {
      throw new Error("Admin access required.");
    }

    const appeal = await ctx.db.get(args.appealId);
    if (!appeal) throw new Error("Appeal not found.");
    const user = await ctx.db.get(appeal.userId);
    if (!user) throw new Error("User not found.");

    await ctx.db.patch(appeal._id, {
      status: args.status,
      resolvedAt: Date.now(),
      resolutionNote: args.resolutionNote,
    });

    await ctx.db.patch(user._id, {
      latestAppealStatus: args.status,
      employmentStatus: args.status === "accepted" ? "active" : user.employmentStatus,
      banReason: args.status === "accepted" ? undefined : user.banReason,
      lastSeenAt: Date.now(),
    });
  },
});

export const listUsers = query({
  args: { adminEmail: v.string() },
  handler: async (ctx, args) => {
    if (!isAdminEmail(args.adminEmail)) {
      return [];
    }

    return await ctx.db.query("users").collect();
  },
});

export const appealsQueue = query({
  args: { adminEmail: v.string() },
  handler: async (ctx, args) => {
    if (!isAdminEmail(args.adminEmail)) {
      return [];
    }

    return await ctx.db.query("appeals").collect();
  },
});

export const evaluateApplication = action({
  args: {
    email: v.string(),
    fullName: v.string(),
    phone: v.string(),
    countryCode: v.string(),
    countryName: v.string(),
    city: v.string(),
    workType: v.string(),
    experienceSummary: v.string(),
    portfolioLink: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
    lastIpRegion: v.optional(v.string()),
    proxyDetected: v.boolean(),
    vpnDetected: v.boolean(),
    testAnswers: v.array(v.object({ prompt: v.string(), answer: v.string() })),
    documentCount: v.number(),
  },
  handler: async (ctx, args) => {
    const heuristicFlags: string[] = [];
    let fraudRiskScore = 0;

    if (args.proxyDetected) {
      heuristicFlags.push("PROXY_SIGNAL");
      fraudRiskScore += 35;
    }
    if (args.vpnDetected) {
      heuristicFlags.push("VPN_SIGNAL");
      fraudRiskScore += 25;
    }
    if (!args.deviceFingerprint) {
      heuristicFlags.push("MISSING_DEVICE_FINGERPRINT");
      fraudRiskScore += 12;
    }
    if (args.lastIpRegion && args.lastIpRegion !== args.countryCode) {
      heuristicFlags.push("IP_REGION_MISMATCH");
      fraudRiskScore += 18;
    }

    if (args.ipAddress && process.env.IPINFO_TOKEN) {
      const ipResponse = await fetch(
        `https://api.ipinfo.io/lite/${args.ipAddress}?token=${process.env.IPINFO_TOKEN}`,
      );
      if (ipResponse.ok) {
        const ipPayload = await ipResponse.json();
        const privacyResponse = await fetch(
          `https://api.ipinfo.io/tools?ip=${args.ipAddress}&token=${process.env.IPINFO_TOKEN}`,
        );

        if (privacyResponse.ok) {
          const privacyPayload = await privacyResponse.json();
          if (privacyPayload?.privacy?.vpn) {
            heuristicFlags.push("IPINFO_VPN");
            fraudRiskScore += 30;
          }
          if (privacyPayload?.privacy?.proxy) {
            heuristicFlags.push("IPINFO_PROXY");
            fraudRiskScore += 35;
          }
          if (privacyPayload?.privacy?.relay) {
            heuristicFlags.push("IPINFO_RELAY");
            fraudRiskScore += 20;
          }
          if (privacyPayload?.privacy?.hosting) {
            heuristicFlags.push("IPINFO_HOSTING");
            fraudRiskScore += 15;
          }
        }

        if (ipPayload?.country && ipPayload.country !== args.countryCode) {
          heuristicFlags.push("IPINFO_COUNTRY_MISMATCH");
          fraudRiskScore += 14;
        }
      }
    }

    if (args.ipAddress && process.env.IPQS_API_KEY) {
      const ipqsResponse = await fetch(
        `https://www.ipqualityscore.com/api/json/ip/${process.env.IPQS_API_KEY}/${args.ipAddress}?strictness=2&allow_public_access_points=true&fast=true&lighter_penalties=true`,
      );
      if (ipqsResponse.ok) {
        const ipqsPayload = await ipqsResponse.json();
        if (ipqsPayload.vpn) {
          heuristicFlags.push("IPQS_VPN");
          fraudRiskScore += 28;
        }
        if (ipqsPayload.proxy) {
          heuristicFlags.push("IPQS_PROXY");
          fraudRiskScore += 34;
        }
        if (ipqsPayload.tor) {
          heuristicFlags.push("IPQS_TOR");
          fraudRiskScore += 26;
        }
        if (ipqsPayload.active_vpn) {
          heuristicFlags.push("IPQS_ACTIVE_VPN");
          fraudRiskScore += 20;
        }
        if (typeof ipqsPayload.fraud_score === "number") {
          fraudRiskScore += Math.min(20, Math.round(ipqsPayload.fraud_score / 5));
        }
      }
    }
    if (args.testAnswers.some((answer) => answer.answer.trim().length < 40)) {
      heuristicFlags.push("LOW_SIGNAL_TEST_RESPONSE");
      fraudRiskScore += 10;
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a strict contractor hiring evaluator. Return JSON with qualificationScore (0-100), decision (pass or fail), and reason. Prioritize accuracy, writing quality, judgment, and reliability.",
          },
          {
            role: "user",
            content: JSON.stringify({
              fullName: args.fullName,
              workType: args.workType,
              experienceSummary: args.experienceSummary,
              testAnswers: args.testAnswers,
            }),
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
    const qualificationScore = Math.max(0, Math.min(100, Number(parsed.qualificationScore ?? 0)));
    const aiDecision = parsed.decision === "pass" ? "pass" : "fail";
    const aiReason = String(parsed.reason ?? "Application evaluation completed.");

    const finalRisk = Math.min(100, fraudRiskScore);

    await ctx.runMutation(api.users.submitApplication, {
      email: args.email,
      fullName: args.fullName,
      phone: args.phone,
      countryCode: args.countryCode,
      countryName: args.countryName,
      city: args.city,
      workType: args.workType,
      experienceSummary: args.experienceSummary,
      portfolioLink: args.portfolioLink,
      qualificationScore,
      aiDecision,
      aiReason,
      fraudRiskScore: finalRisk,
      fraudFlags: heuristicFlags,
      deviceFingerprint: args.deviceFingerprint,
      lastIpRegion: args.lastIpRegion,
      proxyDetected: args.proxyDetected,
      vpnDetected: args.vpnDetected,
      testAnswers: args.testAnswers,
      documentCount: args.documentCount,
    });

    return {
      qualificationScore,
      aiDecision,
      aiReason,
      fraudRiskScore: finalRisk,
      fraudFlags: heuristicFlags,
    };
  },
});
