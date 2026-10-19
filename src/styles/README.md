# Styles (`src/styles`)

Global CSS for the registration app. Single entry file imported from [main.tsx](../main.tsx).

## Overview

| File | Summary |
| --- | --- |
| [index.css](index.css) | Tailwind v4 theme, fonts, base reset, and component-layer classes |

## index.css sections

| Section | Classes / tokens | Used by |
| --- | --- | --- |
| @theme | --font-sans, --font-display, palette (--color-ink, --color-clay, …) | Tailwind utilities across app |
| @font-face | Barlow Semi Condensed, CS Gelios | Body and display headings |
| @layer base | :root aliases, body, focus, reduced motion | Global |
| Sign-in / storm | .sign-in-page, .sign-in-storm*, .sign-in-card*, .sign-in-form, .sign-in-btn, .sign-in-btn--secondary, .sign-in-actions, .sign-in-otp*, .sign-in-resend | SignInShell, SignInStormBackdrop, SignInPage, ForgotPasswordFlow |
| Register shell | .register-page | PageShell, loading states |
| Weather mood | .weather-mood-toggle* | WeatherMoodToggle |
| Odyssey CTA | .odyssey-btn | OdysseyButton |
| Art motion | .art-ship, .ship-oar, .ship-sail | Ship |

Form field appearance for the registration form uses mostly Tailwind classes from [formFieldStyles.ts](../pages/Register/components/formFieldStyles.ts), not dedicated CSS blocks in this file.

### Sign-in buttons

| Class | Role |
| --- | --- |
| `.sign-in-btn` | Primary submit — solid ocean fill, full width (`min-height: 3.42rem`, `padding: 0.9rem 1.5rem`, `font-size: 0.9rem`, weight 600) |
| `.sign-in-btn--secondary` | Alternate actions — forgot password, mode switch, back/cancel (bordered; `min-height: 2.75rem`, `padding: 0.65rem 1.15rem`, `font-size: 0.8125rem`, weight 500) |
| `.sign-in-actions` | Groups secondary buttons below the primary submit; `1rem` margin above the group, `0.5rem` gap between buttons inside |
| `.sign-in-otp__footer` | OTP step footer — resend link plus one secondary button, full width, `0.65rem` internal gap |
| `.sign-in-resend` | Text-style resend control in OTP footers (not a full button) |

`.sign-in-btn--ghost` shares secondary sizing and colors but is unused in TSX. Legacy `.sign-in-link` styles remain in CSS but are unused; secondary actions use `.sign-in-btn--secondary` instead.

## External assets

| Asset | Path in CSS |
| --- | --- |
| Barlow Semi Condensed | /fonts/BarlowSemiCondensed-*.woff2 |
| CS Gelios | /fonts/CSGelios-Regular.woff2 |

Font files live under [public/fonts/](../../public/fonts/).

## Related

| Location | Role |
| --- | --- |
| [public/README.md](../../public/README.md) | Font files and licenses |
| [components/README.md](../components/README.md) | Components using these CSS classes |

Parent index: [../README.md](../README.md).
