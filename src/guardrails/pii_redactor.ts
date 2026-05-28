/**
 * PII Redactor — regex-based, no LLM call, runs in microseconds.
 *
 * Detects and replaces common PII patterns:
 *   email, US phone, SSN, credit card numbers, IPv4 addresses
 *
 * Applied to both input (before orchestrator) and output (before streaming).
 */

export interface PiiMatch {
  type: string;
  original: string;
  placeholder: string;
}

export interface RedactionResult {
  text: string;          // sanitized text
  findings: PiiMatch[];  // what was redacted
  changed: boolean;
}

const PATTERNS: Array<{ type: string; placeholder: string; regex: RegExp }> = [
  {
    type: "email",
    placeholder: "[EMAIL]",
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  },
  {
    type: "phone_us",
    placeholder: "[PHONE]",
    // Matches: (123) 456-7890 | 123-456-7890 | 123.456.7890 | +1 123 456 7890
    regex: /(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g,
  },
  {
    type: "ssn",
    placeholder: "[SSN]",
    regex: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,
  },
  {
    type: "credit_card",
    placeholder: "[CREDIT_CARD]",
    // 13-19 digit sequences with optional spaces/dashes (Luhn not checked — too noisy)
    regex: /\b(?:\d[ \-]?){13,19}\b/g,
  },
  {
    type: "ipv4",
    placeholder: "[IP_ADDRESS]",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  },
  {
    type: "api_key",
    placeholder: "[API_KEY]",
    // Generic bearer/secret-looking tokens: sk-..., pk-..., key-..., Bearer abc123...
    regex: /\b(?:sk|pk|api|key|secret|token|bearer)[-_][A-Za-z0-9\-_]{16,}/gi,
  },
];

export function redact(text: string): RedactionResult {
  const findings: PiiMatch[] = [];
  let sanitized = text;

  for (const { type, placeholder, regex } of PATTERNS) {
    // Reset lastIndex for global regexes
    regex.lastIndex = 0;
    const matches = sanitized.match(regex);
    if (!matches) continue;

    for (const match of matches) {
      findings.push({ type, original: match, placeholder });
    }
    sanitized = sanitized.replace(regex, placeholder);
  }

  return {
    text: sanitized,
    findings,
    changed: findings.length > 0,
  };
}
