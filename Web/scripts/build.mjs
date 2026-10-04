import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import markedKatex from 'marked-katex-extension';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(webDir, '..');
const notesDir = path.join(repoDir, 'Note');
const srcDir = path.join(webDir, 'src');
const distDir = path.join(webDir, 'dist');
const repositoryUrl = 'https://github.com/SSC202/STM32_Engine';
const repositoryBranch = 'V3.0';
const execFileAsync = promisify(execFile);

marked.use(markedKatex({ throwOnError: false, nonStandard: true, strict: false }));

const categoryMeta = {
  '理论基础': {
    description: '从控制理论、电机理论与电力电子出发，建立电机驱动所需的分析基础。',
    icon: 'book'
  },
  '直流电机': {
    description: '理解 H 桥、双闭环控制与舵机驱动，连接控制算法与实际执行机构。',
    icon: 'current'
  },
  '永磁同步电机': {
    description: '覆盖步进电机、PMSM、BLDC、开绕组及多相电机的建模与控制。',
    icon: 'motor'
  },
  '感应电机': {
    description: '梳理感应电机的数学模型、磁场定向与基本驱动方法。',
    icon: 'field'
  },
  '其他电机': {
    description: '记录有限转角等特殊电机的结构、原理与控制方法。',
    icon: 'compass'
  }
};
const categoryOrder = ['理论基础', '直流电机', '永磁同步电机', '感应电机', '其他电机'];

const htmlEscape = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const trimOrder = value => value.replace(/^(?:\d+|[A-Z])[_\s-]+/i, '').trim();
const slugFor = value => createHash('sha1').update(value.replaceAll('\\', '/')).digest('hex').slice(0, 12);
const urlPath = value => value.split(path.sep).map(encodeURIComponent).join('/');

async function visibleNoteFiles(extensions) {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'Note'],
    { cwd: repoDir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  return stdout.split('\0')
    .filter(Boolean)
    .filter(file => extensions.some(extension => file.toLowerCase().endsWith(extension)))
    .map(file => path.resolve(repoDir, file));
}

function stripMarkdown(value) {
  return value.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ').replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|~-]/g, ' ').replace(/\$+/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractTitle(markdown, fallback) {
  return stripMarkdown(markdown.match(/^#\s+(.+)$/m)?.[1] || trimOrder(fallback.replace(/\.md$/i, '')));
}

function extractExcerpt(markdown) {
  const paragraphs = markdown.replace(/```[\s\S]*?```/g, ' ').split(/\r?\n\s*\r?\n/);
  for (const paragraph of paragraphs) {
    if (/^\s*(#|!\[|\||>|[-*+]\s)/.test(paragraph)) continue;
    const text = stripMarkdown(paragraph);
    if (text.length >= 18) return `${text.slice(0, 98)}${text.length > 98 ? '…' : ''}`;
  }
  return '电机驱动理论、控制方法与工程实践笔记。';
}

function categoryFor(relativePath) {
  return trimOrder(relativePath.split(path.sep)[0] || '其他电机');
}

function sectionFor(relativePath, fallback) {
  const directory = relativePath.split(path.sep).slice(1, -1)
    .find(name => !/^(?:read_note|assets)$/i.test(name));
  return directory
    ? { name: trimOrder(directory), order: directory }
    : { name: fallback, order: fallback === '专题概览' ? '0' : '999' };
}

function readingTime(markdown) {
  return Math.max(1, Math.ceil(stripMarkdown(markdown).length / 500));
}

function queueLocalImage(article, imageJobs, href) {
  if (!href || /^(https?:|data:|\/|#)/i.test(href)) return href;
  let decoded = href;
  try { decoded = decodeURIComponent(href); } catch {}
  const source = path.resolve(path.dirname(article.absolutePath), decoded);
  const extension = path.extname(source).toLowerCase() || '.jpg';
  const imageName = `${slugFor(path.relative(notesDir, source))}${extension}`;
  const output = path.join(distDir, 'media', article.slug, imageName);
  if (!imageJobs.some(job => job.output === output)) imageJobs.push({ source, output });
  return `../media/${article.slug}/${imageName}`;
}

function repositoryLink(article, href) {
  if (!href || /^(https?:|data:|mailto:|#|\/)/i.test(href)) return href;
  let decoded = href;
  try { decoded = decodeURIComponent(href); } catch {}
  const target = path.resolve(path.dirname(article.absolutePath), decoded);
  if (!target.startsWith(notesDir)) return href;
  const relative = path.relative(repoDir, target);
  return `${repositoryUrl}/blob/${repositoryBranch}/${urlPath(relative)}`;
}

function makeRenderer(article, imageJobs) {
  const renderer = new marked.Renderer();
  const originalImage = renderer.image.bind(renderer);
  const originalLink = renderer.link.bind(renderer);
  renderer.image = token => originalImage({
    ...token,
    href: queueLocalImage(article, imageJobs, token.href),
    text: token.text === 'NULL' ? '' : token.text
  });
  renderer.link = token => originalLink({ ...token, href: repositoryLink(article, token.href) });
  renderer.code = ({ text, lang }) => {
    const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
    const highlighted = hljs.highlight(text, { language }).value;
    return `<pre><div class="code-head"><span>${htmlEscape(lang || 'text')}</span><button class="copy-code" type="button" aria-label="复制代码">复制</button></div><code class="hljs language-${htmlEscape(language)}">${highlighted}</code></pre>`;
  };
  return renderer;
}

function extractDisplayMath(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  const output = [];
  const delimiter = /^(?:\s*>\s*)*\s*\$\$\s*$/;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!delimiter.test(line)) { output.push(line); continue; }
    const content = [];
    let closing = index + 1;
    while (closing < lines.length && !delimiter.test(lines[closing])) {
      content.push(lines[closing].replace(/^\s*(?:>\s*)*/, ''));
      closing += 1;
    }
    if (closing >= lines.length) { output.push(line); continue; }
    const quote = line.match(/^\s*((?:>\s*)+)/)?.[1] || '';
    const placeholder = `ENGINENOTEMATH${blocks.length}PLACEHOLDER`;
    blocks.push({
      placeholder,
      html: katex.renderToString(content.join('\n').trim(), { displayMode: true, throwOnError: false, strict: false })
    });
    output.push(`${quote}${placeholder}`);
    index = closing;
  }
  return { markdown: output.join('\n'), blocks };
}

function renderMarkdown(article, imageJobs) {
  const renderer = makeRenderer(article, imageJobs);
  const withHtmlImages = article.markdown.replace(
    /(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (match, prefix, quote, href) => `${prefix}${quote}${queueLocalImage(article, imageJobs, href)}${quote}`
  );
  const displayMath = extractDisplayMath(withHtmlImages);
  let html = marked.parse(displayMath.markdown, { renderer, gfm: true, breaks: false });
  for (const block of displayMath.blocks) html = html.replaceAll(block.placeholder, block.html);
  return html;
}

function icon(name) {
  const icons = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>',
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.3 4 5 5 0 0 0 19.2.5S18 0 15 1.9a13.4 13.4 0 0 0-7 0C5 .1 3.8.5 3.8.5A5 5 0 0 0 3.7 4a5.4 5.4 0 0 0-1.5 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 8 18v4"></path><path d="M8 19c-3 .9-3-1.5-4.2-2"></path></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"></path></svg>',
    current: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-7 4 14 2-7h6"></path></svg>',
    motor: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>',
    field: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6c4-4 12-4 16 0M4 18c4 4 12 4 16 0M7 9c3-2 7-2 10 0M7 15c3 2 7 2 10 0"></path></svg>',
    compass: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m15 9-2 4-4 2 2-4 4-2Z"></path></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6M8 13h8M8 17h5"></path></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"></path><path d="M5 21h14"></path></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>'
  };
  return icons[name] || icons.book;
}

function shell({ title, description, body, root = '.', pageClass = '', script = '' }) {
  return `<!doctype html><html lang="zh-CN"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0d100f"><meta name="description" content="${htmlEscape(description)}">
  <title>${htmlEscape(title)}</title><link rel="icon" href="${root}/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${root}/katex.min.css"><link rel="stylesheet" href="${root}/styles.css">
</head><body class="${pageClass}">${body}${script ? `<script type="module" src="${root}/${script}"></script>` : ''}</body></html>`;
}

function siteHeader(root = '.') {
  return `<header class="site-header">
    <a class="brand" href="${root}/index.html" aria-label="电机驱动笔记首页"><span class="brand-mark">M</span><span>电机驱动笔记</span></a>
    <nav class="top-nav" aria-label="主导航"><a href="${root}/index.html#paths">学习路径</a><a href="${root}/index.html#articles">文章索引</a><a class="icon-link" href="${repositoryUrl}" target="_blank" rel="noreferrer" aria-label="GitHub 仓库">${icon('github')}</a></nav>
  </header>`;
}

function articleRow(article, root = '.') {
  const searchable = htmlEscape(`${article.title} ${article.category} ${article.pathLabel} ${article.excerpt}`.toLocaleLowerCase('zh-CN'));
  return `<a class="article-row" data-search-row data-search="${searchable}" href="${root}/articles/${article.slug}.html">
    <span class="article-kind">${article.category}</span><span class="article-copy"><b>${htmlEscape(article.title)}</b><small>${htmlEscape(article.pathLabel)}</small></span>
    <span class="article-time">${article.minutes} 分钟</span><span class="article-open">${icon('arrow')}</span></a>`;
}

function homePage(articles, categories, resources) {
  const starter = articles.find(article => article.title.includes('基础PID')) || articles[0];
  const cards = categories.map((category, index) => {
    const names = category.subtopics
      .filter(subtopic => !['专题概览', '专题资料'].includes(subtopic.name))
      .map(subtopic => htmlEscape(subtopic.name));
    return `<a class="path-card tone-${index % 4}" href="topics/${category.slug}.html">
    <span class="path-icon">${icon(category.icon)}</span><span class="path-order">${String(index + 1).padStart(2, '0')}</span>
    <h3>${htmlEscape(category.name)}</h3><p>${htmlEscape(category.description)}</p>
    ${names.length ? `<span class="path-subtopics">${names.join('<i>·</i>')}</span>` : ''}
    <span class="path-link">${category.count} 篇笔记 · ${category.resources.length} 份资料 ${icon('arrow')}</span></a>`;
  }).join('');
  const rows = articles.map(article => articleRow(article)).join('');
  const body = `<div class="page-shell">${siteHeader('.')}
    <main><section class="home-hero" aria-labelledby="intro-title">
      <div class="hero-copy"><div class="eyebrow"><span></span>Motor control knowledge base</div>
        <h1 id="intro-title"><span>电机驱动笔记</span><small>从原理、建模到控制实现</small></h1>
        <p>围绕控制理论、电力电子与各类电机，整理可检索、可连续阅读的学习资料。</p>
        <div class="hero-actions"><a class="primary-button" href="articles/${starter.slug}.html">开始阅读 ${icon('arrow')}</a><a class="secondary-button" href="#paths">查看学习路径</a></div>
        <div class="hero-stats"><span><b>${articles.length}</b> 篇笔记</span><span><b>${categories.length}</b> 条路径</span><span><b>${resources.length}</b> 份资料</span></div>
      </div>
      <figure class="hero-visual"><img src="./roadmap.jpg" alt="电机驱动知识体系：硬件设计、控制系统设计与电机原理"><figcaption><span>KNOWLEDGE MAP</span> 电机驱动知识体系</figcaption></figure>
    </section>
    <section class="paths-section" id="paths"><div class="section-heading"><div><span>Learning paths</span><h2>学习路径</h2></div><p>按知识域组织，逐层深入</p></div><div class="path-grid">${cards}</div></section>
    <section class="articles-section" id="articles"><div class="section-heading article-heading"><div><span>Article index</span><h2>文章索引</h2></div>
      <label class="search-box">${icon('search')}<input id="article-search" type="search" placeholder="搜索标题、路径或内容" autocomplete="off"><kbd>/</kbd></label></div>
      <div class="article-list-head"><span id="result-count">${articles.length} 篇</span><span>按目录顺序排列</span></div><div class="article-list">${rows}</div></section></main>
    <footer><span>Engine Notes</span><p>电机驱动理论与工程实践。</p><a href="#top">回到顶部 ↑</a></footer></div>`;
  return shell({ title: '电机驱动笔记 · Engine Notes', description: '电机驱动、控制理论、电力电子与永磁同步电机学习笔记。', body, script: 'app.js' });
}

function resourceRow(resource) {
  return `<a class="resource-row" href="${resource.url}" download="${htmlEscape(`${resource.title}.pdf`)}" aria-label="下载 ${htmlEscape(resource.title)}"><span class="resource-icon">${icon('file')}</span><span><b>${htmlEscape(resource.title)}</b><small>${htmlEscape(resource.pathLabel)}</small></span><em>${resource.size}</em>${icon('download')}</a>`;
}

function topicArticleRow(article, index) {
  return `<a class="topic-article-row" href="../articles/${article.slug}.html"><span class="topic-article-index">${String(index + 1).padStart(2, '0')}</span><span class="topic-article-copy"><b>${htmlEscape(article.title)}</b><small>${htmlEscape(article.pathLabel)}</small></span><span class="topic-article-time">${article.minutes} 分钟</span><span class="article-open">${icon('arrow')}</span></a>`;
}

function topicPage(category, categories, imageJobs) {
  const index = categories.findIndex(item => item.slug === category.slug);
  const previous = categories[index - 1];
  const next = categories[index + 1];
  const overview = category.overview ? renderMarkdown(category.overview, imageJobs) : '';
  const subtopicNav = `<nav class="subtopic-nav" aria-label="子专题导航">${category.subtopics.map((subtopic, subtopicIndex) => `<a href="../subtopics/${subtopic.slug}.html"><span>${String(subtopicIndex + 1).padStart(2, '0')}</span><b>${htmlEscape(subtopic.name)}</b><small>${subtopic.articles.length} 篇 · ${subtopic.resources.length} 份资料</small></a>`).join('')}</nav>`;
  const body = `<div class="page-shell">${siteHeader('..')}<main class="topic-main">
    <a class="topic-breadcrumb" href="../index.html#paths">${icon('back')} 全部学习路径</a>
    <header class="topic-hero tone-${index % 4}"><span class="topic-hero-icon">${icon(category.icon)}</span><div><span class="topic-kicker">学习路径 ${String(index + 1).padStart(2, '0')}</span><h1>${htmlEscape(category.name)}</h1><p>${htmlEscape(category.description)}</p></div><span class="topic-count"><b>${category.count}</b> 篇笔记</span></header>
    ${overview ? `<section class="topic-overview"><div class="section-heading"><div><span>Overview</span><h2>专题概览</h2></div></div><article class="markdown-body">${overview}</article></section>` : ''}
    <section class="topic-articles"><div class="section-heading"><div><span>Contents</span><h2>子专题</h2></div><p>进入独立页面继续阅读</p></div>${subtopicNav}</section>
    <nav class="topic-pagination" aria-label="相邻专题">${previous ? `<a href="${previous.slug}.html"><small>上一专题</small><b>${htmlEscape(previous.name)}</b></a>` : '<span></span>'}${next ? `<a class="next" href="${next.slug}.html"><small>下一专题</small><b>${htmlEscape(next.name)}</b></a>` : '<span></span>'}</nav></main>
    <footer><span>Engine Notes</span><p>电机驱动理论与工程实践。</p><a href="#top">回到顶部 ↑</a></footer></div>`;
  return shell({ title: `${category.name} · 电机驱动笔记`, description: category.description, body, root: '..', pageClass: 'topic-page' });
}

function subtopicPage(subtopic, category) {
  const index = category.subtopics.findIndex(item => item.slug === subtopic.slug);
  const previous = category.subtopics[index - 1];
  const next = category.subtopics[index + 1];
  const rows = subtopic.articles.map(topicArticleRow).join('');
  const resources = subtopic.resources.map(resourceRow).join('');
  const body = `<div class="page-shell">${siteHeader('..')}<main class="topic-main">
    <nav class="breadcrumb-trail" aria-label="面包屑"><a href="../index.html#paths">学习路径</a><span>/</span><a href="../topics/${category.slug}.html">${htmlEscape(category.name)}</a></nav>
    <header class="subtopic-hero"><div><span class="topic-kicker">${htmlEscape(category.name)} · ${String(index + 1).padStart(2, '0')}</span><h1>${htmlEscape(subtopic.name)}</h1><p>${subtopic.articles.length} 篇笔记${subtopic.resources.length ? ` · ${subtopic.resources.length} 份阅读资料` : ''}</p></div><a class="back-to-topic" href="../topics/${category.slug}.html">${icon('back')} 返回专题概览</a></header>
    ${rows ? `<section class="subtopic-content"><div class="section-heading"><div><span>Articles</span><h2>文章</h2></div><p>按目录顺序阅读</p></div><div class="topic-article-list">${rows}</div></section>` : ''}
    ${resources ? `<section class="resources-section"><div class="section-heading"><div><span>References</span><h2>阅读资料</h2></div><p>点击条目下载 PDF</p></div><div class="resource-list">${resources}</div></section>` : ''}
    <nav class="topic-pagination" aria-label="相邻子专题">${previous ? `<a href="${previous.slug}.html"><small>上一子专题</small><b>${htmlEscape(previous.name)}</b></a>` : '<span></span>'}${next ? `<a class="next" href="${next.slug}.html"><small>下一子专题</small><b>${htmlEscape(next.name)}</b></a>` : '<span></span>'}</nav></main>
    <footer><span>Engine Notes</span><p>电机驱动理论与工程实践。</p><a href="#top">回到顶部 ↑</a></footer></div>`;
  return shell({ title: `${subtopic.name} · ${category.name}`, description: `${category.name}中的${subtopic.name}学习笔记。`, body, root: '..', pageClass: 'topic-page' });
}

function extractToc(html) {
  const headings = [];
  let index = 0;
  const content = html.replace(/<(h[23])>([\s\S]*?)<\/h[23]>/g, (_, tag, inner) => {
    const label = inner.replace(/<[^>]+>/g, '').trim();
    const id = `section-${++index}`;
    headings.push({ tag, label, id });
    return `<${tag} id="${id}"><a class="heading-anchor" href="#${id}">${inner}</a></${tag}>`;
  });
  return { content, headings };
}

function articlePage(article, imageJobs) {
  const { content, headings } = extractToc(renderMarkdown(article, imageJobs));
  const toc = headings.length ? headings.map(item => `<a class="toc-${item.tag}" href="#${item.id}">${htmlEscape(item.label)}</a>`).join('') : '<span class="toc-empty">本文暂无章节目录</span>';
  const previous = article.previous;
  const next = article.next;
  const body = `<div class="reading-shell">${siteHeader('..')}<button class="toc-toggle" id="toc-toggle" type="button" aria-label="打开文章目录" aria-expanded="false">${icon('menu')}</button>
    <aside class="article-aside" id="article-aside"><div class="toc-head"><span>本文目录</span><button id="toc-close" type="button" aria-label="关闭文章目录">${icon('close')}</button></div><nav class="toc" aria-label="文章目录">${toc}</nav><a class="back-link" href="../subtopics/${article.subtopicSlug}.html">${icon('back')} 返回${htmlEscape(article.section)}</a></aside>
    <main class="article-main"><header class="article-header"><a class="article-category" href="../topics/${article.categorySlug}.html">${htmlEscape(article.category)}</a><h1>${htmlEscape(article.title)}</h1><div class="article-info"><span>${article.minutes} 分钟阅读</span><span>${article.wordCount.toLocaleString('zh-CN')} 字</span><span>${article.modifiedDate}</span></div></header>
      <article class="markdown-body">${content}</article><nav class="article-pagination" aria-label="相邻文章">${previous ? `<a href="${previous.slug}.html"><small>上一篇</small><span>${htmlEscape(previous.title)}</span></a>` : '<span></span>'}${next ? `<a class="next" href="${next.slug}.html"><small>下一篇</small><span>${htmlEscape(next.title)}</span></a>` : '<span></span>'}</nav></main></div>`;
  return shell({ title: `${article.title} · 电机驱动笔记`, description: article.excerpt, body, root: '..', pageClass: 'article-page', script: 'article.js' });
}

async function copyImage(job) {
  try { await stat(job.source); await mkdir(path.dirname(job.output), { recursive: true }); await copyFile(job.source, job.output); return true; }
  catch { console.warn(`缺少图片: ${path.relative(repoDir, job.source)}`); return false; }
}

function humanSize(bytes) {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(path.join(distDir, 'articles'), { recursive: true });
  await mkdir(path.join(distDir, 'topics'), { recursive: true });
  await mkdir(path.join(distDir, 'subtopics'), { recursive: true });

  const markdownFiles = (await visibleNoteFiles(['.md'])).filter(file => path.dirname(file) !== notesDir);
  const pdfFiles = await visibleNoteFiles(['.pdf']);
  const sourceArticles = await Promise.all(markdownFiles.map(async absolutePath => {
    const relativePath = path.relative(notesDir, absolutePath);
    const markdown = await readFile(absolutePath, 'utf8');
    const info = await stat(absolutePath);
    const pathParts = relativePath.split(path.sep).slice(1, -1).map(trimOrder).filter(name => !/^read_note$/i.test(name));
    const section = sectionFor(relativePath, '专题概览');
    return {
      absolutePath, relativePath, markdown, slug: slugFor(relativePath),
      title: extractTitle(markdown, path.basename(absolutePath)), excerpt: extractExcerpt(markdown),
      category: categoryFor(relativePath), section: section.name, sectionOrder: section.order,
      pathLabel: pathParts.join(' / ') || categoryFor(relativePath),
      minutes: readingTime(markdown), wordCount: stripMarkdown(markdown).length,
      modified: info.mtimeMs, modifiedDate: info.mtime.toLocaleDateString('zh-CN')
    };
  }));
  sourceArticles.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true }));
  const articles = sourceArticles.filter(article => article.section !== '专题概览');

  const resources = await Promise.all(pdfFiles.map(async absolutePath => {
    const relativePath = path.relative(notesDir, absolutePath);
    const info = await stat(absolutePath);
    const pathParts = relativePath.split(path.sep).slice(1, -1).map(trimOrder).filter(name => !/^read_note$/i.test(name));
    const section = sectionFor(relativePath, '专题资料');
    return {
      title: trimOrder(path.basename(absolutePath, path.extname(absolutePath))), category: categoryFor(relativePath),
      section: section.name, sectionOrder: section.order,
      pathLabel: pathParts.join(' / ') || categoryFor(relativePath), size: humanSize(info.size),
      url: `${repositoryUrl}/raw/refs/heads/${repositoryBranch}/Note/${urlPath(relativePath)}`
    };
  }));
  resources.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }));

  const categoryNames = [...new Set([...sourceArticles.map(item => item.category), ...resources.map(item => item.category)])];
  const categories = categoryNames.map(name => ({
    name, slug: slugFor(`topic:${name}`),
    description: categoryMeta[name]?.description || '电机驱动理论与工程实践记录。',
    icon: categoryMeta[name]?.icon || 'book',
    overview: sourceArticles.find(article => article.category === name && article.section === '专题概览') || null,
    articles: articles.filter(article => article.category === name),
    resources: resources.filter(resource => resource.category === name)
  })).sort((a, b) => categoryOrder.indexOf(a.name) - categoryOrder.indexOf(b.name));
  for (const category of categories) {
    category.count = category.articles.length;
    const subtopicNames = [...new Set([
      ...category.articles.map(article => article.section),
      ...category.resources.map(resource => resource.section)
    ])];
    category.subtopics = subtopicNames.map(name => {
      const subtopicArticles = category.articles.filter(article => article.section === name);
      const subtopicResources = category.resources.filter(resource => resource.section === name);
      const order = subtopicArticles[0]?.sectionOrder || subtopicResources[0]?.sectionOrder || name;
      return {
        name,
        order,
        id: `subtopic-${slugFor(`${category.name}:${name}`)}`,
        slug: slugFor(`subtopic:${category.name}:${name}`),
        articles: subtopicArticles,
        resources: subtopicResources
      };
    }).sort((a, b) => a.order.localeCompare(b.order, 'zh-CN', { numeric: true }));
    category.articles.forEach(article => {
      article.categorySlug = category.slug;
      article.subtopicSlug = category.subtopics.find(subtopic => subtopic.name === article.section)?.slug;
    });
    category.subtopics.forEach(subtopic => subtopic.articles.forEach((article, index) => {
      article.previous = subtopic.articles[index - 1] || null;
      article.next = subtopic.articles[index + 1] || null;
    }));
  }

  const imageJobs = [];
  for (const article of articles) {
    await writeFile(path.join(distDir, 'articles', `${article.slug}.html`), articlePage(article, imageJobs), 'utf8');
  }
  for (const category of categories) {
    await writeFile(path.join(distDir, 'topics', `${category.slug}.html`), topicPage(category, categories, imageJobs), 'utf8');
    for (const subtopic of category.subtopics) {
      await writeFile(path.join(distDir, 'subtopics', `${subtopic.slug}.html`), subtopicPage(subtopic, category), 'utf8');
    }
  }
  await Promise.all(imageJobs.map(copyImage));
  await writeFile(path.join(distDir, 'index.html'), homePage(articles, categories, resources), 'utf8');
  await Promise.all(['styles.css', 'app.js', 'article.js', 'favicon.svg'].map(file => copyFile(path.join(srcDir, file), path.join(distDir, file))));
  await copyFile(path.join(repoDir, 'assets', 'picture_1.jpg'), path.join(distDir, 'roadmap.jpg'));
  await copyFile(path.join(webDir, 'node_modules', 'katex', 'dist', 'katex.min.css'), path.join(distDir, 'katex.min.css'));
  await cp(path.join(webDir, 'node_modules', 'katex', 'dist', 'fonts'), path.join(distDir, 'fonts'), { recursive: true });
  await writeFile(path.join(distDir, 'search-index.json'), JSON.stringify(articles.map(({ title, excerpt, category, pathLabel, slug }) => ({ title, excerpt, category, pathLabel, url: `articles/${slug}.html` }))), 'utf8');
  const sitemap = [
    ...categories.map(item => `topics/${item.slug}.html`),
    ...categories.flatMap(category => category.subtopics.map(item => `subtopics/${item.slug}.html`)),
    ...articles.map(item => `articles/${item.slug}.html`)
  ];
  await writeFile(path.join(distDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>index.html</loc></url>${sitemap.map(item => `<url><loc>${item}</loc></url>`).join('')}</urlset>`, 'utf8');
  console.log(`构建完成：${articles.length} 篇文章，${categories.length} 个专题，${resources.length} 份 PDF，${imageJobs.length} 个图片引用。`);
}

await build();
