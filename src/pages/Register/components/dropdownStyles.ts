export const dropdownContainerClass = (open: boolean) =>
  open ? "relative z-30" : "relative";

export const dropdownPanelClass =
  "absolute z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border-2 border-(--sand) bg-white py-1 shadow-lg";

export const dropdownOptionClass = (active: boolean) =>
  `block w-full px-3 py-2 text-left text-sm hover:bg-(--clay) ${
    active ? "bg-(--clay) font-medium text-(--ink)" : "text-(--ink)"
  }`;
