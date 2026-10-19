import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { getRegistrationPhase, resolveHackathonTimelineSource } from "../../shared/hackathon/schedule";
import { DEFAULT_HACKATHON_NAME } from "../../shared/hackathon/eventDefaults";
import { getPublicEventConfigRef } from "../convex/api";
import { getConvexClient } from "../convex/client";
import { useMockAuth } from "./useMockAuth";

/** Live hackathon display name from the server eventConfig table. */
export function useHackathonConfig() {
  const mockAuth = useMockAuth();
  const client = getConvexClient();
  const config = useQuery(
    getPublicEventConfigRef,
    client && !mockAuth.enabled ? {} : "skip",
  );
  return {
    name: config?.name ?? DEFAULT_HACKATHON_NAME,
    ...resolveHackathonTimelineSource(config),
    isLoading: Boolean(client && !mockAuth.enabled && config === undefined),
  };
}

export function useHackathonName() {
  return useHackathonConfig().name;
}

export function useRegistrationWindow(registrationOpensAt: number, registrationClosesAt: number | null) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const next = now < registrationOpensAt
      ? registrationOpensAt
      : registrationClosesAt !== null && now < registrationClosesAt
        ? registrationClosesAt
        : null;
    if (next === null) return;
    const timer = window.setTimeout(
      () => setTick((value) => value + 1),
      Math.min(next - now, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [registrationOpensAt, registrationClosesAt, tick]);
  return getRegistrationPhase({ registrationOpensAt, registrationClosesAt });
}
