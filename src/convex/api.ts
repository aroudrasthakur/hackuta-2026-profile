import { makeFunctionReference } from "convex/server";

export const getPublicEventConfigRef = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    name: string;
    registrationOpensAt: number;
    registrationClosesAt: number | null;
    decisionsReleasedAt: number | null;
    startsAt: number;
    endsAt: number;
  }
>("eventConfig:getPublicEventConfig");

export const getApplicantRoutingStateRef = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    authenticated: boolean;
    verifiedEmail: string | null;
    hasSubmittedRegistration: boolean;
  }
>("applicant:getApplicantRoutingState");

export const getMyApplicantDashboardRef = makeFunctionReference<
  "query",
  Record<string, never>
>("applications:getMyApplicantDashboard");

export const getMyApplicationDraftRef = makeFunctionReference<
  "query",
  Record<string, never>
>("applications:getMyApplicationDraft");

export const saveApplicationDraftRef = makeFunctionReference<
  "mutation",
  { patch: Record<string, unknown> }
>("applications:saveApplicationDraft");

export const ensureApplicantApplicationRef = makeFunctionReference<
  "mutation",
  Record<string, never>
>("applicant:ensureApplicantApplication");

export const getOtpSendCooldownRef = makeFunctionReference<
  "mutation",
  { email: string },
  { waitSeconds: number; hourlyLimitReached: boolean }
>("rateLimits:getOtpSendCooldown");

export const getPasswordResetSendCooldownRef = makeFunctionReference<
  "mutation",
  { email: string },
  { waitSeconds: number; hourlyLimitReached: boolean }
>("rateLimits:getPasswordResetSendCooldown");

export const invalidateSessionsAfterPasswordResetRef = makeFunctionReference<
  "mutation",
  Record<string, never>
>("passwordReset:invalidateSessionsAfterPasswordReset");

export const assertResetCodeAvailableRef = makeFunctionReference<
  "mutation",
  { email: string; code: string },
  { ok: boolean }
>("passwordReset:assertResetCodeAvailable");

export type SubmittedApplication = {
  submittedAt: number | null;
  sections: Array<{ title: string; rows: Array<{ label: string; value: string }> }>;
  resume: {
    status: "none" | "available" | "missing";
    url: string | null;
    filename: string | null;
  };
};

export type ParticipantDashboard = {
  profile: {
    displayName: string;
    email: string | null;
  };
  application: {
    submitted: boolean;
    submittedAt: number | null;
    school: string | null;
  } | null;
  reviewStatus:
    | "unreviewed"
    | "under_review"
    | "accepted"
    | "rejected"
    | "waitlisted"
    | "withdrawn"
    | null;
  /** Registration QR token only before check-in; after check-in the physical badge is the pass. */
  participant:
    | { status: "awaiting_check_in"; acceptedAt: number; qrCodeToken: string }
    | { status: "checked_in"; acceptedAt: number; checkedInAt: number }
    | null;
  hackathon: {
    name: string;
    startsAt: number | null;
    endsAt: number | null;
    decisionsReleasedAt: number | null;
    registrationOpensAt: number | null;
    registrationClosesAt: number | null;
  };
  /** Present when the deployed dashboard query includes submission detail (may be absent briefly on older backends). */
  submittedApplication?: SubmittedApplication | null;
};

export const getMyParticipantDashboardRef = makeFunctionReference<
  "query",
  Record<string, never>,
  ParticipantDashboard | null
>("profile/dashboard:getMyParticipantDashboard");

export const getMySubmittedApplicationRef = makeFunctionReference<
  "query",
  Record<string, never>,
  SubmittedApplication | null
>("profile/submission:getMySubmittedApplication");
