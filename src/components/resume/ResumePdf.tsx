import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdfjs/pdf.worker.min.mjs`;

const options = {
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
  cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
};

export default function ResumePdf({ url, onClose }: { url: string; onClose: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<"unavailable" | "render" | null>(null);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, entry.contentRect.width - 32));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function changePage(next: number) {
    setPage(next);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }

  const buttonClass = "participant-resume-dialog__btn";

  return (
    <div className="participant-resume-dialog__viewer">
      <div className="participant-resume-dialog__toolbar" aria-label="PDF controls">
        <div className="participant-resume-dialog__toolbar-group">
          <button type="button" className={buttonClass} disabled={!pages || page <= 1 || failure !== null} onClick={() => changePage(page - 1)}>Previous</button>
          <span role="status" className="participant-resume-dialog__page">{pages ? `Page ${page} of ${pages}` : "PDF"}</span>
          <button type="button" className={buttonClass} disabled={!pages || page >= pages || failure !== null} onClick={() => changePage(page + 1)}>Next</button>
        </div>
        <div className="participant-resume-dialog__toolbar-group">
          <button type="button" aria-label="Zoom out" className={buttonClass} disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
          <button type="button" className={buttonClass} onClick={() => setZoom(1)}>Fit width</button>
          <span className="participant-resume-dialog__page">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" className={buttonClass} disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))}>+</button>
          <button type="button" autoFocus className={buttonClass} onClick={onClose}>Close</button>
        </div>
      </div>
      <div ref={viewport} className="participant-resume-dialog__pages" tabIndex={0} aria-label="Resume pages">
        {failure !== null ? (
          <div role="alert" className="participant-resume-dialog__error">
            <h3>{failure === "unavailable" ? "Resume file unavailable" : "Unable to open this PDF"}</h3>
            <p>
              {failure === "unavailable"
                ? "We could not fetch the uploaded resume. Try again or close and reopen the preview."
                : "The file could not be displayed. It may be corrupted or unsupported in this browser."}
            </p>
            <button type="button" className={buttonClass} onClick={() => { setFailure(null); setPages(0); setPage(1); setAttempt((value) => value + 1); }}>Try again</button>
          </div>
        ) : (
          <Document key={attempt} file={url} options={options} loading={<p role="status">Loading resume…</p>} onLoadSuccess={({ numPages }) => setPages(numPages)} onLoadError={() => setFailure("render")} onSourceError={() => setFailure("unavailable")} onPassword={() => setFailure("render")}>
            {width > 0 && <Page key={page} pageNumber={page} width={Math.min(width, 1000) * zoom} renderAnnotationLayer={false} loading={<p role="status">Loading page…</p>} onLoadError={() => setFailure("render")} onRenderError={() => setFailure("render")} />}
          </Document>
        )}
      </div>
    </div>
  );
}
