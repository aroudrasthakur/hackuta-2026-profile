import { adminError } from "./errors";

/** Most units of one item a volunteer can sell in a single purchase. */
export const SHOP_MAX_QUANTITY = 10;
export const SHOP_NAME_MAX_LENGTH = 80;
export const SHOP_DESCRIPTION_MAX_LENGTH = 500;
export const SHOP_REASON_MAX_LENGTH = 200;
export const FLASH_SALE_TITLE_MAX_LENGTH = 80;
export const FLASH_SALE_MESSAGE_MAX_LENGTH = 300;
export const FLASH_SALE_MAX_ITEMS = 50;
export const SHOP_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const SHOP_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

export type ShopItemInput = {
  name: string;
  description: string;
  pointsCost: number;
};

export type FlashSaleInput = {
  title: string;
  message: string;
  startsAt: number;
  endsAt: number;
  items: Array<{ itemId: string; salePointsCost: number }>;
};

function trimmedText(value: unknown, maxLength: number, allowEmpty: boolean) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || trimmed.length > maxLength) return null;
  return trimmed;
}

/** Price per unit: whole number above zero. */
export function assertPointsCost(points: number): number {
  if (!Number.isSafeInteger(points) || points <= 0) {
    throw adminError("INVALID_SHOP_ITEM");
  }
  return points;
}

/** Units in one purchase: 1 to `SHOP_MAX_QUANTITY`. */
export function isValidPurchaseQuantity(quantity: number) {
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= SHOP_MAX_QUANTITY;
}

/** Client-made key for one purchase attempt (a UUID fits). */
export function isValidIdempotencyKey(key: string) {
  return typeof key === "string" && IDEMPOTENCY_KEY_PATTERN.test(key);
}

/** Trims item fields. Name is required; description may be empty. */
export function normalizeShopItemInput(input: ShopItemInput) {
  const name = trimmedText(input.name, SHOP_NAME_MAX_LENGTH, false);
  const description = trimmedText(input.description, SHOP_DESCRIPTION_MAX_LENGTH, true);
  if (name === null || description === null) {
    throw adminError("INVALID_SHOP_ITEM");
  }
  return { name, description, pointsCost: assertPointsCost(input.pointsCost) };
}

/** Trims a required audit reason for refunds. */
export function normalizeShopReason(reason: string): string {
  const trimmed = trimmedText(reason, SHOP_REASON_MAX_LENGTH, false);
  if (trimmed === null) {
    throw adminError("INVALID_SHOP_REASON");
  }
  return trimmed;
}

/** Checks sale text, window, and item list. Prices against base cost are checked by the caller. */
export function normalizeFlashSaleInput<T extends FlashSaleInput>(input: T) {
  const title = trimmedText(input.title, FLASH_SALE_TITLE_MAX_LENGTH, false);
  const message = trimmedText(input.message, FLASH_SALE_MESSAGE_MAX_LENGTH, true);
  if (title === null || message === null) {
    throw adminError("INVALID_FLASH_SALE");
  }
  if (
    !Number.isSafeInteger(input.startsAt) ||
    !Number.isSafeInteger(input.endsAt) ||
    input.startsAt >= input.endsAt
  ) {
    throw adminError("INVALID_FLASH_SALE");
  }
  const seen = new Set<string>();
  if (input.items.length === 0 || input.items.length > FLASH_SALE_MAX_ITEMS) {
    throw adminError("INVALID_FLASH_SALE");
  }
  for (const item of input.items) {
    if (seen.has(item.itemId) || !Number.isSafeInteger(item.salePointsCost) || item.salePointsCost <= 0) {
      throw adminError("INVALID_FLASH_SALE");
    }
    seen.add(item.itemId);
  }
  return { title, message, startsAt: input.startsAt, endsAt: input.endsAt, items: input.items as T["items"] };
}
