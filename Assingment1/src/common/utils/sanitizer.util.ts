// ============================================================================
// [X2] CHALLENGE REQUIREMENT: Central Secret Redaction Utility
// Recursively sanitizes data structures to prevent leaking sensitive fields
// (password, token, authorization, secrets) in logs and error responses.
// ============================================================================

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /authorization/i,
  /secret/i,
  /cookie/i,
  /hash/i,
];

/**
 * Checks if an object key name matches known sensitive keywords.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Sanitizes sensitive key-value patterns inside strings (e.g. error messages, connection strings).
 */
export function sanitizeString(text: string): string {
  let sanitized = text;

  // Redact password=... or password: ...
  sanitized = sanitized.replace(
    /(password(?:_hash)?\s*[:=]\s*)([^\s,;&"']+)/gi,
    "$1[REDACTED]",
  );

  // Redact token=... or token: ...
  sanitized = sanitized.replace(
    /(token(?:_hash)?\s*[:=]\s*)([^\s,;&"']+)/gi,
    "$1[REDACTED]",
  );

  // Redact secret=... or secret: ...
  sanitized = sanitized.replace(
    /(secret\s*[:=]\s*)([^\s,;&"']+)/gi,
    "$1[REDACTED]",
  );

  // Redact Bearer tokens
  sanitized = sanitized.replace(/bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");

  return sanitized;
}

/**
 * Recursively redacts sensitive keys in objects, arrays, and strings.
 * Preserves object shape and structure while replacing sensitive values with "[REDACTED]".
 */
export function sanitizeData<T>(data: T, seen = new WeakSet()): T {
  if (data === null || data === undefined) {
    return data;
  }

  // If data is a string, sanitize sensitive key-value pairs or tokens within it
  if (typeof data === "string") {
    return sanitizeString(data) as unknown as T;
  }

  if (typeof data !== "object") {
    return data;
  }

  // Handle circular references
  if (seen.has(data as object)) {
    return "[CIRCULAR]" as unknown as T;
  }
  seen.add(data as object);

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      if (typeof value === "string" && /^bearer\s+/i.test(value)) {
        result[key] = "Bearer [REDACTED]";
      } else {
        result[key] = "[REDACTED]";
      }
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeData(value, seen);
    } else if (typeof value === "string") {
      result[key] = sanitizeData(value, seen);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
