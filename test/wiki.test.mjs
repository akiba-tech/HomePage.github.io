import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewServer } from '../scripts/serve-wiki.mjs';

const builder = fileURLToPath(new URL('../scripts/build-wiki.mjs', import.meta.url));

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'homepage-wiki-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'homepage');
  await mkdir(root);
  await writeFile(path.join(root, 'index.html'), '<html><!-- PRODUCT_CATALOG --></html>');
  return { directory, root };
}

for (const preview of [false, true]) {
  test(`builds articles, catalog and assets (${preview ? 'preview' : 'production'})`, async (t) => {
    const { directory, root } = await fixture(t);
    const source = preview ? path.join(directory, 'product-wiki', 'articles') : path.join(root, 'content', 'articles');
    const put = async (name, body) => {
      await mkdir(path.dirname(path.join(source, name)), { recursive: true });
      await writeFile(path.join(source, name), body);
    };
    await put('Universal-PD/overview.md', `---
title: 概要
product: Universal-PD
status: limited_stock
shop_url: https://example.com/shop?a=1&b=2
---
# 概要

電源を供給します。
電圧を確認してください。

| 項目 | 内容 |
| --- | --- |
| 出力 | 5V |

![設定表](assets/logic.jpg)

\x60\x60\x60text
| literal | code |
| --- | --- |
\x60\x60\x60
`);
    await put('Universal-PD/assets/logic.jpg', Buffer.from([255, 216, 255, 217]));
    await put('AG-BPWR-001/overview.md', '---\nproduct: AG-BPWR-001\ndate: 2026-10-25\n---\n# 概要\n\n- USB給電\n- バッテリー給電');
    await put('Old/overview.md', '---\nstatus: discontinued\nshop_url: https://example.com/old\n---\n# 旧製品');
    await mkdir(path.join(root, 'product-wiki', 'reviews'), { recursive: true });
    await writeFile(path.join(root, 'product-wiki', 'reviews', 'private.md'), 'private');
    execFileSync(process.execPath, [builder, ...(preview ? ['--preview'] : [])], { cwd: root });
    const site = path.join(root, 'site');
    const html = await readFile(path.join(site, 'wiki', 'universal-pd', 'overview.html'), 'utf8');
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert.match(html, /販売ページはこちら<\/a><span class="product-status product-status-limited">在庫限り<\/span><\/p>/);
    assert.match(html, /電源を供給します。<br>電圧を確認してください。/);
    assert.doesNotMatch(html, /&lt;br&gt;/);
    assert.match(html, /<th>項目<\/th>/);
    assert.match(html, /<pre><code>\| literal \| code \|\n\| --- \| --- \|<\/code><\/pre>/);
    assert.match(html, /aria-current="page">概要/);
    assert.match(html, /src="\/wiki\/assets\/Universal-PD\/assets\/logic.jpg"/);
    assert.deepEqual(await readFile(path.join(site, 'wiki', 'assets', 'Universal-PD', 'assets', 'logic.jpg')), Buffer.from([255, 216, 255, 217]));
    const catalog = await readFile(path.join(site, 'index.html'), 'utf8');
    assert.match(catalog, /在庫限り/);
    assert.match(catalog, /販売終了/);
    assert.match(catalog, /AG-BPWR-001/);
    assert.match(catalog, /shop\?a=1&amp;b=2/);
    assert.doesNotMatch(catalog, /https:\/\/example.com\/old/);
    const battery = await readFile(path.join(site, 'wiki', 'ag-bpwr-001', 'overview.html'), 'utf8');
    assert.match(battery, /更新日: 2026-10-25/);
    assert.match(battery, /<li>USB給電<\/li>/);
    assert.doesNotMatch(battery, /wiki-product-identity|wiki-explorer-model|class="product-model"/);
    assert.doesNotMatch(battery, /product-status-limited/);
    const discontinued = await readFile(path.join(site, 'wiki', 'old', 'overview.html'), 'utf8');
    assert.match(discontinued, /wiki-product-notice is-discontinued">販売終了/);
    assert.doesNotMatch(discontinued, /販売ページはこちら|https:\/\/example.com\/old/);
    await assert.rejects(access(path.join(site, 'product-wiki')));
    if (preview) assert.equal(await readFile(path.join(root, 'wiki', 'universal-pd', 'overview.html'), 'utf8'), html);
  });
}

test('product name and model are separate, escaped and independent of article titles and URLs', async (t) => {
  const { root } = await fixture(t);
  const source = path.join(root, 'content', 'articles', 'AG-BPWR-001');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'overview.md'), '---\ntitle: 概要\nproduct: USB & バッテリー電源基板\nmodel: AG-<BPWR>-001\n---\n# 概要\n\n本文');
  execFileSync(process.execPath, [builder], { cwd: root });
  const site = path.join(root, 'site');
  const home = await readFile(path.join(site, 'index.html'), 'utf8');
  assert.match(home, /href="\/wiki\/ag-bpwr-001\/overview.html">USB &amp; バッテリー電源基板<\/a>/);
  assert.match(home, /<p class="product-model">品番: AG-&lt;BPWR&gt;-001<\/p>/);
  const article = await readFile(path.join(site, 'wiki', 'ag-bpwr-001', 'overview.html'), 'utf8');
  assert.match(article, /<p class="wiki-product-name">USB &amp; バッテリー電源基板<\/p><p class="product-model">品番: AG-&lt;BPWR&gt;-001<\/p>/);
  assert.match(article, /<summary>AG-&lt;BPWR&gt;-001<\/summary>/);
  const breadcrumbs = article.match(/<nav class="wiki-breadcrumbs"[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.match(breadcrumbs, />AG-&lt;BPWR&gt;-001<\/a>/);
  assert.doesNotMatch(breadcrumbs, /USB &amp; バッテリー電源基板/);
  assert.equal((article.match(/<h1>概要<\/h1>/g) || []).length, 1);
  assert.doesNotMatch(home + article, /<BPWR>/);
});

test('discovery files and structured data describe all published articles safely', async (t) => {
  const { root } = await fixture(t);
  const source = path.join(root, 'content', 'articles', '電源基板');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(root, 'contact.html'), '<html>Contact</html>');
  await writeFile(path.join(source, 'overview.md'), '---\nproduct: 電源 & 基板\nmodel: AG-001\ndescription: 説明 </script><script>alert(1)</script>\ndate: 2026-10-25\n---\n# 概要\n\n本文');
  await writeFile(path.join(source, 'setup.md'), '---\nproduct: 電源 & 基板\nmodel: AG-001\ndate: 2026-02-30\n---\n# 初期設定\n\n手順');
  execFileSync(process.execPath, [builder], { cwd: root });
  const site = path.join(root, 'site');
  const article = await readFile(path.join(site, 'wiki', '電源基板', 'overview.html'), 'utf8');
  const url = 'https://akiba-tech.jp/wiki/%E9%9B%BB%E6%BA%90%E5%9F%BA%E6%9D%BF/overview.html';
  assert.match(article, /<title>電源 &amp; 基板 \| AG-001 \| 概要 \| アキバ技研 Wiki<\/title>/);
  assert.ok(article.includes(`<link rel="canonical" href="${url}"`));
  const json = article.match(/<script type="application\/ld\+json" data-wiki-metadata>(.*?)<\/script>/)[1];
  assert.ok(!json.includes('<'));
  const metadata = JSON.parse(json);
  assert.equal(metadata['@type'], 'TechArticle');
  assert.equal(metadata.url, url);
  assert.equal(metadata.about.name, '電源 & 基板');
  assert.equal(metadata.about.model, 'AG-001');
  assert.equal(metadata.dateModified, '2026-10-25');
  assert.equal(metadata.description, '説明 </script><script>alert(1)</script>');
  const setup = await readFile(path.join(site, 'wiki', '電源基板', 'setup.html'), 'utf8');
  assert.ok(!JSON.parse(setup.match(/<script type="application\/ld\+json" data-wiki-metadata>(.*?)<\/script>/)[1]).dateModified);
  const index = await readFile(path.join(site, 'wiki', 'index.html'), 'utf8');
  const list = index.match(/<section aria-labelledby="wiki-articles-title">([\s\S]*?)<\/section>/)[1];
  assert.match(list, /電源 &amp; 基板 \| AG-001 \| 概要/);
  assert.match(list, /電源 &amp; 基板 \| AG-001 \| 初期設定/);
  const sitemap = await readFile(path.join(site, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<lastmod>2026-10-25<\/lastmod>/);
  assert.doesNotMatch(sitemap, /2026-02-30/);
  assert.ok(sitemap.includes(url));
  const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.equal(locations.length, 5);
  assert.equal(new Set(locations).size, 5);
  for (const location of locations) {
    const pathname = decodeURIComponent(new URL(location).pathname);
    await access(path.join(site, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  }
  assert.equal(await readFile(path.join(site, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\n\nSitemap: https://akiba-tech.jp/sitemap.xml\n');
});

test('nested lists preserve parents, siblings, mixed types and block boundaries', async (t) => {
  const { root } = await fixture(t);
  const source = path.join(root, 'content', 'articles', 'nested');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'overview.md'), `# リスト

- 大項目
  - 小項目
    - **孫項目**
  - 小項目2
- 大項目2

## 番号付き
1. 親
   - 子
     1. 孫
     2. 孫2
   - 子2
2. 親2

## 種類の切り替え
- 親
  - 子
  1. 番号付きの子
- 次の親

本文

- 最後
  - 子
## 終了
`);
  execFileSync(process.execPath, [builder], { cwd: root });
  const html = (await readFile(path.join(root, 'site', 'wiki', 'nested', 'overview.html'), 'utf8')).replace(/\r?\n/g, '').replace(/>\s+</g, '><');
  assert.ok(html.includes('<ul><li>大項目<ul><li>小項目<ul><li><strong>孫項目</strong></li></ul></li><li>小項目2</li></ul></li><li>大項目2</li></ul>'));
  assert.ok(html.includes('<ol><li>親<ul><li>子<ol><li>孫</li><li>孫2</li></ol></li><li>子2</li></ul></li><li>親2</li></ol>'));
  assert.ok(html.includes('<ul><li>親<ul><li>子</li></ul><ol><li>番号付きの子</li></ol></li><li>次の親</li></ul><p>本文</p>'));
  assert.ok(html.includes('<ul><li>最後<ul><li>子</li></ul></li></ul><h2'));
});

test('explicit line breaks work in lists and text while code and other HTML stay literal', async (t) => {
  const { root } = await fixture(t);
  const source = path.join(root, 'content', 'articles', 'breaks');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'overview.md'), '# Breaks\n\n- Parent<br>same item\n  - Child<br/>next<br />last\n\nText<BR>next\n\n`<br>` and \\<br> and <script>alert(1)</script>\n\n```html\n<br>\n```');
  execFileSync(process.execPath, [builder], { cwd: root });
  const html = await readFile(path.join(root, 'site', 'wiki', 'breaks', 'overview.html'), 'utf8');
  assert.match(html, /<li>Parent<br>same item/);
  assert.match(html, /<li>Child<br>next<br>last<\/li>/);
  assert.match(html, /<p>Text<br>next<\/p>/);
  assert.match(html, /<code>&lt;br&gt;<\/code> and &lt;br&gt; and &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<pre><code>&lt;br&gt;<\/code><\/pre>/);
});

test('missing or empty sources fail without deleting the previous build', async (t) => {
  const { root } = await fixture(t);
  await mkdir(path.join(root, 'site'));
  await writeFile(path.join(root, 'site', 'index.html'), 'previous build');
  for (const empty of [false, true]) {
    if (empty) await mkdir(path.join(root, 'content', 'articles'), { recursive: true });
    const result = spawnSync(process.execPath, [builder], { cwd: root });
    assert.equal(result.status, 1);
    assert.equal(await readFile(path.join(root, 'site', 'index.html'), 'utf8'), 'previous build');
  }
});

test('preview serves the built site and rejects traversal and writes', async (t) => {
  const { root } = await fixture(t);
  const server = previewServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${url}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /PRODUCT_CATALOG/);
  assert.equal((await fetch(`${url}/missing`)).status, 404);
  assert.equal((await fetch(`${url}/%2e%2e%2foutside`)).status, 403);
  assert.equal((await fetch(`${url}/%ff`)).status, 400);
  assert.equal((await fetch(`${url}/`, { method: 'POST' })).status, 405);
});
