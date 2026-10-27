import type { ReactNode } from "react";

export function ParticipantPageHeader({
  id,
  title,
  description,
  actions,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="participant-frieze">
      <img
        className="participant-frieze__art"
        src="/images/shop/pillars.webp"
        alt=""
        aria-hidden="true"
        width={281}
        height={480}
        decoding="async"
      />
      <header className="participant-page-header">
        <div className="participant-page-header__copy">
          <h1 id={id} className="participant-page-title">
            {title}
          </h1>
          {description ? <div className="participant-page-header__description">{description}</div> : null}
        </div>
        {actions ? <div className="participant-page-header__actions">{actions}</div> : null}
      </header>
      <span aria-hidden="true" className="participant-meander participant-meander--flip" />
    </div>
  );
}
