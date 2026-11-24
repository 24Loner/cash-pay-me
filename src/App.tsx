import { useEffect } from "react";
import logoUrl from "./assets/logo1.png";
import qrcodeRaw from "./vendor/qrcode/qrcode.min.js?raw";
import { PAGE_HTML } from "./page-html";
import { initCheckout } from "./checkout";

/* Original markup, with every logo1.png reference pointed at the bundled
   (inlined) asset so the single-file build is fully self-contained. */
const html = PAGE_HTML.replace(/logo1\.png/g, logoUrl);

/* Guard: initialize the original page script exactly once per page load. */
let initialized = false;

export default function App() {
  useEffect(() => {
    if (initialized) return;
    initialized = true;

    /* Original: <link rel="icon" type="image/png" href="logo1.png"/> */
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/png";
    icon.href = logoUrl;
    document.head.appendChild(icon);

    /* Original: <script src="vendor/qrcode/qrcode.min.js"></script>
       (classic-script IIFE defining the global QRCode constructor) */
    (0, eval)(qrcodeRaw);

    /* Original: <script src="index1029.js"></script> */
    initCheckout();

    /* The original script fades the splash screen on window 'load'.
       If 'load' already fired before this mount, perform the identical fade. */
    if (document.readyState === "complete") {
      const splash = document.getElementById("splash-screen");
      if (splash) {
        setTimeout(() => {
          splash.classList.add("fade-out");
          setTimeout(() => {
            (splash as HTMLElement).style.display = "none";
          }, 500);
        }, 800);
      }
    }
  }, []);

  return (
    /* display:contents keeps body's flex layout applying directly to the
       splash screen and cards, exactly as in the original document. */
    <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
