import { describe, expect, it } from "vitest";
import { isValidEmailSyntax, normalizeEmail } from "../../shared/lib/normalizeEmail";

describe("normalizeEmail", () => {
  it("converts email to lowercase", () => {
    expect(normalizeEmail("TEST@EXAMPLE.COM")).toBe("test@example.com");
    expect(normalizeEmail("User@Example.Com")).toBe("user@example.com");
  });

  it("trims whitespace", () => {
    expect(normalizeEmail("  test@example.com  ")).toBe("test@example.com");
    expect(normalizeEmail("\ttest@example.com\n")).toBe("test@example.com");
  });

  it("returns undefined for empty/null/undefined inputs", () => {
    expect(normalizeEmail("")).toBeUndefined();
    expect(normalizeEmail(null)).toBeUndefined();
    expect(normalizeEmail(undefined)).toBeUndefined();
  });

  it("normalizes even invalid email formats", () => {
    // normalizeEmail doesn't validate, just normalizes
    expect(normalizeEmail("NOT-AN-EMAIL")).toBe("not-an-email");
    expect(normalizeEmail("INVALID")).toBe("invalid");
  });

  it("handles valid email formats", () => {
    expect(normalizeEmail("simple@example.com")).toBe("simple@example.com");
    expect(normalizeEmail("user.name@example.com")).toBe("user.name@example.com");
    expect(normalizeEmail("user+tag@example.com")).toBe("user+tag@example.com");
    expect(normalizeEmail("user_name@example.co.uk")).toBe("user_name@example.co.uk");
  });

  it("handles edge cases", () => {
    expect(normalizeEmail("a@b.c")).toBe("a@b.c");
    expect(normalizeEmail("test@sub.domain.example.com")).toBe("test@sub.domain.example.com");
  });
});

describe("isValidEmailSyntax", () => {
  it("validates correct email formats", () => {
    expect(isValidEmailSyntax("test@example.com")).toBe(true);
    expect(isValidEmailSyntax("user.name@example.com")).toBe(true);
    expect(isValidEmailSyntax("user+tag@example.com")).toBe(true);
    expect(isValidEmailSyntax("user@subdomain.example.com")).toBe(true);
  });

  it("rejects invalid email formats", () => {
    expect(isValidEmailSyntax("")).toBe(false);
    expect(isValidEmailSyntax("notanemail")).toBe(false);
    expect(isValidEmailSyntax("@example.com")).toBe(false);
    expect(isValidEmailSyntax("user@")).toBe(false);
    expect(isValidEmailSyntax("user @example.com")).toBe(false);
    expect(isValidEmailSyntax("user@example")).toBe(false);
  });

  it("handles whitespace", () => {
    // isValidEmailSyntax doesn't trim - it rejects emails with spaces
    expect(isValidEmailSyntax("test@example.com")).toBe(true);
    expect(isValidEmailSyntax("   ")).toBe(false);
    expect(isValidEmailSyntax(" test@example.com")).toBe(false);
    expect(isValidEmailSyntax("test@example.com ")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isValidEmailSyntax("Test@Example.COM")).toBe(true);
    expect(isValidEmailSyntax("USER@DOMAIN.COM")).toBe(true);
  });
});
