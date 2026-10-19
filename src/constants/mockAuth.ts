export type MockAuthScenario =
  | "signedOut"
  | "otpPending"
  | "signedInNew"
  | "signedInReturning";

export const MOCK_OTP = "042681";

/** E2E hook mounted by MockAuthProvider when mock API is enabled. */
export type HackutaMockAuthWindow = {
  setScenario: (scenario: MockAuthScenario) => void;
};

declare global {
  interface Window {
    __hackutaMockAuth?: HackutaMockAuthWindow;
  }
}

/** Compile-time gate only. Never set VITE_USE_MOCK_API=true on live production deploys. */
export function isMockApiEnabled() {
  return import.meta.env.VITE_USE_MOCK_API === "true";
}
