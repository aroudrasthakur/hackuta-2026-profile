import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  PASSWORD_REQUIREMENTS_MESSAGE,
  validatePasswordConfirmation,
  validatePasswordRequirements,
} from "../../../shared/auth/password";
import {
  PASSWORD_RESET_FAILED_MESSAGE,
  PASSWORD_RESET_HOURLY_LIMIT_MESSAGE,
  PASSWORD_RESET_REQUESTED_MESSAGE,
  PASSWORD_RESET_SUCCESS_MESSAGE,
} from "../../../shared/auth/passwordResetMessages";
import {
  cooldownStatusFromExpiry,
  formatOtpResendLabel,
  getCooldownWaitSeconds,
  mergeCooldownExpiry,
  OTP_RESEND_COOLDOWN_SECONDS,
  startCooldownExpiry,
} from "../../../shared/auth/otpRateLimit";
import { mapPasswordResetError, OTP_INVALID_MESSAGE } from "../../../shared/auth/errorMessages";
import { isValidEmailSyntax, normalizeEmail } from "../../../shared/lib/normalizeEmail";
import { OtpCodeInput } from "../../components/OtpCodeInput";
import { SignInPasswordInput } from "../../components/SignInPasswordInput";
import { SignInShell } from "../../components/SignInShell";
import { MOCK_OTP } from "../../constants/mockAuth";
import {
  assertResetCodeAvailableRef,
  getPasswordResetSendCooldownRef,
} from "../../convex/api";
import { getConvexClient } from "../../convex/client";
import { useMockAuth } from "../../hooks/useMockAuth";

type ForgotPasswordStep = "email" | "verify" | "password";

type ConvexPasswordSignIn = (
  provider: string,
  formData: FormData,
) => Promise<{ signingIn: boolean }>;

type ForgotPasswordFlowProps = {
  convexSignIn: ConvexPasswordSignIn | null;
  convexSignOut: (() => Promise<void>) | null;
  invalidateSessions: (() => Promise<void>) | null;
  onComplete: (message: string) => void;
  onCancel: () => void;
};

export function ForgotPasswordFlow({
  convexSignIn,
  convexSignOut,
  invalidateSessions,
  onComplete,
  onCancel,
}: ForgotPasswordFlowProps) {
  const mockAuth = useMockAuth();
  const client = getConvexClient();

  const [step, setStep] = useState<ForgotPasswordStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [cooldownExpiresAt, setCooldownExpiresAt] = useState<number | null>(null);
  const [hourlyLimitReached, setHourlyLimitReached] = useState(false);
  const [cooldownTick, setCooldownTick] = useState(0);

  const cooldown = cooldownStatusFromExpiry(cooldownExpiresAt, hourlyLimitReached);

  useEffect(() => {
    if (getCooldownWaitSeconds(cooldownExpiresAt) <= 0) return;
    const timer = window.setTimeout(() => setCooldownTick((value) => value + 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownExpiresAt, cooldownTick]);

  const fetchResetCooldown = useCallback(async (normalized: string) => {
    if (mockAuth.enabled || !client) {
      return { waitSeconds: 0, hourlyLimitReached: false };
    }
    try {
      return await client.mutation(getPasswordResetSendCooldownRef, { email: normalized });
    } catch {
      return { waitSeconds: 0, hourlyLimitReached: false };
    }
  }, [client, mockAuth.enabled]);

  const requestResetCode = useCallback(
    async (normalized: string) => {
      if (mockAuth.enabled) {
        setStep("verify");
        setCode("");
        setInfoMessage(PASSWORD_RESET_REQUESTED_MESSAGE);
        setCooldownExpiresAt(startCooldownExpiry(OTP_RESEND_COOLDOWN_SECONDS));
        return;
      }

      const formData = new FormData();
      formData.set("email", normalized);
      formData.set("flow", "reset");

      if (!convexSignIn) {
        throw new Error(PASSWORD_RESET_REQUESTED_MESSAGE);
      }

      // Existing and missing accounts both resolve without starting a session.
      // Show the same confirmation for either; only operational errors reject.
      await convexSignIn("password", formData);

      const status = await fetchResetCooldown(normalized);
      setHourlyLimitReached(status.hourlyLimitReached);
      setCooldownExpiresAt(mergeCooldownExpiry(null, status));
      if (!status.hourlyLimitReached) {
        setCooldownExpiresAt(startCooldownExpiry(OTP_RESEND_COOLDOWN_SECONDS));
      }

      setEmail(normalized);
      setStep("verify");
      setCode("");
      setInfoMessage(PASSWORD_RESET_REQUESTED_MESSAGE);
    },
    [convexSignIn, fetchResetCooldown, mockAuth.enabled],
  );

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const normalized = normalizeEmail(email);
    if (!normalized || !isValidEmailSyntax(normalized)) {
      setError("Please enter a valid email address.");
      return;
    }

    setPending(true);
    setError(null);
    setInfoMessage(null);

    try {
      await requestResetCode(normalized);
      setEmail(normalized);
    } catch (err) {
      setError(mapPasswordResetError(err));
    } finally {
      setPending(false);
    }
  };

  const handleVerifySubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const trimmedCode = code.trim();
    if (trimmedCode.length !== 6) {
      setError(OTP_INVALID_MESSAGE);
      return;
    }

    if (mockAuth.enabled && trimmedCode !== MOCK_OTP) {
      setError(OTP_INVALID_MESSAGE);
      return;
    }

    setPending(true);
    setError(null);

    try {
      if (!mockAuth.enabled) {
        const normalized = normalizeEmail(email);
        if (!client || !normalized) {
          throw new Error(PASSWORD_RESET_FAILED_MESSAGE);
        }
        const result = await client.mutation(assertResetCodeAvailableRef, {
          email: normalized,
          code: trimmedCode,
        });
        if (!result.ok) {
          throw new Error("Invalid code");
        }
      }
      setStep("password");
      setNewPassword("");
      setConfirmPassword("");
      setInfoMessage(null);
    } catch (err) {
      setError(mapPasswordResetError(err));
    } finally {
      setPending(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const normalized = normalizeEmail(email);
    const trimmedCode = code.trim();
    if (!normalized || trimmedCode.length !== 6) {
      setError(OTP_INVALID_MESSAGE);
      return;
    }

    try {
      validatePasswordRequirements(newPassword);
      validatePasswordConfirmation(newPassword, confirmPassword);
    } catch (err) {
      setError(mapPasswordResetError(err));
      return;
    }

    setPending(true);
    setError(null);

    try {
      if (mockAuth.enabled) {
        if (trimmedCode !== MOCK_OTP) {
          setError(OTP_INVALID_MESSAGE);
          return;
        }
        onComplete(PASSWORD_RESET_SUCCESS_MESSAGE);
        return;
      }

      const formData = new FormData();
      formData.set("email", normalized);
      formData.set("code", trimmedCode);
      formData.set("newPassword", newPassword);
      formData.set("flow", "reset-verification");

      if (!convexSignIn) {
        throw new Error(PASSWORD_RESET_SUCCESS_MESSAGE);
      }

      const result = await convexSignIn("password", formData);
      if (!result.signingIn) {
        setError(OTP_INVALID_MESSAGE);
        return;
      }

      if (invalidateSessions) {
        await invalidateSessions().catch(() => undefined);
      }
      if (convexSignOut) {
        await convexSignOut().catch(() => undefined);
      }

      onComplete(PASSWORD_RESET_SUCCESS_MESSAGE);
    } catch (err) {
      setError(mapPasswordResetError(err));
    } finally {
      setPending(false);
    }
  };

  const handleResendCode = async () => {
    if (pending || cooldown.waitSeconds > 0 || cooldown.hourlyLimitReached) return;

    const normalized = normalizeEmail(email);
    if (!normalized) return;

    setPending(true);
    setError(null);

    try {
      await requestResetCode(normalized);
    } catch (err) {
      setError(mapPasswordResetError(err));
    } finally {
      setPending(false);
    }
  };

  const shellTitle =
    step === "email"
      ? "Reset your password"
      : step === "verify"
        ? "Enter your reset code"
        : "Choose a new password";

  const shellSubtitle: ReactNode =
    step === "email" ? (
      "Enter the email address you used to create your account."
    ) : step === "verify" ? (
      <>
        Enter the 6-digit code from the reset email for{" "}
        <span className="sign-in-card__subtitle-email">{email}</span>.
      </>
    ) : (
      "Create a new password for your account."
    );

  const resendLabel = cooldown.hourlyLimitReached
    ? PASSWORD_RESET_HOURLY_LIMIT_MESSAGE
    : formatOtpResendLabel(cooldown.waitSeconds);

  return (
    <SignInShell title={shellTitle} subtitle={shellSubtitle}>
      {step === "email" ? (
        <form onSubmit={handleEmailSubmit} noValidate className="sign-in-form">
          <label className="sign-in-field" htmlFor="forgot-email">
            <span className="sign-in-field__label">Email</span>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
              className="sign-in-field__input"
              aria-invalid={!!error}
            />
          </label>

          {infoMessage ? (
            <p className="sign-in-message sign-in-message--info" role="status" aria-live="polite">
              {infoMessage}
            </p>
          ) : null}

          {error ? (
            <p className="sign-in-message sign-in-message--error" role="alert" aria-live="polite">
              {error}
            </p>
          ) : null}

          <button type="submit" className="sign-in-btn" disabled={pending}>
            {pending ? "Sending code…" : "Send code"}
          </button>

          <div className="sign-in-actions">
            <button
              type="button"
              className="sign-in-btn sign-in-btn--secondary"
              onClick={onCancel}
            >
              Back to sign in
            </button>
          </div>
        </form>
      ) : null}

      {step === "verify" ? (
        <form onSubmit={handleVerifySubmit} noValidate className="sign-in-form">
          {infoMessage ? (
            <p className="sign-in-message sign-in-message--info" role="status" aria-live="polite">
              {infoMessage}
            </p>
          ) : null}

          <OtpCodeInput
            value={code}
            onChange={setCode}
            disabled={pending}
            invalid={!!error}
          />

          {error ? (
            <p className="sign-in-message sign-in-message--error" role="alert" aria-live="polite">
              {error}
            </p>
          ) : null}

          <button type="submit" className="sign-in-btn" disabled={pending || code.length !== 6}>
            {pending ? "Checking code…" : "Continue"}
          </button>

          <div className="sign-in-otp__footer">
            <button
              type="button"
              className="sign-in-resend"
              disabled={pending || cooldown.waitSeconds > 0 || cooldown.hourlyLimitReached}
              onClick={() => void handleResendCode()}
            >
              {resendLabel}
            </button>
            <button
              type="button"
              className="sign-in-btn sign-in-btn--secondary"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
                setInfoMessage(null);
              }}
            >
              Change email
            </button>
          </div>
        </form>
      ) : null}

      {step === "password" ? (
        <form onSubmit={handlePasswordSubmit} noValidate className="sign-in-form">
          <div className="sign-in-field">
            <label className="sign-in-field__label" htmlFor="forgot-new-password">
              New password
            </label>
            <SignInPasswordInput
              id="forgot-new-password"
              autoComplete="new-password"
              placeholder="••••••••"
              required
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                setError(null);
              }}
              className="sign-in-field__input"
              aria-invalid={!!error}
            />
          </div>

          <div className="sign-in-field">
            <label className="sign-in-field__label" htmlFor="forgot-confirm-password">
              Confirm new password
            </label>
            <SignInPasswordInput
              id="forgot-confirm-password"
              autoComplete="new-password"
              placeholder="••••••••"
              required
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setError(null);
              }}
              className="sign-in-field__input"
              aria-invalid={!!error}
            />
          </div>

          <p className="sign-in-message">{PASSWORD_REQUIREMENTS_MESSAGE}</p>

          {error ? (
            <p className="sign-in-message sign-in-message--error" role="alert" aria-live="polite">
              {error}
            </p>
          ) : null}

          <button type="submit" className="sign-in-btn" disabled={pending}>
            {pending ? "Saving password…" : "Save new password"}
          </button>

          <div className="sign-in-actions">
            <button
              type="button"
              className="sign-in-btn sign-in-btn--secondary"
              onClick={() => {
                setStep("verify");
                setError(null);
              }}
            >
              Back to reset code
            </button>
          </div>
        </form>
      ) : null}
    </SignInShell>
  );
}
