import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { installWebMcpShim } from "./webmcp-shim"
import { App } from "./App"

// Development only: a stand-in for document.modelContext when the browser has no WebMCP.
if (import.meta.env.DEV) installWebMcpShim()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
