import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = process.argv.includes('--preview')
  ? path.resolve(root, '..', 'product-wiki', 'articles')
  : path.join(root, 'content', 'articles');
const outputRoot = path.join(root, 'site');
const wikiRoot = path.join(outputRoot, 'wiki');
const siteOrigin = 'https://akiba-tech.jp';
const absoluteUrl = (url) => new URL(url, siteOrigin).href;
const jsonForHtml = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

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
  let markdown = raw.replace(/^\uFEFF/, '').replace(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/, (_, block) => {
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
    model: frontMatter.model || '',
    slug: slugify(frontMatter.slug || fileName),
    title: frontMatter.title || titleFromHeading || fileName,
    description: frontMatter.description || '',
    date: frontMatter.date || '',
    status: frontMatter.status || 'active',
    shopUrl: frontMatter.shop_url || '',
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
  // Code spans stay literal, including examples containing <br>.
  return markdown.split(/(`[^`]+`)/g).map((part) => {
    if (part.startsWith('`') && part.endsWith('`')) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    return inlineText(part, article);
  }).join('');
}

function inlineText(markdown, article) {
  let html = escapeHtml(markdown);
  html = html.replace(/(\\)?&lt;br\s*\/?&gt;/gi, (_, escaped) => escaped ? '&lt;br&gt;' : '<br>');
  html = html.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, alt, url, title) => {
    const titleAttribute = title ? ` title="${title}"` : '';
    return `<img src="${escapeHtml(imageUrl(article, url))}" alt="${alt}"${titleAttribute}>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
}

function renderMarkdown(markdown, article) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  const lists = [];
  let code = null;

  const closeParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join('\n'), article).replaceAll('\n', '<br>')}</p>`);
    paragraph = [];
  };
  const closeListLevel = () => {
    const list = lists.pop();
    html[html.length - 1] += '</li>';
    html.push(`</${list.type}>`);
  };
  const closeList = () => {
    while (lists.length) closeListLevel();
  };
  const closeCode = () => {
    if (code) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    code = null;
  };

  const tableCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const isTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('```')) {
      if (code) closeCode(); else { closeParagraph(); closeList(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
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
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const listItem = line.match(/^([ \t]*)([-*+]|\d+\.)[ \t]+(.+)$/);
    if (heading) {
      closeParagraph(); closeList();
      const level = heading[1].length;
      const text = heading[2];
      html.push(`<h${level} id="${slugify(text)}">${inline(text, article)}</h${level}>`);
    } else if (listItem) {
      closeParagraph();
      const indent = listItem[1].replaceAll('\t', '    ').length;
      const type = /^\d/.test(listItem[2]) ? 'ol' : 'ul';
      while (lists.length && lists.at(-1).indent > indent) closeListLevel();
      if (lists.length && lists.at(-1).indent === indent && lists.at(-1).type !== type) closeListLevel();
      if (!lists.length || lists.at(-1).indent < indent) {
        // Keep the parent <li> open so the child list belongs to that item.
        html.push(`<${type}>`);
        lists.push({ indent, type });
      } else {
        html[html.length - 1] += '</li>';
      }
      html.push(`<li>${inline(listItem[3], article)}`);
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

function articlePageTitle(article) {
  return [...new Set([article.productName, article.model, article.title].filter(Boolean))].join(' | ');
}

function articleMetadata(article) {
  const url = absoluteUrl(articleUrl(article));
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${url}#article`,
    url,
    headline: articlePageTitle(article),
    ...(article.description ? { description: article.description } : {}),
    inLanguage: 'ja',
    ...(validDate(article.date) ? { dateModified: article.date } : {}),
    publisher: { '@type': 'Organization', name: 'アキバ技研合同会社', url: `${siteOrigin}/` },
    about: {
      '@type': 'Product',
      name: article.productName,
      ...(article.model ? { model: article.model } : {}),
    },
  };
}

function renderArticleIndex(articles) {
  return `<section aria-labelledby="wiki-articles-title"><h2 id="wiki-articles-title">製品ドキュメント一覧</h2><ul class="wiki-article-list">${articles.map((article) => `<li><a href="${articleUrl(article)}">${escapeHtml(articlePageTitle(article))}</a>${article.description ? `<p>${escapeHtml(article.description)}</p>` : ''}</li>`).join('')}</ul></section>`;
}

async function writeDiscoveryFiles(articles) {
  const staticPages = (await readdir(outputRoot)).filter((name) => name.endsWith('.html')).sort();
  const entries = [
    ...staticPages.map((name) => ({ url: name === 'index.html' ? '/' : `/${name}` })),
    { url: '/wiki/' },
    ...articles.map((article) => ({ url: articleUrl(article), date: article.date })),
  ];
  const urls = entries.map(({ url, date }) => `<url><loc>${escapeHtml(absoluteUrl(url))}</loc>${validDate(date || '') ? `<lastmod>${date}</lastmod>` : ''}</url>`).join('\n');
  await writeFile(path.join(outputRoot, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, 'utf8');
  await writeFile(path.join(outputRoot, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\n`, 'utf8');
}

function productCatalog(articles) {
  const products = new Map();
  for (const article of articles) {
    if (!products.has(article.productSlug)) {
      products.set(article.productSlug, {
        name: article.productName,
        model: '',
        url: articleUrl(article),
        statuses: new Set(),
        shopUrl: '',
      });
    }
    const product = products.get(article.productSlug);
    if (article.model) product.model = article.model;
    if (article.status) product.statuses.add(article.status);
    if (article.shopUrl) product.shopUrl = article.shopUrl;
  }
  return [...products.values()].map((product) => ({
    ...product,
    status: product.statuses.has('discontinued')
      ? 'discontinued'
      : product.statuses.has('limited_stock') ? 'limited_stock' : 'active',
  }));
}

function renderProductStatus(status) {
  if (status === 'discontinued') return '<span class="product-status product-status-discontinued">販売終了</span>';
  if (status === 'limited_stock') return '<span class="product-status product-status-limited">在庫限り</span>';
  return '';
}

function renderProductCatalog(products) {
  if (!products.length) return '';
  const cards = products.map((product) => {
    const isDiscontinued = product.status === 'discontinued';
    const status = renderProductStatus(product.status);
    const shopUrl = !isDiscontinued && /^https?:\/\//i.test(product.shopUrl) ? product.shopUrl : '';
    const shopLink = shopUrl ? `<a href="${escapeHtml(shopUrl)}" target="_blank" rel="noopener noreferrer">販売サイト</a>` : '';
    const model = product.model ? `<p class="product-model">品番: ${escapeHtml(product.model)}</p>` : '';
    return `<li class="product-card${isDiscontinued ? ' is-discontinued' : ''}"><div class="product-card-heading"><a href="${product.url}">${escapeHtml(product.name)}</a>${status}</div>${model}<div class="product-card-links"><a href="${product.url}">製品情報</a>${shopLink}</div></li>`;
  }).join('');
  return `<section class="product-catalog" aria-labelledby="product-catalog-title"><h2 id="product-catalog-title">製品情報</h2><ul>${cards}</ul></section>`;
}

function explorer(articles, activeUrl = '') {
  const root = { folders: new Map(), articles: [] };
  for (const article of articles) {
    let node = root;
    article.productPath.forEach((segment, index) => {
      if (!node.folders.has(segment)) node.folders.set(segment, { name: index === 0 ? article.productName : segment, model: '', folders: new Map(), articles: [] });
      node = node.folders.get(segment);
      if (index === 0 && article.model) node.model = article.model;
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
    return `<details${containsActive(node) ? ' open' : ''}><summary>${escapeHtml(node.model || node.name)}</summary>${contents}</details>`;
  };
  const folders = [...root.folders.values()].map(renderNode).join('');
  return `<aside class="wiki-explorer" aria-label="Wiki Explorer"><button class="wiki-explorer-toggle" type="button" aria-expanded="false" aria-controls="wiki-explorer-tree">Explorerを開く</button><div class="wiki-explorer-tree" id="wiki-explorer-tree">${folders || '<p class="wiki-empty">公開済みの記事はありません。</p>'}</div></aside>`;
}

function page({ title, description, breadcrumbs, navigation, document, url = '/wiki/', metadata }) {
  const crumbHtml = breadcrumbs.map((crumb, index) => index === breadcrumbs.length - 1
    ? `<span aria-current="page">${escapeHtml(crumb.label)}</span>`
    : `<a href="${crumb.href}">${escapeHtml(crumb.label)}</a>`).join(' <span aria-hidden="true">&gt;</span> ');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | アキバ技研 Wiki</title>
  <meta name="description" content="${escapeHtml(description || title)}" data-wiki-metadata>
  <link rel="canonical" href="${escapeHtml(absoluteUrl(url))}" data-wiki-metadata>
  ${metadata ? `<script type="application/ld+json" data-wiki-metadata>${jsonForHtml(metadata)}</script>` : ''}
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
  // Fail before replacing the output if the article checkout is missing or empty.
  const files = await walkMarkdown(sourceRoot);
  if (!files.length) throw new Error(`記事が見つかりません: ${sourceRoot}`);
  const articles = await Promise.all(files.map(async (file) => parseArticle(await readFile(file, 'utf8'), file)));
  articles.sort((a, b) => a.productName.localeCompare(b.productName, 'ja') || a.title.localeCompare(b.title, 'ja'));
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const excluded = new Set(['.git', '.github', '.nvmrc', '.gitignore', '.tools', 'content', 'product-wiki', 'node_modules', 'site', 'wiki', 'scripts', 'test', 'package.json', 'README.md']);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!excluded.has(entry.name)) {
      await cp(path.join(root, entry.name), path.join(outputRoot, entry.name), { recursive: true });
    }
  }
  await mkdir(wikiRoot, { recursive: true });
  await copyAssets(sourceRoot);
  const nav = explorer(articles);
  const catalog = renderProductCatalog(productCatalog(articles));
  const homePath = path.join(outputRoot, 'index.html');
  try {
    const home = await readFile(homePath, 'utf8');
    const marker = '<!-- PRODUCT_CATALOG -->';
    if (home.includes(marker)) await writeFile(homePath, home.replace(marker, catalog), 'utf8');
    else if (catalog) console.warn('Product catalog skipped: index.html is missing the PRODUCT_CATALOG marker.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(path.join(wikiRoot, 'index.html'), page({
    title: 'Wiki', description: 'アキバ技研の製品公式ドキュメント',
    breadcrumbs: [{ label: 'Wiki', href: '/wiki/' }], navigation: nav,
    document: `<h1>Wiki の使い方</h1><p>アキバ技研の製品に関する仕様、使い方、FAQを掲載しています。</p>${renderArticleIndex(articles)}<h2>ドキュメントを探す</h2><ol><li>画面左の品番（品番未設定の場合は製品名）をクリックして、製品を選びます。</li><li>表示された記事から、確認したい内容を選びます。</li><li>製品シリーズは、矢印をクリックすると個別製品を展開できます。</li></ol><h2>情報が見つからない場合</h2><p>掲載内容で解決しない場合は、お問い合わせページからご連絡ください。</p>`,
  }), 'utf8');
  for (const article of articles) {
    const target = path.join(outputRoot, articleUrl(article).replace(/^\//, ''));
    await mkdir(path.dirname(target), { recursive: true });
    const articleShopUrl = /^https?:\/\//i.test(article.shopUrl) ? article.shopUrl : '';
    const productNotice = article.status === 'discontinued'
      ? '<p class="wiki-product-notice is-discontinued">販売終了</p>'
      : articleShopUrl ? `<p class="wiki-product-notice"><a href="${escapeHtml(articleShopUrl)}" target="_blank" rel="noopener noreferrer">販売ページはこちら</a>${renderProductStatus(article.status)}</p>`
        : renderProductStatus(article.status);
    const productIdentity = article.model ? `<div class="wiki-product-identity"><p class="wiki-product-name">${escapeHtml(article.productName)}</p><p class="product-model">品番: ${escapeHtml(article.model)}</p></div>` : '';
    const body = `${productIdentity}<h1>${escapeHtml(article.title)}</h1>${productNotice}${article.date ? `<p class="wiki-updated">更新日: ${escapeHtml(article.date)}</p>` : ''}${renderMarkdown(article.markdown, article)}`;
    await writeFile(target, page({
      title: articlePageTitle(article), description: article.description,
      url: articleUrl(article), metadata: articleMetadata(article),
      breadcrumbs: [{ label: 'Wiki', href: '/wiki/' }, { label: article.model || article.productName, href: '/wiki/' }, { label: article.title, href: articleUrl(article) }],
      navigation: explorer(articles, articleUrl(article)), document: body,
    }), 'utf8');
  }
  await writeDiscoveryFiles(articles);
  if (process.argv.includes('--preview')) {
    const previewRoot = path.join(root, 'wiki');
    await rm(previewRoot, { recursive: true, force: true });
    await cp(wikiRoot, previewRoot, { recursive: true });
  }
  console.log(`Built Wiki with ${articles.length} article(s).`);
}

build().catch((error) => { console.error(error); process.exitCode = 1; });

