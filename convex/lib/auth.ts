import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export async function getAuthenticatedIdentity(ctx: QueryCtx | MutationCtx) {
  return await ctx.auth.getUserIdentity();
}

export async function requireAuthenticatedIdentity(
  ctx: QueryCtx | MutationCtx
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthenticated: Please sign in to perform this action");
  }
  return identity;
}

export async function resolveAuthenticatedUser(
  ctx: QueryCtx | MutationCtx
): Promise<{
  identity: NonNullable<Awaited<ReturnType<typeof ctx.auth.getUserIdentity>>>;
  user: Doc<"users"> | null;
}> {
  const identity = await requireAuthenticatedIdentity(ctx);

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();

  return { identity, user };
}

export async function requireAuthenticatedUser(
  ctx: QueryCtx | MutationCtx
): Promise<{
  identity: NonNullable<Awaited<ReturnType<typeof ctx.auth.getUserIdentity>>>;
  user: Doc<"users">;
}> {
  const { identity, user } = await resolveAuthenticatedUser(ctx);

  if (!user) {
    throw new Error(
      "User profile not synchronized. Please call ensureCurrentUser first."
    );
  }

  return { identity, user };
}

export async function getOptionalUser(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}
