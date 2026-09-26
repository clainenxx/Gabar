import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { ConfirmDialogProvider } from "./components/ConfirmDialogProvider.jsx";
import { ProcessingOverlayProvider } from "./components/ProcessingOverlayProvider.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <ConfirmDialogProvider>
        <ProcessingOverlayProvider>
          <App />
        </ProcessingOverlayProvider>
      </ConfirmDialogProvider>
    </BrowserRouter>
  </StrictMode>,
);
