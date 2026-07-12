import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  outfile: "main.js",
  platform: "browser",
  target: "es2018",
  logLevel: "info",
  sourcemap: "inline",
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
