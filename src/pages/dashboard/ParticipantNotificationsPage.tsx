import { PARTICIPANT_NOTIFICATIONS } from "../../constants/participantNotifications";

export default function ParticipantNotificationsPage() {
  return (
    <section className="participant-notifications" aria-labelledby="participant-notifications-title">
      <h1 id="participant-notifications-title" className="participant-page-title">
        Notifications
      </h1>
      <p className="participant-page-lead">Updates from the HackUTA team about the event.</p>
      <ul className="participant-notifications__list">
        {PARTICIPANT_NOTIFICATIONS.map((item) => (
          <li key={item.id}>
            <article className="participant-notifications__card">
              <header className="participant-notifications__card-head">
                <h2>{item.title}</h2>
                <time dateTime={item.postedAt}>
                  {new Date(`${item.postedAt}T12:00:00`).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </time>
              </header>
              <p>{item.body}</p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
