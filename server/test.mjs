// Offline test with a fake Rizful/NWC client: node server/test.mjs
import assert from "node:assert/strict";
import { createApp } from "./app.mjs";

let settled = false;
const nwc = {
  async makeInvoice({ amount, expiry }) {
    assert.equal(amount % 1000, 0); assert.equal(expiry, 3600);
    return { invoice: "lnbc1fakeinvoice", payment_hash: "abc123", amount };
  },
  async lookupInvoice({ payment_hash }) {
    assert.equal(payment_hash, "abc123");
    return settled ? { state: "settled", settled_at: 1, preimage: "ff" } : { state: "pending" };
  },
};
const server = createApp({ nwc, getBtcUsd: async () => 100000 });
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const post = (b) => fetch(base + "/api/pay/createinvoice", { method: "POST", body: JSON.stringify(b) });

assert.equal((await post({ username: "kk", amountUsd: "0.5" })).status, 400);
const r = await post({ username: "kk", amountUsd: "25.00" });
const d = await r.json();
assert.equal(r.status, 200);
assert.equal(d.serialized, "lnbc1fakeinvoice");
assert.equal(d.amount_sats, 25000); // $25 at $100k/BTC
let s = await (await fetch(`${base}/api/pay/status/${d.payment_id}`)).json();
assert.equal(s.status, "pending");
settled = true;
s = await (await fetch(`${base}/api/pay/status/${d.payment_id}`)).json();
assert.equal(s.status, "paid");
assert.equal((await fetch(`${base}/api/pay/status/00000000-0000-0000-0000-000000000000`)).status, 404);
console.log("all tests passed");
server.close();
