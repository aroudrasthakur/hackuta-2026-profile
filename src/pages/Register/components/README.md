# Register form components (`src/pages/Register/components`)

Presentational widgets used only by [ApplicationForm](../ApplicationForm.tsx). Not shared with [src/components/](../../../components/README.md).

## Overview

| File | Summary |
| --- | --- |
| [FormFields.tsx](FormFields.tsx) | RequiredMark, FieldError, TextField, TextAreaField, SelectField — accessible labeled inputs |
| [formFieldStyles.ts](formFieldStyles.ts) | Tailwind tokens: fieldClass(), fieldsetErrorClass() |
| [SelectWithOther.tsx](SelectWithOther.tsx) | Unified picker + inline “Other (Please Specify)” text entry for school, major, and hear-about |
| [OtherSpecifyInput.tsx](OtherSpecifyInput.tsx) | Shared styled text input for checkbox-based Other follow-ups (race/ethnicity) |
| [SearchableSelect.tsx](SearchableSelect.tsx) | Filterable combobox used by SelectWithOther for school search |
| [dropdownStyles.ts](dropdownStyles.ts) | Shared listbox panel and option classes for SelectField and SearchableSelect |
| [useDropdownDismiss.ts](useDropdownDismiss.ts) | Closes open dropdowns on outside click or Escape |
| [CustomCheckbox.tsx](CustomCheckbox.tsx) | CustomCheckbox, CustomRadio — styled controls matching Odyssey theme |
| [ResumeUpload.tsx](ResumeUpload.tsx) | Drag-and-drop PDF picker with client validation |

SelectField and SearchableSelect use custom listbox/combobox widgets (not native `<select>`) to avoid flicker during draft autosave re-renders.

## Usage

| Component | Used in ApplicationForm for |
| --- | --- |
| TextField, SelectField, FieldError | Name, email, selects, numeric fields (age, graduation year, hackathons attended) |
| TextAreaField | Mandatory application questions (`builtOrWantToBuild`, `shortDeadlineLearning`); optional accessibility notes |
| SelectWithOther | School (searchable), major, gender, hear-about — Other/self-describe option pinned first; picker stays visible with a follow-up text field when selected |
| OtherSpecifyInput | Race/ethnicity “Other (Please Specify)” follow-up |
| CustomCheckbox | Race/ethnicity, dietary (includes No Beef / No Pork), MLH consents |
| CustomRadio | International student yes/no |
| ResumeUpload | Resume PDF |
| formFieldStyles | All of the above + inline fields |

## Tests

| File | Test |
| --- | --- |
| SearchableSelect.tsx | [searchable-select.test.tsx](../../../../tests/unit/searchable-select.test.tsx) |
| SelectWithOther.tsx | [select-with-other.test.tsx](../../../../tests/unit/select-with-other.test.tsx) |
| Other option storage regression | [other-option-fields.test.ts](../../../../tests/unit/other-option-fields.test.ts), [other-option-schema.test.ts](../../../../tests/unit/other-option-schema.test.ts) |
| SelectField (FormFields.tsx) | [select-field.test.tsx](../../../../tests/unit/select-field.test.tsx) |
| CustomCheckbox.tsx | [custom-checkbox.test.tsx](../../../../tests/unit/custom-checkbox.test.tsx) |
| FormFields.tsx (TextAreaField) | [form-fields.test.tsx](../../../../tests/unit/form-fields.test.tsx) |
| ResumeUpload.tsx | [resume-upload.test.tsx](../../../../tests/unit/resume-upload.test.tsx) |

Validation rules: [shared/registration/](../../../../shared/registration/) (e.g. validateResume).

## Related

| Location | Role |
| --- | --- |
| [../README.md](../README.md) | Register flow overview |
| [shared/registration/resume.ts](../../../../shared/registration/resume.ts) | Client resume policy |

Parent index: [../README.md](../README.md).
