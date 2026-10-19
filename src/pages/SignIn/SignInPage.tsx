import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  PASSWORD_REQUIREMENTS_MESSAGE,
  validatePasswordConfirmation,
  validatePasswordRequirements,
} from "../../../shared/auth/password";
import {
  cooldownStatusFromExpiry,
  formatOtpResendLabel,
  getCooldownWaitSeconds,
  mergeCooldownExpiry,
  OTP_HOURLY_LIMIT_MESSAGE,
  OTP_RESEND_COOLDOWN_SECONDS,
  startCooldownExpiry,
} from "../../../shared/auth/otpRateLimit";
import {
  AUTH_FAILED_MESSAGE,
  mapAuthError,
  OTP_INVALID_MESSAGE,
} from "../../../shared/auth/errorMessages";
import { isValidEmailSyntax, normalizeEmail } from "../../../shared/lib/normalizeEmail";
import { OtpCodeInput } from "../../components/OtpCodeInput";
import { SignInPasswordInput } from "../../components/SignInPasswordInput";
import { SignInShell } from "../../components/SignInShell";
import { useMockAuth } from "../../hooks/useMockAuth";
import {
  ensureApplicantApplicationRef,
  getOtpSendCooldownRef,
  invalidateSessionsAfterPasswordResetRef,
} from "../../convex/api";
import { ForgotPasswordFlow } from "./ForgotPasswordFlow";
import { getConvexClient } from "../../convex/client";
import { useApplicantRouting } from "../../hooks/useApplicantRouting";
import { useSessionAuth } from "../../hooks/useSessionAuth";

type AuthMode = "signUp" | "signIn";
type SignInStep = "credentials" | "verify";
type SignInView = "auth" | "forgotPassword";

type ConvexPasswordSignIn = (
  provider: string,
  formData: FormData,
) => Promise<{ signingIn: boolean }>;

type EnsureApplicationMutation = (args: Record<string, never>) => Promise<unknown>;
type FetchAccessToken = (args: { forceRefreshToken: boolean }) => Promise<string | null>;

type ConvexSignOut = () => Promise<void>;

function SignInPageContent({
  convexSignIn,
  convexSignOut,
  ensureApplication,
  fetchAccessToken,
  invalidateSessionsAfterReset,
}: {
  convexSignIn: ConvexPasswordSignIn | null;
  convexSignOut?: ConvexSignOut | null;
  ensureApplication: EnsureApplicationMutation | null;
  fetchAccessToken?: FetchAccessToken | null;
  invalidateSessionsAfterReset?: (() => Promise<void>) | null;
}) {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useSessionAuth();
  const mockAuth = useMockAuth();
  const routing = useApplicantRouting();
  const client = getConvexClient();

  const [view, setView] = useState<SignInView>("auth");
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [step, setStep] = useState<SignInStep>("credentials");
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownExpiresAt, setCooldownExpiresAt] = useState<number | null>(null);
  const [hourlyLimitReached, setHourlyLimitReached] = useState(false);
  const [cooldownTick, setCooldownTick] = useState(0);

  const cooldown = cooldownStatusFromExpiry(cooldownExpiresAt, hourlyLimitReached);

  useEffect(() => {
    if (getCooldownWaitSeconds(cooldownExpiresAt) <= 0) return;
    const timer = window.setTimeout(() => setCooldownTick((value) => value + 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownExpiresAt, cooldownTick]);

  const routeAfterSignIn = useCallback(async () => {
    if (mockAuth.enabled) {
      navigate("/dashboard", { replace: true });
      return;
    }

    if (client && ensureApplication && fetchAccessToken) {
      const token = await fetchAccessToken({ forceRefreshToken: true });
      if (token) {
        await ensureApplication({}).catch(() => undefined);
      }
    }

    navigate("/dashboard", { replace: true });
  }, [client, ensureApplication, fetchAccessToken, mockAuth, navigate]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && !routing.isLoading && routing.isAuthenticated) {
      void routeAfterSignIn();
    }
  }, [isAuthenticated, isLoading, routeAfterSignIn, routing.isAuthenticated, routing.isLoading]);

  if (
    view === "auth" &&
    !isLoading &&
    isAuthenticated &&
    routing.isAuthenticated
  ) {
    return (
      <Navigate
        to="/dashboard"
        replace
      />
    );
  }

  if (view === "forgotPassword") {
    return (
      <ForgotPasswordFlow
        convexSignIn={convexSignIn}
        convexSignOut={convexSignOut ?? null}
        invalidateSessions={invalidateSessionsAfterReset ?? null}
        onComplete={(message) => {
          setResetSuccessMessage(message);
          setView("auth");
          setMode("signIn");
          setStep("credentials");
          setError(null);
        }}
        onCancel={() => {
          setView("auth");
          setMode("signIn");
          setError(null);
        }}
      />
    );
  }

  const fetchOtpCooldown = async (normalized: string) => {
    if (mockAuth.enabled || !client) {
      return { waitSeconds: 0, hourlyLimitReached: false };
    }
    try {
      return await client.mutation(getOtpSendCooldownRef, { email: normalized });
    } catch {
      return { waitSeconds: 0, hourlyLimitReached: false };
    }
  };

  const handleCredentialsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const normalized = normalizeEmail(email);
    if (!normalized || !isValidEmailSyntax(normalized)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (mode === "signUp") {
      try {
        validatePasswordRequirements(password);
        validatePasswordConfirmation(password, confirmPassword);
      } catch (err) {
        setError(mapAuthError(err, mode));
        return;
      }
    }

    if (!password) {
      setError("Password is required.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      if (mockAuth.enabled) {
        if (mode === "signUp") {
          mockAuth.requestOtp(normalized);
          setEmail(normalized);
          setStep("verify");
          setCode("");
          setCooldownExpiresAt(startCooldownExpiry(OTP_RESEND_COOLDOWN_SECONDS));
        } else {
          await routeAfterSignIn();
        }
        return;
      }

      const formData = new FormData();
      formData.set("email", normalized);
      formData.set("password", password);
      formData.set("flow", mode);

      if (!convexSignIn) {
        throw new Error(AUTH_FAILED_MESSAGE);
      }

      const result = await convexSignIn("password", formData);
      if (result.signingIn) {
        await routeAfterSignIn();
        return;
      }

      setEmail(normalized);
      setStep("verify");
      setCode("");
      setCooldownExpiresAt(startCooldownExpiry(OTP_RESEND_COOLDOWN_SECONDS));
    } catch (err) {
        setError(mapAuthError(err, mode));
    } finally {
      setPending(false);
    }
  };

  const handleVerifySubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;

    const normalized = normalizeEmail(email);
    const trimmedCode = code.trim();
    if (!normalized || trimmedCode.length !== 6) {
      setError(OTP_INVALID_MESSAGE);
      return;
    }

    setPending(true);
    setError(null);

    try {
      if (mockAuth.enabled) {
        const ok = mockAuth.verifyOtp(trimmedCode);
        if (!ok) {
          setError(OTP_INVALID_MESSAGE);
          return;
        }
        await routeAfterSignIn();
        return;
      }

      const formData = new FormData();
      formData.set("email", normalized);
      formData.set("code", trimmedCode);
      formData.set("flow", "email-verification");

      if (!convexSignIn) {
        throw new Error(AUTH_FAILED_MESSAGE);
      }

      const result = await convexSignIn("password", formData);
      if (!result.signingIn) {
        setError(OTP_INVALID_MESSAGE);
        return;
      }

      await routeAfterSignIn();
    } catch {
      setError(OTP_INVALID_MESSAGE);
    } finally {
      setPending(false);
    }
  };

  const handleResendCode = async () => {
    if (pending || cooldown.waitSeconds > 0 || cooldown.hourlyLimitReached) return;

    const normalized = normalizeEmail(email);
    if (!normalized || !password) return;

    setPending(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("email", normalized);
      formData.set("password", password);
      formData.set("flow", mode);

      if (!convexSignIn) {
        throw new Error(AUTH_FAILED_MESSAGE);
      }

      await convexSignIn("password", formData);
      const status = await fetchOtpCooldown(normalized);
      setHourlyLimitReached(status.hourlyLimitReached);
      setCooldownExpiresAt(mergeCooldownExpiry(null, status));
      if (!status.hourlyLimitReached) {
        setCooldownExpiresAt(startCooldownExpiry(OTP_RESEND_COOLDOWN_SECONDS));
      }
    } catch (err) {
      setError(mapAuthError(err, mode));
    } finally {
      setPending(false);
    }
  };

  const shellTitle =
    step === "credentials"
      ? mode === "signUp"
        ? "Create your account"
        : "Welcome back"
      : "Verify your email";

  const shellSubtitle: ReactNode =
    step === "credentials" ? (
      mode === "signUp" ? (
        "Enter your email and choose a password to begin your application."
      ) : (
        "Sign in with the same email and password you used to register."
      )
    ) : (
      <>
        We sent a 6-digit code to{" "}
        <span className="sign-in-card__subtitle-email">{email}</span>.
      </>
    );

  const resendLabel = cooldown.hourlyLimitReached
    ? OTP_HOURLY_LIMIT_MESSAGE
    : formatOtpResendLabel(cooldown.waitSeconds);

  return (
    <SignInShell title={shellTitle} subtitle={shellSubtitle}>
      {step === "credentials" ? (
        <form onSubmit={handleCredentialsSubmit} noValidate className="sign-in-form">
          <label className="sign-in-field" htmlFor="sign-in-email">
            <span className="sign-in-field__label">Email</span>
            <input
              id="sign-in-email"
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

          <div className="sign-in-field">
            <label className="sign-in-field__label" htmlFor="sign-in-password">
              Password
            </label>
            <SignInPasswordInput
              id="sign-in-password"
              autoComplete={mode === "signUp" ? "new-password" : "current-password"}
              placeholder="••••••••"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              className="sign-in-field__input"
              aria-invalid={!!error}
            />
          </div>

          {mode === "signUp" ? (
            <div className="sign-in-field">
              <label className="sign-in-field__label" htmlFor="sign-in-confirm-password">
                Confirm password
              </label>
              <SignInPasswordInput
                id="sign-in-confirm-password"
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
          ) : null}

          {mode === "signUp" ? (
            <p className="sign-in-message">{PASSWORD_REQUIREMENTS_MESSAGE}</p>
          ) : null}

          {resetSuccessMessage ? (
            <p className="sign-in-message sign-in-message--info" role="status" aria-live="polite">
              {resetSuccessMessage}
            </p>
          ) : null}

          {error ? (
            <p className="sign-in-message sign-in-message--error" role="alert" aria-live="polite">
              {error}
            </p>
          ) : null}

          <button type="submit" className="sign-in-btn" disabled={pending}>
            {pending
              ? mode === "signUp"
                ? "Creating account…"
                : "Signing in…"
              : mode === "signUp"
                ? "Create account"
                : "Sign in"}
          </button>

          <div className="sign-in-actions">
            {mode === "signIn" ? (
              <button
                type="button"
                className="sign-in-btn sign-in-btn--secondary"
                onClick={() => {
                  setView("forgotPassword");
                  setError(null);
                  setResetSuccessMessage(null);
                }}
              >
                Forgot password?
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <form onSubmit={handleVerifySubmit} noValidate className="sign-in-form">
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
            {pending ? "Verifying…" : "Verify email"}
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
                setStep("credentials");
                setCode("");
                setError(null);
              }}
            >
              Back to sign in
            </button>
          </div>
        </form>
      )}
    </SignInShell>
  );
}

function SignInPageWithConvex() {
  const { signIn, signOut } = useAuthActions();
  const { fetchAccessToken } = useConvexAuth();
  const ensureApplication = useMutation(ensureApplicantApplicationRef);
  const invalidateSessionsAfterReset = useMutation(
    invalidateSessionsAfterPasswordResetRef,
  );
  return (
    <SignInPageContent
      convexSignIn={signIn}
      convexSignOut={signOut}
      ensureApplication={ensureApplication}
      fetchAccessToken={fetchAccessToken}
      invalidateSessionsAfterReset={() => invalidateSessionsAfterReset({})}
    />
  );
}

export default function SignInPage() {
  const mockAuth = useMockAuth();
  if (mockAuth.enabled) {
    return <SignInPageContent convexSignIn={null} ensureApplication={null} />;
  }
  return <SignInPageWithConvex />;
}
