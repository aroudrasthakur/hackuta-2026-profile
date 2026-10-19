# Register flow (`src/pages/Register`)

Multi-step registration: application form, draft autosave, submit, brief success screen.

## Overview

| Path | Summary |
| --- | --- |
| [RegisterPage.tsx](RegisterPage.tsx) | Step shell (application \| success); storm frame + sign-out |
| [ApplicationForm.tsx](ApplicationForm.tsx) | Full MLH application UI, draft load/save, submit (custom dropdowns; no remount on draft hydrate). Sections include **Application Questions** (`hackathonsAttended`, `experienceLevel`, two mandatory multiline answers) and **Event Preferences** (dietary options, `allergyDetails` when Allergies is checked, optional `otherDietaryRestrictions`). |
| [registerApi.ts](registerApi.ts) | Resume upload HTTP + registrations:submitRegistration + resumeUploads:discardUploadSession |
| [SuccessStep.tsx](SuccessStep.tsx) | Post-submit celebration; links to profile and landing |
| [constants.ts](constants.ts) | Re-exports form options from [shared/registration/](../../../shared/registration/) |
| [components/](components/README.md) | Form field widgets |

## Routes and guards

| Route | Guard | Page |
| --- | --- | --- |
| /register | Auth + no submitted registration | RegisterPage |

After submit, RegisterPage shows SuccessStep briefly then navigates to /profile.

## Key dependencies

| Module | Role |
| --- | --- |
| [shared/registration/](../../../shared/registration/) | Types, validation, draft mapping, submit errors |
| [convex/api.ts](../../convex/api.ts) | Draft query/mutation refs |
| [constants/mockAuth.ts](../../constants/mockAuth.ts) | Skip Convex draft when mock API on |

## Related

| Location | Role |
| --- | --- |
| [components/README.md](components/README.md) | Form-only widgets |
| [convex/README.md](../../../convex/README.md) | applications:* and registrations:* handlers |

Parent index: [../README.md](../README.md).
