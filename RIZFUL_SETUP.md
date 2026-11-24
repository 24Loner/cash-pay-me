# Rizful setup
1. Rizful: Menu > NWC Codes > Receive Only > copy the code (keep it secret; it lives on the server only).
2. `npm install && npm run build`
3. `NWC_URI="nostr+walletconnect://..." npm start`  -> http://localhost:8787/yourname
Optional: `ALLOWED_ORIGINS=https://your-site.com` if the page is hosted on a different domain
(then build with `VITE_API_BASE=https://your-api-domain`).
Customers pay via the QR code, the copy button, or the "open wallet" button (Cash App deep link).

## Deploy to Netlify
1. Push this repo to GitHub (`.gitignore` already excludes node_modules, dist and .env).
2. Netlify > Add new site > Import from Git > pick the repo. `netlify.toml` sets build command, publish dir and Node 22.
3. Site settings > Environment variables > add `NWC_URI` = your Receive Only code (mark it secret). Redeploy.
4. Visit https://your-site.netlify.app/yourname
The API runs as a Netlify Function (`netlify/functions/pay.mjs`); `server/` is only for running locally.
