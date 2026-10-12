import { mkdir, readFile, writeFile } from "node:fs/promises";
import { marked } from "marked";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppearanceSelect } from "../src/ui/AppearanceSelect.tsx";
import { SyntaxHighlighter } from "../src/ui/SyntaxHighlighter.tsx";

marked.use({
  renderer: {
    code({ text, lang }) {
      return renderToStaticMarkup(
        createElement(SyntaxHighlighter, { code: text, language: lang }),
      );
    },
  },
});

// Only repository-authored Markdown is rendered; this is not a user HTML endpoint.
const pages = [
  ["SCRIPTING_API", "Scripting API"],
  ["API", "REST API"],
  ["PLUGINS", "Plugins"],
];
const pageDescriptions = {
  SCRIPTING_API:
    "Comprehensive guide and reference for Luma's JavaScript scripting API, document object model, and automation commands.",
  API: "Local REST API reference for Luma image editor sessions, commands, and history.",
  PLUGINS:
    "Package format, permissions, and extension guide for Luma image editor command plugins.",
};
const slug = (name) => name.toLowerCase().replaceAll("_", "-");
const escape = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
await mkdir("public/developer", { recursive: true });
for (const [name, title] of pages) {
  const description =
    pageDescriptions[name] ?? "Documentation for the Luma image editor.";
  const markdown = await readFile(`docs/${name}.md`, "utf8");
  let html = marked.parse(markdown);
  const ids = new Map();
  html = html.replace(/<h([1-6])>(.*?)<\/h\1>/gs, (_, level, content) => {
    const id = content
      .replace(/<[^>]+>/g, "")
      .toLowerCase()
      .replace(/&amp;/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    const count = ids.get(id) ?? 0;
    ids.set(id, count + 1);
    return `<h${level} id="${id}${count ? `-${count}` : ""}">${content}</h${level}>`;
  });
  html = html.replace(
    /href="(?:\.\/)?([A-Z_]+)\.md(#[^"]*)?"/g,
    (_, page, anchor = "") => `href="${slug(page)}.html${anchor}"`,
  );
  html = html.replace(
    /<a href="\.\.\/[^\"]*">(.*?)<\/a>/gs,
    "$1 <small>(repository source)</small>",
  );
  const nav = pages
    .map(
      ([page, label]) =>
        `<a href="${slug(page)}.html" ${name === page ? 'aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  await writeFile(
    `public/developer/${slug(name)}.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Luma developer docs</title><meta name="description" content="${escape(description)}"><meta name="robots" content="index, follow, max-image-preview:large"><link rel="canonical" href="${slug(name)}.html"><meta property="og:type" content="article"><meta property="og:site_name" content="Luma"><meta property="og:title" content="${escape(title)} · Luma developer docs"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="../og-image.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)} · Luma developer docs"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="../og-image.png"><meta name="color-scheme" content="light dark"><link rel="icon" type="image/svg+xml" href="../favicon.svg"><link rel="icon" type="image/png" sizes="32x32" href="../favicon-32x32.png"><link rel="apple-touch-icon" href="../apple-touch-icon.png"><script src="../appearance.js"></script><link rel="stylesheet" href="docs.css"></head><body><a class="skip" href="#content">Skip to content</a><aside><a class="brand" href="../">luma<span>DEVELOPER DOCS</span></a><nav aria-label="Documentation">${nav}</nav>${renderToStaticMarkup(createElement(AppearanceSelect, { staticPage: true }))}<a class="return" href="../">← Return to editor</a></aside><main id="content">${html}</main></body></html>`,
  );
}
await writeFile(
  "public/developer/docs.css",
  `
*{box-sizing:border-box}html{scroll-padding-top:24px}body{margin:0;background:var(--color-app);color:var(--color-text);font:15px/1.7 system-ui,sans-serif}a{color:var(--color-accent);text-underline-offset:3px}a:hover{color:var(--color-accent-hover)}:focus-visible{outline:2px solid var(--color-accent);outline-offset:4px}aside{position:fixed;inset:0 auto 0 0;width:230px;padding:34px 26px;border-right:1px solid var(--color-border);background:var(--color-panel);overflow:auto}.brand{display:block;font-size:34px;font-weight:700;letter-spacing:-2px;text-decoration:none;color:var(--color-text)}.brand span{display:block;font-size:10px;letter-spacing:2px;color:var(--color-text-secondary);margin:6px 0 36px}nav{display:grid;gap:7px}nav a{padding:6px 10px;color:var(--color-text-secondary);text-decoration:none;border-radius:5px}nav a[aria-current]{background:var(--color-selected);color:var(--color-accent)}.return{display:block;margin-top:40px;font-size:12px}main{overflow-wrap:anywhere;max-width:1220px;margin-left:230px;padding:46px 5vw 100px}h1{font-size:36px;letter-spacing:-1.2px;line-height:1.2}h2{font-size:24px;margin-top:48px;border-top:1px solid var(--color-border);padding-top:26px}h3{font-size:18px;margin-top:30px}h4{font-size:15px}p,li{color:var(--color-text-secondary)}code{font:13px/1.6 ui-monospace,monospace;color:var(--color-text);background:var(--color-panel-raised);padding:2px 4px;border-radius:3px;overflow-wrap:anywhere}pre{padding:20px;background:var(--color-field);border:1px solid var(--color-border);border-radius:8px;overflow:auto}pre code{padding:0;background:none;white-space:pre;overflow-wrap:normal}table{display:block;overflow:auto;border-collapse:collapse;font-size:13px;max-width:100%;margin:20px 0}th,td{padding:10px 13px;border:1px solid var(--color-border);text-align:left;vertical-align:top}th{background:var(--color-panel);color:var(--color-text)}blockquote{margin:18px 0;border-left:3px solid var(--color-accent);padding:1px 18px}small{color:var(--color-text-muted)}hr{border:0;border-top:1px solid var(--color-border);margin:30px 0}.skip{position:fixed;left:10px;top:-100px;background:var(--color-app);padding:10px;z-index:2}.skip:focus{top:10px}@media(max-width:850px){aside{position:static;width:auto;padding:20px;border-right:0;border-bottom:1px solid var(--color-border)}.brand span{margin-bottom:12px}nav{display:flex;flex-wrap:wrap;gap:3px;font-size:12px}.return{margin-top:12px}main{margin:0;padding:24px 18px 70px}h1{font-size:30px}}`,
);
// Share the component and its design tokens with React consumers; docs stay static.
await writeFile(
  "public/developer/docs.css",
  [
    await readFile("src/ui/tokens.css", "utf8"),
    await readFile("public/developer/docs.css", "utf8"),
    await readFile("src/ui/SyntaxHighlighter.css", "utf8"),
    await readFile("src/ui/AppearanceSelect.css", "utf8"),
  ].join("\n"),
);
console.log(`Built ${pages.length} developer documentation pages.`);
