import {
  TOOL_CATEGORIES,
  TOOL_CONDITIONS,
  TOOL_STATUSES,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  type ToolCategory,
  type ToolCondition,
  type ToolStatus,
} from "../constants";

export function validateToolName(name: unknown): string {
  if (typeof name !== "string") {
    throw new Error("Tool name must be a string");
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Tool name cannot be empty or blank");
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`Tool name cannot exceed ${MAX_NAME_LENGTH} characters`);
  }
  return trimmed;
}

export function validateDescription(description: unknown): string {
  if (typeof description !== "string") {
    throw new Error("Tool description must be a string");
  }
  const trimmed = description.trim();
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `Tool description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`
    );
  }
  return trimmed;
}

export function validateCategory(category: unknown): ToolCategory {
  if (
    typeof category !== "string" ||
    !TOOL_CATEGORIES.includes(category as ToolCategory)
  ) {
    throw new Error(
      `Invalid tool category: "${category}". Allowed categories are: ${TOOL_CATEGORIES.join(", ")}`
    );
  }
  return category as ToolCategory;
}

export function validateCondition(condition: unknown): ToolCondition {
  if (
    typeof condition !== "string" ||
    !TOOL_CONDITIONS.includes(condition as ToolCondition)
  ) {
    throw new Error(
      `Invalid tool condition: "${condition}". Allowed conditions are: ${TOOL_CONDITIONS.join(", ")}`
    );
  }
  return condition as ToolCondition;
}

export function validateStatus(status: unknown): ToolStatus {
  if (
    typeof status !== "string" ||
    !TOOL_STATUSES.includes(status as ToolStatus)
  ) {
    throw new Error(
      `Invalid tool status: "${status}". Allowed statuses are: ${TOOL_STATUSES.join(", ")}`
    );
  }
  return status as ToolStatus;
}
