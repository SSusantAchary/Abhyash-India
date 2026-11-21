import { spawn } from "node:child_process";
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 400);
}
async function ready() {
  try {
    return (
      await fetch("http://127.0.0.1:3100/api/agent-tools", {
        signal: AbortSignal.timeout(1000),
      })
    ).ok;
  } catch {
    return false;
  }
}
function launch(script) {
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", script],
    { stdio: "inherit", detached: false },
  );
  children.push(child);
  child.once("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
  return child;
}
if (!(await ready())) {
  launch("dev");
  let available = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await ready()) {
      available = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!available) {
    console.error("The app did not become ready.");
    stop(1);
  }
}
if (!stopping) {
  launch("tools:dev");
  console.log(
    "Open http://127.0.0.1:3100. Save preparation, start practice, then ask your coach to save feedback and create a plan.",
  );
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
