import { Link } from "react-router-dom";
import { ParticipantPageHeader } from "../../components/participant/ParticipantPageHeader";
import {
  formatNotificationTimestamp,
  isInternalNotificationLink,
  NOTIFICATION_TYPE_LABELS,
} from "../../constants/participantNotifications";
import { useParticipantNotifications } from "./useParticipantNotifications";

export default function ParticipantNotificationsPage() {
  const { loading, notifications } = useParticipantNotifications();

  return (
    <section
      className="participant-notifications"
      aria-labelledby="participant-notifications-title"
    >
      <ParticipantPageHeader
        id="participant-notifications-title"
        title="Notifications"
        description="Updates from the HackUTA team about the event."
      />

      {loading ? (
        <div className="participant-notifications__empty" role="status">
          <p>Loading notifications…</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="participant-notifications__empty" role="status">
          <h2>No notifications yet</h2>
          <p>
            When organizers publish event announcements, reminders, or shop flash sales, they will
            appear here automatically.
          </p>
        </div>
      ) : (
        <ul className="participant-notifications__list" aria-label="Published notifications">
          {notifications.map((item) => {
            const typeLabel = NOTIFICATION_TYPE_LABELS[item.type] ?? "General";
            const linkLabel = item.linkLabel?.trim() || "Open link";
            const isoTime = new Date(item.publishedAt).toISOString();
            return (
              <li key={item.notificationId}>
                <article
                  className={`participant-notifications__card participant-notifications__card--${item.type}`}
                >
                  <header className="participant-notifications__card-head">
                    <div className="participant-notifications__title-group">
                      <span
                        className={`participant-notifications__badge participant-notifications__badge--${item.type}`}
                      >
                        {typeLabel}
                      </span>
                      <h2>{item.title}</h2>
                    </div>
                    <time dateTime={isoTime}>
                      {formatNotificationTimestamp(item.publishedAt)}
                    </time>
                  </header>
                  <p className="participant-notifications__message">{item.message}</p>
                  {item.linkUrl ? (
                    <div className="participant-notifications__actions">
                      {isInternalNotificationLink(item.linkUrl) ? (
                        <Link to={item.linkUrl} className="participant-notifications__link">
                          {linkLabel}
                        </Link>
                      ) : (
                        <a
                          href={item.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="participant-notifications__link"
                        >
                          {linkLabel}
                        </a>
                      )}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
