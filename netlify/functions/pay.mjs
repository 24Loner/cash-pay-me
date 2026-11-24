// Netlify Function: same API the page already uses, but stateless (no in-memory Map).
//   POST /api/pay/createinvoice  { username, amountUsd } -> { payment_id, order_id, serialized }
//   GET  /api/pay/status/:id                             -> { status, invoice, order_id, amount_usd, created_at }
// payment_id === the invoice's payment_hash, so status is looked up straight from Rizful.
import { NWCClient } from "@getalby/sdk/nwc";
import { makeBtcUsdFetcher } from "../../server/app.mjs";

const INVOICE_TTL_SECONDS = 3600;
const MIN_USD = 1;
const MAX_USD = 1000;

const getBtcUsd = makeBtcUsdFetcher();
const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export function createHandler({ getNwc, getBtcUsd }) {
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/\.netlify\/functions\/pay/, "/api/pay");
    try {
      if (req.method === "POST" && path === "/api/pay/createinvoice") {
        let body;
        try { body = await req.json(); } catch { return json(400, { detail: "Invalid JSON" }); }
        const usd = Number(body.amountUsd);
        const username = String(body.username || "").slice(0, 64);
        if (!(usd >= MIN_USD && usd <= MAX_USD)) {
          return json(400, { detail: `Amount must be between $${MIN_USD} and $${MAX_USD}` });
        }
        const btcUsd = await getBtcUsd();
        const sats = Math.max(1, Math.round((usd / btcUsd) * 1e8));
        const nwc = getNwc();
        const tx = await nwc.makeInvoice({
          amount: sats * 1000,
          description: `Payment to ${username || "merchant"} ($${usd.toFixed(2)})`,
          expiry: INVOICE_TTL_SECONDS,
        });
        const order_id = "#" + tx.payment_hash.slice(0, 8).toUpperCase();
        return json(200, { payment_id: tx.payment_hash, order_id, serialized: tx.invoice, amount_sats: sats });
      }

      const m = path.match(/^\/api\/pay\/status\/([0-9a-f]{64})$/i);
      if (req.method === "GET" && m) {
        const hash = m[1].toLowerCase();
        const tx = await getNwc().lookupInvoice({ payment_hash: hash });
        let status = "pending";
        if (tx.state === "settled" || (tx.settled_at && tx.preimage)) status = "paid";
        else if (tx.state === "expired" || tx.state === "failed") status = "expired";
        else if (tx.expires_at && Date.now() / 1000 > tx.expires_at) status = "expired";
        const fromDesc = /\(\$([\d.]+)\)/.exec(tx.description || "");
        const amount_usd = fromDesc
          ? fromDesc[1]
          : ((tx.amount / 1000 / 1e8) * (await getBtcUsd())).toFixed(2);
        return json(200, {
          status,
          invoice: tx.invoice,
          order_id: "#" + hash.slice(0, 8).toUpperCase(),
          amount_usd,
          created_at: tx.created_at ? new Date(tx.created_at * 1000).toISOString() : undefined,
        });
      }
      return json(404, { detail: "Not found" });
    } catch (e) {
      console.error(e);
      return json(500, { detail: e?.message || "Server error" });
    }
  };
}

let client;
const getNwc = () => {
  if (!process.env.NWC_URI) throw new Error("Server is missing NWC_URI");
  return (client ??= new NWCClient({ nostrWalletConnectUrl: process.env.NWC_URI }));
};

export default createHandler({ getNwc, getBtcUsd });
export const config = { path: "/api/pay/*" };
