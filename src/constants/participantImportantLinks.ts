import { LANDING_URL } from "./site";

const DISCORD_URL = "https://discord.gg/2bVsYS3SgS";
const CONTACT_EMAIL = "hello@hackuta.org";

/** Hacker Pack Notion — override with VITE_HACKER_PACK_URL when published. */
const HACKER_PACK_URL =
  import.meta.env.VITE_HACKER_PACK_URL?.trim() ||
  "https://hackuta.notion.site/";

export type ParticipantImportantLink = {
  id: string;
  label: string;
  href: string;
  external?: boolean;
};

export const PARTICIPANT_IMPORTANT_LINKS: ParticipantImportantLink[] = [
  { id: "faq", label: "FAQ", href: `${LANDING_URL.replace(/\/$/, "")}/#faq` },
  { id: "contact", label: "Contact", href: `mailto:${CONTACT_EMAIL}` },
  { id: "hacker-pack", label: "Hacker Pack", href: HACKER_PACK_URL, external: true },
  { id: "discord", label: "Discord", href: DISCORD_URL, external: true },
  { id: "instagram", label: "Instagram", href: "https://instagram.com/hackuta", external: true },
  { id: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/company/hackuta", external: true },
];
