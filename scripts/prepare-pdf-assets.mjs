import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pdfjsDirectory = dirname(require.resolve("pdfjs-dist/package.json"));
const publicPdfjs = fileURLToPath(new URL("../public/pdfjs/", import.meta.url));
mkdirSync(publicPdfjs, { recursive: true });

for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  const destination = join(publicPdfjs, directory);
  mkdirSync(destination, { recursive: true });
  cpSync(join(pdfjsDirectory, directory), destination, { recursive: true });
}

cpSync(
  join(pdfjsDirectory, "build", "pdf.worker.min.mjs"),
  join(publicPdfjs, "pdf.worker.min.mjs"),
);
