// Shared field-level validators. Each returns true for an empty value too —
// callers are expected to check "required" separately — so these only judge
// whether whatever WAS typed is the right kind of value.

// Letters, spaces, and the punctuation real names/titles use (Dr. O'Brien-Smith).
const TEXT_PATTERN = /^[A-Za-z][A-Za-z\s.'-]*$/;

// Digits with common phone formatting: spaces, hyphens, an optional leading +.
const NUMERIC_PATTERN = /^\+?[0-9][0-9\s-]*$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidText(value) {
  const v = (value ?? '').trim();
  return v === '' || TEXT_PATTERN.test(v);
}

export function isValidNumeric(value) {
  const v = (value ?? '').trim();
  return v === '' || NUMERIC_PATTERN.test(v);
}

export function isValidEmail(value) {
  const v = (value ?? '').trim();
  return v === '' || EMAIL_PATTERN.test(v);
}
