import { lazy, Suspense, useEffect, useId, useRef, useState, type RefObject } from "react";
import { isUnsupportedNonPdfResume } from "../../lib/resumeFile";

const ResumePdf = lazy(() => import("./ResumePdf"));

export type ResumePreviewState = {
  status: "none" | "available" | "missing";
  url: string | null;
  filename: string | null;
};

type Props = {
  resume: ResumePreviewState;
  /** Compact row with icon trigger (profile list). */
  variant?: "compact" | "panel";
};

export function ResumePreviewDialog({ resume, variant = "panel" }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);

  const unsupported =
    resume.status === "available" && isUnsupportedNonPdfResume(resume.filename, resume.url);

  useEffect(() => {
    if (!open) return;
    const dialogEl = dialog.current;
    if (!dialogEl) return;
    const focusTarget = dialogEl.querySelector<HTMLElement>("[autofocus], button:not([disabled])");
    focusTarget?.focus({ preventScroll: true });
  }, [open]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }

  function openDialog() {
    setOpen(true);
    dialog.current?.showModal();
  }

  const canPreview = resume.status === "available" && resume.url && !unsupported;

  if (variant === "compact") {
    return (
      <>
        {canPreview ? (
          <button
            ref={trigger}
            type="button"
            className="participant-profile-row__icon-btn"
            aria-label="Preview resume"
            onClick={openDialog}
          >
            <EyeIcon />
          </button>
        ) : (
          <span className="participant-profile-row__hint">
            {resume.status === "none"
              ? "No resume"
              : unsupported
                ? "PDF only"
                : "Unavailable"}
          </span>
        )}
        <ResumeDialog
          dialog={dialog}
          titleId={titleId}
          open={open}
          resume={resume}
          onClose={close}
        />
      </>
    );
  }

  return (
    <section className="participant-submission-resume" aria-label="Resume">
      <div className="participant-submission-resume__head">
        <h3>Resume</h3>
        {resume.status === "available" && resume.filename ? (
          <p className="participant-submission-resume__meta">{resume.filename}{!unsupported ? " · PDF" : ""}</p>
        ) : null}
      </div>
      {canPreview ? (
        <button ref={trigger} type="button" className="participant-btn participant-btn--primary" onClick={openDialog}>
          Preview resume
        </button>
      ) : (
        <p className="participant-submission-resume__meta">
          {unsupported
            ? "Preview is only available for PDF resumes."
            : resume.status === "missing"
              ? "The attached resume is no longer available."
              : "No resume was attached."}
        </p>
      )}
      <ResumeDialog dialog={dialog} titleId={titleId} open={open} resume={resume} onClose={close} />
    </section>
  );
}

function ResumeDialog({
  dialog,
  titleId,
  open,
  resume,
  onClose,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  titleId: string;
  open: boolean;
  resume: ResumePreviewState;
  onClose: () => void;
}) {
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-modal="true"
      aria-label="Resume preview"
      className="participant-resume-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <header className="participant-resume-dialog__header">
        <h2 id={titleId}>{resume.filename || "Resume"}</h2>
      </header>
      {open && resume.url ? (
        <Suspense fallback={<p role="status" className="participant-resume-dialog__loading">Loading preview…</p>}>
          <ResumePdf key={resume.url} url={resume.url} onClose={onClose} />
        </Suspense>
      ) : null}
    </dialog>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
