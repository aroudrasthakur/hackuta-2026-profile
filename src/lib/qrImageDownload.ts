export const CHECK_IN_QR_IMAGE_FILENAME = "hackuta-2026-checkin.png";

export type CheckInPassImageDetails = {
  displayName: string;
  email: string | null;
  hackathonName: string;
  startsAt: number | null;
  endsAt: number | null;
};

const PASS_WIDTH = 1080;
const PASS_PADDING = 72;
const PASS_RADIUS = 48;
const QR_MODULE_PIXELS = 10;
const QR_QUIET_ZONE_MODULES = 4;
const NAVY = "#102f46";
const CREAM = "#f6eddf";
const LABEL = "#8ca1aa";
const QR_FOREGROUND = "#1a3a52";
const QR_BACKGROUND = "#ffffff";
const SANS = '"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif';
const DISPLAY = '"CS Gelios", Georgia, "Times New Roman", serif';
const QR_MODULE_COMMAND = /M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Failed to encode QR image."));
    }, "image/png");
  });
}

function qrViewBoxSize(svg: SVGSVGElement): number {
  const viewBox = svg.viewBox.baseVal.width;
  if (viewBox > 0) return viewBox;
  const parts = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/) ?? [];
  const size = Number(parts[2]);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function isLightFill(fill: string | null): boolean {
  const value = (fill ?? "").trim().toLowerCase();
  return value === "" || value === "#fff" || value === "#ffffff" || value === "white";
}

function darkModuleCells(svg: SVGSVGElement): Array<[number, number]> {
  const darkPath =
    Array.from(svg.querySelectorAll("path")).find((path) => !isLightFill(path.getAttribute("fill"))) ??
    null;
  const d = darkPath?.getAttribute("d") ?? "";
  const cells: Array<[number, number]> = [];
  for (const match of d.matchAll(QR_MODULE_COMMAND)) {
    cells.push([Number(match[1]), Number(match[2])]);
  }
  return cells;
}

export function formatCheckInPassEventWindow(startsAt: number, endsAt: number): string {
  const partsFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  });
  const startParts = Object.fromEntries(
    partsFormatter.formatToParts(new Date(startsAt)).map((part) => [part.type, part.value]),
  );
  const endParts = Object.fromEntries(
    partsFormatter.formatToParts(new Date(endsAt)).map((part) => [part.type, part.value]),
  );
  if (
    startParts.month === endParts.month &&
    startParts.year === endParts.year &&
    startParts.day !== endParts.day
  ) {
    return `${startParts.month} ${startParts.day}–${endParts.day}, ${startParts.year}`;
  }
  const startLabel = partsFormatter.format(new Date(startsAt));
  const endLabel = partsFormatter.format(new Date(endsAt));
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

async function waitForPassFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`600 24px ${SANS}`),
        document.fonts.load(`700 40px ${SANS}`),
        document.fonts.load(`64px ${DISPLAY}`),
        document.fonts.ready,
      ]),
      new Promise((resolve) => window.setTimeout(resolve, 800)),
    ]);
  } catch {
    // System fonts still render a readable pass.
  }
}

function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function fillFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: string,
  maxSize: number,
) {
  let size = maxSize;
  while (size > 22) {
    context.font = font.replace("SIZE", String(size));
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  context.fillText(text, x, y);
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (!current || context.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function drawField(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  context.fillStyle = LABEL;
  context.font = `600 22px ${SANS}`;
  context.fillText(label, x, y);
  context.fillStyle = CREAM;
  context.font = `700 36px ${SANS}`;
  const lines = wrapText(context, value, maxWidth, 2);
  lines.forEach((line, index) => {
    fillFittedText(
      context,
      line,
      x,
      y + 44 + index * 42,
      maxWidth,
      `700 SIZEpx ${SANS}`,
      36,
    );
  });
}

export async function svgElementToPngBlob(
  svg: SVGSVGElement,
  details: CheckInPassImageDetails,
): Promise<Blob> {
  await waitForPassFonts();

  const moduleCount = qrViewBoxSize(svg);
  const cells = darkModuleCells(svg);
  if (moduleCount <= 0 || cells.length === 0) {
    throw new Error("Failed to render QR image.");
  }

  const quiet = QR_QUIET_ZONE_MODULES * QR_MODULE_PIXELS;
  const qrPlate = moduleCount * QR_MODULE_PIXELS + quiet * 2;
  const contentWidth = PASS_WIDTH - PASS_PADDING * 2;
  const dates =
    details.startsAt != null && details.endsAt != null
      ? formatCheckInPassEventWindow(details.startsAt, details.endsAt)
      : "Event weekend";

  const qrTop = PASS_PADDING + 8 + 56 + 64 + 150 + 150 + 150;
  const footerBlock = details.email ? 170 : 120;
  const passHeight = qrTop + qrPlate + footerBlock;

  const canvas = document.createElement("canvas");
  canvas.width = PASS_WIDTH;
  canvas.height = passHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to render QR image.");
  }

  context.textBaseline = "alphabetic";
  roundRectPath(context, 0, 0, PASS_WIDTH, passHeight, PASS_RADIUS);
  context.fillStyle = NAVY;
  context.fill();

  const left = PASS_PADDING;
  const right = PASS_WIDTH - PASS_PADDING;
  let y = PASS_PADDING + 8;

  context.fillStyle = CREAM;
  context.font = `700 28px ${SANS}`;
  context.fillText("HACKUTA", left, y + 28);
  context.textAlign = "right";
  context.fillStyle = LABEL;
  context.font = `600 22px ${SANS}`;
  context.fillText("CHECK-IN", right, y + 26);
  context.textAlign = "left";

  y += 56;
  context.strokeStyle = "rgba(246, 237, 223, 0.18)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(left, y);
  context.lineTo(right, y);
  context.stroke();

  y += 64;
  context.fillStyle = LABEL;
  context.font = `600 22px ${SANS}`;
  context.fillText("EVENT", left, y);
  context.fillStyle = CREAM;
  fillFittedText(
    context,
    details.hackathonName || "HackUTA",
    left,
    y + 64,
    contentWidth,
    `400 SIZEpx ${DISPLAY}`,
    64,
  );

  y += 150;
  const columnGap = 48;
  const columnWidth = (contentWidth - columnGap) / 2;
  drawField(context, "PARTICIPANT", details.displayName || "Participant", left, y, columnWidth);
  drawField(context, "STATUS", "Pre-Check-In Only", left + columnWidth + columnGap, y, columnWidth);

  y += 150;
  drawField(context, "DATES", dates, left, y, columnWidth);
  drawField(context, "VALIDITY", "Until badge pickup", left + columnWidth + columnGap, y, columnWidth);

  y += 150;
  const plateX = Math.round((PASS_WIDTH - qrPlate) / 2);
  roundRectPath(context, plateX, y, qrPlate, qrPlate, 28);
  context.fillStyle = QR_BACKGROUND;
  context.fill();

  context.imageSmoothingEnabled = false;
  context.fillStyle = QR_FOREGROUND;
  for (const [cellX, cellY] of cells) {
    context.fillRect(
      plateX + quiet + cellX * QR_MODULE_PIXELS,
      y + quiet + cellY * QR_MODULE_PIXELS,
      QR_MODULE_PIXELS,
      QR_MODULE_PIXELS,
    );
  }

  y += qrPlate + 56;
  context.fillStyle = LABEL;
  context.font = `600 22px ${SANS}`;
  context.textAlign = "center";
  context.fillText("Check-in QR · Valid until badge pickup", PASS_WIDTH / 2, y);
  context.fillStyle = CREAM;
  context.font = `600 26px ${SANS}`;
  context.fillText("Show this code at the HackUTA check-in desk.", PASS_WIDTH / 2, y + 40);
  if (details.email) {
    context.fillStyle = LABEL;
    context.font = `400 24px ${SANS}`;
    context.fillText(details.email, PASS_WIDTH / 2, y + 84);
  }
  context.textAlign = "left";

  const pngBlob = await canvasToPngBlob(canvas);
  const bytes = new Uint8Array(await pngBlob.arrayBuffer());
  return new Blob([Uint8Array.from(bytes)], { type: "application/octet-stream" });
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
}
