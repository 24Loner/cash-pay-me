import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
/* Same stylesheets as the original page, in the same order:
   vendor/nunito.css, vendor/tabler/tabler-icons.min.css, index1029.css */
import "./vendor/nunito.css";
import "./vendor/tabler/tabler-icons.min.css";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
