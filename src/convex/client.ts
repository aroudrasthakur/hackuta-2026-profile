import { ConvexReactClient } from "convex/react";

export function normalizeConvexUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
}

const convexUrl = normalizeConvexUrl(import.meta.env.VITE_CONVEX_URL);

export const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function getConvexClient() {
  return convexClient;
}
