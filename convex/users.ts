import { mutation, query } from "./_generated/server";

export function extractDisplayName(identity: {
  name?: string;
  nickname?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  subject: string;
}): string {
  if (identity.name && identity.name.trim().length > 0) {
    return identity.name.trim();
  }
  if (identity.nickname && identity.nickname.trim().length > 0) {
    return identity.nickname.trim();
  }
  const given = identity.givenName?.trim() || "";
  const family = identity.familyName?.trim() || "";
  const full = `${given} ${family}`.trim();
  if (full.length > 0) {
    return full;
  }
  if (identity.email && identity.email.includes("@")) {
    const localPart = identity.email.split("@")[0].trim();
    if (localPart.length > 0) {
      return localPart;
    }
  }
  return `Neighbor-${identity.subject.slice(-4)}`;
}

export const ensureCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated: Please sign in to sync your user profile");
    }

    const clerkId = identity.subject;
    const displayName = extractDisplayName(identity);

    // Look for existing user
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();

    if (existingUser) {
      // Preserve existing role and trusted lender status strictly
      // Update display name only if changed
      if (displayName && existingUser.displayName !== displayName) {
        await ctx.db.patch(existingUser._id, { displayName });
        return {
          ...existingUser,
          displayName,
        };
      }
      return existingUser;
    }

    // First use: create user record with default 'user' role and isTrustedLender: false
    const userId = await ctx.db.insert("users", {
      clerkId,
      displayName,
      role: "user",
      isTrustedLender: false,
    });

    const newUser = await ctx.db.get(userId);
    return newUser!;
  },
});

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
  },
});
