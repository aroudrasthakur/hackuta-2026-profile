import { useSignOut } from "../hooks/useSignOut";
import { OdysseyButton } from "./OdysseyButton";

type SignOutButtonProps = {
  className?: string;
  buttonClassName?: string;
};

export function SignOutButton({
  className = "flex justify-center",
  buttonClassName,
}: SignOutButtonProps) {
  const handleSignOut = useSignOut();

  return (
    <div className={className}>
      <OdysseyButton
        type="button"
        {...(buttonClassName ? { className: buttonClassName } : {})}
        onClick={() => void handleSignOut()}
      >
        Sign out
      </OdysseyButton>
    </div>
  );
}
