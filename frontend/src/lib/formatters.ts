// Formatting utility functions extracted from page.tsx

export function formatPrice(p: number) {
  return "£" + p.toLocaleString("en-GB");
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function yearsMonths(from: Date, to: Date): string {
  let y = to.getFullYear() - from.getFullYear();
  let m = to.getMonth() - from.getMonth();
  if (m < 0) { y--; m += 12; }
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} yr${y !== 1 ? "s" : ""}`);
  if (m > 0) parts.push(`${m} mo`);
  return parts.length ? parts.join(" ") : "< 1 month";
}

export function fmtK(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`;
  return `£${Math.round(n / 1000)}k`;
}

export function fmtPsf(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}/sqft`;
}

export function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}
