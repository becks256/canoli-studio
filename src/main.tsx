import { createRoot } from "react-dom/client"
import { EditorApplication } from "./editor"
import { App } from "./ui/App"
import * as DOM from "./dom"
import { Analytics } from "@vercel/analytics/next"
import "./ui/styles.css"

const editor = new EditorApplication()
// A usable development API, sharing the actual UI document and command history.
if (import.meta.env.DEV || import.meta.env.VITE_BENCHMARK === "1")
  Object.assign(window, { luma: { editor, ...DOM } })
createRoot(document.getElementById("root")!).render(
  <>
    <Analytics />
    <App editor={editor} />
  </>,
)
