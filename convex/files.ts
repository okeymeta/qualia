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

export const generateApplicantUploadUrl = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await getUserByEmail(ctx, args.email);
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveApplicantDocument = mutation({
  args: {
    email: v.string(),
    kind: v.union(
      v.literal("government_id"),
      v.literal("proof_of_address"),
      v.literal("resume"),
      v.literal("certificate"),
    ),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByEmail(ctx, args.email);
    return await ctx.db.insert("applicationDocuments", {
      userId: user._id,
      applicationId: undefined,
      kind: args.kind,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      status: "pending",
      uploadedAt: Date.now(),
      reviewedAt: undefined,
      reviewNote: undefined,
    });
  },
});

export const applicantDocuments = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByEmail(ctx, args.email);
    const docs = await ctx.db
      .query("applicationDocuments")
      .withIndex("by_user", (query) => query.eq("userId", user._id))
      .collect();

    return await Promise.all(
      docs.map(async (doc) => ({
        ...doc,
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    );
  },
});

export const adminDocumentQueue = query({
  args: { adminEmail: v.string() },
  handler: async (ctx, args) => {
    const admin = await getUserByEmail(ctx, args.adminEmail);
    if (!admin.isAdmin) {
      return [];
    }

    const docs = await ctx.db.query("applicationDocuments").collect();
    return await Promise.all(
      docs.map(async (doc) => ({
        ...doc,
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    );
  },
});

export const reviewApplicantDocument = mutation({
  args: {
    adminEmail: v.string(),
    documentId: v.id("applicationDocuments"),
    status: v.union(v.literal("approved"), v.literal("rejected")),
    reviewNote: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await getUserByEmail(ctx, args.adminEmail);
    if (!admin.isAdmin) {
      throw new Error("Admin access required.");
    }

    await ctx.db.patch(args.documentId, {
      status: args.status,
      reviewedAt: Date.now(),
      reviewNote: args.reviewNote,
    });
  },
});
