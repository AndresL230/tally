import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const root = createRoot(document.getElementById("root")!);

// DEV-ONLY state gallery (reconciled decision E): `#gallery` in a dev serve
// mounts the QA gallery instead of the app. `import.meta.env.DEV` is
// statically false in production builds, so the whole branch — and the
// dynamically imported dev chunk — is dropped from the bundle.
if (import.meta.env.DEV && window.location.hash === "#gallery") {
  const { Gallery } = await import("./dev/Gallery");
  root.render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
