import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Document } from "../src/dom";
import {
  commandRequestSchema,
  createDocumentSchema,
  parseCommands,
  revisionSchema,
} from "../src/core/validation";

export function createApiServer() {
  const documents = new Map<string, Document>();
  const send = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(value));
  };
  const body = async (request: IncomingMessage) => {
    if (!request.headers["content-type"]?.startsWith("application/json"))
      throw new Error("Send application/json.");
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 1_000_000) throw new Error("Request body exceeds 1 MB.");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  };
  const snapshot = (document: Document) => ({
    document: document.toJSON(),
    revision: document.getSnapshot().revision,
    canUndo: document.canUndo,
    canRedo: document.canRedo,
  });

  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    const trustedOrigins = [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "http://127.0.0.1:4173",
      "http://localhost:4173",
    ];
    // Defense against cross-site requests and DNS rebinding to this local service.
    const host = request.headers.host?.split(":")[0];
    if (
      !["localhost", "127.0.0.1"].includes(host ?? "") ||
      (origin && !trustedOrigins.includes(origin))
    ) {
      send(response, 403, {
        error:
          "This local API only accepts loopback clients and the local editor origin.",
      });
      return;
    }
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS",
      );
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.writeHead(204);
      response.end();
      return;
    }
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      const method = request.method;
      if (path === "/api/v1/health" && method === "GET") {
        send(response, 200, {
          status: "ok",
          storage: "memory",
          scope: "document-model",
        });
        return;
      }
      if (path === "/api/v1/documents") {
        if (method === "GET") {
          send(response, 200, {
            documents: [...documents.values()].map((d) => ({
              id: d.id,
              name: d.name,
              revision: d.getSnapshot().revision,
            })),
          });
          return;
        }
        if (method === "POST") {
          if (documents.size >= 100) {
            send(response, 409, {
              error: "Local session limit: 100 documents.",
            });
            return;
          }
          const document = new Document(
            createDocumentSchema.parse(await body(request)),
          );
          documents.set(document.id, document);
          send(response, 201, snapshot(document));
          return;
        }
      }
      const match = path.match(
        /^\/api\/v1\/documents\/([^/]+)(?:\/(commands|undo|redo))?$/,
      );
      if (!match || !documents.has(match[1])) {
        send(response, 404, { error: "Document or endpoint not found." });
        return;
      }
      const document = documents.get(match[1])!;
      const operation = match[2];
      if (!operation && method === "GET") {
        send(response, 200, snapshot(document));
        return;
      }
      if (
        (operation && method === "POST") ||
        (!operation && method === "DELETE")
      ) {
        const input = await body(request);
        const parsed =
          operation === "commands"
            ? commandRequestSchema.parse(input)
            : revisionSchema.parse(input);
        if (parsed.expectedRevision !== document.getSnapshot().revision) {
          send(response, 409, {
            error: "Revision conflict. Read the document and retry.",
            revision: document.getSnapshot().revision,
          });
          return;
        }
        if (!operation) {
          documents.delete(document.id);
          send(response, 200, { deleted: document.id });
          return;
        }
        if (operation === "commands") {
          const commandInput = commandRequestSchema.parse(input);
          const commands = parseCommands(commandInput.commands);
          document.transaction(commandInput.label ?? "REST transaction", () =>
            commands.forEach((command) => document._dispatch(command)),
          );
        } else if (operation === "undo") document.undo();
        else document.redo();
        send(response, 200, snapshot(document));
        return;
      }
      send(response, 405, { error: "Method not allowed." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid request.";
      send(response, 400, { error: message.slice(0, 2000) });
    }
  });
}
