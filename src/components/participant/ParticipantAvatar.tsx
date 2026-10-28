import { profileInitials } from "../../lib/participantDisplay";

type ParticipantAvatarProps = {
  displayName: string;
};

export function ParticipantAvatar({ displayName }: ParticipantAvatarProps) {
  const initials = profileInitials(displayName);
  return (
    <div
      className="participant-avatar participant-avatar--sidebar"
      role="img"
      aria-label={`${displayName} avatar`}
    >
      {initials}
    </div>
  );
}
