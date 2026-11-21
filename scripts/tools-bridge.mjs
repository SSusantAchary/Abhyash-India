import http from "node:http";
import { spawn } from "node:child_process";
import { mkdir, access, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir =
  process.env.ABHYASH_DATA_DIR || path.join(root, "apps/web/.abhyash");
const endpointFile = path.join(dataDir, "tool-endpoint.json");
const appUrl = process.env.ABHYASH_APP_URL || "http://127.0.0.1:3100";
const port = Number(process.env.ABHYASH_TOOLS_PORT || 3101);
let binary =
  process.env.CLOUDFLARED_BIN ||
  path.join(root, "apps/web/.abhyash/bin/cloudflared");
try {
  await access(binary);
} catch {
  binary = "cloudflared";
}
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const server = http.createServer(async (request, response) => {
  if (
    request.url !== "/api/agent-tools" ||
    !["GET", "POST"].includes(request.method)
  ) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const parts = [];
  let size = 0;
  try {
    for await (const part of request) {
      size += part.length;
      if (size > 32768) {
        response.writeHead(413);
        response.end("Request too large");
        return;
      }
      parts.push(part);
    }
    const upstream = await fetch(`${appUrl}/api/agent-tools`, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.authorization
          ? { Authorization: request.headers.authorization }
          : {}),
      },
      body: request.method === "POST" ? Buffer.concat(parts) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    response.writeHead(upstream.status, {
      "Content-Type":
        upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    });
    response.end(await upstream.text());
  } catch {
    if (!response.headersSent)
      response.writeHead(502, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error:
          "The local tool service is unavailable. Keep npm run dev running.",
      }),
    );
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
const tunnel = spawn(
  binary,
  [
    "tunnel",
    "--no-autoupdate",
    "--url",
    `http://127.0.0.1:${port}`,
    "--protocol",
    "http2",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let endpoint,
  stopping = false;
const setupTimeout = setTimeout(() => {
  console.error(
    "Tool tunnel did not start. Check your network or set ABHYASH_TOOLS_BASE_URL to your deployed HTTPS origin.",
  );
  void stop(1);
}, 60000);
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(setupTimeout);
  tunnel.kill("SIGTERM");
  server.close();
  try {
    const current = JSON.parse(await readFile(endpointFile, "utf8"));
    if (current.pid === process.pid) await unlink(endpointFile);
  } catch {}
  setTimeout(() => process.exit(code), 200).unref();
}
function output(chunk) {
  const value = chunk.toString();
  const match = value.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !endpoint) {
    endpoint = match[0];
    clearTimeout(setupTimeout);
    void writeFile(
      endpointFile,
      JSON.stringify({
        url: endpoint,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    ).then(() => {
      console.log(`Agent tool endpoint: ${endpoint}/api/agent-tools`);
      console.log(
        "Only /api/agent-tools is exposed. Each action requires an expiring session capability.",
      );
      console.log(
        "Keep this terminal open while practicing. The app discovers this URL automatically.",
      );
    });
  }
  if (/ERR |failed to|error=/i.test(value)) process.stderr.write(value);
}
tunnel.stdout.on("data", output);
tunnel.stderr.on("data", output);
tunnel.once("error", () => {
  console.error(
    "cloudflared is unavailable. Run npm run tools:install first, or install cloudflared and put it on PATH.",
  );
  void stop(1);
});
tunnel.once("exit", (code) => {
  if (!stopping) void stop(code || 1);
});
process.on("SIGINT", () => {
  void stop();
});
process.on("SIGTERM", () => {
  void stop();
});
