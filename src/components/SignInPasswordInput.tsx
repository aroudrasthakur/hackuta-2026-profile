import { useState, type InputHTMLAttributes } from "react";

type SignInPasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function SignInPasswordInput({
  className = "sign-in-field__input",
  ...props
}: SignInPasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="sign-in-field__control">
      <input {...props} type={visible ? "text" : "password"} className={className} />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 3l18 18" />
            <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83" />
            <path d="M9.88 5.09A9.9 9.9 0 0 1 12 5c7 0 10 7 10 7a13.3 13.3 0 0 1-1.67 2.68" />
            <path d="M6.61 6.61C3.98 8.27 2 12 2 12s3 7 10 7a9.7 9.7 0 0 0 5.04-1.38" />
          </svg>
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
