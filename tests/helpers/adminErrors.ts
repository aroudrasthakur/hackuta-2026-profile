import { expect } from "vitest";
import { adminErrorCode, type AdminErrorCode } from "../../shared/admin/errors";

const NO_THROW = Symbol("no throw");

/** Asserts that `run` rejects with an `adminError` carrying `code`, checked on the error data. */
export async function expectAdminErrorCode(
  run: Promise<unknown> | (() => Promise<unknown>),
  code: AdminErrorCode,
) {
  let caught: unknown = NO_THROW;
  try {
    await (typeof run === "function" ? run() : run);
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected an error with code ${code}`).not.toBe(NO_THROW);
  expect(adminErrorCode(caught), String(caught)).toBe(code);
}
