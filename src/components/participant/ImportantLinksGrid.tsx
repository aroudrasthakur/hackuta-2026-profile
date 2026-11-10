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
          <path d="M9 9a3 3 0 1 1 4.1 2.75c-.85.4-1.35 1-1.35 2V14.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="12" cy="17.5" r="1.15" fill="currentColor" />
        </svg>
      );
    case "contact":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
          <path d="m4 8 8 5 8-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case "devpost":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 3h10l5 9-5 9H7l-5-9 5-9Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M9.5 8h2.2a4 4 0 0 1 0 8H9.5V8Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        </svg>
      );
    case "discord":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.05.05 0 0 0-.053.024 12.3 12.3 0 0 0-.608 1.25 18.6 18.6 0 0 0-5.487 0 12.7 12.7 0 0 0-.617-1.25.05.05 0 0 0-.053-.024A19.8 19.8 0 0 0 2.729 4.492a.04.04 0 0 0-.021.018C.356 9.274-.213 13.955.066 18.584a.06.06 0 0 0 .023.042 20 20 0 0 0 6.023 3.049.05.05 0 0 0 .056-.019c.463-.63.874-1.295 1.226-1.994a.05.05 0 0 0-.027-.07 13 13 0 0 1-1.872-.892.05.05 0 0 1-.005-.084c.125-.094.251-.192.371-.291a.05.05 0 0 1 .051-.007c3.927 1.793 8.18 1.793 12.061 0a.05.05 0 0 1 .053.007c.12.099.246.198.372.292a.05.05 0 0 1-.004.084c-.598.35-1.22.645-1.873.892a.05.05 0 0 0-.028.07c.36.698.772 1.362 1.225 1.993a.05.05 0 0 0 .056.019 20 20 0 0 0 6.026-3.048.06.06 0 0 0 .023-.042c.334-5.338-.557-9.967-2.358-14.074a.04.04 0 0 0-.02-.019M8.02 15.278c-1.183 0-2.157-1.085-2.157-2.419S6.863 10.44 8.02 10.44c1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418m6.302 0c-1.183 0-2.157-1.085-2.157-2.419s.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418" />
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
    default:
      return null;
  }
}

export function ImportantLinksGrid({ variant = "dark" }: { variant?: "dark" | "portal" }) {
  return (
    <ul className={`participant-link-grid${variant === "portal" ? " participant-link-grid--portal" : ""}`}>
      {PARTICIPANT_IMPORTANT_LINKS.map((link) => (
        <li key={link.id}>
          {link.href ? (
            <a
              className="participant-link-card"
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              <span className="participant-link-card__icon">{linkIcon(link.id)}</span>
              {link.external ? <ExternalArrowIcon /> : null}
              <span className="participant-link-card__label">{link.label}</span>
            </a>
          ) : (
            <div className="participant-link-card participant-link-card--soon" aria-disabled="true">
              <span className="participant-link-card__icon">{linkIcon(link.id)}</span>
              <span className="participant-link-card__soon">Coming soon</span>
              <span className="participant-link-card__label">{link.label}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
