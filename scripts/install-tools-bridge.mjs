import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  copyFile,
  chmod,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "apps/web/.abhyash/bin");
const platform =
  process.platform === "darwin"
    ? "darwin"
    : process.platform === "linux"
      ? "linux"
      : null;
if (!platform || !["arm64", "x64"].includes(process.arch))
  throw new Error(
    "Install cloudflared from Cloudflare's official downloads for this platform, then set CLOUDFLARED_BIN.",
  );
const arch = process.arch === "x64" ? "amd64" : "arm64";
const filename = `cloudflared-${platform}-${arch}${platform === "darwin" ? ".tgz" : ""}`;
const releaseResponse = await fetch(
  "https://api.github.com/repos/cloudflare/cloudflared/releases/latest",
  { headers: { "User-Agent": "Abhyash-India-tools-bridge" } },
);
if (!releaseResponse.ok)
  throw new Error("Could not read the official cloudflared release.");
const release = await releaseResponse.json();
const asset = release.assets.find((item) => item.name === filename);
if (
  !asset ||
  !asset.browser_download_url.startsWith(
    "https://github.com/cloudflare/cloudflared/",
  )
)
  throw new Error("Official cloudflared binary was not found.");
const response = await fetch(asset.browser_download_url);
if (!response.ok) throw new Error("Could not download cloudflared.");
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(bytes).digest("hex");
if (asset.digest?.startsWith("sha256:") && asset.digest !== `sha256:${digest}`)
  throw new Error("cloudflared checksum verification failed.");
const temporary = await mkdtemp(path.join(tmpdir(), "abhyash-cloudflared-"));
try {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const downloaded = path.join(temporary, filename);
  await writeFile(downloaded, bytes);
  if (platform === "darwin")
    execFileSync("tar", ["-xzf", downloaded, "-C", temporary]);
  await copyFile(
    platform === "darwin" ? path.join(temporary, "cloudflared") : downloaded,
    path.join(target, "cloudflared"),
  );
  await chmod(path.join(target, "cloudflared"), 0o755);
  console.log(
    `Installed official cloudflared ${release.tag_name} for ${platform}/${arch}. SHA-256: ${digest}`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
