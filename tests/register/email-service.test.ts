import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEmailServiceConfig,
  getEmailStatus,
  sendMailMessage,
  formatEmailTrackingError,
  sendTrackedEmail,
} from "../../convex/email/emailService";
import {
  buildApplicationConfirmationEmailContent,
  buildOtpEmailContent,
  buildPasswordResetEmailContent,
} from "../../convex/email/templates";

describe("buildApplicationConfirmationEmailContent", () => {
  it("uses the journey template with applicant name and submission time", () => {
    const content = buildApplicationConfirmationEmailContent({
      applicantName: "Aroudra Syamantak",
      submittedAt: Date.parse("2026-09-21T22:06:00.000Z"),
      hackathonName: "HackUTA 2026",
    });

    expect(content.subject).toBe("HackUTA 2026 application received");
    expect(content.text).toContain("Hi Aroudra Syamantak,");
    expect(content.text).toContain("officially begun its journey");
    expect(content.text).toContain("Application submitted: September 21, 2026");
    expect(content.text).toContain("https://hackuta.com");
    expect(content.text).toContain("With excitement,");
    expect(content.text).toContain("The HackUTA Team");
    expect(content.text).not.toContain("profile");
    expect(content.html).not.toContain("applicant profile");
    expect(content.html).toContain("https://hackuta.com");
  });

  it("falls back to neutral copy when the name or hackathon name is blank", () => {
    const content = buildApplicationConfirmationEmailContent({
      applicantName: "   ",
      submittedAt: Date.parse("2026-09-21T22:06:00.000Z"),
      hackathonName: " ",
    });
    expect(content.text).toContain("Hi there,");
    expect(content.subject).toBe("HackUTA application received");
  });
});

describe("buildOtpEmailContent", () => {
  it("includes the code and expiry guidance without leaking secrets", () => {
    const content = buildOtpEmailContent("042681");
    expect(content.text).toContain("042681");
    expect(content.text).toContain("10 minutes");
    expect(content.subject).toBe("Your HackUTA verification code");
  });
});

describe("buildPasswordResetEmailContent", () => {
  it("includes reset-specific copy and expiry guidance", () => {
    const content = buildPasswordResetEmailContent("042681");
    expect(content.text).toContain("042681");
    expect(content.text).toContain("password reset");
    expect(content.text).toContain("10 minutes");
    expect(content.subject).toBe("Your HackUTA password reset code");
  });
});

const SERVICE_URL = "https://emailservice.example.test";
const API_KEY = "test-api-key-123";

function stubServiceEnv(url = SERVICE_URL, apiKey = API_KEY) {
  vi.stubEnv("EMAIL_SERVICE_URL", url);
  vi.stubEnv("EMAIL_SERVICE_API_KEY", apiKey);
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the promise to reject.");
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getEmailServiceConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires both the service URL and API key", () => {
    vi.stubEnv("EMAIL_SERVICE_URL", "");
    vi.stubEnv("EMAIL_SERVICE_API_KEY", "");
    expect(() => getEmailServiceConfig()).toThrow("Email is not configured.");

    stubServiceEnv(SERVICE_URL, "   ");
    expect(() => getEmailServiceConfig()).toThrow("Email is not configured.");

    stubServiceEnv("", API_KEY);
    expect(() => getEmailServiceConfig()).toThrow("Email is not configured.");
  });

  it("rejects malformed URLs and plain HTTP to remote hosts", () => {
    stubServiceEnv("not a url");
    expect(() => getEmailServiceConfig()).toThrow("Email is not configured.");

    stubServiceEnv("http://emailservice.example.test");
    expect(() => getEmailServiceConfig()).toThrow("Email is not configured.");

    stubServiceEnv("ftp://emailservice.example.test");
    expect(() => getEmailServiceConfig()).toThrow("Email is not configured.");
  });

  it("accepts HTTPS URLs and strips trailing slashes", () => {
    stubServiceEnv(`  ${SERVICE_URL}//  `, `  ${API_KEY}  `);
    expect(getEmailServiceConfig()).toEqual({ url: SERVICE_URL, apiKey: API_KEY });
  });

  it("allows plain HTTP only for a local test service", () => {
    stubServiceEnv("http://127.0.0.1:4010");
    expect(getEmailServiceConfig().url).toBe("http://127.0.0.1:4010");

    stubServiceEnv("http://localhost:4010/");
    expect(getEmailServiceConfig().url).toBe("http://localhost:4010");
  });
});

describe("sendMailMessage", () => {
  const message = {
    to: "applicant@example.com",
    subject: "Your HackUTA verification code",
    text: "Your code is 042681",
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubServiceEnv();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the plain-text body to /send-email and returns the queue ID", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "912a97ef-229f-459f-981b-e7d1e9482800" }, 201));

    await expect(sendMailMessage(message)).resolves.toEqual({
      id: "912a97ef-229f-459f-981b-e7d1e9482800",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${SERVICE_URL}/send-email`);
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      email: "applicant@example.com",
      api_key: API_KEY,
      subject: "Your HackUTA verification code",
      body: "Your code is 042681",
    });
  });

  it("includes the optional note when provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "queued-1" }, 201));

    await sendMailMessage({ ...message, note: "otp" });

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ note: "otp" });
  });

  it("reports a rejected API key without echoing it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));

    const error = await rejectionOf(sendMailMessage(message));
    expect(error.message).toBe("Email service rejected the API key.");
    expect(error.message).not.toContain(API_KEY);
  });

  it("surfaces the service's error text and status for other failures", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "email is required" }, 400));

    const error = await rejectionOf(sendMailMessage(message));
    expect(error.message).toBe("Email service error (HTTP 400): email is required");
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain("042681");
  });

  it("handles non-JSON error responses", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));

    await expect(sendMailMessage(message)).rejects.toThrow(
      "Email service error (HTTP 502): unknown error",
    );
  });

  it("treats a success response without an ID as a failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, 200));
    await expect(sendMailMessage(message)).rejects.toThrow(
      "Email service response did not include an email ID.",
    );

    fetchMock.mockResolvedValue(jsonResponse({ id: "   " }, 201));
    await expect(sendMailMessage(message)).rejects.toThrow(
      "Email service response did not include an email ID.",
    );
  });

  it("times out after 10 seconds", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    fetchMock.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    await expect(sendMailMessage(message)).rejects.toThrow("Email service timed out.");
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it("reports network failures separately from timeouts", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(sendMailMessage(message)).rejects.toThrow("Email service is unreachable.");
  });

  it("does not call the service when it is not configured", async () => {
    vi.stubEnv("EMAIL_SERVICE_API_KEY", "");

    await expect(sendMailMessage(message)).rejects.toThrow("Email is not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getEmailStatus", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubServiceEnv();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the service's status for a queue ID", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "queued-1", status: "success" }, 200));

    await expect(getEmailStatus("queued-1")).resolves.toEqual({ id: "queued-1", status: "success" });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${SERVICE_URL}/email-status?id=queued-1`);
  });

  it("surfaces unknown IDs and malformed responses as errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "email not found" }, 404));
    await expect(getEmailStatus("missing")).rejects.toThrow(
      "Email service error (HTTP 404): email not found",
    );

    fetchMock.mockResolvedValue(jsonResponse({ id: "queued-1" }, 200));
    await expect(getEmailStatus("queued-1")).rejects.toThrow(
      "Email service response did not include a status.",
    );
  });
});

describe("formatEmailTrackingError", () => {
  it("returns trimmed Error messages capped at 500 characters", () => {
    expect(formatEmailTrackingError(new Error("  database unavailable  "))).toBe(
      "database unavailable",
    );
    expect(formatEmailTrackingError(new Error("x".repeat(600)))).toHaveLength(500);
  });

  it("falls back to a generic message for non-Error values", () => {
    expect(formatEmailTrackingError("boom")).toBe("unknown error");
    expect(formatEmailTrackingError(new Error("   "))).toBe("unknown error");
  });
});

describe("sendTrackedEmail", () => {
  const message = {
    to: "applicant@example.com",
    subject: "Your HackUTA verification code",
    text: "Your code is 042681",
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  const fakeCtx = (runMutation: ReturnType<typeof vi.fn>) =>
    ({ runMutation }) as unknown as Parameters<typeof sendTrackedEmail>[0];

  beforeEach(() => {
    stubServiceEnv();
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "queued-1" }, 201));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("tags the email with its kind and records the queue ID", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);

    await expect(sendTrackedEmail(fakeCtx(runMutation), "otp", message)).resolves.toEqual({
      id: "queued-1",
    });

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ note: "otp" });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      serviceId: "queued-1",
      kind: "otp",
      recipient: "applicant@example.com",
    });
  });

  it("persists a durable tracking failure without failing the queued email", async () => {
    const runMutation = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(null);
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendTrackedEmail(fakeCtx(runMutation), "otp", message)).resolves.toEqual({
      id: "queued-1",
    });

    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[1]![1]).toEqual({
      serviceId: "queued-1",
      kind: "otp",
      recipient: "applicant@example.com",
      errorMessage: "database unavailable",
    });
    expect(logError).toHaveBeenCalledWith(
      "Failed to record email delivery queued-1 (otp): database unavailable",
    );
    const logged = logError.mock.calls.flat().join(" ");
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain("042681");
  });

  it("logs again when the durable tracking failure row cannot be saved", async () => {
    const runMutation = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendTrackedEmail(fakeCtx(runMutation), "otp", message)).resolves.toEqual({
      id: "queued-1",
    });

    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError.mock.calls[1]![0]).toBe(
      "Failed to persist email delivery recording failure for queued-1 (otp): database unavailable",
    );
  });

  it("does not record anything when the send fails", async () => {
    const runMutation = vi.fn();
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));

    await expect(sendTrackedEmail(fakeCtx(runMutation), "otp", message)).rejects.toThrow(
      "Email service rejected the API key.",
    );
    expect(runMutation).not.toHaveBeenCalled();
  });
});
