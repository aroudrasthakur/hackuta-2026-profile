import { Navigate } from "react-router-dom";
import { useApplicantRouting } from "../hooks/useApplicantRouting";

export default function HomeRedirect() {
  const routing = useApplicantRouting();

  if (routing.isLoading) {
    return (
      <main className="sign-in-page flex min-h-screen items-center justify-center">
        <p className="text-sm text-(--ocean)" role="status" aria-live="polite">
          Loading…
        </p>
      </main>
    );
  }

  if (!routing.isAuthenticated) {
    return <Navigate to="/sign-in" replace />;
  }

  return <Navigate to="/dashboard" replace />;
}
