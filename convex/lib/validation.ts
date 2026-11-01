import {
  TOOL_CATEGORIES,
  TOOL_CONDITIONS,
  TOOL_STATUSES,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  DEFAULT_TIMEZONE,
  MAX_BORROW_DAYS,
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

/**
 * Validates strict YYYY-MM-DD format and actual calendar validity.
 */
export function validateDateString(dateStr: unknown, fieldName: string): string {
  if (typeof dateStr !== "string") {
    throw new Error(`${fieldName} must be a string in YYYY-MM-DD format`);
  }

  const formatRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!formatRegex.test(dateStr)) {
    throw new Error(
      `${fieldName} "${dateStr}" is invalid. Expected format: YYYY-MM-DD`
    );
  }

  const parts = dateStr.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  if (month < 1 || month > 12) {
    throw new Error(`${fieldName} has invalid month: ${month}`);
  }

  const dateObj = new Date(Date.UTC(year, month - 1, day));
  if (
    dateObj.getUTCFullYear() !== year ||
    dateObj.getUTCMonth() !== month - 1 ||
    dateObj.getUTCDate() !== day
  ) {
    throw new Error(
      `${fieldName} "${dateStr}" is not a valid calendar date`
    );
  }

  return dateStr;
}

/**
 * Returns current date in YYYY-MM-DD for the business timezone.
 */
export function getTodayInTimezone(timezone: string = DEFAULT_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

/**
 * Validates borrow request date range.
 * - Format & calendar validity
 * - Start date not in past (relative to business timezone)
 * - End date >= start date
 * - Maximum duration <= MAX_BORROW_DAYS
 */
export function validateDateRange(
  startDateStr: unknown,
  endDateStr: unknown,
  timezone: string = DEFAULT_TIMEZONE
): {
  startDate: string;
  endDate: string;
  durationDays: number;
} {
  const startDate = validateDateString(startDateStr, "Start date");
  const endDate = validateDateString(endDateStr, "End date");

  const today = getTodayInTimezone(timezone);
  if (startDate < today) {
    throw new Error(
      `Borrowing start date (${startDate}) cannot be in the past (today in ${timezone} is ${today})`
    );
  }

  if (endDate < startDate) {
    throw new Error(
      `Borrowing end date (${endDate}) cannot be earlier than start date (${startDate})`
    );
  }

  const [sYear, sMonth, sDay] = startDate.split("-").map(Number);
  const [eYear, eMonth, eDay] = endDate.split("-").map(Number);

  const startMs = Date.UTC(sYear, sMonth - 1, sDay);
  const endMs = Date.UTC(eYear, eMonth - 1, eDay);
  const durationDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;

  if (durationDays > MAX_BORROW_DAYS) {
    throw new Error(
      `Borrowing duration cannot exceed ${MAX_BORROW_DAYS} days (requested duration: ${durationDays} days)`
    );
  }

  return {
    startDate,
    endDate,
    durationDays,
  };
}

/**
 * Checks whether two inclusive date ranges overlap.
 * Overlap condition: startA <= endB AND endA >= startB
 */
export function doDateRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  return startA <= endB && endA >= startB;
}

/**
 * Calculates whether an active loan is overdue according to the business timezone.
 */
export function isLoanOverdue(
  dueDate: string,
  status: string,
  timezone: string = DEFAULT_TIMEZONE
): boolean {
  if (status !== "active") return false;
  const today = getTodayInTimezone(timezone);
  return dueDate < today;
}

