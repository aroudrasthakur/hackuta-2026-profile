export const inputClass =
  "w-full min-w-0 rounded-lg border-2 border-(--sand) bg-white px-4 py-3 text-(--ink) outline-none transition-colors focus:border-(--ocean) focus:ring-2 focus:ring-(--ocean)/20 disabled:cursor-not-allowed disabled:opacity-60";

const inputErrorClass = "border-red-400 focus:border-red-500 focus:ring-red-100";

export const labelClass =
  "flex w-full min-w-0 flex-col gap-1.5 text-sm font-medium text-(--ink)";
export const legendClass = "font-semibold text-(--ink)";

export const fieldsetLegendClass = `${legendClass} mb-5 block w-full`;

export const checkboxFieldsetClass = "flex flex-col gap-6 text-sm";

export const checkboxGridClass = "grid grid-cols-1 gap-4 sm:grid-cols-2";

export const inlineRadioGroupClass = "flex flex-wrap gap-6";

export const customCheckboxRowClass = "flex items-start gap-3 text-(--ink)";

export const customRadioRowClass = "flex items-center gap-3 text-(--ink)";

/** Wraps only the visible control — hover and click stay on the box, not the caption. */
export const customControlHitTargetClass =
  "group/control relative flex shrink-0 cursor-pointer items-center justify-center " +
  "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

export const customCheckboxHitTargetClass = `${customControlHitTargetClass} mt-0.5`;

export const customControlInputClass =
  "peer absolute opacity-0 w-5 h-5 cursor-pointer disabled:cursor-not-allowed";

export const customControlBoxClass =
  "w-5 h-5 shrink-0 border-2 border-(--sand) bg-white transition-[color,background-color,border-color,box-shadow,opacity,transform] " +
  "peer-enabled:group-hover/control:border-(--ocean)/45 peer-enabled:group-hover/control:bg-(--light) " +
  "peer-focus-visible:ring-2 peer-focus-visible:ring-(--ocean)/30 peer-focus-visible:ring-offset-2 " +
  "peer-disabled:cursor-not-allowed peer-disabled:opacity-60 peer-disabled:bg-(--light) " +
  "flex items-center justify-center";

export const customCheckboxBoxClass =
  `${customControlBoxClass} rounded ` +
  "peer-checked:border-(--ocean) peer-checked:bg-(--ocean) " +
  "peer-checked:peer-enabled:group-hover/control:border-(--ink) peer-checked:peer-enabled:group-hover/control:bg-(--ink)";

export const customRadioBoxClass =
  `${customControlBoxClass} rounded-full ` +
  "peer-checked:border-(--ocean) peer-checked:peer-enabled:group-hover/control:border-(--ink)";

export const customCheckboxCaptionClass = "text-sm leading-relaxed";

export const customRadioCaptionClass = "text-sm font-medium";

export function fieldClass(error?: string) {
  return error ? `${inputClass} ${inputErrorClass}` : inputClass;
}

const compactSelectClass =
  "appearance-none rounded-lg border-2 border-(--sand) bg-white py-3 pl-2 pr-5 text-sm text-(--ink) " +
  "outline-none transition-colors focus:border-(--ocean) focus:ring-2 focus:ring-(--ocean)/20 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export function countryCodeSelectClass(error?: string) {
  return error
    ? `${compactSelectClass} border-red-400 focus:border-red-500 focus:ring-red-100`
    : compactSelectClass;
}

export function fieldsetErrorClass(hasError: boolean) {
  return hasError ? "rounded-lg border-2 border-red-400 bg-red-50 p-4" : "";
}
