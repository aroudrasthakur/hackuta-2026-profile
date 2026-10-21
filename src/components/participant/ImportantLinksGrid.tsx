import { PARTICIPANT_IMPORTANT_LINKS } from "../../constants/participantImportantLinks";

function ExternalArrowIcon() {
  return (
    <svg className="participant-link-card__external" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M17 7H9M17 7v8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function linkIcon(id: string) {
  switch (id) {
    case "faq":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 9.5a5 5 0 0 1 9.2-2.5M9 14h.01M10 18a8 8 0 1 0-2.3-5.7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case "contact":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
          <path d="m4 8 8 5 8-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case "hacker-pack":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 4h12v16H6V4Z" stroke="currentColor" strokeWidth="1.75" />
          <path d="M9 8h6M9 12h6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case "discord":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M8 8.5c1.5-1 3.5-1 4 0 2-.5 3.5 0 4.5 1.5-1 2.5-2.5 4-5 4.5-.5-1-2-1.5-3.5-1.5S9 15 8.5 16c-2.5-.5-4-2-5-4.5 1-1.5 2.5-2 4.5-1.5.5-1 2.5-1 4 0Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="17.2" cy="6.8" r="1" fill="currentColor" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.75" />
          <path d="M8 10v7M8 7.5v.5M12 17v-4.2c0-1.2.9-2.3 2.1-2.3s1.9 1 1.9 2.3V17M12 12.8V17" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export function ImportantLinksGrid() {
  return (
    <ul className="participant-link-grid">
      {PARTICIPANT_IMPORTANT_LINKS.map((link) => (
        <li key={link.id}>
          <a
            className="participant-link-card"
            href={link.href}
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            <span className="participant-link-card__icon">{linkIcon(link.id)}</span>
            {link.external ? <ExternalArrowIcon /> : null}
            <span className="participant-link-card__label">{link.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
