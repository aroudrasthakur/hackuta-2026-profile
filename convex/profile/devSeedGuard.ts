const SHARED_DEV_DEPLOYMENT_SLUG = "standing-manatee-425";

/** True only for the shared dev Cloud URL. Production and empty URLs are rejected. */
export function isSharedDevSeedDeployment(cloudUrl: string | undefined): boolean {
  return (cloudUrl ?? "").includes(SHARED_DEV_DEPLOYMENT_SLUG);
}
