import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export interface AuditEventParams {
  actorId?: Id<"users">;
  action: string;
  targetType: "tools" | "borrowRequests" | "loans" | "users";
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Transactionally records an audit log entry.
 *
 * Rules:
 * - Writes transactionally within the caller mutation (fails or commits atomically).
 * - Sanitizes metadata: no complete user profiles, secrets, tokens, or JWTs.
 * - Server clock is used for timestamps.
 */
export async function logAuditEvent(
  ctx: MutationCtx,
  event: AuditEventParams
): Promise<Id<"auditLogs">> {
  return await ctx.db.insert("auditLogs", {
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata,
    timestamp: Date.now(),
  });
}
