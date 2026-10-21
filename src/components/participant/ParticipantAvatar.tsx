import { profileInitials } from "../../lib/participantDisplay";

type ParticipantAvatarProps = {
  displayName: string;
  size?: "sidebar" | "profile";
};

export function ParticipantAvatar({ displayName, size = "profile" }: ParticipantAvatarProps) {
  const initials = profileInitials(displayName);
  return (
    <div
      className={`participant-avatar participant-avatar--${size}`}
      role="img"
      aria-label={`${displayName} avatar`}
    >
      {initials}
    </div>
  );
}
