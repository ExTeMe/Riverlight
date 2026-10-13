import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
const revision = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = !process.env.GITHUB_SHA && !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Build revision must be a full commit SHA.');
export default defineConfig({
  plugins: [{ name: 'riverlight-build-version', transformIndexHtml(html, context) {
    const preview = !context.bundle || process.env.GITHUB_REF === 'refs/heads/dev';
    return { html, tags: [
      { tag: 'meta', attrs: { name: 'riverlight-revision', content: revision }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'riverlight-working-tree', content: dirty ? 'modified' : 'clean' }, injectTo: 'head' },
      ...(preview ? [{ tag: 'div', attrs: { id: 'build-version', title: revision, style: 'position:fixed;bottom:6px;right:8px;z-index:5;font:10px system-ui;color:#527065;pointer-events:none' }, children: `开发预览 · ${revision.slice(0, 7)}${dirty ? ' · 本地未提交' : ''}`, injectTo: 'body' }] : []),
    ] };
  } }],
  optimizeDeps: { entries: ['index.html'] },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
