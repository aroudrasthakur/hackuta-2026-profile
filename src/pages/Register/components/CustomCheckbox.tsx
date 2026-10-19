import type { InputHTMLAttributes } from "react";
import { RequiredMark } from "./FormFields";
import {
  customCheckboxBoxClass,
  customCheckboxCaptionClass,
  customCheckboxHitTargetClass,
  customCheckboxRowClass,
  customControlInputClass,
  customRadioBoxClass,
  customRadioCaptionClass,
  customRadioRowClass,
  customControlHitTargetClass,
} from "./formFieldStyles";

type CustomCheckboxProps = {
  label: string | React.ReactNode;
  id: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function CustomCheckbox({
  label,
  id,
  className = "",
  required,
  ...props
}: CustomCheckboxProps) {
  const captionId = `${id}-caption`;

  return (
    <div className={`${customCheckboxRowClass} ${className}`}>
      <label htmlFor={id} className={customCheckboxHitTargetClass}>
        <input
          type="checkbox"
          id={id}
          required={required}
          aria-labelledby={captionId}
          aria-required={required ? true : undefined}
          className={customControlInputClass}
          {...props}
        />
        <div
          className={`${customCheckboxBoxClass} peer-checked:[&>svg]:opacity-100`}
          aria-hidden="true"
        >
          <svg
            className="h-3 w-3 text-white opacity-0 transition-opacity"
            viewBox="0 0 12 10"
            fill="none"
          >
            <path
              d="M1 5l3.5 3.5L11 1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </label>
      <span id={captionId} className={customCheckboxCaptionClass}>
        {label}
        {required ? <RequiredMark /> : null}
      </span>
    </div>
  );
}

type CustomRadioProps = {
  label: string;
  id: string;
  name: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function CustomRadio({ label, id, name, className = "", ...props }: CustomRadioProps) {
  const captionId = `${id}-caption`;

  return (
    <div className={`${customRadioRowClass} ${className}`}>
      <label htmlFor={id} className={customControlHitTargetClass}>
        <input
          type="radio"
          id={id}
          name={name}
          aria-labelledby={captionId}
          className={customControlInputClass}
          {...props}
        />
        <div
          className={`${customRadioBoxClass} peer-checked:[&>div]:scale-100 peer-checked:[&>div]:opacity-100 peer-checked:peer-enabled:group-hover/control:[&>div]:bg-(--ink)`}
          aria-hidden="true"
        >
          <div className="h-2.5 w-2.5 scale-0 rounded-full bg-(--ocean) opacity-0 transition-[opacity,transform,background-color]" />
        </div>
      </label>
      <span id={captionId} className={customRadioCaptionClass}>
        {label}
      </span>
    </div>
  );
}
