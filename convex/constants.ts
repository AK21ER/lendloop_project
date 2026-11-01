export const TOOL_CATEGORIES = [
  "Power Tools",
  "Garden",
  "Kitchen",
  "Camping",
  "Hand Tools",
  "Other",
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const TOOL_CONDITIONS = ["new", "good", "fair"] as const;
export type ToolCondition = (typeof TOOL_CONDITIONS)[number];

export const TOOL_STATUSES = ["active", "inactive", "removed"] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;
