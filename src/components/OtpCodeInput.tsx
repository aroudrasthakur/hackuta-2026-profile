import { useCallback, useId, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

const OTP_LENGTH = 6;
const OTP_GROUP_SIZE = 3;

type OtpCodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export function OtpCodeInput({ value, onChange, disabled = false, invalid = false }: OtpCodeInputProps) {
  const labelId = useId();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = digitsOnly(value).padEnd(OTP_LENGTH, " ").split("");

  const focusIndex = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, OTP_LENGTH - 1));
    inputRefs.current[clamped]?.focus();
  }, []);

  const applyDigits = useCallback(
    (nextDigits: string) => {
      onChange(digitsOnly(nextDigits));
    },
    [onChange],
  );

  const handleChange = (index: number, nextValue: string) => {
    const cleaned = digitsOnly(nextValue);
    if (!cleaned) {
      const chars = digitsOnly(value).split("");
      chars[index] = "";
      applyDigits(chars.join(""));
      return;
    }

    if (cleaned.length > 1) {
      applyDigits(cleaned);
      focusIndex(Math.min(cleaned.length, OTP_LENGTH - 1));
      return;
    }

    const chars = digitsOnly(value).padEnd(OTP_LENGTH, " ").split("");
    chars[index] = cleaned;
    applyDigits(chars.join("").trimEnd());
    if (index < OTP_LENGTH - 1) {
      focusIndex(index + 1);
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index]?.trim() && index > 0) {
      event.preventDefault();
      focusIndex(index - 1);
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusIndex(index - 1);
    }
    if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      focusIndex(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text");
    applyDigits(pasted);
    focusIndex(Math.min(digitsOnly(pasted).length, OTP_LENGTH - 1));
  };

  const renderGroup = (start: number) =>
    Array.from({ length: OTP_GROUP_SIZE }, (_, offset) => {
      const index = start + offset;
      return (
        <input
          key={index}
          ref={(element) => {
            inputRefs.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-labelledby={labelId}
          maxLength={OTP_GROUP_SIZE}
          disabled={disabled}
          value={digits[index]?.trim() ?? ""}
          className="sign-in-otp__cell"
          aria-invalid={invalid}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
        />
      );
    });

  return (
    <div className="sign-in-otp">
      <span id={labelId} className="sign-in-field__label">
        Verification code
      </span>
      <div className="sign-in-otp__groups" role="group" aria-labelledby={labelId}>
        <div className="sign-in-otp__group">{renderGroup(0)}</div>
        <span className="sign-in-otp__sep" aria-hidden="true">
          –
        </span>
        <div className="sign-in-otp__group">{renderGroup(OTP_GROUP_SIZE)}</div>
      </div>
    </div>
  );
}
