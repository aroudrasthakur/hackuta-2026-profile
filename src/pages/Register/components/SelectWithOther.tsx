import { useMemo } from "react";
import { SearchableSelect } from "./SearchableSelect";
import { SelectField, TextField } from "./FormFields";

type SelectWithOtherBaseProps = {
  id: string;
  otherId: string;
  label: string;
  required?: boolean;
  otherOption: string;
  otherPlaceholder: string;
  otherLabel?: string;
  value: string;
  otherValue: string;
  onValueChange: (value: string) => void;
  onOtherValueChange: (value: string) => void;
  error?: string | undefined;
  otherError?: string | undefined;
  maxLength?: number;
};

type SearchableSelectWithOtherProps = SelectWithOtherBaseProps & {
  variant: "searchable";
  options: readonly string[];
  featuredOptions?: readonly string[];
  placeholder?: string;
};

type ListboxSelectWithOtherProps = SelectWithOtherBaseProps & {
  variant: "listbox";
  options: readonly string[];
  placeholder?: string;
};

export type SelectWithOtherProps =
  | SearchableSelectWithOtherProps
  | ListboxSelectWithOtherProps;

export function SelectWithOther(props: SelectWithOtherProps) {
  const {
    id,
    otherId,
    label,
    required,
    otherOption,
    otherPlaceholder,
    otherLabel,
    value,
    otherValue,
    onValueChange,
    onOtherValueChange,
    error,
    otherError,
    maxLength,
  } = props;

  const isOtherMode = value === otherOption;

  const listboxOptions = useMemo(() => {
    if (props.variant !== "listbox") return [];
    return [
      otherOption,
      ...props.options.filter((option) => option !== otherOption),
    ];
  }, [otherOption, props]);

  const handleValueChange = (nextValue: string) => {
    if (nextValue !== otherOption && otherValue) {
      onOtherValueChange("");
    }
    onValueChange(nextValue);
  };

  const sharedFieldProps = {
    id,
    label,
    ...(required ? { required: true as const } : {}),
    ...(error ? { error } : {}),
  };

  const picker =
    props.variant === "searchable" ? (
      <SearchableSelect
        {...sharedFieldProps}
        {...(props.placeholder ? { placeholder: props.placeholder } : {})}
        value={value}
        options={props.options}
        {...(props.featuredOptions ? { featuredOptions: props.featuredOptions } : {})}
        extraOptions={[otherOption]}
        onChange={handleValueChange}
      />
    ) : (
      <SelectField
        {...sharedFieldProps}
        {...(props.placeholder ? { placeholder: props.placeholder } : {})}
        value={value}
        options={listboxOptions}
        onChange={handleValueChange}
      />
    );

  // Render the follow-up field as a sibling, not nested under the picker, so parent
  // grid layouts can place it in normal field order instead of stacking below.
  return (
    <>
      {picker}
      {isOtherMode ? (
        <TextField
          id={otherId}
          label={otherLabel ?? otherPlaceholder}
          {...(required ? { required: true as const } : {})}
          placeholder={otherPlaceholder}
          value={otherValue}
          onChange={(event) => onOtherValueChange(event.target.value)}
          {...(maxLength !== undefined ? { maxLength } : {})}
          {...(otherError ? { error: otherError } : {})}
        />
      ) : null}
    </>
  );
}
