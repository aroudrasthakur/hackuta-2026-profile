// Setup for tests ported from hackuta-2026-register (see tests/register/README.md).
import { afterEach, vi } from "vitest";

// Scheduled confirmation emails call the email service. Answer it here so no
// test reaches a real server.
const passthroughFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const serviceUrl = process.env.EMAIL_SERVICE_URL;
  if (serviceUrl && url === `${serviceUrl}/send-email`) {
    return new Response(JSON.stringify({ id: "test-email-id" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }
  return passthroughFetch(input, init);
}) as typeof fetch;

afterEach(() => {
  vi.restoreAllMocks();
});
