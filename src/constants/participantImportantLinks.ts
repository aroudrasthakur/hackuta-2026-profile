import { LANDING_URL } from "./site";

const DISCORD_URL = "https://discord.gg/2bVsYS3SgS";
const CONTACT_EMAIL = "hello@hackuta.org";

export type ParticipantImportantLink = {
  id: string;
  label: string;
  /** Omitted for links that are not live yet; the card renders as "Coming soon". */
  href?: string;
  external?: boolean;
};

export const PARTICIPANT_IMPORTANT_LINKS: ParticipantImportantLink[] = [
  { id: "faq", label: "FAQ", href: `${LANDING_URL.replace(/\/$/, "")}/#faq` },
  { id: "contact", label: "Contact", href: `mailto:${CONTACT_EMAIL}` },
  { id: "devpost", label: "Devpost" },
  { id: "discord", label: "Discord", href: DISCORD_URL, external: true },
  { id: "instagram", label: "Instagram", href: "https://www.instagram.com/hack.uta/", external: true },
  { id: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/company/hackuta", external: true },
];
