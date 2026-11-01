import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  requireAuthenticatedUser,
  resolveAuthenticatedUser,
} from "./lib/auth";
import { checkToolAvailableForRequest } from "./lib/permissions";
import { validateDateRange } from "./lib/validation";
import type { RequestStatus } from "./constants";

/**
 * Creates a new borrow request for an active tool.
 *
 * Requirements:
 * - Caller must be an authenticated application user.
 * - Tool must exist and be active.
 * - Borrower cannot borrow their own tool.
 * - Dates must be valid calendar dates (YYYY-MM-DD), not in the past (Africa/Addis_Ababa),
 *   start <= end, and <= 30 days total duration.
 * - Duplicate pending requests by the same borrower for the same tool & dates are rejected.
 * - Initial status is strictly set to "pending".
 *
 * FUTURE AUTOMATION HOOK (Phase 3.3/n8n):
 * Event: "borrow.requested"
 * Trigger: When a new borrow request is inserted.
 * Recipient: Tool owner (lender).
 */
export const create = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Authenticated application user
    const { user } = await requireAuthenticatedUser(ctx);

    // 2. Validate dates strictly (calendar validity, timezone, duration bounds)
    validateDateRange(args.startDate, args.endDate);

    // 3. Verify tool exists
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throw new Error("Tool not found");
    }

    // 4. Verify tool listing status is active
    checkToolAvailableForRequest(tool);

    // 5. Reject requests for tools owned by the borrower
    if (tool.ownerId === user._id) {
      throw new Error("Cannot request to borrow your own tool");
    }

    // 6. Prevent duplicate equivalent pending requests from same borrower
    const pendingRequests = await ctx.db
      .query("borrowRequests")
      .withIndex("by_tool_status", (q) =>
        q.eq("toolId", args.toolId).eq("status", "pending")
      )
      .collect();

    const isDuplicate = pendingRequests.some(
      (r) =>
        r.borrowerId === user._id &&
        r.startDate === args.startDate &&
        r.endDate === args.endDate
    );

    if (isDuplicate) {
      throw new Error(
        "A pending request for this tool with the same date range already exists"
      );
    }

    // 7. Store with status 'pending'
    const requestId = await ctx.db.insert("borrowRequests", {
      toolId: args.toolId,
      borrowerId: user._id,
      lenderId: tool.ownerId,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "pending",
    });

    return requestId;
  },
});

/**
 * Returns borrow requests created by the authenticated user.
 * Sorted newest first, with permitted tool metadata.
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

    const requests = await ctx.db
      .query("borrowRequests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .order("desc")
      .take(limit);

    return await Promise.all(
      requests.map(async (req) => {
        const tool = await ctx.db.get(req.toolId);
        return {
          _id: req._id,
          toolId: req.toolId,
          toolName: tool ? tool.name : "Tool Listing",
          toolCategory: tool ? tool.category : "Other",
          startDate: req.startDate,
          endDate: req.endDate,
          status: req.status,
          _creationTime: req._creationTime,
        };
      })
    );
  },
});

/**
 * Returns incoming borrow requests for tools owned by the authenticated user.
 * Supports optional status filtering.
 */
export const listIncoming = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await resolveAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);

    let requests;
    if (args.status && args.status !== "all") {
      requests = await ctx.db
        .query("borrowRequests")
        .withIndex("by_lender_status", (q) =>
          q.eq("lenderId", user._id).eq("status", args.status as RequestStatus)
        )
        .order("desc")
        .take(limit);
    } else {
      requests = await ctx.db
        .query("borrowRequests")
        .withIndex("by_lender", (q) => q.eq("lenderId", user._id))
        .order("desc")
        .take(limit);
    }

    return await Promise.all(
      requests.map(async (req) => {
        const [tool, borrower] = await Promise.all([
          ctx.db.get(req.toolId),
          ctx.db.get(req.borrowerId),
        ]);

        return {
          _id: req._id,
          toolId: req.toolId,
          toolName: tool ? tool.name : "Tool Listing",
          toolCategory: tool ? tool.category : "Other",
          borrowerId: req.borrowerId,
          borrowerDisplayName: borrower ? borrower.displayName : "Neighbor",
          startDate: req.startDate,
          endDate: req.endDate,
          status: req.status,
          _creationTime: req._creationTime,
        };
      })
    );
  },
});

/**
 * Returns details for a specific borrow request if the caller is the borrower or lender.
 */
export const getById = query({
  args: {
    requestId: v.optional(v.id("borrowRequests")),
    id: v.optional(v.id("borrowRequests")),
  },
  handler: async (ctx, args) => {
    const { user } = await resolveAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const targetId = args.requestId ?? args.id;
    if (!targetId) {
      throw new Error("Request ID is required");
    }

    const request = await ctx.db.get(targetId);
    if (!request) {
      return null;
    }

    // Access strictly restricted to borrower or tool lender
    const isBorrower = request.borrowerId === user._id;
    const isLender = request.lenderId === user._id;

    if (!isBorrower && !isLender) {
      return null;
    }

    const [tool, otherUser] = await Promise.all([
      ctx.db.get(request.toolId),
      ctx.db.get(isBorrower ? request.lenderId : request.borrowerId),
    ]);

    return {
      _id: request._id,
      toolId: request.toolId,
      toolName: tool ? tool.name : "Tool Listing",
      toolCategory: tool ? tool.category : "Other",
      startDate: request.startDate,
      endDate: request.endDate,
      status: request.status,
      isBorrower,
      isLender,
      otherPartyDisplayName: otherUser ? otherUser.displayName : "Neighbor",
      _creationTime: request._creationTime,
    };
  },
});
