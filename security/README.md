# Security headers (`security/`)

Single source of truth for Content-Security-Policy, Permissions-Policy, and Referrer-Policy strings. Production deploys them via [vercel.json](../vercel.json); local vite preview mirrors the same values.

Broader threat model, validation, and upload hardening: [docs/SECURITY.md](../docs/SECURITY.md).

## Overview

| File | Summary |
| --- | --- |
| [csp.ts](csp.ts) | Strict CSP: self default, Convex in connect-src, Trusted Types, no inline scripts |
| [headers.ts](headers.ts) | Permissions-Policy and Referrer-Policy strings |

Flat directory — no subfolders.

## Where values are applied

| Consumer | Headers from security/ | Notes |
| --- | --- | --- |
| [vercel.json](../vercel.json) | CSP, Permissions-Policy, Referrer-Policy | Production + preview deploys |
| [vite.config.ts](../vite.config.ts) preview.headers | Same three | npm run preview matches prod policy |
| [vite.config.ts](../vite.config.ts) dev server | None | npm run dev does not send CSP locally |

## Trusted Types companion

| File | Role |
| --- | --- |
| [public/trusted-types.js](../public/trusted-types.js) | Registers default Trusted Types policy (loaded first in [index.html](../index.html)) |
| CSP directive | require-trusted-types-for 'script' + trusted-types default in [csp.ts](csp.ts) |

## Tests

| File | Covers |
| --- | --- |
| [tests/unit/security.test.ts](../tests/unit/security.test.ts) | vercel.json CSP / Permissions / Referrer byte-for-byte match |
| [tests/unit/csp.test.ts](../tests/unit/csp.test.ts) | CSP structure (directives, Convex, Trusted Types, workers) |
| [tests/register.spec.ts](../tests/register.spec.ts) | E2E header parity before resume upload under CSP |

Run: `npm run test:unit -- tests/unit/security.test.ts tests/unit/csp.test.ts`

## CSP allowlist (high level)

| Directive | Intent |
| --- | --- |
| default-src 'self' | Baseline same-origin |
| script-src 'self' + Vercel live | App bundle; Vercel toolbar in preview |
| script-src-attr 'none' | No inline event handlers |
| style-src 'self' 'unsafe-inline' | Tailwind / component styles |
| connect-src … *.convex.cloud / *.convex.site | Convex queries, mutations, resume HTTP |
| worker-src 'self' blob: | Vite / shader workers |
| frame-ancestors 'none' | Clickjacking protection |
| Trusted Types | Mitigate DOM XSS sink abuse |

## Headers not in this folder

These live only in [vercel.json](../vercel.json) today:

| Header | Value (summary) |
| --- | --- |
| Strict-Transport-Security | HSTS preload |
| Cross-Origin-Opener-Policy | same-origin |
| X-Frame-Options | DENY |
| X-Robots-Tag | noindex |
| Cache-Control | Long-cache for /assets, /images, /fonts, /trusted-types.js |

## Change workflow

1. Edit [csp.ts](csp.ts) and/or [headers.ts](headers.ts).
2. Copy the joined string into the matching keys in [vercel.json](../vercel.json) (/(.*) rule).
3. Run unit tests above — security.test.ts fails if strings diverge.
4. Smoke-test with npm run preview if you changed script/connect sources.

## Related

| Location | Role |
| --- | --- |
| [shared/README.md](../shared/README.md) | Input sanitization and Zod validation |
| [convex/resumeUploadSecurity.ts](../convex/resumeUploadSecurity.ts) | Resume upload origin allowlist |
| [convex/rateLimits.ts](../convex/rateLimits.ts) | OTP and upload rate limits |
| [public/README.md](../public/README.md) | trusted-types.js |

Parent index: [README.md](../README.md).
