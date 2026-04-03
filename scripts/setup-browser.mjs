import { access } from "node:fs/promises";
import { constants } from "node:fs";

const DIST_MANIFEST_PATH = "dist/manifest.json";

async function main() {
  try {
    await access(DIST_MANIFEST_PATH, constants.R_OK);
  } catch {
    console.error("Build output missing: dist/manifest.json not found.");
    console.error("Run `npm run build` before loading in Chrome.");
    process.exit(1);
  }

  console.log("");
  console.log("Build completed. Next steps in Chrome:");
  console.log("1) Open chrome://extensions");
  console.log("2) Enable Developer mode (top-right)");
  console.log("3) Click Load unpacked");
  console.log("4) Select this project's dist/ folder");
  console.log("5) If already loaded, click Reload on Recorder");
  console.log("");
}

void main();
