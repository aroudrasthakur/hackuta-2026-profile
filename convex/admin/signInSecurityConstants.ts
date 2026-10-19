/**
 * Pre-computed Scrypt hash used when no `adminAuthAccounts` row exists.
 * Sign-in always runs `verifyPassword` so response timing does not reveal
 * whether the email is provisioned (mitigates account enumeration).
 */
export const ADMIN_SIGN_IN_DUMMY_PASSWORD_HASH =
  "bb6f7d995cfc347c9a863503584ff172:88566a22c94ca8c063511cad240defeb8ace7c299640b4df747b4ff19384a7805bd18f49bf3f8771ba28d81c02ee21bd17740193d9b98bc918523c14ce1da0f4";
