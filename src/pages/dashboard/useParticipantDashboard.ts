import { useQuery } from "../../convex/reactBindings";
import { getMyParticipantDashboardRef, type ParticipantDashboard } from "../../convex/api";
import { getConvexClient } from "../../convex/client";
import { useMockAuth } from "../../hooks/useMockAuth";

const MOCK_NOW = 1_700_000_000_000;

export function useParticipantDashboard(): {
  loading: boolean;
  data: ParticipantDashboard | null;
} {
  const mockAuth = useMockAuth();
  const client = getConvexClient();
  const dashboard = useQuery(
    getMyParticipantDashboardRef,
    client && !mockAuth.enabled ? {} : "skip",
  );

  if (mockAuth.enabled) {
    return {
      loading: false,
      data: {
        profile: { displayName: "Sam Test", email: mockAuth.verifiedEmail },
        application: { submitted: true, submittedAt: MOCK_NOW, school: "UT Arlington" },
        reviewStatus: "accepted",
        participant: mockAuth.participantCheckedIn
          ? { status: "checked_in", acceptedAt: MOCK_NOW, checkedInAt: MOCK_NOW + 86_400_000 }
          : { status: "awaiting_check_in", acceptedAt: MOCK_NOW, qrCodeToken: "a".repeat(64) },
        hackathon: {
          name: "HackUTA 2026",
          startsAt: MOCK_NOW + 86_400_000,
          endsAt: MOCK_NOW + 172_800_000,
          decisionsReleasedAt: MOCK_NOW - 86_400_000,
          registrationOpensAt: MOCK_NOW - 604_800_000,
          registrationClosesAt: MOCK_NOW - 259_200_000,
        },
        submittedApplication: {
          submittedAt: MOCK_NOW,
          sections: [
            {
              title: "Personal Information",
              rows: [
                { label: "First name", value: "Sam" },
                { label: "Last name", value: "Test" },
              ],
            },
          ],
          resume: { status: "none", url: null, filename: null },
        },
      },
    };
  }

  if (dashboard === undefined) {
    return { loading: true, data: null };
  }

  return { loading: false, data: dashboard };
}
