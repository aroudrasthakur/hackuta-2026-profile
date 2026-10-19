export const profilePageTitle = "text-2xl font-semibold text-(--ink)";

export const profilePageTitleSubmitted = "text-3xl font-semibold text-(--ink) sm:text-[2rem]";

export const profilePageSubtitle = "mt-2 text-sm leading-relaxed text-(--mist)";

export const profilePageSubtitleSubmitted = "mt-2.5 text-base leading-relaxed text-(--mist)";

export const profileSectionTitle =
  "border-b border-(--sand) pb-2 text-base font-semibold text-(--ink)";

export const profileSection = "space-y-4";

export const profileFieldLabel =
  "text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-(--ocean)/75";

export const profileFieldValue = "mt-1.5 text-base font-medium leading-snug text-(--ink)";

export const profileFieldValueSubmitted =
  "mt-1.5 text-lg font-medium leading-snug text-(--ink) sm:text-[1.125rem]";

export const profileFieldGrid = "grid gap-5 sm:grid-cols-2";

export const profileFieldStack = "grid gap-4";

export const profileStatusBadge =
  "inline-flex rounded-full border-2 border-(--ocean)/25 bg-(--ocean)/8 px-3.5 py-1 text-sm font-semibold capitalize text-(--ink)";

export const profileMetaText = "text-sm text-(--mist)";

export const profileOverviewGrid =
  "grid flex-1 gap-8 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] lg:items-start lg:gap-14";

export const profileOverviewPanel = "flex flex-col gap-6";

/** Nudge the timeline column right on large screens. Increase `lg:pl-*` to shift further. */
export const profileOverviewTimelinePanel = `${profileOverviewPanel} lg:pl-12`;

export const profileTimelineDate =
  "text-sm font-semibold uppercase tracking-[0.14em] text-(--mist)";

export const profileTimelineNextUp =
  "mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-(--ocean)";

export const profileTimelineLabel = "text-lg font-semibold text-(--ink)";

export const profileTimelineDescription = "mt-1 text-base leading-relaxed text-(--mist)";

export const profileCompactButton = "!min-h-11 !min-w-0 !px-8 !py-2";

/** Fills the compact PageShell card so sign-out can sit at the panel bottom. */
export const profilePageBody = "flex min-h-0 flex-1 flex-col gap-6";

/** Left-aligned with applicant details; pinned near the panel bottom via mt-auto. */
export const profileSignOutWrap = "mt-auto self-start pt-4";

export const profileSignOutButton =
  "profile-sign-out-btn !min-h-11 !min-w-0 !px-8 !py-2";
