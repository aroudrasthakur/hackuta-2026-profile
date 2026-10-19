import { useRef, useState, type DragEvent } from "react";
import { validateResume } from "../../../../shared/registration/resume";
import { legendClass } from "./formFieldStyles";
import { FieldError } from "./FormFields";

type ResumeUploadProps = {
  file: File | null;
  savedFilename?: string | null;
  uploading?: boolean;
  error?: string | undefined;
  disabled?: boolean;
  onChange: (file: File | null) => void;
  onError: (error: string | undefined) => void;
};

export function ResumeUpload({
  file,
  savedFilename = null,
  uploading = false,
  error,
  disabled,
  onChange,
  onError,
}: ResumeUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = (selectedFile: File | null) => {
    if (!selectedFile) {
      onChange(null);
      onError(undefined);
      return;
    }

    const validationError = validateResume(selectedFile);
    if (validationError) {
      onError(validationError);
      onChange(null);
      if (inputRef.current) inputRef.current.value = "";
    } else {
      onError(undefined);
      onChange(selectedFile);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    if (disabled) return;

    const droppedFile = e.dataTransfer.files[0];
    handleFile(droppedFile || null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleClick = () => {
    if (!disabled && !uploading) inputRef.current?.click();
  };

  const displayedFilename = file?.name ?? savedFilename;
  const hasResume = Boolean(displayedFilename);
  const isDisabled = disabled || uploading;

  const handleRemove = () => {
    onChange(null);
    onError(undefined);
    if (inputRef.current) inputRef.current.value = "";
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="resume-upload" className={legendClass}>
        Resume (optional)
      </label>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        className={`
          relative rounded-lg border-2 border-dashed p-8 text-center transition-all cursor-pointer
          ${isDragging 
            ? "border-(--ocean) bg-(--ocean)/5 scale-[1.02]" 
            : error 
              ? "border-red-400 bg-red-50" 
              : "border-(--sand) bg-white hover:border-(--ocean) hover:bg-(--clay)/30"
          }
          ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}
        `}
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isDisabled) {
            e.preventDefault();
            handleClick();
          }
        }}
        aria-label="Upload resume"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          disabled={isDisabled}
          className="hidden"
          id="resume-upload"
          onChange={(e) => handleFile(e.target.files?.[0] || null)}
          aria-describedby="resume-help resume-error"
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm font-semibold text-(--ink)">Uploading resume…</p>
            <p className="text-xs text-(--mist)">This may take a moment.</p>
          </div>
        ) : hasResume ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-(--ocean)/10">
              <svg className="h-8 w-8 text-(--ocean)" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M12 18v-6" />
                <path d="M9 15h6" />
              </svg>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-semibold text-(--ink)">
                {displayedFilename}
              </p>
              {file ? (
                <p className="text-xs text-(--mist)">
                  {formatFileSize(file.size)}
                </p>
              ) : (
                <p className="text-xs text-(--mist)">Saved to your application</p>
              )}
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
              disabled={isDisabled}
              className="text-sm font-medium text-(--ocean) underline decoration-1 underline-offset-2 transition-colors hover:text-(--ink)"
            >
              Remove resume
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-(--sand)">
              <svg className="h-8 w-8 text-(--ocean)" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-semibold text-(--ink)">
                {isDragging ? "Drop your resume here" : "Click to upload or drag and drop"}
              </p>
              <p className="text-xs text-(--mist)">
                PDF only, up to 2 MB
              </p>
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-(--ocean) px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-(--ink)"
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
              disabled={isDisabled}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Choose file
            </button>
          </div>
        )}
      </div>

      <p id="resume-help" className="text-xs text-(--mist)">
        Upload your resume as a PDF file. Maximum file size is 2 MB.
      </p>

      <FieldError id="resume-error" message={error} />
    </div>
  );
}
