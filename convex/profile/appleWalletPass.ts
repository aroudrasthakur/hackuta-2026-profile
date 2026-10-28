"use node";

import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { action } from "../_generated/server";
import type {
  AppleWalletPassDataInput,
  AppleWalletPassLookupResult,
} from "./appleWalletPassData";

export const APPLE_WALLET_PASS_MIME_TYPE = "application/vnd.apple.pkpass";
export const APPLE_WALLET_PASS_FILENAME = "hackuta-2026-checkin.pkpass";
export const WALLET_SERVICE_MIN_API_KEY_LENGTH = 32;
const ATTENDEE_NAME_MAX_LENGTH = 80;
const PASS_STORAGE_TTL_MS = 60_000;
const WALLET_SERVICE_TIMEOUT_MS = 15_000;

export type WalletServiceConfig = {
  baseUrl: string;
  apiKey: string;
};

export type WalletServicePassRequest = {
  serialNumber: string;
  attendeeName: string;
  qrToken: string;
};

export type GenerateAppleWalletPassResult =
  | {
      ok: true;
      passUrl: string | null;
      pkpassBase64: string;
      filename: string;
      serialNumber: string;
    }
  | {
      ok: false;
      code:
        | "unauthenticated"
        | "not_eligible"
        | "already_checked_in"
        | "not_configured"
        | "signing_failed";
      message: string;
    };

const getMyAppleWalletPassInputRef = makeFunctionReference<
  "query",
  Record<string, never>,
  AppleWalletPassLookupResult
>("profile/appleWalletPassData:getMyAppleWalletPassInput");

const deleteAppleWalletPassFileRef = makeFunctionReference<
  "mutation",
  { storageId: GenericId<"_storage"> },
  null
>("profile/appleWalletPassData:deleteAppleWalletPassFile");

/** Reads the wallet-service base URL and API key from server-side environment variables. */
export function readWalletServiceConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WalletServiceConfig | null {
  const baseUrl = (env.WALLET_SERVICE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (env.WALLET_SERVICE_API_KEY ?? "").trim();
  if (!baseUrl || apiKey.length < WALLET_SERVICE_MIN_API_KEY_LENGTH) {
    return null;
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return null;
  }
  return { baseUrl, apiKey };
}

/** Maps eligibility data to the wallet-service generate-pass JSON body. */
export function toWalletServicePassRequest(
  passInput: AppleWalletPassDataInput,
): WalletServicePassRequest {
  return {
    serialNumber: passInput.serialNumber,
    attendeeName: passInput.displayName.trim().slice(0, ATTENDEE_NAME_MAX_LENGTH) || "Participant",
    qrToken: passInput.qrCodeToken,
  };
}

function signingUnavailableMessage() {
  return "Apple Wallet passes are not available right now. Please use the QR code above.";
}

function signingFailedMessage() {
  return "We could not generate your Apple Wallet pass. Please try again or use the QR code above.";
}

async function requestSignedPkpass(
  config: WalletServiceConfig,
  passInput: AppleWalletPassDataInput,
): Promise<
  { ok: true; buffer: Buffer } | { ok: false; code: "not_configured" | "signing_failed" }
> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/passes/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: APPLE_WALLET_PASS_MIME_TYPE,
      },
      body: JSON.stringify(toWalletServicePassRequest(passInput)),
      signal: AbortSignal.timeout(WALLET_SERVICE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, code: "signing_failed" };
  }

  if (response.status === 503) {
    return { ok: false, code: "not_configured" };
  }

  if (!response.ok) {
    return { ok: false, code: "signing_failed" };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    return { ok: false, code: "signing_failed" };
  }

  return { ok: true, buffer };
}

/**
 * Fetches a signed Apple Wallet `.pkpass` from the wallet service for the
 * authenticated, accepted, pre-check-in participant. The browser never calls
 * the signer or supplies IDs, names, or QR tokens.
 */
export const generateMyAppleWalletPass = action({
  args: {},
  handler: async (ctx): Promise<GenerateAppleWalletPassResult> => {
    const lookup = await ctx.runQuery(getMyAppleWalletPassInputRef, {});

    if (lookup.status === "unauthenticated") {
      return {
        ok: false,
        code: "unauthenticated",
        message: "Sign in to add your check-in pass to Apple Wallet.",
      };
    }

    if (lookup.status === "already_checked_in") {
      return {
        ok: false,
        code: "already_checked_in",
        message:
          "You have already checked in. Your physical HackUTA badge is now your event pass.",
      };
    }

    if (lookup.status !== "ok") {
      return {
        ok: false,
        code: "not_eligible",
        message: "Your check-in pass is not available for Apple Wallet.",
      };
    }

    const config = readWalletServiceConfigFromEnv();
    if (!config) {
      return {
        ok: false,
        code: "not_configured",
        message: signingUnavailableMessage(),
      };
    }

    const signed = await requestSignedPkpass(config, lookup.passInput);
    if (!signed.ok) {
      return {
        ok: false,
        code: signed.code,
        message:
          signed.code === "not_configured"
            ? signingUnavailableMessage()
            : signingFailedMessage(),
      };
    }

    let passUrl: string | null = null;
    try {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array(signed.buffer)], {
          type: APPLE_WALLET_PASS_MIME_TYPE,
        }),
      );
      passUrl = await ctx.storage.getUrl(storageId);
      await ctx.scheduler.runAfter(PASS_STORAGE_TTL_MS, deleteAppleWalletPassFileRef, {
        storageId,
      });
    } catch {
      // Storage URL is optional when base64 fallback is used.
    }

    return {
      ok: true,
      passUrl,
      pkpassBase64: signed.buffer.toString("base64"),
      filename: APPLE_WALLET_PASS_FILENAME,
      serialNumber: lookup.passInput.serialNumber,
    };
  },
});
