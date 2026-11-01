import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAuthenticatedUser } from "./auth";

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx
): Promise<{
  identity: NonNullable<Awaited<ReturnType<typeof ctx.auth.getUserIdentity>>>;
  user: Doc<"users">;
}> {
  const { identity, user } = await requireAuthenticatedUser(ctx);
  if (user.role !== "admin") {
    throw new Error("Forbidden: Administrator privileges required");
  }
  return { identity, user };
}

export async function requireToolOwner(
  ctx: QueryCtx | MutationCtx,
  toolId: Id<"tools">
): Promise<{
  identity: NonNullable<Awaited<ReturnType<typeof ctx.auth.getUserIdentity>>>;
  user: Doc<"users">;
  tool: Doc<"tools">;
}> {
  const { identity, user } = await requireAuthenticatedUser(ctx);

  const tool = await ctx.db.get(toolId);
  if (!tool) {
    throw new Error("Tool not found");
  }

  if (tool.ownerId !== user._id) {
    throw new Error("Forbidden: You do not have permission to modify this tool");
  }

  return { identity, user, tool };
}

export function checkToolAvailableForRequest(tool: Doc<"tools">): void {
  if (tool.status !== "active") {
    throw new Error(
      `Cannot request tool with status "${tool.status}". Only active listings can be requested.`
    );
  }
}

export async function requireRequestParticipant(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"borrowRequests">
): Promise<{
  identity: NonNullable<Awaited<ReturnType<typeof ctx.auth.getUserIdentity>>>;
  user: Doc<"users">;
  request: Doc<"borrowRequests">;
}> {
  const { identity, user } = await requireAuthenticatedUser(ctx);

  const request = await ctx.db.get(requestId);
  if (!request) {
    throw new Error("Borrow request not found");
  }

  const isBorrower = request.borrowerId === user._id;
  const isLender = request.lenderId === user._id;

  if (!isBorrower && !isLender) {
    throw new Error("Borrow request not found");
  }

  return { identity, user, request };
}
