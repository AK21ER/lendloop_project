import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  TOOL_CATEGORIES,
  TOOL_CONDITIONS,
  TOOL_STATUSES,
  USER_ROLES,
} from "./constants";

export const toolCategoryValidator = v.union(
  v.literal(TOOL_CATEGORIES[0]),
  v.literal(TOOL_CATEGORIES[1]),
  v.literal(TOOL_CATEGORIES[2]),
  v.literal(TOOL_CATEGORIES[3]),
  v.literal(TOOL_CATEGORIES[4]),
  v.literal(TOOL_CATEGORIES[5])
);

export const toolConditionValidator = v.union(
  v.literal(TOOL_CONDITIONS[0]),
  v.literal(TOOL_CONDITIONS[1]),
  v.literal(TOOL_CONDITIONS[2])
);

export const toolStatusValidator = v.union(
  v.literal(TOOL_STATUSES[0]),
  v.literal(TOOL_STATUSES[1]),
  v.literal(TOOL_STATUSES[2])
);

export const userRoleValidator = v.union(
  v.literal(USER_ROLES[0]),
  v.literal(USER_ROLES[1])
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    displayName: v.string(),
    role: userRoleValidator,
    isTrustedLender: v.boolean(),
  }).index("by_clerk_id", ["clerkId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    description: v.string(),
    status: toolStatusValidator,
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"])
    .index("by_status", ["status"])
    .index("by_status_category", ["status", "category"]),
});
