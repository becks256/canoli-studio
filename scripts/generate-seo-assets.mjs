import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const manrope = (await readFile("node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2")).toString("base64");
  const dmMono = (await readFile("node_modules/@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2")).toString("base64");

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#181c1b"/>
  <g transform="translate(32, 32) skewX(-16) translate(-32, -32)">
    <rect x="15" y="21" width="6.5" height="22" rx="3.25" fill="#d5e79b"/>
    <rect x="24.5" y="14" width="6.5" height="36" rx="3.25" fill="#d5e79b"/>
    <rect x="34" y="18" width="6.5" height="28" rx="3.25" fill="#d5e79b"/>
    <rect x="43.5" y="21" width="6.5" height="22" rx="3.25" fill="#d5e79b"/>
  </g>
</svg>`;

  await writeFile("public/favicon.svg", svgContent, "utf8");

  // Render PNG favicons and app icons
  const iconSizes = [
    { size: 16, path: "public/favicon-16x16.png" },
    { size: 32, path: "public/favicon-32x32.png" },
    { size: 180, path: "public/apple-touch-icon.png" },
    { size: 192, path: "public/icon-192.png" },
    { size: 512, path: "public/icon-512.png" },
  ];

  for (const { size, path } of iconSizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; display: flex; align-items: center; justify-content: center; width: ${size}px; height: ${size}px; }
    svg { width: ${size}px; height: ${size}px; display: block; }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`);
    const buffer = await page.screenshot({ omitBackground: true });
    await writeFile(path, buffer);
  }

  // Render Open Graph preview image (1200 x 630)
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 200 800; src: url(data:font/woff2;base64,${manrope}) format('woff2'); }
    @font-face { font-family: 'DM Mono'; font-style: normal; font-weight: 500; src: url(data:font/woff2;base64,${dmMono}) format('woff2'); }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1200px;
      height: 630px;
      background: #181c1b;
      color: #e7e9df;
      font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 72px 80px;
      position: relative;
      overflow: hidden;
    }
    .bg-glow-1 {
      position: absolute;
      top: -150px;
      right: -100px;
      width: 650px;
      height: 650px;
      background: radial-gradient(circle, rgba(213, 231, 155, 0.12) 0%, rgba(213, 231, 155, 0) 70%);
      pointer-events: none;
    }
    .bg-glow-2 {
      position: absolute;
      bottom: -200px;
      left: 100px;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(73, 98, 28, 0.2) 0%, rgba(24, 28, 27, 0) 70%);
      pointer-events: none;
    }
    .grid-lines {
      position: absolute;
      inset: 0;
      background-image: linear-gradient(to right, rgba(54, 61, 53, 0.3) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(54, 61, 53, 0.3) 1px, transparent 1px);
      background-size: 40px 40px;
      opacity: 0.5;
      mask-image: linear-gradient(135deg, rgba(0,0,0,0.8), transparent 85%);
      pointer-events: none;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      position: relative;
      z-index: 2;
    }
    .brand-mark {
      height: 38px;
      display: flex;
      gap: 5px;
      align-items: center;
      transform: skew(-16deg);
    }
    .brand-mark i {
      display: block;
      background: #d5e79b;
      width: 8px;
      border-radius: 6px;
      height: 24px;
    }
    .brand-mark i:nth-child(2) { height: 38px; }
    .brand-mark i:nth-child(3) { height: 30px; }
    .brand-mark i:nth-child(4) { height: 24px; }
    .brand-title {
      font-size: 42px;
      font-weight: 700;
      letter-spacing: -2px;
      color: #e7e9df;
    }
    .badge {
      font-family: 'DM Mono', monospace;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 2px;
      color: #929c8f;
      background: #202523;
      border: 1px solid #363d35;
      padding: 5px 12px;
      border-radius: 6px;
      margin-left: 8px;
    }
    .main-content {
      position: relative;
      z-index: 2;
      max-width: 900px;
      margin-top: 10px;
    }
    .headline {
      font-size: 64px;
      font-weight: 800;
      letter-spacing: -2.5px;
      line-height: 1.1;
      margin-bottom: 24px;
      background: linear-gradient(180deg, #ffffff 20%, #c8cfc2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .description {
      font-size: 24px;
      line-height: 1.5;
      color: #a5ada0;
      font-weight: 400;
      letter-spacing: -0.3px;
    }
    .footer {
      display: flex;
      align-items: center;
      gap: 16px;
      position: relative;
      z-index: 2;
    }
    .feature-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #202523;
      border: 1px solid #363d35;
      padding: 10px 18px;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 600;
      color: #e7e9df;
    }
    .feature-pill span {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #d5e79b;
    }
  </style>
</head>
<body>
  <div class="bg-glow-1"></div>
  <div class="bg-glow-2"></div>
  <div class="grid-lines"></div>
  
  <div class="header">
    <div class="brand-mark">
      <i></i><i></i><i></i><i></i>
    </div>
    <div class="brand-title">Canoli Studio</div>
    <div class="badge">IMAGE EDITOR</div>
  </div>

  <div class="main-content">
    <h1 class="headline">Professional in-browser image editor & layer studio.</h1>
    <p class="description">Non-destructive adjustments, 16 blend modes, WebGPU viewport acceleration, and private local processing without cloud uploads or accounts.</p>
  </div>

  <div class="footer">
    <div class="feature-pill"><span></span>Layer Groups & Masks</div>
    <div class="feature-pill"><span></span>WebGPU Acceleration</div>
    <div class="feature-pill"><span></span>Non-Destructive Tones</div>
    <div class="feature-pill"><span></span>100% In-Browser & Private</div>
  </div>
</body>
</html>`);

  await page.evaluate(() => document.fonts.ready);
  const ogBuffer = await page.screenshot();
  await writeFile("public/og-image.png", ogBuffer);

  await browser.close();
  console.log("Generated SEO assets successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
