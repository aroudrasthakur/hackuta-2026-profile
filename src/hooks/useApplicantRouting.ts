import { useQuery } from "convex/react";
import { getApplicantRoutingStateRef } from "../convex/api";
import { getConvexClient } from "../convex/client";
import { useMockAuth } from "./useMockAuth";
import { useSessionAuth } from "./useSessionAuth";

export function useApplicantRouting() {
  const { isAuthenticated, isLoading: authLoading } = useSessionAuth();
  const mockAuth = useMockAuth();
  const client = getConvexClient();

  const routingState = useQuery(
    getApplicantRoutingStateRef,
    client && isAuthenticated && !mockAuth.enabled ? {} : "skip",
  );

  if (mockAuth.enabled) {
    return {
      isLoading: mockAuth.isLoading,
      isAuthenticated: mockAuth.isAuthenticated,
      verifiedEmail: mockAuth.verifiedEmail,
      hasSubmittedRegistration: mockAuth.hasSubmittedRegistration,
    };
  }

  return {
    isLoading: authLoading || (isAuthenticated && routingState === undefined),
    isAuthenticated,
    verifiedEmail: routingState?.verifiedEmail ?? null,
    hasSubmittedRegistration: routingState?.hasSubmittedRegistration ?? false,
  };
}
