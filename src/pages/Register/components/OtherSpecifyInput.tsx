import { FieldError } from "./FormFields";
import { fieldClass } from "./formFieldStyles";

type OtherSpecifyInputProps = {
  id: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  maxLength?: number;
};

export function OtherSpecifyInput({
  id,
  placeholder,
  value,
  onChange,
  error,
  maxLength,
}: OtherSpecifyInputProps) {
  const errorId = `${id}-error`;

  return (
    <div className="mt-2">
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        maxLength={maxLength}
        className={fieldClass(error)}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}
