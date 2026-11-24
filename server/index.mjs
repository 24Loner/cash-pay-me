// Run:  NWC_URI="nostr+walletconnect://..." node server/index.mjs
// Serves the built checkout page (dist/) and the payments API from one process.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NWCClient } from "@getalby/sdk/nwc";
import { createApp, makeBtcUsdFetcher } from "./app.mjs";

if (!process.env.NWC_URI) {
  console.error("Missing NWC_URI. In Rizful: Menu > NWC Codes > Receive Only > copy the code.");
  process.exit(1);
}

const nwc = new NWCClient({ nostrWalletConnectUrl: process.env.NWC_URI });
const api = createApp({
  nwc,
  getBtcUsd: makeBtcUsdFetcher(),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
});

// Wrap: API first, otherwise serve the static build.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const server = (await import("node:http")).createServer((req, res) => {
  if (req.url.startsWith("/api/")) return api.emit("request", req, res);
  // Page is a single-file build, so every non-API path serves index.html (/username?l=... style URLs).
  const file = path.join(dist, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Run `npm run build` first"); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT || 8787);
server.listen(port, () => console.log(`Checkout on http://localhost:${port}`));
