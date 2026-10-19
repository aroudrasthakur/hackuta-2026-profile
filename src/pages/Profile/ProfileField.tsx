import type { ReactNode } from "react";
import {
  profileFieldLabel,
  profileFieldValue,
  profileFieldValueSubmitted,
} from "./profileStyles";

export function ProfileField({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: ReactNode;
  emphasized?: boolean;
}) {
  return (
    <div>
      <dt className={profileFieldLabel}>{label}</dt>
      <dd className={emphasized ? profileFieldValueSubmitted : profileFieldValue}>{value}</dd>
    </div>
  );
}
