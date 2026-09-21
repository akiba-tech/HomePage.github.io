import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'content', 'articles');
const outputRoot = path.join(root, 'site');
const wikiRoot = path.join(outputRoot, 'wiki');

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const slugify = (value) => String(value)
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '') || 'document';

function parseArticle(raw, filePath) {
  const frontMatter = {};
  let markdown = raw.replace(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/, (_, block) => {
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
      if (match) frontMatter[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return '';
  });
  const relative = path.relative(sourceRoot, filePath);
  const segments = relative.split(path.sep);
  const productPath = segments.slice(0, -1);
  if (!productPath.length) throw new Error(`記事は製品フォルダ内に置いてください: ${relative}`);
  const fileName = path.basename(filePath, '.md');
  const leadingHeading = markdown.match(/^[\r\n]*#\s+(.+)\s*\n?/);
  const titleFromHeading = leadingHeading?.[1]?.trim();
  // The page template renders the document title. Do not render a leading H1 twice.
  if (leadingHeading) markdown = markdown.slice(leadingHeading[0].length);
  const productSlug = productPath.map(slugify).join('/');
  return {
    filePath,
    relative,
    productPath,
    productSlug,
    productName: frontMatter.product || productPath[0],
    slug: slugify(frontMatter.slug || fileName),
    title: frontMatter.title || titleFromHeading || fileName,
    description: frontMatter.description || '',
    date: frontMatter.date || '',
    markdown,
  };
}

async function walkMarkdown(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkMarkdown(entryPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(entryPath);
  }
  return files;
}

async function copyAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await copyAssets(entryPath);
    else if (!entry.name.toLowerCase().endsWith('.md')) {
      const relative = path.relative(sourceRoot, entryPath);
      const target = path.join(wikiRoot, 'assets', relative);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(entryPath, target);
    }
  }
}

function imageUrl(article, rawUrl) {
  if (/^(https?:|data:|#)/i.test(rawUrl)) return rawUrl;
  const imagePath = path.resolve(path.dirname(article.filePath), rawUrl);
  const relative = path.relative(sourceRoot, imagePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`画像の参照先は articles/ 内にしてください: ${article.relative} -> ${rawUrl}`);
  }
  return `/wiki/assets/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function inline(markdown, article) {
  let html = escapeHtml(markdown);
  html = html.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, alt, url, title) => {
    const titleAttribute = title ? ` title="${title}"` : '';
    return `<img src="${escapeHtml(imageUrl(article, url))}" alt="${alt}"${titleAttribute}>`;
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
}

function renderMarkdown(markdown, article) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = null;
  let code = null;

  const closeParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join('<br>'), article)}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  const closeCode = () => {
    if (code) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    code = null;
  };

  const tableCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const isTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes('|') && isTableDivider(lines[index + 1] || '')) {
      closeParagraph(); closeList();
      const headers = tableCells(line).map((cell) => `<th>${inline(cell, article)}</th>`).join('');
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(`<tr>${tableCells(lines[index]).map((cell) => `<td>${inline(cell, article)}</td>`).join('')}</tr>`);
        index += 1;
      }
      index -= 1;
      html.push(`<div class="wiki-table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }
    if (line.startsWith('```')) {
      if (code) closeCode(); else { closeParagraph(); closeList(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (heading) {
      closeParagraph(); closeList();
      const level = heading[1].length;
      const text = heading[2];
      html.push(`<h${level} id="${slugify(text)}">${inline(text, article)}</h${level}>`);
    } else if (unordered || ordered) {
      closeParagraph();
      const type = unordered ? 'ul' : 'ol';
      if (list !== type) { closeList(); html.push(`<${type}>`); list = type; }
      html.push(`<li>${inline((unordered || ordered)[1], article)}</li>`);
    } else if (!line.trim()) {
      closeParagraph(); closeList();
    } else {
      closeList(); paragraph.push(line);
    }
  }
  closeParagraph(); closeList(); if (code) closeCode();
  return html.join('\n');
}

function articleUrl(article) {
  return `/wiki/${article.productSlug}/${article.slug}.html`;
}

function explorer(articles, activeUrl = '') {
  const root = { folders: new Map(), articles: [] };
  for (const article of articles) {
    let node = root;
    article.productPath.forEach((segment, index) => {
      if (!node.folders.has(segment)) node.folders.set(segment, { name: index === 0 ? article.productName : segment, folders: new Map(), articles: [] });
      node = node.folders.get(segment);
    });
    node.articles.push(article);
  }
  const containsActive = (node) => node.articles.some((article) => articleUrl(article) === activeUrl)
    || [...node.folders.values()].some(containsActive);
  const renderNode = (node) => {
    const items = node.articles.map((article) => {
      const url = articleUrl(article);
      return `<li><a href="${url}"${url === activeUrl ? ' aria-current="page"' : ''}>${escapeHtml(article.title)}</a></li>`;
    }).join('');
    const childFolders = [...node.folders.values()].map(renderNode).join('');
    const contents = `${items ? `<ul>${items}</ul>` : ''}${childFolders}`;
    return `<details${containsActive(node) ? ' open' : ''}><summary>${escapeHtml(node.name)}</summary>${contents}</details>`;
  };
  const folders = [...root.folders.values()].map(renderNode).join('');
  return `<aside class="wiki-explorer" aria-label="Wiki Explorer"><button class="wiki-explorer-toggle" type="button" aria-expanded="false" aria-controls="wiki-explorer-tree">Explorerを開く</button><div class="wiki-explorer-tree" id="wiki-explorer-tree">${folders || '<p class="wiki-empty">公開済みの記事はありません。</p>'}</div></aside>`;
}

function page({ title, description, breadcrumbs, navigation, document }) {
  const crumbHtml = breadcrumbs.map((crumb, index) => index === breadcrumbs.length - 1
    ? `<span aria-current="page">${escapeHtml(crumb.label)}</span>`
    : `<a href="${crumb.href}">${escapeHtml(crumb.label)}</a>`).join(' <span aria-hidden="true">&gt;</span> ');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | アキバ技研 Wiki</title>
  <meta name="description" content="${escapeHtml(description || title)}">
  <link rel="icon" href="/resources/akiba-tech/akiba_tech_favicon.ico">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/wiki.css">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-KWEN8PGLWQ"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-KWEN8PGLWQ');</script>
</head>
<body class="wiki-page">
  <div id="particles-js"></div>
  <div id="header"></div>
  <main class="wiki-shell">
    <div class="wiki-layout">${navigation}<article class="wiki-document"><nav class="wiki-breadcrumbs" aria-label="パンくずリスト">${crumbHtml}</nav>${document}</article></div>
  </main>
  <div id="partner_baner"></div><div id="footer"></div>
  <script src="/js/jQuery/jquery-3.7.1.min.js"></script>
  <script src="/js/main.js"></script><script src="/js/load_common_parts.js"></script>
  <script src="/js/wiki-navigation.js"></script>
  <script src="/js/particles/particles.min.js"></script><script src="/js/particles/particles.settings.js"></script>
  <script>document.addEventListener('click',function(e){const image=e.target.closest('.wiki-document img');if(image) image.classList.toggle('wiki-image-expanded')})</script>
</body>
</html>`;
}

async function build() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const excluded = new Set(['.git', '.github', 'content', 'node_modules', 'site', 'wiki']);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!excluded.has(entry.name)) {
      await cp(path.join(root, entry.name), path.join(outputRoot, entry.name), { recursive: true });
    }
  }
  await mkdir(wikiRoot, { recursive: true });
  let articles = [];
  try {
    if ((await stat(sourceRoot)).isDirectory()) {
      const files = await walkMarkdown(sourceRoot);
      articles = await Promise.all(files.map(async (file) => parseArticle(await readFile(file, 'utf8'), file)));
      articles.sort((a, b) => a.productName.localeCompare(b.productName, 'ja') || a.title.localeCompare(b.title, 'ja'));
      await copyAssets(sourceRoot);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const nav = explorer(articles);
  await writeFile(path.join(wikiRoot, 'index.html'), page({
    title: 'Wiki', description: 'アキバ技研の製品公式ドキュメント',
    breadcrumbs: [{ label: 'Wiki', href: '/wiki/' }], navigation: nav,
    document: `<h1>Wiki の使い方</h1><p>アキバ技研の製品に関する仕様、使い方、FAQを掲載しています。</p><h2>ドキュメントを探す</h2><ol><li>画面左の製品名をクリックして、製品を選びます。</li><li>表示された記事から、確認したい内容を選びます。</li><li>製品シリーズは、矢印をクリックすると個別製品を展開できます。</li></ol><h2>情報が見つからない場合</h2><p>掲載内容で解決しない場合は、お問い合わせページからご連絡ください。</p>`,
  }), 'utf8');
  for (const article of articles) {
    const target = path.join(outputRoot, articleUrl(article).replace(/^\//, ''));
    await mkdir(path.dirname(target), { recursive: true });
    const body = `<h1>${escapeHtml(article.title)}</h1>${article.date ? `<p class="wiki-updated">更新日: ${escapeHtml(article.date)}</p>` : ''}${renderMarkdown(article.markdown, article)}`;
    await writeFile(target, page({
      title: article.title, description: article.description,
      breadcrumbs: [{ label: 'Wiki', href: '/wiki/' }, { label: article.productName, href: '/wiki/' }, { label: article.title, href: articleUrl(article) }],
      navigation: explorer(articles, articleUrl(article)), document: body,
    }), 'utf8');
  }
  if (process.argv.includes('--preview')) {
    const previewRoot = path.join(root, 'wiki');
    await rm(previewRoot, { recursive: true, force: true });
    await cp(wikiRoot, previewRoot, { recursive: true });
  }
  console.log(`Built Wiki with ${articles.length} article(s).`);
}

build().catch((error) => { console.error(error); process.exitCode = 1; });
