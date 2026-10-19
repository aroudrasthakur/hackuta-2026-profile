import { useState, type ReactNode } from "react";
import { useSessionAuth } from "../hooks/useSessionAuth";

function AuthLoadingScreen() {
  return (
    <main className="register-page flex min-h-screen items-center justify-center bg-(--clay)">
      <p className="text-sm text-(--ocean)" role="status" aria-live="polite">
        Loading…
      </p>
    </main>
  );
}

/** Waits for the initial Convex Auth read before rendering routed pages. */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  const { isLoading } = useSessionAuth();
  const [sessionReady, setSessionReady] = useState(false);

  // Latch after the first completed auth read. Do not unmount the tree when
  // isLoading flips during sign-in actions — that would reset SignInPage step state.
  if (!sessionReady && !isLoading) {
    setSessionReady(true);
  }

  if (!sessionReady) {
    return <AuthLoadingScreen />;
  }

  return children;
}
