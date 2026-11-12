import { Navigate } from "react-router-dom";
import { PORTAL_APPLICATION_REQUIRED_LOCATION_STATE } from "../constants/authMessages";
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

  if (!routing.hasSubmittedRegistration) {
    return <Navigate to="/sign-in" replace state={PORTAL_APPLICATION_REQUIRED_LOCATION_STATE} />;
  }

  return <Navigate to="/dashboard" replace />;
}
