import { build } from "esbuild";
await build({
  entryPoints: ["src/scripting/runtime.ts"],
  bundle: true,
  outfile: "src/generated/script-runtime.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
});
