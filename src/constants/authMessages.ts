/** Shown on /sign-in when a session exists without a submitted HackUTA application. */
export const PORTAL_APPLICATION_REQUIRED_MESSAGE =
  "Access to the Hacker Portal is available after you complete and submit your HackUTA application. Please finish your application, then return here to sign in.";

export const PORTAL_APPLICATION_REQUIRED_LINK_LABEL = "Complete your application";

export const PORTAL_APPLICATION_REQUIRED_LOCATION_STATE = {
  applicationRequired: true as const,
};

export type PortalSignInLocationState = {
  applicationRequired?: boolean;
  from?: string;
};

export function isPortalApplicationRequiredState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  return (state as PortalSignInLocationState).applicationRequired === true;
}
