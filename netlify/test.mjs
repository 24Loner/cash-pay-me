// Offline test of the Netlify handler: node netlify/test.mjs
import assert from "node:assert/strict";
import { createHandler } from "./functions/pay.mjs";
const hash = "a".repeat(64);
let settled = false;
const nwc = {
  async makeInvoice({ amount }) { return { invoice: "lnbc1fake", payment_hash: hash, amount }; },
  async lookupInvoice({ payment_hash }) {
    assert.equal(payment_hash, hash);
    return { invoice: "lnbc1fake", amount: 25000000, description: "Payment to kk ($25.00)", created_at: 1700000000,
      expires_at: 4102444800, ...(settled ? { state: "settled", settled_at: 1, preimage: "ff" } : { state: "pending" }) };
  },
};
const h = createHandler({ getNwc: () => nwc, getBtcUsd: async () => 100000 });
const post = (b) => h(new Request("http://x/api/pay/createinvoice", { method: "POST", body: JSON.stringify(b) }));
assert.equal((await post({ username: "kk", amountUsd: "0.5" })).status, 400);
const d = await (await post({ username: "kk", amountUsd: "25.00" })).json();
assert.equal(d.payment_id, hash); assert.equal(d.amount_sats, 25000); assert.equal(d.serialized, "lnbc1fake");
const get = async () => (await h(new Request(`http://x/api/pay/status/${hash}`))).json();
let s = await get(); assert.equal(s.status, "pending"); assert.equal(s.amount_usd, "25.00");
settled = true; s = await get(); assert.equal(s.status, "paid");
assert.equal((await h(new Request("http://x/api/pay/status/nope"))).status, 404);
console.log("netlify handler tests passed");
