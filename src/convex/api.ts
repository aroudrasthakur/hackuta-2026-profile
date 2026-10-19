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
  participant: {
    qrCodeToken: string;
    acceptedAt: number;
  } | null;
  hackathon: {
    name: string;
    startsAt: number | null;
    endsAt: number | null;
    decisionsReleasedAt: number | null;
    registrationOpensAt: number | null;
    registrationClosesAt: number | null;
  };
};

export const getMyParticipantDashboardRef = makeFunctionReference<
  "query",
  Record<string, never>,
  ParticipantDashboard | null
>("profile/dashboard:getMyParticipantDashboard");
