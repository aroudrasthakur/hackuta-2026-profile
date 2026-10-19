import { PROFILE_ASSETS } from "../../constants/images";

export function ProfileAsset() {
  return (
    <>
      <p className="sr-only">
        HackUTA 2026 odyssey illustrations of a ship, clouds, and an island
      </p>
      <div
        className="pointer-events-none fixed inset-0 z-[1]"
        aria-hidden="true"
        data-testid="profile-decorations"
      >
        <img
          src={PROFILE_ASSETS.clouds}
          alt=""
          className="absolute top-0 left-0 h-[58vh] w-auto max-w-none"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-end">
          <img
            src={PROFILE_ASSETS.island}
            alt=""
            className="h-[52vh] w-[46vw] max-w-none object-contain object-bottom"
          />
          <img
            src={PROFILE_ASSETS.ship}
            alt=""
            className="w-[54vw] max-w-none translate-y-[14vh] self-end"
          />
        </div>
      </div>
    </>
  );
}
