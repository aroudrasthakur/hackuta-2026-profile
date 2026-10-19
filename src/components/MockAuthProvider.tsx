import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  isMockApiEnabled,
  MOCK_OTP,
  type MockAuthScenario,
} from "../constants/mockAuth";
import {
  defaultMockAuthValue,
  MockAuthContext,
  type MockAuthContextValue,
} from "../hooks/mockAuthContext";

function scenarioState(
  scenario: MockAuthScenario,
  email: string | null,
): Omit<
  MockAuthContextValue,
  "enabled" | "setScenario" | "requestOtp" | "verifyOtp" | "signOut"
> {
  switch (scenario) {
    case "signedOut":
      return {
        isLoading: false,
        isAuthenticated: false,
        verifiedEmail: null,
        hasSubmittedRegistration: false,
      };
    case "otpPending":
      return {
        isLoading: false,
        isAuthenticated: false,
        verifiedEmail: email,
        hasSubmittedRegistration: false,
      };
    case "signedInNew":
      return {
        isLoading: false,
        isAuthenticated: true,
        verifiedEmail: email ?? "applicant@example.com",
        hasSubmittedRegistration: false,
      };
    case "signedInReturning":
      return {
        isLoading: false,
        isAuthenticated: true,
        verifiedEmail: email ?? "applicant@example.com",
        hasSubmittedRegistration: true,
      };
  }
}

export function MockAuthProvider({ children }: { children: ReactNode }) {
  const enabled = isMockApiEnabled();
  const [scenario, setScenarioState] = useState<MockAuthScenario>("signedOut");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  const setScenario = useCallback((next: MockAuthScenario) => {
    setScenarioState(next);
    if (next === "signedOut") {
      setPendingEmail(null);
      setVerifiedEmail(null);
    }
  }, []);

  const requestOtp = useCallback((email: string) => {
    setPendingEmail(email);
    setScenarioState("otpPending");
  }, []);

  const verifyOtp = useCallback(
    (code: string) => {
      if (code !== MOCK_OTP) return false;
      const email = pendingEmail ?? "applicant@example.com";
      setVerifiedEmail(email);
      setScenarioState("signedInNew");
      return true;
    },
    [pendingEmail],
  );

  const signOut = useCallback(() => {
    setScenarioState("signedOut");
    setPendingEmail(null);
    setVerifiedEmail(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    window.__hackutaMockAuth = { setScenario };
    return () => {
      delete window.__hackutaMockAuth;
    };
  }, [enabled, setScenario]);

  const value = useMemo<MockAuthContextValue>(() => {
    if (!enabled) return defaultMockAuthValue;

    const email = verifiedEmail ?? pendingEmail;
    const base = scenarioState(scenario, email);

    return {
      enabled: true,
      setScenario,
      requestOtp,
      verifyOtp,
      signOut,
      ...base,
    };
  }, [enabled, pendingEmail, requestOtp, scenario, setScenario, verifiedEmail, verifyOtp, signOut]);

  return (
    <MockAuthContext.Provider value={value}>{children}</MockAuthContext.Provider>
  );
}
