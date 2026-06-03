/**
 * Purpose: Bundle CodeMirror 6 into a single ESM file for demo/vendor/.
 * How: Use esbuild to bundle the entry point with all dependencies.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["scripts/codemirror-entry.mjs"],
  bundle: true,
  format: "esm",
  outfile: "demo/vendor/codemirror/codemirror.js",
  minify: true,
  sourcemap: false,
  target: "es2022",
});

console.log("CodeMirror bundle written to demo/vendor/codemirror/codemirror.js");
