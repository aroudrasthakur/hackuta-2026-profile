/**
 * Check-in completes when a volunteer assigns a badge (`checkInWithBadge` sets
 * `checkedInAt`). Badge replacement never clears it.
 */
export function isParticipantCheckedIn<T extends { checkedInAt?: number }>(
  participant: T,
): participant is T & { checkedInAt: number } {
  return participant.checkedInAt !== undefined;
}

/**
 * Participant fields the portal may see. Built field by field so no other row
 * field (including any badge token) can reach the client. The registration
 * token is returned only before check-in; the physical badge replaces it after.
 */
export function participantPortalView(participant: {
  acceptedAt: number;
  qrCodeToken: string;
  checkedInAt?: number;
}) {
  if (isParticipantCheckedIn(participant)) {
    return {
      status: "checked_in" as const,
      acceptedAt: participant.acceptedAt,
      checkedInAt: participant.checkedInAt,
    };
  }
  return {
    status: "awaiting_check_in" as const,
    acceptedAt: participant.acceptedAt,
    qrCodeToken: participant.qrCodeToken,
  };
}
