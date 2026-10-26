/**
 * Shared volunteer provisioning helpers. **Not an auth boundary**: callers must
 * call `requireAdminRole` first and pass that admin's id as the actor.
 *
 * Used by `volunteers.ts` (standalone volunteers) and `participantsAdmin.ts`
 * (participant promotion) so both paths validate, hash, and audit the same way.
 * Applicant `users` / `authAccounts` rows are never created or modified.
 */
import type { GenericId } from "convex/values";
import { formatApplicantFullName } from "../lib/applications";
import type { MutationCtx } from "../lib/dataModel";
import { isValidEmailSyntax, normalizeEmail } from "../lib/normalizeEmail";
import { adminError } from "../../shared/admin/errors";
import { buildStaffConfigDetails } from "../../shared/admin/volunteerRules";
import { validatePasswordRequirements } from "../../shared/auth/password";
import { requireEligibleParticipant } from "./pointsLedger";
import { newVolunteerFields } from "./staffAuth";
import { setStaffPassword } from "./staffCredentials";

type AdminId = GenericId<"admins">;
type ParticipantId = GenericId<"participants">;

type CapabilityInput = { canCheckIn?: boolean; canFoodCheckIn?: boolean };

export function requireStaffName(name: string | null | undefined) {
  const trimmed = name?.trim();
  if (!trimmed) throw adminError("INVALID_STAFF_NAME");
  return trimmed;
}

/** Same normalization as staff sign-in. Any existing staff row (any role, active or not) blocks reuse. */
export async function requireAvailableStaffEmail(ctx: MutationCtx, email: string | null | undefined) {
  const normalized = normalizeEmail(email ?? "");
  if (!normalized || !isValidEmailSyntax(normalized)) throw adminError("INVALID_EMAIL");
  const existing = await ctx.db.query("admins")
    .withIndex("by_email", (q) => q.eq("email", normalized)).first();
  if (existing) throw adminError("STAFF_ACCOUNT_EXISTS");
  return normalized;
}

/** Inserts the staff row, hashed credentials, and the audit row in the caller's transaction. */
export async function insertVolunteer(
  ctx: MutationCtx,
  actorAdminId: AdminId,
  fields: CapabilityInput & {
    email: string;
    name: string;
    password: string;
    participantId?: ParticipantId;
  },
) {
  const now = Date.now();
  const capabilities = {
    canCheckIn: fields.canCheckIn === true,
    canFoodCheckIn: fields.canFoodCheckIn === true,
  };
  const adminId = await ctx.db.insert("admins", {
    email: fields.email,
    name: fields.name,
    active: true,
    ...newVolunteerFields(),
    ...capabilities,
    ...(fields.participantId ? { participantId: fields.participantId } : {}),
    createdAt: now,
    updatedAt: now,
  });
  await setStaffPassword(ctx, adminId, fields.password);
  await ctx.db.insert("staffConfigLogs", {
    actorAdminId,
    action: fields.participantId ? "volunteer_promoted" : "volunteer_created",
    targetAdminId: adminId,
    ...(fields.participantId ? { targetParticipantId: fields.participantId } : {}),
    details: buildStaffConfigDetails({ after: { ...capabilities, active: true } }),
    createdAt: now,
  });
  return { ok: true as const, adminId, email: fields.email };
}

/**
 * Creates a **separate** volunteer staff account linked to an accepted
 * participant. Email and name default to the registration values. The
 * participant row, QR token, points, application, and applicant account are
 * left untouched, and existing staff accounts are never converted.
 */
export async function promoteParticipant(
  ctx: MutationCtx,
  actorAdminId: AdminId,
  args: CapabilityInput & {
    participantId: ParticipantId;
    password: string;
    email?: string;
    name?: string;
  },
) {
  const participant = await requireEligibleParticipant(ctx, args.participantId);
  const linked = await ctx.db.query("admins")
    .withIndex("by_participant", (q) => q.eq("participantId", args.participantId)).first();
  if (linked) throw adminError("STAFF_ACCOUNT_EXISTS");
  const application = await ctx.db.get(participant.applicationId);
  const registrationEmail = application?.email ?? (await ctx.db.get(participant.authUserId))?.email;
  const name = requireStaffName(args.name ?? (application && formatApplicantFullName(application)));
  validatePasswordRequirements(args.password);
  const email = await requireAvailableStaffEmail(ctx, args.email ?? registrationEmail);
  return insertVolunteer(ctx, actorAdminId, {
    email, name, password: args.password, participantId: args.participantId,
    ...(args.canCheckIn !== undefined ? { canCheckIn: args.canCheckIn } : {}),
    ...(args.canFoodCheckIn !== undefined ? { canFoodCheckIn: args.canFoodCheckIn } : {}),
  });
}
