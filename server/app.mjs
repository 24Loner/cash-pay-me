// Tiny payments backend for the checkout page, powered by Rizful (Nostr Wallet Connect).
// Keeps the same API shape the front-end already uses:
//   POST /api/pay/createinvoice   { username, amountUsd }  -> { payment_id, order_id, serialized }
//   GET  /api/pay/status/:id                               -> { status, invoice, amount_usd, created_at }
import http from "node:http";
import crypto from "node:crypto";

const INVOICE_TTL_SECONDS = 3600; // matches the 60 min countdown in the page
const MIN_USD = 1;
const MAX_USD = 1000;

/** USD -> sats using Coinbase's public spot price (cached 30s). */
export function makeBtcUsdFetcher(fetchImpl = fetch) {
  let cache = { price: 0, at: 0 };
  return async function getBtcUsd() {
    if (cache.price && Date.now() - cache.at < 30_000) return cache.price;
    const r = await fetchImpl("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    if (!r.ok) throw new Error("Price feed unavailable");
    const price = Number((await r.json()).data.amount);
    if (!(price > 0)) throw new Error("Bad price from feed");
    cache = { price, at: Date.now() };
    return price;
  };
}

/**
 * @param {object} deps
 * @param {{makeInvoice:Function, lookupInvoice:Function}} deps.nwc  Alby NWCClient (or a fake in tests)
 * @param {() => Promise<number>} deps.getBtcUsd
 * @param {string[]} [deps.allowedOrigins]  CORS allow-list; empty = same-origin only
 */
export function createApp({ nwc, getBtcUsd, allowedOrigins = [] }) {
  /** @type {Map<string, any>} in-memory; swap for a DB if you need history across restarts */
  const payments = new Map();

  const send = (res, status, body, origin) => {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (origin && allowedOrigins.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (c) => {
        data += c;
        if (data.length > 10_000) { reject(new Error("Body too large")); req.destroy(); }
      });
      req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("Invalid JSON")); } });
    });

  async function refresh(p) {
    if (p.status !== "pending") return p;
    if (Date.now() > p.expires_at) { p.status = "expired"; return p; }
    try {
      const tx = await nwc.lookupInvoice({ payment_hash: p.payment_hash });
      if (tx.state === "settled" || (tx.settled_at && tx.preimage)) p.status = "paid";
      else if (tx.state === "expired" || tx.state === "failed") p.status = "expired";
    } catch (e) {
      console.error("lookup_invoice failed:", e?.message || e); // leave as pending, client retries
    }
    return p;
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, "http://x");

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...(origin && allowedOrigins.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    try {
      if (req.method === "POST" && url.pathname === "/api/pay/createinvoice") {
        const body = await readJson(req);
        const usd = Number(body.amountUsd);
        const username = String(body.username || "").slice(0, 64);
        if (!(usd >= MIN_USD && usd <= MAX_USD)) {
          return send(res, 400, { detail: `Amount must be between $${MIN_USD} and $${MAX_USD}` }, origin);
        }
        const btcUsd = await getBtcUsd();
        const sats = Math.max(1, Math.round((usd / btcUsd) * 1e8));
        const id = crypto.randomUUID();
        const order_id = "#" + id.slice(0, 8).toUpperCase();
        const tx = await nwc.makeInvoice({
          amount: sats * 1000, // msats
          description: `Payment to ${username || "merchant"} ${order_id}`,
          expiry: INVOICE_TTL_SECONDS,
        });
        payments.set(id, {
          id, order_id, username,
          invoice: tx.invoice,
          payment_hash: tx.payment_hash,
          amount_usd: usd.toFixed(2),
          amount_sats: sats,
          status: "pending",
          created_at: new Date().toISOString(),
          expires_at: Date.now() + INVOICE_TTL_SECONDS * 1000,
        });
        return send(res, 200, { payment_id: id, order_id, serialized: tx.invoice, amount_sats: sats }, origin);
      }

      const m = url.pathname.match(/^\/api\/pay\/status\/([0-9a-f-]{36})$/);
      if (req.method === "GET" && m) {
        const p = payments.get(m[1]);
        if (!p) return send(res, 404, { detail: "Payment not found" }, origin);
        await refresh(p);
        return send(res, 200, {
          status: p.status, invoice: p.invoice, order_id: p.order_id,
          amount_usd: p.amount_usd, created_at: p.created_at,
        }, origin);
      }

      return send(res, 404, { detail: "Not found" }, origin);
    } catch (e) {
      console.error(e);
      return send(res, 500, { detail: e?.message || "Server error" }, origin);
    }
  });
}
