export const sensitiveReceiptKeyPattern = /(?:authorization|credential|secret|token|oauth|env|headers?|password|passwd|passphrase|api(?:[\s_-]?key)|private(?:[\s_-]?key)|cookie|session)/i;

type SensitiveTextRule = Readonly<{
  source: string;
  flags: string;
  replacement: string;
}>;

const sensitiveTextRules: readonly SensitiveTextRule[] = [
  { source: String.raw`(\bauthorization\b\s*[:=]\s*)(?!\[redacted\])(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;]+)`, flags: "gi", replacement: "$1[redacted]" },
  { source: String.raw`\bsk-[A-Za-z0-9][A-Za-z0-9_-]*\b`, flags: "gi", replacement: "[redacted]" },
  { source: String.raw`\b(?:gh[pousr]_[A-Za-z0-9][A-Za-z0-9_-]*|github_pat_[A-Za-z0-9][A-Za-z0-9_-]*)\b`, flags: "gi", replacement: "[redacted]" },
  { source: String.raw`\bxox[baprs]-[A-Za-z0-9-]+\b`, flags: "gi", replacement: "[redacted]" },
  { source: String.raw`\bAKIA[A-Z0-9]{16}\b`, flags: "g", replacement: "[redacted]" },
  { source: String.raw`((?:["']?\b(?:credential|token|secret|password|passwd|passphrase|api[\s_-]*key|private[\s_-]*key|oauth[\s_-]*token|cookie|session)\b["']?)\s*[:=]\s*)(?!\[redacted\])(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)`, flags: "gi", replacement: "$1[redacted]" },
  { source: String.raw`\b(?:canary[-_][A-Za-z0-9_-]+|[A-Za-z0-9_-]+[-_]canary[-_][A-Za-z0-9_-]+)\b`, flags: "gi", replacement: "[redacted]" },
  { source: String.raw`\/Users\/[^/\s]+\/`, flags: "g", replacement: "[home]/" },
  { source: String.raw`\/(?:private\/)?tmp\/[A-Za-z0-9._/-]+`, flags: "g", replacement: "[temporary-path]" }
] as const;

export function sanitizeReceiptValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeReceiptValue);
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      sensitiveReceiptKeyPattern.test(key) ? "[redacted]" : sanitizeReceiptValue(item)
    ]));
  }
  return value;
}

export function containsSensitiveText(value: string): boolean {
  return sensitiveTextRules.some((rule) =>
    new RegExp(rule.source, rule.flags.replace("g", "")).test(value)
  );
}

function redactSensitiveText(value: string): string {
  return sensitiveTextRules.reduce(
    (sanitized, rule) => sanitized.replace(new RegExp(rule.source, rule.flags), rule.replacement),
    value
  );
}
