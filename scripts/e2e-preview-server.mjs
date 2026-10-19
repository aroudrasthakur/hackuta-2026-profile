/**
 * Serves `dist/` for Playwright with `/api/admin/*` auth routes (Vite preview does not run dev middleware).
 */
import { createServer, preview } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4374);

process.env.VITE_E2E_MOCK ??= "true";
process.env.VITE_CONVEX_URL ??= "https://e2e-mock.invalid.convex.cloud";

const moduleLoader = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { middlewareMode: true },
  appType: "custom",
});

const { routeAdminAuthRequest } = await moduleLoader.ssrLoadModule(
  "/server/adminAuthHandlers.ts",
);

async function readNodeRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function writeNodeResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

function toWebRequest(req, body) {
  const hostHeader = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${hostHeader}`);
  const method = req.method ?? "GET";
  const init = {
    method,
    headers: req.headers,
  };
  if (method !== "GET" && method !== "HEAD" && body.length > 0) {
    init.body = new Uint8Array(body);
  }
  return new Request(url, init);
}

function adminAuthApiMiddleware(req, res, next) {
  if (!req.url?.startsWith("/api/admin/")) {
    next();
    return;
  }
  void (async () => {
    try {
      const body = await readNodeRequestBody(req);
      const request = toWebRequest(req, body);
      const response = await routeAdminAuthRequest(request);
      await writeNodeResponse(res, response);
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : "Internal Server Error");
    }
  })();
}

const previewServer = await preview({
  root,
  configFile: join(root, "vite.config.ts"),
  preview: {
    host,
    port,
    strictPort: true,
  },
});

previewServer.middlewares.stack.unshift({
  route: "",
  handle: adminAuthApiMiddleware,
});

previewServer.printUrls();
