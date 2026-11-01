import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  requireAuthenticatedUser,
  resolveAuthenticatedUser,
} from "./lib/auth";
import { isLoanOverdue } from "./lib/validation";
import { logAuditEvent } from "./lib/audit";

/**
 * Returns all loans where the authenticated user is the borrower or lender.
 * Sorted newest first, enriched with tool and other party details.
 */
export const listMine = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await resolveAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);

    // Fetch loans where user is borrower and loans where user is lender
    const [borrowerLoans, lenderLoans] = await Promise.all([
      ctx.db
        .query("loans")
        .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
        .collect(),
      ctx.db
        .query("loans")
        .withIndex("by_lender", (q) => q.eq("lenderId", user._id))
        .collect(),
    ]);

    // Combine and sort by newest first
    const allLoans = [...borrowerLoans, ...lenderLoans].sort(
      (a, b) => b._creationTime - a._creationTime
    );

    const paginatedLoans = allLoans.slice(0, limit);

    return await Promise.all(
      paginatedLoans.map(async (loan) => {
        const [tool, borrower, lender] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.borrowerId),
          ctx.db.get(loan.lenderId),
        ]);

        const isLender = loan.lenderId === user._id;
        const isBorrower = loan.borrowerId === user._id;

        return {
          _id: loan._id,
          requestId: loan.requestId,
          toolId: loan.toolId,
          toolName: tool ? tool.name : "Tool Listing",
          toolCategory: tool ? tool.category : "Other",
          startDate: loan.startDate,
          dueDate: loan.dueDate,
          status: loan.status,
          returnedAt: loan.returnedAt,
          isLender,
          isBorrower,
          borrowerDisplayName: borrower ? borrower.displayName : "Neighbor",
          lenderDisplayName: lender ? lender.displayName : "Neighbor",
          isOverdue: isLoanOverdue(loan.dueDate, loan.status),
          _creationTime: loan._creationTime,
        };
      })
    );
  },
});

/**
 * Returns details for a specific loan if the caller is the borrower or lender.
 */
export const getById = query({
  args: {
    loanId: v.optional(v.id("loans")),
    id: v.optional(v.id("loans")),
  },
  handler: async (ctx, args) => {
    const { user } = await resolveAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const targetId = args.loanId ?? args.id;
    if (!targetId) {
      throw new Error("Loan ID is required");
    }

    const loan = await ctx.db.get(targetId);
    if (!loan) {
      return null;
    }

    // Access strictly restricted to borrower or lender
    const isBorrower = loan.borrowerId === user._id;
    const isLender = loan.lenderId === user._id;

    if (!isBorrower && !isLender) {
      return null;
    }

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
      startDate: loan.startDate,
      dueDate: loan.dueDate,
      status: loan.status,
      returnedAt: loan.returnedAt,
      isLender,
      isBorrower,
      borrowerDisplayName: borrower ? borrower.displayName : "Neighbor",
      lenderDisplayName: lender ? lender.displayName : "Neighbor",
      isOverdue: isLoanOverdue(loan.dueDate, loan.status),
      _creationTime: loan._creationTime,
    };
  },
});

/**
 * Confirms a tool has been returned.
 *
 * Requirements:
 * 1. Only the verified lender may mark a loan returned.
 * 2. Sets returnedAt from server clock and status to 'returned'.
 * 3. Idempotent on safe repeated calls.
 * 4. Returned loans are preserved in the database for audit/loan history.
 *
 * FUTURE AUTOMATION HOOK (Phase 3.3/n8n):
 * Event: "loan.returned"
 * Trigger: When a loan is marked returned.
 * Recipient: Borrower & Lender.
 */
export const markReturned = mutation({
  args: {
    loanId: v.optional(v.id("loans")),
    id: v.optional(v.id("loans")),
  },
  handler: async (ctx, args) => {
    const targetId = args.loanId ?? args.id;
    if (!targetId) {
      throw new Error("Loan ID is required");
    }

    const { user } = await requireAuthenticatedUser(ctx);

    const loan = await ctx.db.get(targetId);
    if (!loan) {
      throw new Error("Loan not found");
    }

    // Only the lender can confirm return
    if (loan.lenderId !== user._id) {
      throw new Error("Forbidden: Only the tool lender can confirm tool return");
    }

    // Safe idempotency
    if (loan.status === "returned") {
      return {
        success: true,
        alreadyReturned: true,
      };
    }

    const now = Date.now();
    await ctx.db.patch(loan._id, {
      status: "returned",
      returnedAt: now,
    });

    await logAuditEvent(ctx, {
      actorId: user._id,
      action: "loan.return",
      targetType: "loans",
      targetId: loan._id,
      metadata: { toolId: loan.toolId },
    });

    return {
      success: true,
      alreadyReturned: false,
    };
  },
});

/**
 * Returns reserved date ranges for active loans on a tool.
 * Enables date-aware availability checking during tool browsing and request creation.
 */
export const getToolAvailability = query({
  args: {
    toolId: v.id("tools"),
  },
  handler: async (ctx, args) => {
    const activeLoans = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) =>
        q.eq("toolId", args.toolId).eq("status", "active")
      )
      .collect();

    return activeLoans.map((loan) => ({
      startDate: loan.startDate,
      dueDate: loan.dueDate,
    }));
  },
});
