# Canoli Studio local ChatGPT plugin

This desktop package contains a portable Agent Plugins manifest, a focused editing skill and a bundled Node.js MCP server. It connects to explicitly chosen live browser documents. Install the complete package; a source manifest without `plugins/canoli-studio/server/index.mjs` is not a runnable release.

1. Install Node.js 22 or newer on the same computer as the browser and ChatGPT desktop app. The MCP configuration runs `node` from that computer's PATH.
2. Unzip the downloaded package and add its marketplace root with `codex plugin marketplace add /absolute/path/to/canoli-studio-chatgpt`. The root contains this README, `.agents/plugins/marketplace.json` and `plugins/canoli-studio/`.
3. Restart ChatGPT desktop, select the **Canoli Studio** local marketplace in the Plugins Directory, and install the plugin. Current client/workspace policies can restrict local plugins. This package does not register an account, publish a listing, or bypass those policies.
4. In a local ChatGPT thread, ask Canoli Studio to start a document connection. In Canoli's browser editor, open **ChatGPT connection**, choose a document, paste the returned code and choose whether to allow editing. Confirm with **Connect selected document**. Codes expire after two minutes and can be used once.
5. Ask ChatGPT to inspect that connected document before editing. Edits share the normal Canoli history and reject stale revisions. Disconnect in Canoli to revoke access; closing the document or editor also revokes it. Closing the connection dialog alone keeps authorized connections active.

The connection uses a private loopback HTTP listener and stdio MCP. It does not expose a public service. Browser local-network permission or enterprise policy may require approval; allow it only for your intended local plugin. Owner credentials stay in process/browser memory, never project files, tool results or persistent browser preferences. Layer names, text and settings returned by tools may enter the ChatGPT conversation. Original image/file bytes are not shared by these tools.

Cancellation before commit authorization stops new edits. After authorization, inspect the result or retry the same idempotency key if an acknowledgement is lost. Do not resubmit with a new key. Metadata requests/results have separate 2 MB/complexity limits; original document resolution and source-file bytes are unchanged. Connections retain 256 edit receipts and permit 16 pending requests; reconnect explicitly after receipt capacity is reached. A missing browser owner expires after 45 seconds. Accepted artwork remains in Canoli if the plugin closes.

Tools: `canoli_begin_connection`, `canoli_list_documents`, `canoli_read_document`, `canoli_new_layer_template`, `canoli_apply_edits`, `canoli_undo`, `canoli_redo`, `canoli_disconnect_document`. The `canoli://commands` index links focused command/field schemas. `canoli://all-command-schemas` retains the large complete reference. Fresh detached paint/vector/text/group templates come from actual Canoli constructors; insertion still requires a normal writable command transaction. Referenced assets must already exist and remain valid. Arbitrary JavaScript, file/URL fetching, native preparation, original-file transfer, sign-in and inference are not exposed by this package. Independent REST sessions retain their existing separate semantics.

Public desktop-only directory submission requires OpenAI partner eligibility and review. This local test package is not a public listing or evidence of that approval. Verify installation and real ChatGPT workflows separately from SDK protocol tests.

Build source: `server/chatgpt/`, `src/integrations/chatgpt/`, `scripts/build-chatgpt-plugin.ts`. Third-party notices accompany the bundled server.

Official guidance: https://developers.openai.com/plugins/build/plugins and https://developers.openai.com/plugins/deploy/connect-chatgpt
