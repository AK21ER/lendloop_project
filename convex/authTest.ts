
import { query } from "./_generated/server";

export const getMyIdentity = query({
  args: {},

  handler: async (ctx) => {
    const identity =
      await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("UNAUTHENTICATED");
    }

    return {
      clerkId: identity.subject,
      authenticated: true,
    };
  },
});
