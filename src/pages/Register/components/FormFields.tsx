import {
  memo,
  useCallback,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { DropdownChevron } from "./DropdownChevron";
import {
  dropdownContainerClass,
  dropdownOptionClass,
  dropdownPanelClass,
} from "./dropdownStyles";
import { fieldClass, labelClass, legendClass } from "./formFieldStyles";
import { useDropdownDismiss } from "./useDropdownDismiss";

export function RequiredMark() {
  return (
    <>
      {" "}
      <span aria-hidden="true">*</span>
    </>
  );
}

export function FieldError({
  id,
  message,
}: {
  id: string;
  message?: string | undefined;
}) {
  if (!message) return null;

  return (
    <p id={id} className="text-xs font-medium text-red-600">
      {message}
    </p>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  helperText?: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function TextField({
  id,
  label,
  required,
  error,
  helperText,
  className,
  ...inputProps
}: TextFieldProps) {
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const descriptionIds = [helperText ? helperId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={labelClass} htmlFor={id}>
      <span className={legendClass}>
        {label}
        {required ? <RequiredMark /> : null}
      </span>
      <input
        id={id}
        required={required}
        aria-invalid={!!error}
        aria-describedby={descriptionIds || undefined}
        className={className ?? fieldClass(error)}
        {...inputProps}
      />
      {helperText ? (
        <p id={helperId} className="text-xs font-normal text-(--ocean)">
          {helperText}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </label>
  );
}

type TextAreaFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  helperText?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextAreaField({
  id,
  label,
  required,
  error,
  helperText,
  className,
  ...textareaProps
}: TextAreaFieldProps) {
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const descriptionIds = [helperText ? helperId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={labelClass} htmlFor={id}>
      <span className={legendClass}>
        {label}
        {required ? <RequiredMark /> : null}
      </span>
      <textarea
        id={id}
        required={required}
        aria-invalid={!!error}
        aria-describedby={descriptionIds || undefined}
        className={className ?? `${fieldClass(error)} resize-y min-h-[6rem]`}
        {...textareaProps}
      />
      {helperText ? (
        <p id={helperId} className="text-xs font-normal text-(--ocean)">
          {helperText}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </label>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  helperText?: string;
  placeholder?: string;
  value: string;
  options: readonly string[];
  disabled?: boolean;
  onChange: (value: string) => void;
};

export const SelectField = memo(function SelectField({
  id,
  label,
  required,
  error,
  helperText,
  placeholder = "Select one",
  value,
  options,
  disabled,
  onChange,
}: SelectFieldProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const closeList = useCallback(() => setOpen(false), []);
  useDropdownDismiss(containerRef, open, closeList);

  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const descriptionIds = [helperText ? helperId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  const selectedIndex = value ? options.indexOf(value) : -1;
  const activeOptionIndex =
    options.length === 0 ? 0 : Math.min(activeIndex, options.length - 1);

  const openList = useCallback(() => {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [disabled, selectedIndex]);

  const selectOption = useCallback(
    (option: string) => {
      onChange(option);
      closeList();
    },
    [closeList, onChange],
  );

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openList();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }

    if (event.key === "Enter" && open && options[activeOptionIndex]) {
      event.preventDefault();
      selectOption(options[activeOptionIndex]!);
    }
  };

  const displayValue = value || placeholder;

  return (
    <div ref={containerRef} className={`${dropdownContainerClass(open)} w-full`}>
      <label className={labelClass} htmlFor={id}>
        <span className={legendClass}>
          {label}
          {required ? <RequiredMark /> : null}
        </span>
        <div className="relative w-full">
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-haspopup="listbox"
            aria-invalid={!!error}
            aria-describedby={descriptionIds || undefined}
            aria-required={required || undefined}
            disabled={disabled}
            className={`${fieldClass(error)} w-full cursor-pointer pr-10 text-left disabled:cursor-not-allowed`}
            onClick={() => (open ? closeList() : openList())}
            onKeyDown={handleTriggerKeyDown}
          >
            <span className={value ? "text-(--ink)" : "text-(--mist)"}>
              {displayValue}
            </span>
          </button>
          <DropdownChevron active={open} />
        </div>
        {helperText ? (
          <p id={helperId} className="text-xs font-normal text-(--ocean)">
            {helperText}
          </p>
        ) : null}
        <FieldError id={errorId} message={error} />
      </label>

      {open ? (
        <ul id={listboxId} role="listbox" className={dropdownPanelClass}>
          {options.map((option, index) => (
            <li key={option} role="option" aria-selected={option === value}>
              <button
                type="button"
                className={dropdownOptionClass(
                  index === activeOptionIndex || option === value,
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
