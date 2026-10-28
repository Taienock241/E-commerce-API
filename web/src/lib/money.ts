export const CURRENCY = "USD";

export function formatMoney(cents: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY }).format(cents / 100);
}

export function currencyUnitsToCents(value: string | number) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid non-negative price");
  return Math.round(amount * 100);
}
