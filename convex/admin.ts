import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { requireAdmin } from "./lib/permissions";
import { isLoanOverdue } from "./lib/validation";
import { logAuditEvent } from "./lib/audit";

/**
 * Admin: List all loans across the platform with pagination and status filtering.
 *
 * Requirements:
 * - Requires authentication and an 'admin' role stored in Convex.
 * - Sanitized response: returns tool, lender, borrower, dates, overdue calculation.
 * - Excludes Clerk IDs, emails, JWTs, and internal secrets.
 * - Supports status filtering ("active" | "returned") and bounded results.
 */
export const listAllLoans = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);

    let loans;
    if (args.status === "active" || args.status === "returned") {
      loans = await ctx.db
        .query("loans")
        .withIndex("by_status_due", (q) => q.eq("status", args.status as "active" | "returned"))
        .take(limit);
    } else {
      loans = await ctx.db.query("loans").take(limit);
    }

    const enriched = await Promise.all(
      loans.map(async (loan) => {
        const [tool, borrower, lender] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.borrowerId),
          ctx.db.get(loan.lenderId),
        ]);

        return {
          _id: loan._id,
          requestId: loan.requestId,
          toolId: loan.toolId,
          toolName: tool ? tool.name : "Tool Listing",
          toolCategory: tool ? tool.category : "Other",
          lenderId: loan.lenderId,
          lenderDisplayName: lender ? lender.displayName : "Lender",
          borrowerId: loan.borrowerId,
          borrowerDisplayName: borrower ? borrower.displayName : "Borrower",
          startDate: loan.startDate,
          dueDate: loan.dueDate,
          status: loan.status,
          returnedAt: loan.returnedAt,
          isOverdue: isLoanOverdue(loan.dueDate, loan.status),
          _creationTime: loan._creationTime,
        };
      })
    );

    return enriched;
  },
});

/**
 * Admin: Soft-removes any tool listing.
 *
 * Requirements:
 * - Requires admin role.
 * - Soft deletion: updates status to "removed".
 * - Preserves related borrowing requests, active loans, and history intact.
 * - Does not cancel approved loans automatically.
 * - Safe on repeated removal calls (idempotent).
 * - Records an audit log.
 */
export const removeListing = mutation({
  args: {
    toolId: v.optional(v.id("tools")),
    id: v.optional(v.id("tools")),
  },
  handler: async (ctx, args) => {
    const { user: adminUser } = await requireAdmin(ctx);

    const targetId = args.toolId ?? args.id;
    if (!targetId) {
      throw new Error("Tool ID is required");
    }

    const tool = await ctx.db.get(targetId);
    if (!tool) {
      throw new Error("Tool not found");
    }

    // Safe idempotency: if already removed, return early
    if (tool.status === "removed") {
      return {
        success: true,
        alreadyRemoved: true,
        toolId: tool._id,
      };
    }

    await ctx.db.patch(tool._id, {
      status: "removed",
      updatedAt: Date.now(),
    });

    await logAuditEvent(ctx, {
      actorId: adminUser._id,
      action: "admin.tool.remove",
      targetType: "tools",
      targetId: tool._id,
      metadata: { name: tool.name, ownerId: tool.ownerId },
    });

    return {
      success: true,
      alreadyRemoved: false,
      toolId: tool._id,
    };
  },
});

/**
 * Admin: List users/lenders for management and trusted status review.
 *
 * Requirements:
 * - Requires admin role.
 * - Returns only necessary public fields (no emails, clerkId, tokens).
 * - Bounded results.
 */
export const listLenders = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const users = await ctx.db.query("users").take(limit);

    return users.map((u) => ({
      _id: u._id,
      displayName: u.displayName,
      role: u.role,
      isTrustedLender: u.isTrustedLender,
      _creationTime: u._creationTime,
    }));
  },
});

/**
 * Admin: Set or unset isTrustedLender flag for a user.
 *
 * Requirements:
 * - Requires admin role.
 * - Sets or unsets isTrustedLender.
 * - Does NOT modify target's role.
 * - Safe on repeated identical updates.
 * - Records an audit log.
 */
export const setTrustedLender = mutation({
  args: {
    userId: v.id("users"),
    isTrusted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: adminUser } = await requireAdmin(ctx);

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) {
      throw new Error("Target user not found");
    }

    // Safe idempotency on repeated calls
    if (targetUser.isTrustedLender === args.isTrusted) {
      return {
        success: true,
        changed: false,
        userId: targetUser._id,
        isTrustedLender: targetUser.isTrustedLender,
      };
    }

    // Update only isTrustedLender (strictly preserving role)
    await ctx.db.patch(targetUser._id, {
      isTrustedLender: args.isTrusted,
    });

    await logAuditEvent(ctx, {
      actorId: adminUser._id,
      action: "admin.user.trusted_update",
      targetType: "users",
      targetId: targetUser._id,
      metadata: { isTrusted: args.isTrusted },
    });

    return {
      success: true,
      changed: true,
      userId: targetUser._id,
      isTrustedLender: args.isTrusted,
    };
  },
});

/**
 * Admin: List recent system audit logs.
 *
 * Requirements:
 * - Requires admin role.
 * - Public callers cannot read audit logs.
 */
export const listAuditLogs = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const logs = await ctx.db.query("auditLogs").order("desc").take(limit);

    const enriched = await Promise.all(
      logs.map(async (log) => {
        let actorDisplayName = "System";
        if (log.actorId) {
          const actor = await ctx.db.get(log.actorId);
          if (actor) {
            actorDisplayName = actor.displayName;
          }
        }

        return {
          _id: log._id,
          actorId: log.actorId,
          actorDisplayName,
          action: log.action,
          targetType: log.targetType,
          targetId: log.targetId,
          metadata: log.metadata,
          timestamp: log.timestamp,
        };
      })
    );

    return enriched;
  },
});

/**
 * Controlled Operator-Only Admin Provisioning:
 *
 * Implemented strictly as an `internalMutation`.
 * Inaccessible from public clients, browser RPCs, and unauthenticated endpoints.
 * Can only be executed by an authorized operator through the Convex CLI or deployment dashboard:
 *
 * CLI Execution:
 *   npx convex run admin:provisionAdminInternal '{"clerkId": "<clerk_user_id>"}'
 *   OR
 *   npx convex run admin:provisionAdminInternal '{"userId": "<convex_user_id>"}'
 */
export const provisionAdminInternal = internalMutation({
  args: {
    clerkId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    let targetUser = null;
    if (args.userId) {
      targetUser = await ctx.db.get(args.userId);
    } else if (args.clerkId) {
      targetUser = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId!))
        .first();
    }

    if (!targetUser) {
      throw new Error("User not found for admin provisioning");
    }

    // Idempotent: safe repeated call
    if (targetUser.role === "admin") {
      return {
        success: true,
        alreadyAdmin: true,
        userId: targetUser._id,
        role: "admin",
      };
    }

    await ctx.db.patch(targetUser._id, {
      role: "admin",
    });

    await logAuditEvent(ctx, {
      actorId: targetUser._id,
      action: "admin.provisioned",
      targetType: "users",
      targetId: targetUser._id,
      metadata: { method: "operator_internal" },
    });

    return {
      success: true,
      alreadyAdmin: false,
      userId: targetUser._id,
      role: "admin",
    };
  },
});
