import { api } from "./_generated/api";
import { internalAction } from "./_generated/server";

export const runCountryReviewWindow = internalAction({
  args: {},
  handler: async (ctx) => {
    const policies = await ctx.runQuery(api.admin.allCountryPolicies, {});
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();
    const systemAdminEmail = process.env.SYSTEM_ADMIN_EMAIL ?? "ops@okeymeta.com.ng";

    await ctx.runMutation(api.users.ensureUser, {
      email: systemAdminEmail,
      displayName: "Qualia Ops",
    });

    const matchingPolicies = policies.filter((policy) => {
      if (!policy.enabled) return false;
      return policy.reviewHourUTC === currentHour && policy.reviewMinuteUTC <= currentMinute;
    });

    for (const policy of matchingPolicies) {
      await ctx.runAction(api.tasks.runCountryAiReview, {
        email: systemAdminEmail,
        countryCode: policy.countryCode,
      });
    }
  },
});
