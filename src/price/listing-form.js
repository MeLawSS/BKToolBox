export const DEFAULT_LISTING_PRICE_PERCENT = 98;

export function parseListingDefaultPricePercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent <= 0) return DEFAULT_LISTING_PRICE_PERCENT;
  return percent;
}

export function computeDefaultUnitPrice(minPrice, percent = DEFAULT_LISTING_PRICE_PERCENT) {
  const min = Number(minPrice);
  if (!Number.isFinite(min) || min <= 0) return null;
  const scaled = Math.floor((min * parseListingDefaultPricePercent(percent)) / 100);
  return Math.max(scaled, 1);
}

export function computeTotal({ count, unitPrice }) {
  const c = Number(count);
  const p = Number(unitPrice);
  if (!Number.isInteger(c) || !Number.isInteger(p)) return null;
  if (c < 1 || p < 1) return null;
  return c * p;
}

export function validateListing({ count, unitPrice, ownedCount }) {
  const c = Number(count);
  const p = Number(unitPrice);
  const owned = Number(ownedCount);
  const errors = {};
  if (!Number.isInteger(c) || c < 1 || (Number.isFinite(owned) && c > owned)) {
    errors.count = true;
  }
  if (!Number.isInteger(p) || p < 1) {
    errors.unitPrice = true;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}
