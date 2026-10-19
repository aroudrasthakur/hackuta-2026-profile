import { describe, expect, it } from "vitest";
import {
  assertSafePlainText,
  containsCrlf,
  containsDangerousMarkup,
  sanitizeEmailHeaderValue,
  sanitizePlainText,
} from "../../shared/lib/sanitizeInput";
import { isValidEmailSyntax, normalizeEmail } from "../../shared/lib/normalizeEmail";
import { registrationPayloadSchema } from "../../shared/registration/schema";
import { validRegistrationForm } from "../fixtures/validRegistrationForm";
import { validateApplicationForm } from "../../shared/registration/validation";

describe("sanitizeInput", () => {
  it("strips control characters and normalizes whitespace", () => {
    expect(sanitizePlainText("  Sam\u0000 Test  ")).toBe("Sam Test");
  });

  it("detects HTML and script injection patterns", () => {
    expect(containsDangerousMarkup("<script>alert(1)</script>")).toBe(true);
    expect(containsDangerousMarkup("javascript:alert(1)")).toBe(true);
    expect(containsDangerousMarkup("plain text")).toBe(false);
  });

  it("rejects unsafe plain text", () => {
    expect(assertSafePlainText("<img onerror=alert(1)>")).toBeNull();
    expect(assertSafePlainText("Sam Test")).toBe("Sam Test");
  });

  it("sanitizes email header values", () => {
    expect(sanitizeEmailHeaderValue("  Question about HackUTA  ", 150)).toBe(
      "Question about HackUTA",
    );
    expect(() => sanitizeEmailHeaderValue("<script>", 150)).toThrow();
  });

  it("collapses tabs and line breaks into single spaces without leading spaces", () => {
    expect(sanitizePlainText("\r\n\tSam\r\n\r\nTest\t")).toBe("Sam Test");
    expect(sanitizePlainText("Sam \nTest")).toBe("Sam Test");
  });

  it("keeps line breaks when newlines are allowed but still strips control characters", () => {
    expect(sanitizePlainText("line one\nline\u0007 two\u007f", { allowNewlines: true })).toBe(
      "line one\nline two",
    );
  });

  it("applies NFKC normalization so look-alike characters cannot bypass checks", () => {
    expect(sanitizePlainText("Ｓam")).toBe("Sam");
    expect(containsDangerousMarkup(sanitizePlainText("＜script＞"))).toBe(true);
  });

  it("detects inline event handlers", () => {
    expect(containsDangerousMarkup("x onclick = steal()")).toBe(true);
    expect(containsDangerousMarkup("JavaScript :void(0)")).toBe(true);
  });

  it("detects CR and LF characters", () => {
    expect(containsCrlf("a\rb")).toBe(true);
    expect(containsCrlf("a\nb")).toBe(true);
    expect(containsCrlf("a\tb")).toBe(false);
  });

  it("truncates email header values to the max length after stripping injection", () => {
    expect(sanitizeEmailHeaderValue("Subject\r\nBcc: victim@example.com", 12)).toBe("Subject Bcc:");
  });

  describe("assertSafePlainText", () => {
    it("rejects input that is entirely control characters", () => {
      expect(assertSafePlainText("\u0000\u0001\u0002")).toBeNull();
    });

    it("returns an empty string for genuinely blank input", () => {
      expect(assertSafePlainText("   ")).toBe("");
    });

    it("rejects line breaks unless explicitly allowed", () => {
      expect(assertSafePlainText("first\nsecond")).toBeNull();
      expect(assertSafePlainText("first\nsecond", { allowNewlines: true })).toBe("first\nsecond");
    });

    it("rejects markup even when newlines are allowed", () => {
      expect(assertSafePlainText("hi\n<a href=x>", { allowNewlines: true })).toBeNull();
    });
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, returning undefined for empty input", () => {
    expect(normalizeEmail("  Sam@Example.COM ")).toBe("sam@example.com");
    expect(normalizeEmail("   ")).toBeUndefined();
    expect(normalizeEmail(null)).toBeUndefined();
    expect(normalizeEmail(undefined)).toBeUndefined();
  });

  it("validates email syntax including the RFC length ceiling", () => {
    expect(isValidEmailSyntax("sam@example.com")).toBe(true);
    expect(isValidEmailSyntax("sam@example")).toBe(false);
    expect(isValidEmailSyntax("sam example@x.com")).toBe(false);
    const local = "a".repeat(64);
    const domain = `${"b".repeat(185)}.com`;
    expect(isValidEmailSyntax(`${local}@${domain}`)).toBe(true);
    expect(`${local}@${domain}`).toHaveLength(254);
    expect(isValidEmailSyntax(`${local}@b${domain}`)).toBe(false);
  });
});

describe("server-side XSS validation integration", () => {
  it("rejects HTML in registration names", () => {
    const form = validRegistrationForm();
    form.firstName = "<script>alert(1)</script>";

    const result = validateApplicationForm(form);
    expect(result.success).toBe(false);
  });

  it("rejects HTML in registration payload schema", () => {
    const form = validRegistrationForm();
    const candidate = {
      ...form,
      firstName: "<b>Evil</b>",
      age: Number(form.age),
      graduationYear: Number(form.graduationYear),
      major: form.major,
      mlhCodeOfConductAgreed: true as const,
      mlhDataSharingConsent: true as const,
    };

    const result = registrationPayloadSchema.safeParse(candidate);
    expect(result.success).toBe(false);
  });

});
