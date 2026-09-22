import { createRoot } from "react-dom/client";
import { EditorApplication } from "./editor";
import { App } from "./ui/App";
import * as DOM from "./dom";
import "./ui/styles.css";

const editor = new EditorApplication();
// A usable development API, sharing the actual UI document and command history.
if (import.meta.env.DEV) Object.assign(window, { luma: { editor, ...DOM } });
createRoot(document.getElementById("root")!).render(<App editor={editor} />);
