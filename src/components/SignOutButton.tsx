import { useNavigate } from "react-router-dom";
import { useMockAuth } from "../hooks/useMockAuth";
import { useSessionAuth } from "../hooks/useSessionAuth";
import { OdysseyButton } from "./OdysseyButton";

type SignOutButtonProps = {
  className?: string;
  buttonClassName?: string;
};

export function SignOutButton({
  className = "flex justify-center",
  buttonClassName,
}: SignOutButtonProps) {
  const navigate = useNavigate();
  const { signOut } = useSessionAuth();
  const mockAuth = useMockAuth();

  const handleSignOut = async () => {
    if (mockAuth.enabled) {
      mockAuth.signOut();
      navigate("/sign-in", { replace: true });
      return;
    }
    await signOut();
    navigate("/sign-in", { replace: true });
  };

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
