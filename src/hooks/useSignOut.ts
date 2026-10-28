import { useNavigate } from "react-router-dom";
import { useMockAuth } from "./useMockAuth";
import { useSessionAuth } from "./useSessionAuth";

/** Signs out of Convex (or mock auth) and returns to /sign-in. */
export function useSignOut() {
  const navigate = useNavigate();
  const { signOut } = useSessionAuth();
  const mockAuth = useMockAuth();

  return async () => {
    if (mockAuth.enabled) {
      mockAuth.signOut();
      navigate("/sign-in", { replace: true });
      return;
    }
    await signOut();
    navigate("/sign-in", { replace: true });
  };
}
