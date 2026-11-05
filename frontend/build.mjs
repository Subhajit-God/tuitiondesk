// Production build with esbuild (no other tooling needed). Output: ./dist (static files; host anywhere over HTTPS).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch'); const OUT = process.env.OUT || 'dist';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT + '/assets', { recursive: true });
const opts = {
  entryPoints: ['src/main.jsx'], bundle: true, splitting: true, format: 'esm', outdir: OUT + '/assets', entryNames: '[name]', chunkNames: 'chunk-[hash]',
  minify: !watch, sourcemap: watch, jsx: 'automatic', loader: { '.js': 'jsx' }, target: ["chrome100","safari15","es2022"],
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' }, logLevel: 'info',
};
const copyStatic = () => {
  for (const f of fs.readdirSync('public')) fs.copyFileSync(path.join('public', f), path.join(OUT, f));
  fs.copyFileSync('index.html', OUT + '/index.html');
};
if (watch) { const ctx = await esbuild.context({ ...opts, plugins: [{ name: 'copy', setup(b) { b.onEnd(copyStatic); } }] }); await ctx.watch(); console.log('watching…'); }
else { await esbuild.build(opts); copyStatic(); console.log('Built to ./dist'); }
