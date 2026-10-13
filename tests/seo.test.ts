import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

describe("SEO metadata and discoverability", () => {
  it("includes all essential SEO meta tags in index.html", async () => {
    const html = await readFile("index.html", "utf8");

    // Title & description
    expect(html).toContain("<title>Canoli Studio — Free In-Browser Image Editor &amp; Layer Studio</title>");
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]+"/);
    expect(html).toMatch(/<meta\s+name="keywords"\s+content="[^"]+"/);
    expect(html).toMatch(/<meta\s+name="author"\s+content="Canoli Studio"/);
    expect(html).toMatch(/<meta\s+name="robots"\s+content="index,\s*follow/);

    // Canonical link
    expect(html).toMatch(/<link\s+rel="canonical"\s+href="https:\/\/luma-editor\.app\/"/);

    // Open Graph protocol
    expect(html).toMatch(/<meta\s+property="og:type"\s+content="website"/);
    expect(html).toMatch(/<meta\s+property="og:title"\s+content="[^"]+"/);
    expect(html).toMatch(/<meta\s+property="og:description"\s+content="[^"]+"/);
    expect(html).toMatch(/<meta\s+property="og:image"\s+content="\/og-image\.png"/);
    expect(html).toMatch(/<meta\s+property="og:image:width"\s+content="1200"/);
    expect(html).toMatch(/<meta\s+property="og:image:height"\s+content="630"/);

    // Twitter Card
    expect(html).toMatch(/<meta\s+name="twitter:card"\s+content="summary_large_image"/);
    expect(html).toMatch(/<meta\s+name="twitter:image"\s+content="\/og-image\.png"/);

    // Icons & manifest
    expect(html).toMatch(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/favicon\.svg"/);
    expect(html).toMatch(/<link\s+rel="apple-touch-icon"/);
    expect(html).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"/);

    // Structured data (Schema.org JSON-LD)
    expect(html).toContain('application/ld+json');
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(jsonLdMatch).toBeTruthy();
    const structuredData = JSON.parse(jsonLdMatch![1]);
    expect(structuredData["@context"]).toBe("https://schema.org");
    const graph = structuredData["@graph"];
    expect(Array.isArray(graph)).toBe(true);

    const webApp = graph.find((item: any) => item["@type"] === "WebApplication");
    expect(webApp).toBeDefined();
    expect(webApp.name).toBe("Canoli Studio");
    expect(webApp.applicationCategory).toBe("DesignApplication");
    expect(webApp.offers.price).toBe("0");

    const webSite = graph.find((item: any) => item["@type"] === "WebSite");
    expect(webSite).toBeDefined();
    expect(webSite.name).toBe("Canoli Studio");
  });

  it("provides valid robots.txt and sitemap.xml", async () => {
    expect(existsSync("public/robots.txt")).toBe(true);
    const robots = await readFile("public/robots.txt", "utf8");
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Sitemap: /sitemap.xml");

    expect(existsSync("public/sitemap.xml")).toBe(true);
    const sitemap = await readFile("public/sitemap.xml", "utf8");
    expect(sitemap).toContain("<urlset");
    expect(sitemap).toContain("https://luma-editor.app/</loc>");
    expect(sitemap).toContain("https://luma-editor.app/developer/scripting-api.html</loc>");
    expect(sitemap).toContain("https://luma-editor.app/developer/api.html</loc>");
    expect(sitemap).toContain("https://luma-editor.app/developer/plugins.html</loc>");
  });

  it("provides valid web application manifest", async () => {
    expect(existsSync("public/manifest.webmanifest")).toBe(true);
    const manifestJson = await readFile("public/manifest.webmanifest", "utf8");
    const manifest = JSON.parse(manifestJson);
    expect(manifest.name).toContain("Canoli Studio");
    expect(manifest.short_name).toBe("Canoli Studio");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  it("provides all essential favicon, icon, and preview image assets", () => {
    expect(existsSync("public/favicon.svg")).toBe(true);
    expect(existsSync("public/favicon.ico")).toBe(true);
    expect(existsSync("public/favicon-16x16.png")).toBe(true);
    expect(existsSync("public/favicon-32x32.png")).toBe(true);
    expect(existsSync("public/apple-touch-icon.png")).toBe(true);
    expect(existsSync("public/icon-192.png")).toBe(true);
    expect(existsSync("public/icon-512.png")).toBe(true);
    expect(existsSync("public/og-image.png")).toBe(true);
  });

  it("includes SEO metadata in generated developer docs", async () => {
    for (const doc of ["api", "scripting-api", "plugins"]) {
      const path = `public/developer/${doc}.html`;
      expect(existsSync(path)).toBe(true);
      const content = await readFile(path, "utf8");
      expect(content).toContain(`· Canoli Studio developer docs</title>`);
      expect(content).toContain('content="Canoli Studio"');
      expect(content).toContain('>Canoli Studio<span>DEVELOPER DOCS</span>');
      expect(content).toContain("<meta name=\"description\"");
      expect(content).toContain("<meta name=\"robots\"");
      expect(content).toContain("<meta property=\"og:title\"");
      expect(content).toContain("<meta name=\"twitter:card\"");
      expect(content).toContain("<link rel=\"icon\"");
    }
  });
});
