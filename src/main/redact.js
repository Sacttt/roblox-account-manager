'use strict';

// Anything that could let someone sign in as a user must never reach logs,
// diagnostics, or error messages shown in the UI.
const PATTERNS = [
  // Full .ROBLOSECURITY values always start with this warning banner.
  [/_\|WARNING:-DO-NOT-SHARE-THIS[^\s"';,]*/gi, '[REDACTED_COOKIE]'],
  [/(\.ROBLOSECURITY\s*=\s*)[^;\s"']+/gi, '$1[REDACTED]'],
  [/("?(?:roblosecurity|cookie|x-csrf-token|rbx-authentication-ticket|authorization)"?\s*[:=]\s*"?)[^"\s,;}]+/gi, '$1[REDACTED]'],
  // roblox-player: launch URIs embed a one-time sign-in ticket.
  [/(gameinfo:)[^+\s"']+/gi, '$1[REDACTED]'],
  [/(roblox-player:)[^\s"']+/gi, '$1[REDACTED]'],
  // Long opaque tokens (hex/base64-ish blobs) that slipped through.
  [/\b[A-F0-9]{200,}\b/gi, '[REDACTED_TOKEN]'],
];

function redact(value) {
  if (value === null || value === undefined) return value;
  let text = typeof value === 'string' ? value : safeStringify(value);
  for (const [re, repl] of PATTERNS) text = text.replace(re, repl);
  return text;
}

function safeStringify(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

module.exports = { redact };
