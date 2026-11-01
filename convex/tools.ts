import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  requireAuthenticatedIdentity,
  requireAuthenticatedUser,
  resolveAuthenticatedUser,
} from "./lib/auth";
import { requireToolOwner } from "./lib/permissions";
import {
  validateCategory,
  validateCondition,
  validateDescription,
  validateToolName,
} from "./lib/validation";
import type {
  ToolCategory,
  ToolCondition,
  ToolStatus,
} from "./constants";

export const listPublic = query({
  args: {
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);

    let tools;
    if (args.category && args.category !== "All") {
      const validatedCategory = validateCategory(args.category);
      tools = await ctx.db
        .query("tools")
        .withIndex("by_status_category", (q) =>
          q.eq("status", "active").eq("category", validatedCategory)
        )
        .take(limit);
    } else {
      tools = await ctx.db
        .query("tools")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .take(limit);
    }

    // Public data is strictly minimized: return only name and category
    return tools.map((tool) => ({
      name: tool.name,
      category: tool.category,
    }));
  },
});

export const listAll = query({
  args: {
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Require authentication
    await requireAuthenticatedIdentity(ctx);

    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);

    let tools;
    if (args.category && args.category !== "All") {
      const validatedCategory = validateCategory(args.category);
      tools = await ctx.db
        .query("tools")
        .withIndex("by_status_category", (q) =>
          q.eq("status", "active").eq("category", validatedCategory)
        )
        .take(limit);
    } else {
      tools = await ctx.db
        .query("tools")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .take(limit);
    }

    // Return browseable listings without exposing private user account details
    return tools.map((tool) => ({
      _id: tool._id,
      name: tool.name,
      category: tool.category,
      condition: tool.condition,
      description: tool.description,
      status: tool.status,
      updatedAt: tool.updatedAt,
      ownerId: tool.ownerId,
    }));
  },
});

export const getById = query({
  args: {
    id: v.optional(v.id("tools")),
    toolId: v.optional(v.id("tools")),
  },
  handler: async (ctx, args) => {
    const { user } = await resolveAuthenticatedUser(ctx);

    const targetId = args.id ?? args.toolId;
    if (!targetId) {
      throw new Error("Tool ID is required");
    }

    const tool = await ctx.db.get(targetId);
    if (!tool) {
      return null;
    }

    // If removed, non-owners cannot browse or view it
    if (tool.status === "removed" && (!user || tool.ownerId !== user._id)) {
      return null;
    }

    return {
      _id: tool._id,
      name: tool.name,
      category: tool.category,
      condition: tool.condition,
      description: tool.description,
      status: tool.status,
      updatedAt: tool.updatedAt,
      ownerId: tool.ownerId,
      isOwner: user ? tool.ownerId === user._id : false,
    };
  },
});

export const listMine = query({
  args: {
    includeRemoved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await resolveAuthenticatedUser(ctx);

    // If user is not yet created in users table, they have 0 listings
    if (!user) {
      return [];
    }

    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();

    if (args.includeRemoved) {
      return tools;
    }

    return tools.filter((tool) => tool.status !== "removed");
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAuthenticatedUser(ctx);

    const name = validateToolName(args.name);
    const category = validateCategory(args.category);
    const condition = validateCondition(args.condition);
    const description = validateDescription(args.description);

    const toolId = await ctx.db.insert("tools", {
      ownerId: user._id,
      name,
      category,
      condition,
      description,
      status: "active",
      updatedAt: Date.now(),
    });

    return toolId;
  },
});

export const update = mutation({
  args: {
    id: v.optional(v.id("tools")),
    toolId: v.optional(v.id("tools")),
    name: v.optional(v.string()),
    category: v.optional(v.string()),
    condition: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const targetId = args.id ?? args.toolId;
    if (!targetId) {
      throw new Error("Tool ID is required");
    }

    const { tool } = await requireToolOwner(ctx, targetId);

    if (tool.status === "removed") {
      throw new Error("Cannot edit a removed tool listing");
    }

    const patch: Partial<{
      name: string;
      category: ToolCategory;
      condition: ToolCondition;
      description: string;
      status: ToolStatus;
      updatedAt: number;
    }> = {};

    if (args.name !== undefined) {
      patch.name = validateToolName(args.name);
    }
    if (args.category !== undefined) {
      patch.category = validateCategory(args.category);
    }
    if (args.condition !== undefined) {
      patch.condition = validateCondition(args.condition);
    }
    if (args.description !== undefined) {
      patch.description = validateDescription(args.description);
    }
    if (args.status !== undefined) {
      if (args.status === "removed") {
        throw new Error(
          "Cannot set status to 'removed' via update. Use removeMine instead."
        );
      }
      if (args.status !== "active" && args.status !== "inactive") {
        throw new Error(
          "Invalid status. Allowed statuses for update are 'active' or 'inactive'."
        );
      }
      patch.status = args.status;
    }

    patch.updatedAt = Date.now();

    await ctx.db.patch(targetId, patch);

    return await ctx.db.get(targetId);
  },
});

export const removeMine = mutation({
  args: {
    id: v.optional(v.id("tools")),
    toolId: v.optional(v.id("tools")),
  },
  handler: async (ctx, args) => {
    const targetId = args.id ?? args.toolId;
    if (!targetId) {
      throw new Error("Tool ID is required");
    }

    const { tool } = await requireToolOwner(ctx, targetId);

    if (tool.status === "removed") {
      throw new Error("Listing is already removed");
    }

    await ctx.db.patch(targetId, {
      status: "removed",
      updatedAt: Date.now(),
    });

    return { success: true, id: targetId };
  },
});
