# Art (`src/components/art`)

Odyssey-themed brand and illustration components. SVG art is inline; the logo uses responsive WebP files from [public/images/logos/](../../../public/images/logos/).

## Overview

| File | Summary |
| --- | --- |
| [Logo.tsx](Logo.tsx) | Responsive img for HackUTA logos (light / dark, header layout) |
| [Ship.tsx](Ship.tsx) | Inline SVG trireme; optional rowing animation, ink or clay tone |
| [OliveBranch.tsx](OliveBranch.tsx) | Inline SVG laurel branch for success / celebration states |

## Usage

| Component | Used by |
| --- | --- |
| Logo | [PageShell.tsx](../PageShell.tsx), [SignInShell.tsx](../SignInShell.tsx) |
| Ship | [PageShell.tsx](../PageShell.tsx) (background), [SuccessStep.tsx](../../pages/Register/SuccessStep.tsx) |
| OliveBranch | [SuccessStep.tsx](../../pages/Register/SuccessStep.tsx) |

## Logo assets

Logo resolves paths via [src/constants/images.ts](../../constants/images.ts):

| Variant | Base filename | Widths (WebP) |
| --- | --- | --- |
| light | hackuta-logo | 120, 240, 400, 640 |
| dark | hackuta-logo-white | 120, 240, 400, 640 |

Served from /images/logos/{base}-{width}.webp. [index.html](../../../index.html) preloads hackuta-logo-400.webp.

## Props (summary)

| Component | Notable props |
| --- | --- |
| Logo | variant, layout (header), decorative, priority |
| Ship | tone (ink \| clay), rowing, className, style |
| OliveBranch | className |

All art SVGs set aria-hidden="true" (decorative). When Logo is not decorative, alt="HackUTA" is set.

## Related

| Location | Role |
| --- | --- |
| [public/README.md](../../../public/README.md) | Static logo and art files |
| [constants/images.ts](../../constants/images.ts) | Srcset helpers |

Parent index: [../README.md](../README.md).
