import { convexTest } from "convex-test";
import schema from "../../convex/schema";

/** Lazy-loaded Convex modules for convex-test (matches production import graph). */
export const convexTestModules = import.meta.glob("../../convex/**/*.ts", { eager: false });

export function createConvexTest() {
  return convexTest(schema, convexTestModules);
}

export type ConvexTestInstance = ReturnType<typeof createConvexTest>;
