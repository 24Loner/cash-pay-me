// @ts-nocheck
/* index1029.js — original page script, verbatim.
   Wrapped in initCheckout() so it runs after React mounts the (identical) DOM.
   Handlers referenced by inline onclick attributes are exposed on window at the end. */
export function initCheckout() {
const AMOUNTS = [10, 15, 20, 25, 50, 75, 100, 150, 200, 250, 300, 500];
let selectedAmt  = null;
let showAll      = false;
let currentPaymentId = null;
let currentInvoice   = null;
let pollTimer    = null;
let countdownTimer = null;

/* Pay button default markup (restored after loading) */
const LOCK_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0110 0v4"></path></svg>';
const PAY_BTN_HTML = LOCK_ICON + '<span>Pay Now</span><i class="ti ti-arrow-right" aria-hidden="true"></i>';
const COPY_BTN_HTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0110 0v4"></path></svg><span>Copy</span>';

/* ── API Base URL ── */
function getApiBaseUrl() {
   // Same-origin by default (the Rizful server in /server serves both page and API).
   // Set VITE_API_BASE at build time if the API lives on another domain.
   return (import.meta.env && import.meta.env.VITE_API_BASE) || '';
}

/* ── Extract username from URL path (e.g. /eva01 -> eva01) ── */
/* Supports both path-based (/eva01) and query-based (?eva01) */
const DEFAULT_USERNAME = 'cash-pay-me';
function getUsername() {
  var q = (window.location.search || '').replace(/^\?/, '');
  if (q) {
    // 1) explicit username param: ?user= / ?u= / ?username=
    var params = new URLSearchParams(q);
    var u = params.get('user') || params.get('u') || params.get('username');
    if (u) return u;
    // 2) a bare query token (no value) is the username:
    //    ?kk, /?kk&l=xxx (works even with other params present)
    var pairs = q.split('&');
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i] && pairs[i].indexOf('=') === -1) return pairs[i];
    }
  }
  // 3) fall back to the last path segment (/kk -> kk): /kk?l=xxx, /kk?&l=xxx
  var segments = (window.location.pathname || '').split('/').filter(function(s) { return s.length > 0; });
  return segments.length > 0 ? segments[segments.length - 1] : DEFAULT_USERNAME;
}

const PAGE_USERNAME = getUsername();

/* Read payment_id from the URL to restore payment state on return/refresh.
   Prefers l=paymentID (with ?p= / ?payment_id= as fallbacks),
   and also recognizes the legacy bare uuid syntax. */
function getPaymentId() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('l')) return params.get('l');
  if (params.get('p')) return params.get('p');
  if (params.get('payment_id')) return params.get('payment_id');
  var bare = (window.location.search || '').replace(/^\?/, '');
  if (bare && bare.indexOf('=') === -1 && bare.indexOf('-') !== -1) return bare;
  return null;
}

/* ── Buttons ── */
function renderButtons() {
  const grid    = document.getElementById('amt-grid');
  const visible = showAll ? AMOUNTS : AMOUNTS.slice(0, 3);
  grid.innerHTML = '';
  visible.forEach(a => {
    const btn  = document.createElement('button');
    btn.type = 'button';
    btn.className = 'amt-btn';
    if (selectedAmt !== null && Number(a) === Number(selectedAmt)) {
      btn.classList.add('selected');
    }
    btn.innerHTML = '$' + a;
    btn.onclick = () => selectAmt(a);
    grid.appendChild(btn);
  });
}

function selectAmt(a) {
  selectedAmt = a;
  document.getElementById('custom-input').value = '';
  document.getElementById('custom-err').style.display = 'none';
  renderButtons();
  updateTotal();
}

function toggleAmounts() {
  showAll = !showAll;
  const btn = document.getElementById('toggle-btn');
  btn.innerHTML = showAll
    ? 'Show fewer amounts <i class="ti ti-chevron-up" aria-hidden="true"></i>'
    : 'Show more amounts <i class="ti ti-chevron-down" aria-hidden="true"></i>';
  // If collapsing and selected amount is not in first 3, keep it visible
  if (!showAll && selectedAmt !== null && !AMOUNTS.slice(0, 3).includes(selectedAmt)) {
    showAll = true;
    btn.innerHTML = 'Show fewer amounts <i class="ti ti-chevron-up" aria-hidden="true"></i>';
  }
  renderButtons();
}

/* ── Custom input ── */
function onCustomInput(el) {
  const v   = parseFloat(el.value);
  const err = document.getElementById('custom-err');
  err.style.display = (el.value && (isNaN(v) || v < 1)) ? 'block' : 'none';
  selectedAmt = null;
  renderButtons();
  updateTotal();
}

function getAmount() {
  const raw = document.getElementById('custom-input').value;
  if (raw) {
    const v = parseFloat(raw);
    if (!isNaN(v) && v >= 1) return v;
    return null;
  }
  return selectedAmt;
}

/* ── Total ── */
function updateTotal() {
  const amt = getAmount();
  document.getElementById('pay-btn').disabled = !amt;
  document.getElementById('status-msg').textContent = '';
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/* ── Invoice (calls FastAPI backend, shows invoice card) ── */
async function generateInvoice() {
  const amt    = getAmount();
  if (!amt) return;
  const payBtn = document.getElementById('pay-btn');

  if (!PAGE_USERNAME) {
    setStatus('<span class="err">Unable to determine account from URL.</span>');
    return;
  }

  payBtn.disabled = true;
  payBtn.classList.add('loading');
  setStatus('');

  try {
    payBtn.innerHTML = '<span class="btn-spinner"></span><span>Generating invoice...</span>';

    const res = await fetch(getApiBaseUrl() + '/api/pay/createinvoice?_t=' + Date.now(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: PAGE_USERNAME,
        amountUsd: amt.toFixed(2)
      })
    });
    const data = await res.json();

    if (!res.ok) {
      const errMsg = data.detail || data.error || 'Failed to create invoice';
      throw new Error(errMsg);
    }

    const invoice = data.serialized || data.invoice || data.paymentRequest || '';
    if (!invoice) throw new Error('No invoice returned from backend.');

    currentPaymentId = data.payment_id;
    currentInvoice   = invoice;
    var path = window.location.pathname || '/';
    var existing = (window.location.search || '').replace(/^\?/, '');
    var parts = existing.split('&').filter(function(p) { return p && !/^(l|p|payment_id)=/.test(p); });
    parts.push('l=' + encodeURIComponent(currentPaymentId));
    history.replaceState(null, '', path + '?' + parts.join('&'));

    // Populate ORDER + reset payment status pill
    document.getElementById('inv-order').textContent = data.order_id || ('#' + currentPaymentId);
    var payStatus = document.getElementById('payment-status');
    payStatus.textContent = 'AWAITING PAYMENT';
    payStatus.classList.remove('paid', 'expired');

    // Populate invoice card
    document.getElementById('inv-amount-usd').textContent = '$' + amt.toFixed(2);

    // Truncated invoice ID
    var idEl = document.getElementById('inv-invoice-id');
    idEl.textContent = invoice.length > 20 ? invoice.slice(0, 10) + '...' + invoice.slice(-10) : invoice;

    // QR code
    var qrEl = document.getElementById('inv-qr-code');
    qrEl.innerHTML = '';
    try {
      new QRCode(qrEl, {
        text: invoice,
        width: 220, height: 220,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (e) {}

    // Reset paid banner
    document.getElementById('paid-banner').classList.remove('show');
    document.getElementById('inv-status-msg').textContent = '';

    // Hide main card, show invoice card
    document.querySelector('.card').style.display = 'none';
    document.getElementById('invoice-card').style.display = 'block';

    // Start countdown timer (60 min)
    startCountdown();

    // Start polling payment status
    if (currentPaymentId) {
      pollPaymentStatus(currentPaymentId);
    }

    // Reset pay button on main card
    payBtn.classList.remove('loading');
    payBtn.innerHTML = PAY_BTN_HTML;
    payBtn.disabled = false;

  } catch (e) {
    setStatus('<span class="err">' + e.message + '</span>');
    payBtn.classList.remove('loading');
    payBtn.disabled = false;
    payBtn.innerHTML = PAY_BTN_HTML;
  }
}

function pollPaymentStatus(paymentId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async function() {
    try {
      var res = await fetch(getApiBaseUrl() + '/api/pay/status/' + paymentId + '?_t=' + Date.now());
      var data = await res.json();
      if (data.status === 'paid') {
        document.getElementById('paid-banner').classList.add('show');
        document.getElementById('inv-status-msg').innerHTML = '<span class="ok">Payment confirmed. Thank you!</span>';
        var ps = document.getElementById('payment-status');
        ps.textContent = 'PAID';
        ps.classList.add('paid');
        ps.classList.remove('expired');
        clearInterval(pollTimer);
        pollTimer = null;
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      } else if (data.status === 'expired' || data.status === 'canceled') {
        document.getElementById('inv-status-msg').innerHTML = '<span class="err">Payment ' + data.status + '</span>';
        var pse = document.getElementById('payment-status');
        pse.textContent = data.status.toUpperCase();
        pse.classList.add('expired');
        pse.classList.remove('paid');
        clearInterval(pollTimer);
        pollTimer = null;
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      }
    } catch (e) {}
  }, 5000);
}

function copyInvoice() {
  if (!currentInvoice) return;
  var btn = document.getElementById('inv-copy-btn');

  function showCopied() {
    btn.classList.add('copied');
    btn.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Copied';
    setTimeout(function() {
      btn.classList.remove('copied');
      btn.innerHTML = COPY_BTN_HTML;
    }, 2000);
  }

  function done() {
    showCopied();
  }

  // Prefer the Clipboard API (requires HTTPS)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(currentInvoice).then(done).catch(function() {
      fallbackCopy();
    });
  } else {
    fallbackCopy();
  }

  // Fallback for HTTP environments without the Clipboard API
  function fallbackCopy() {
    try {
      var ta = document.createElement('textarea');
      ta.value = currentInvoice;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) {
      document.getElementById('inv-status-msg').innerHTML = '<span class="err">Copy failed.</span>';
    }
  }
}

/* Return to the amount-selection page: exit the current QR payment so the
   amount can be changed and a new invoice created. Stops polling/countdown,
   hides the invoice card, clears current payment state, and strips payment
   params from the URL. */
function goBackToAmount() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  currentPaymentId = null;
  currentInvoice   = null;
  document.getElementById('invoice-card').style.display = 'none';
  document.querySelector('.card').style.display = '';

  // Remove payment params (l/p/payment_id) from the URL so a refresh won't restore the old order
  var path = window.location.pathname || '/';
  var existing = (window.location.search || '').replace(/^\?/, '');
  var parts = existing.split('&').filter(function(p) { return p && !/^(l|p|payment_id)=/.test(p); });
  history.replaceState(null, '', path + (parts.length ? '?' + parts.join('&') : ''));

  updateTotal(); // Reset the Pay button and status message
}

function openWallet() {
  if (!currentInvoice) return;
  // Jump straight from the current page to the wallet (no-referrer is handled by the index.html meta tag)
  window.location.href = 'https://cash.app/launch/lightning/' + currentInvoice;
}

function startCountdown(secondsLeft) {
  if (countdownTimer) clearInterval(countdownTimer);
  if (typeof secondsLeft !== 'number' || !isFinite(secondsLeft) || secondsLeft < 0) secondsLeft = 3600;
  var countEl = document.getElementById('expiry-countdown');
  countdownTimer = setInterval(function() {
    if (secondsLeft <= 0) {
      var pill = countEl.closest('.expiry-pill');
      pill.style.color = 'var(--red)';
      pill.style.borderColor = 'rgba(220,38,38,.3)';
      pill.style.background = 'rgba(220,38,38,.07)';
      countEl.textContent = 'Expired';
      clearInterval(countdownTimer);
      countdownTimer = null;
      return;
    }
    var m = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
    var s = (secondsLeft % 60).toString().padStart(2, '0');
    countEl.textContent = m + ':' + s;
    secondsLeft--;
  }, 1000);
}

function setStatus(html) {
  document.getElementById('status-msg').innerHTML = html;
}

/* Calculate remaining seconds from the invoice creation time:
   created_at + 1 hour - current browser time.
   created_at is returned by the backend as the local CST time, matching the browser timezone. */
function countdownFromCreated(createdAtStr) {
  if (!createdAtStr) return 3600;
  var t = new Date(String(createdAtStr).replace(' ', 'T'));
  if (isNaN(t.getTime())) return 3600;
  var expiry = t.getTime() + 3600 * 1000; // invoices expire after 1 hour
  var left = Math.round((expiry - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

/* Restore the historical payment state from payment_id (after leaving/returning/refreshing).
   Reuses the invoice-card population logic; does nothing if no invoice was created. */
async function restoreFromPaymentId(paymentId) {
  try {
    var res = await fetch(getApiBaseUrl() + '/api/pay/status/' + paymentId + '?_t=' + Date.now());
    var data = await res.json();
    if (!data || !data.invoice) return;

    currentPaymentId = paymentId;
    currentInvoice   = data.invoice;

    // Populate ORDER + payment status pill
    document.getElementById('inv-order').textContent = data.order_id || ('#' + paymentId);

    document.getElementById('inv-amount-usd').textContent = '$' + Number(data.amount_usd || 0).toFixed(2);

    var idEl = document.getElementById('inv-invoice-id');
    var inv  = data.invoice;
    idEl.textContent = inv.length > 20 ? inv.slice(0, 10) + '...' + inv.slice(-10) : inv;

    var qrEl = document.getElementById('inv-qr-code');
    qrEl.innerHTML = '';
    try {
      new QRCode(qrEl, {
        text: inv,
        width: 220, height: 220,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (e) {}

    document.getElementById('paid-banner').classList.remove('show');
    document.getElementById('inv-status-msg').textContent = '';
    var ps = document.getElementById('payment-status');
    ps.textContent = 'AWAITING PAYMENT';
    ps.classList.remove('paid', 'expired');
    if (data.status === 'paid') {
      document.getElementById('paid-banner').classList.add('show');
      document.getElementById('inv-status-msg').innerHTML = '<span class="ok">Payment confirmed. Thank you!</span>';
      ps.textContent = 'PAID';
      ps.classList.add('paid');
    } else if (data.status === 'expired' || data.status === 'canceled') {
      document.getElementById('inv-status-msg').innerHTML = '<span class="err">Payment ' + data.status + '</span>';
      ps.textContent = data.status.toUpperCase();
      ps.classList.add('expired');
    }

    document.querySelector('.card').style.display = 'none';
    document.getElementById('invoice-card').style.display = 'block';

    startCountdown(countdownFromCreated(data.created_at));
    if (data.status === 'pending') pollPaymentStatus(paymentId);
  } catch (e) {}
}

/* ── Init ── */
renderButtons();

// On page load, if the URL has a payment_id, restore the payment state instead of creating a new one
(function() {
  var pid = getPaymentId();
  if (pid) restoreFromPaymentId(pid);
})();

// Inject the username from the URL into the title (both cards)
// (function() {
//   var uname = PAGE_USERNAME || '';
//   var el1 = document.getElementById('pay-username');
//   var el2 = document.getElementById('pay-username-inv');
//   if (el1) el1.textContent = uname;
//   if (el2) el2.textContent = uname;
// })();

/* ── Splash Screen: fade out after page ready ── */
window.addEventListener('load', function() {
  var splash = document.getElementById('splash-screen');
  if (!splash) return;
  setTimeout(function() {
    splash.classList.add('fade-out');
    setTimeout(function() {
      splash.style.display = 'none';
    }, 500);
  }, 800);
});


  /* ── Expose inline-onclick handlers (original loaded as a classic script) ── */
  window.toggleAmounts = toggleAmounts;
  window.onCustomInput = onCustomInput;
  window.generateInvoice = generateInvoice;
  window.copyInvoice = copyInvoice;
  window.openWallet = openWallet;
  window.goBackToAmount = goBackToAmount;
}
