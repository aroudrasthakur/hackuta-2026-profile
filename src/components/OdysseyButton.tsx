import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

type OdysseyButtonProps = {
  href?: string;
  children: ReactNode;
  disabled?: boolean;
  newTab?: boolean;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  className?: string;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
};

export function OdysseyButton({
  href,
  children,
  disabled = false,
  newTab = false,
  type = "button",
  className,
  onClick,
}: OdysseyButtonProps) {
  const classes = ["odyssey-btn", className].filter(Boolean).join(" ");

  if (href && !disabled) {
    if (href.startsWith("/")) {
      return (
        <Link className={classes} to={href}>
          {children}
        </Link>
      );
    }

    return (
      <a
        className={classes}
        href={href}
        {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
