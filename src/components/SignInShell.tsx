import type { ReactNode } from "react";
import { Logo } from "./art/Logo";
import { SignInStormBackdrop } from "./SignInStormBackdrop";
import { LANDING_URL } from "../constants/site";

type SignInShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: ReactNode;
};

export function SignInShell({
  children,
  title = "Sign in",
  subtitle = "Sign in with your email and password to continue your application.",
}: SignInShellProps) {
  return (
    <main className="sign-in-page relative min-h-screen overflow-hidden">
      <SignInStormBackdrop />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <div className="sign-in-card w-full">
          <a
            href={LANDING_URL}
            aria-label="HackUTA home"
            className="sign-in-card__logo inline-flex transition-opacity hover:opacity-80"
          >
            <Logo className="h-12 w-auto" variant="light" layout="header" decorative />
          </a>

          <div className="sign-in-card__heading">
            <h1 className="sign-in-card__title">{title}</h1>
            {subtitle ? <p className="sign-in-card__subtitle">{subtitle}</p> : null}
          </div>

          <div className="sign-in-card__body">{children}</div>
        </div>
      </div>
    </main>
  );
}
