// Shared constants extracted from page.tsx

export const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export const FULL_POSTCODE_RE = /[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}/i;
