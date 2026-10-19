import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

const signIn = makeFunctionReference<"action">("auth:signIn");

describe("auth", () => {
  it("exports the email sign-in action reference", () => {
    expect(signIn).toBeDefined();
  });
});
