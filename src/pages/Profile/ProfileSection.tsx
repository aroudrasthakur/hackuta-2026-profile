import type { ReactNode } from "react";
import { profileSection, profileSectionTitle } from "./profileStyles";

export function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={profileSection}>
      <h3 className={profileSectionTitle}>{title}</h3>
      {children}
    </section>
  );
}
