import { convexTest } from "convex-test";
import { minimalPdfBytes } from "../fixtures/minimalPdf";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import {
  deleteStorageIfExists,
  prepareResumeDraftPatch,
} from "../../convex/lib/draftResume";
import { MAX_RESUME_BYTES, RESUME_UPLOAD_EXPIRED_MESSAGE } from "../../shared/registration/resume";

const modules = import.meta.glob("../../convex/**/*.ts", { eager: false });
const createTest = () => convexTest(schema, modules);
type TestInstance = ReturnType<typeof createTest>;

function pdfBytes() {
  return minimalPdfBytes();
}

async function storePdf(
  t: Pick<TestInstance, "run">,
  contents: BlobPart,
  contentType = "application/pdf",
) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([contents], { type: contentType })));
  await t.run((ctx) =>
    (ctx.db.patch as unknown as (id: string, value: { contentType: string }) => Promise<void>)(storageId, {
      contentType,
    }),
  );
  return storageId;
}

async function seedUser(t: Pick<TestInstance, "run">) {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      email: "draft-resume@example.com",
      emailVerificationTime: Date.now(),
    }),
  );
}

async function seedApplication(
  t: Pick<TestInstance, "run">,
  authUserId: GenericId<"users">,
  fields: { resumeStorageId?: GenericId<"_storage"> } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("applications", {
      authUserId,
      email: "draft-resume@example.com",
      createdAt: Date.now(),
      applicantUpdatedAt: Date.now(),
      ...fields,
    }),
  );
}

async function verifiedSession(
  t: Pick<TestInstance, "run">,
  authUserId: GenericId<"users">,
  storageId: GenericId<"_storage">,
  createdAt = Date.now(),
) {
  await t.run((ctx) =>
    ctx.db.insert("resumeUploadSessions", {
      token: crypto.randomUUID(),
      authUserId,
      storageId,
      createdAt,
      verifiedAt: createdAt,
    }),
  );
}

describe("prepareResumeDraftPatch", () => {
  it("no-ops when the patch omits resume fields", async () => {
    const t = createTest();
    const authUserId = await seedUser(t);
    const applicationId = await seedApplication(t, authUserId);
    const application = await t.run((ctx) => ctx.db.get(applicationId));

    await expect(
      t.run((ctx) => prepareResumeDraftPatch(ctx, application!, {}, authUserId)),
    ).resolves.toEqual({});
  });

  it("returns the previous storage id when clearing a saved resume", async () => {
    const t = createTest();
    const authUserId = await seedUser(t);
    const oldStorageId = await storePdf(t, await pdfBytes());
    const applicationId = await seedApplication(t, authUserId, { resumeStorageId: oldStorageId });
    const application = await t.run((ctx) => ctx.db.get(applicationId));

    await expect(
      t.run((ctx) =>
        prepareResumeDraftPatch(ctx, application!, { resumeStorageId: null }, authUserId),
      ),
    ).resolves.toEqual({ deleteStorageId: oldStorageId });
  });

  it("no-ops when attaching the same storage id that is already saved", async () => {
    const t = createTest();
    const authUserId = await seedUser(t);
    const storageId = await storePdf(t, await pdfBytes());
    await verifiedSession(t, authUserId, storageId);
    const applicationId = await seedApplication(t, authUserId, { resumeStorageId: storageId });
    const application = await t.run((ctx) => ctx.db.get(applicationId));

    await expect(
      t.run((ctx) =>
        prepareResumeDraftPatch(
          ctx,
          application!,
          { resumeStorageId: storageId, resumeFilename: "resume.pdf" },
          authUserId,
        ),
      ),
    ).resolves.toEqual({});
  });

  it("returns the previous storage id when replacing a saved resume", async () => {
    const t = createTest();
    const authUserId = await seedUser(t);
    const oldStorageId = await storePdf(t, await pdfBytes());
    const nextStorageId = await storePdf(t, await pdfBytes());
    await verifiedSession(t, authUserId, nextStorageId);
    const applicationId = await seedApplication(t, authUserId, { resumeStorageId: oldStorageId });
    const application = await t.run((ctx) => ctx.db.get(applicationId));

    await expect(
      t.run((ctx) =>
        prepareResumeDraftPatch(
          ctx,
          application!,
          { resumeStorageId: nextStorageId, resumeFilename: "next.pdf" },
          authUserId,
        ),
      ),
    ).resolves.toEqual({ deleteStorageId: oldStorageId });
  });

  it("rejects invalid filenames before checking storage", async () => {
    const t = createTest();
    const authUserId = await seedUser(t);
    const applicationId = await seedApplication(t, authUserId);
    const application = await t.run((ctx) => ctx.db.get(applicationId));

    await expect(
      t.run((ctx) =>
        prepareResumeDraftPatch(
          ctx,
          application!,
          { resumeStorageId: "kg2537xxya4qwd56jj2kmhke098f2thx", resumeFilename: "resume.exe" },
          authUserId,
        ),
      ),
    ).rejects.toThrow("Please select a PDF file.");
  });

  it("rejects non-PDF or oversized storage metadata", async () => {
    const t = createTest();
    const authUserId = await seedUser(t);
    const textStorageId = await storePdf(t, "plain text", "text/plain");
    await verifiedSession(t, authUserId, textStorageId);
    const applicationId = await seedApplication(t, authUserId);
    const application = await t.run((ctx) => ctx.db.get(applicationId));

    await expect(
      t.run((ctx) =>
        prepareResumeDraftPatch(
          ctx,
          application!,
          { resumeStorageId: textStorageId, resumeFilename: "resume.pdf" },
          authUserId,
        ),
      ),
    ).rejects.toThrow("Please upload a valid PDF resume of 2 MB or smaller.");

    const oversizedStorageId = await storePdf(t, await pdfBytes());
    await t.run((ctx) =>
      (ctx.db.patch as unknown as (id: string, value: { size: number }) => Promise<void>)(oversizedStorageId, {
        size: MAX_RESUME_BYTES + 1,
      }),
    );
    await verifiedSession(t, authUserId, oversizedStorageId);

    await expect(
      t.run((ctx) =>
        prepareResumeDraftPatch(
          ctx,
          application!,
          { resumeStorageId: oversizedStorageId, resumeFilename: "large.pdf" },
          authUserId,
        ),
      ),
    ).rejects.toThrow("Please upload a valid PDF resume of 2 MB or smaller.");
  });

  it("rejects resumes already attached to another application", async () => {
    const t = createTest();
    const ownerId = await seedUser(t);
    const otherUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "other-applicant@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const storageId = await storePdf(t, await pdfBytes());
    await verifiedSession(t, ownerId, storageId);
    await seedApplication(t, otherUserId, { resumeStorageId: storageId });
    const applicationId = await seedApplication(t, ownerId);
    const application = await t.run((ctx) => ctx.db.get(applicationId));

    await expect(
      t.run((ctx) =>
        prepareResumeDraftPatch(
          ctx,
          application!,
          { resumeStorageId: storageId, resumeFilename: "resume.pdf" },
          ownerId,
        ),
      ),
    ).rejects.toThrow("This resume is already attached to another application.");
  });

  it("rejects uploads whose session expired or belongs to another user", async () => {
    const t = createTest();
    const authUserId = await seedUser(t);
    const otherUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "someone-else@example.com",
        emailVerificationTime: Date.now(),
      }),
    );
    const storageId = await storePdf(t, await pdfBytes());
    const applicationId = await seedApplication(t, authUserId);
    const application = await t.run((ctx) => ctx.db.get(applicationId));

    await verifiedSession(t, otherUserId, storageId);
    await expect(
      t.run((ctx) =>
        prepareResumeDraftPatch(
          ctx,
          application!,
          { resumeStorageId: storageId, resumeFilename: "theirs.pdf" },
          authUserId,
        ),
      ),
    ).rejects.toThrow(RESUME_UPLOAD_EXPIRED_MESSAGE);

    const expiredStorageId = await storePdf(t, await pdfBytes());
    const expiredAt = Date.now() - 31 * 60 * 1000;
    await verifiedSession(t, authUserId, expiredStorageId, expiredAt);
    await expect(
      t.run((ctx) =>
        prepareResumeDraftPatch(
          ctx,
          application!,
          { resumeStorageId: expiredStorageId, resumeFilename: "late.pdf" },
          authUserId,
        ),
      ),
    ).rejects.toThrow(RESUME_UPLOAD_EXPIRED_MESSAGE);
  });
});

describe("deleteStorageIfExists", () => {
  it("deletes an existing file and ignores missing files", async () => {
    const t = createTest();
    const storageId = await storePdf(t, await pdfBytes());

    await t.run(async (ctx) => {
      await deleteStorageIfExists(ctx, storageId);
      expect(await ctx.db.system.get("_storage", storageId)).toBeNull();
      await expect(deleteStorageIfExists(ctx, storageId)).resolves.toBeUndefined();
    });
  });
});
