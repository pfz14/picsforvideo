// 生成 pics.momoto520.com 的静态下载页。
// 读仓库根目录下每个视频文件夹（跳过“待发布”开头的），输出到 _site/dist：
//   o/<id>/<n>.<ext>  原图（原样复制）
//   p/<id>/<n>.webp   大图预览（长边 1600）
//   t/<id>/<n>.webp   缩略图（长边 480）
//   assets/           样式、脚本、按页面用字裁剪过的 Momoto Sans
// 用法：cd _site && npm ci && node build.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import subsetFont from 'subset-font';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SITE, '..');
const DIST = path.join(SITE, 'dist');
const cfg = JSON.parse(await fs.readFile(path.join(SITE, 'site.json'), 'utf8'));

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const mb = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';

// ---------- README 解析 ----------
function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener" target="_blank">$1</a>');
  return s;
}

function mdToHtml(lines) {
  // 只支持段落和两级列表，够 README 用
  const out = [];
  let depth = 0;
  const closeTo = (d) => {
    while (depth > d) { out.push('</li></ul>'); depth--; }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeTo(0); continue; }
    const m = line.match(/^(\s*)[-*] (.*)$/);
    if (m) {
      const level = Math.min(2, Math.floor(m[1].length / 2) + 1);
      if (level > depth) {
        while (depth < level) { out.push('<ul><li>'); depth++; }
      } else {
        closeTo(level);
        out.push('</li><li>');
      }
      out.push(inline(m[2]));
    } else {
      closeTo(0);
      out.push(`<p>${inline(line.trim())}</p>`);
    }
  }
  closeTo(0);
  return out.join('');
}

function parseReadme(text, folder) {
  const lines = text.split(/\r?\n/);
  let title = '';
  let date = '';
  let link = '';
  const rest = [];
  for (const line of lines) {
    if (!title && /^#\s+/.test(line)) { title = line.replace(/^#\s+/, '').trim(); continue; }
    const d = line.match(/发布[:：]\s*(\d{4}-\d{2}-\d{2})/);
    if (d) { date = d[1]; continue; }
    const l = line.match(/https:\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/);
    if (l && /B站/.test(line)) { link = `https://www.bilibili.com/video/${l[1]}`; continue; }
    rest.push(line);
  }
  return { title: title || folder, date, link, notesHtml: mdToHtml(rest) };
}

// ---------- 小工具 ----------
async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

async function writeHashed(dir, base, ext, content) {
  const name = `${base}.${hash(content)}${ext}`;
  await fs.writeFile(path.join(dir, name), content);
  return `/assets/${name}`;
}

// ---------- 主流程 ----------
const t0 = Date.now();
await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(path.join(DIST, 'assets'), { recursive: true });

const dirents = await fs.readdir(ROOT, { withFileTypes: true });
const videos = [];
for (const d of dirents) {
  if (!d.isDirectory()) continue;
  if (cfg.skip.some((p) => d.name.startsWith(p))) continue;
  const dir = path.join(ROOT, d.name);
  const files = (await fs.readdir(dir)).filter((f) => IMG_EXT.has(path.extname(f).toLowerCase()));
  if (!files.length) continue;
  files.sort(collator.compare);
  let readme = '';
  try { readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8'); } catch {}
  const info = parseReadme(readme, d.name.replace(/^BV[0-9A-Za-z]{10}-/, ''));
  const bv = (d.name.match(/^(BV[0-9A-Za-z]{10})/) || [])[1] || '';
  const id = bv || 's' + hash(Buffer.from(d.name)).slice(0, 8);
  if (!info.link && bv) info.link = `https://www.bilibili.com/video/${bv}`;
  videos.push({ id, bv, folder: d.name, ...info, files, images: [] });
}
// 新的在前；没有日期的（比如共用设定稿）放最后
videos.sort((a, b) => (b.date || '0').localeCompare(a.date || '0') || collator.compare(a.folder, b.folder));

// 处理图片
const jobs = [];
for (const v of videos) {
  for (const [i, file] of v.files.entries()) jobs.push({ v, i, file });
}
for (const sub of ['o', 'p', 't']) {
  for (const v of videos) await fs.mkdir(path.join(DIST, sub, v.id), { recursive: true });
}
await pool(jobs, 4, async ({ v, i, file }) => {
  const src = path.join(ROOT, v.folder, file);
  const ext = path.extname(file).toLowerCase().replace('.jpeg', '.jpg');
  const n = i + 1;
  const stat = await fs.stat(src);
  const meta = await sharp(src).metadata();
  const gif = ext === '.gif';
  const o = `/o/${v.id}/${n}${ext}`;
  const t = `/t/${v.id}/${n}.webp`;
  const p = gif ? o : `/p/${v.id}/${n}.webp`;
  await fs.copyFile(src, path.join(DIST, o));
  await sharp(src).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 76, effort: 4 }).toFile(path.join(DIST, t));
  if (!gif) {
    await sharp(src).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84, effort: 4 }).toFile(path.join(DIST, p));
  }
  v.images[i] = {
    n, name: file, o, p, t, gif,
    w: meta.width, h: meta.pageHeight || meta.height, bytes: stat.size,
  };
});

// 首屏大图：用 site.json 里指定的那张
let hero = null;
if (cfg.hero && cfg.hero.image) {
  const src = path.join(ROOT, cfg.hero.image);
  try {
    const img = sharp(src);
    const meta = await img.metadata();
    // 取右上角一块（这张图那里是纯底色），用来铺满宽屏两侧
    const patch = await sharp(src).extract({ left: Math.round(meta.width * 0.86), top: Math.round(meta.height * 0.04), width: Math.round(meta.width * 0.1), height: Math.round(meta.height * 0.2) }).png().toBuffer();
    const strip = await sharp(patch).stats();
    const [r, g, b] = strip.channels.map((c) => Math.round(c.mean));
    const bg = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
    await sharp(src).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toFile(path.join(DIST, 'assets', 'hero.webp'));
    await sharp(src).resize(800, 800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(DIST, 'assets', 'hero-800.webp'));
    hero = { ...cfg.hero, bg, w: Math.min(1600, meta.width), h: Math.round(Math.min(1600, meta.width) * meta.height / meta.width) };
  } catch (e) {
    console.warn('首屏图读取失败，跳过：', e.message);
  }
}

// ---------- 页面 ----------
const totalImages = videos.reduce((s, v) => s + v.images.length, 0);
const tpl = (body, { title, desc, assets, page }) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#000000">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${hero ? `<meta property="og:image" content="${esc(cfg.origin)}/assets/hero-800.webp">` : ''}
<meta name="format-detection" content="telephone=no">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${assets.fontBold}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${assets.css}">
</head>
<body class="page-${page}">
${body}
</body>
</html>
`;

function videoSection(v) {
  const bytes = v.images.reduce((s, im) => s + im.bytes, 0);
  const tiles = v.images.map((im) => `
      <li class="tile" data-key="${v.id}/${im.n}">
        <a class="tile-open" href="${im.o}" data-i="${im.n - 1}" aria-label="看大图：${esc(im.name)}">
          <img src="${im.t}" alt="${esc(im.name.replace(/\.[^.]+$/, ''))}" loading="lazy" decoding="async">
          ${im.gif ? '<span class="tile-badge">动图</span>' : ''}
        </a>
        <button class="tile-check" type="button" aria-pressed="false" aria-label="选中 ${esc(im.name)}"></button>
      </li>`).join('');
  return `
  <section class="video" id="${v.id}" data-id="${v.id}">
    <header class="video-head">
      <h2 class="video-title">${esc(v.title)}</h2>
      <p class="video-meta">${v.date ? `<span>${v.date} 发布</span>` : ''}<span>${v.images.length} 张，${mb(bytes)}</span>${v.link ? `<a href="${v.link}" rel="noopener" target="_blank">去 B站看</a>` : ''}</p>
      ${v.notesHtml ? `<details class="video-notes"><summary>关于这些图</summary><div>${v.notesHtml}</div></details>` : ''}
    </header>
    <ul class="grid">${tiles}
    </ul>
    <div class="video-actions">
      <button class="btn btn-ink js-zip-all" type="button" data-id="${v.id}">全部打包下载（${mb(bytes)}）</button>
    </div>
  </section>`;
}

const navHtml = videos.map((v) => `<li><a href="#${v.id}">${esc(v.title)}</a></li>`).join('');

const indexBody = `
<a class="skip" href="#main">跳到图库</a>
<header class="site-head">
  <a class="site-name" href="/">${esc(cfg.title)}</a>
  ${cfg.bilibili ? `<a class="site-bili" href="${esc(cfg.bilibili)}" rel="noopener" target="_blank">B站主页</a>` : ''}
</header>
${hero ? `
<figure class="hero">
  <div class="hero-frame">
    <img src="/assets/hero.webp" srcset="/assets/hero-800.webp 800w, /assets/hero.webp ${hero.w}w" sizes="(min-width: 1100px) 1100px, 100vw" width="${hero.w}" height="${hero.h}" alt="">
    <p class="hero-quote">${esc(hero.quote)}</p>
  </div>
  <figcaption class="hero-source">${esc(hero.source)}</figcaption>
</figure>` : ''}
<div class="intro">
  <p class="intro-lead">${esc(cfg.intro)}</p>
  <div class="rules">
    <span class="stamp" aria-hidden="true">仅限<br>自存</span>
    <p><strong>${esc(cfg.rules)}</strong> <a href="/license.html">完整说明</a></p>
  </div>
  <p class="howto">${esc(cfg.howto)}</p>
  <p class="inapp" hidden>你现在是在 App 里打开的，打包下载可能用不了：点右上角「…」，选「在浏览器打开」。单张图点开以后长按也能保存。</p>
</div>
<nav class="toc" aria-label="视频目录">
  <ul>${navHtml}</ul>
</nav>
<main id="main">${videos.map(videoSection).join('')}
</main>
<footer class="site-foot">
  <p>图片版权所有 © 2026 风霜秋雨，共 ${videos.length} 支视频、${totalImages} 张图。</p>
  <p>网页由小克制作。字体 Momoto Sans（<a href="/assets/OFL.txt">SIL OFL 1.1</a>）。</p>
</footer>

<div class="bar" hidden>
  <p class="bar-count" aria-live="polite"></p>
  <button class="btn btn-paper js-zip-selected" type="button">打包下载</button>
  <button class="btn btn-ghost js-clear" type="button">清空</button>
</div>
<p class="toast" role="status" aria-live="polite" hidden></p>

<div class="lb" role="dialog" aria-modal="true" aria-label="看大图" hidden>
  <button class="lb-close" type="button" aria-label="关闭">关闭</button>
  <div class="lb-stage">
    <img class="lb-img" alt="">
    <button class="lb-nav lb-prev" type="button" aria-label="上一张">‹</button>
    <button class="lb-nav lb-next" type="button" aria-label="下一张">›</button>
  </div>
  <div class="lb-bar">
    <p class="lb-info"><span class="lb-name"></span><span class="lb-size"></span></p>
    <p class="lb-hint"></p>
    <div class="lb-actions">
      <button class="btn btn-ghost lb-full" type="button">加载原图</button>
      <a class="btn btn-paper lb-dl" href="#" download>下载原图</a>
      <button class="btn btn-ghost lb-pick" type="button" aria-pressed="false">选中</button>
    </div>
  </div>
</div>

<script type="application/json" id="data">${JSON.stringify(videos.map((v) => ({
  id: v.id, title: v.title,
  images: v.images.map(({ n, name, o, p, bytes, gif }) => ({ n, name, o, p, bytes, gif })),
}))).replace(/</g, '\\u003c')}</script>
<script src="__APP__" data-jszip="__JSZIP__" defer></script>
`;

const licenseText = await fs.readFile(path.join(ROOT, 'LICENSE'), 'utf8').catch(() => '');
const licenseBody = `
<header class="site-head"><a class="site-name" href="/">${esc(cfg.title)}</a></header>
<main class="doc">
  <h1>使用说明</h1>
  ${licenseText.split(/\n\s*\n/).map((para) => {
    const ls = para.split('\n').filter(Boolean);
    if (ls.every((l) => /^- /.test(l))) return `<ul>${ls.map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
    if (ls.length > 1 && ls.slice(1).every((l) => /^- /.test(l))) return `<p>${esc(ls[0])}</p><ul>${ls.slice(1).map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
    if (/^-{3,}$/.test(para.trim())) return '<hr>';
    return `<p>${ls.map(esc).join('<br>')}</p>`;
  }).join('\n  ')}
  <p><a href="/">回到图库</a></p>
</main>`;

const notFoundBody = `
<header class="site-head"><a class="site-name" href="/">${esc(cfg.title)}</a></header>
<main class="doc">
  <h1>这里没有图</h1>
  <p>链接可能写错了，或者这张图换了位置。</p>
  <p><a href="/">回到图库首页</a></p>
</main>`;

// ---------- 字体：只留页面上用到的字 ----------
const appSrc = await fs.readFile(path.join(SITE, 'src', 'app.js'), 'utf8');
const allText = [indexBody, licenseBody, notFoundBody, appSrc, JSON.stringify(cfg)].join('');
const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const chars = [...new Set(ascii + '，。、：；！？（）「」《》“”‘’…—·✓‹›' + allText.replace(/<[^>]+>/g, ''))].join('');
const fonts = {};
for (const weight of ['Regular', 'Bold']) {
  const buf = await fs.readFile(path.join(SITE, 'fonts', `MomotoSans-${weight}.woff2`));
  const out = await subsetFont(buf, chars, { targetFormat: 'woff2' });
  fonts[weight] = await writeHashed(path.join(DIST, 'assets'), `momoto-${weight.toLowerCase()}`, '.woff2', out);
}
await fs.copyFile(path.join(SITE, 'fonts', 'OFL.txt'), path.join(DIST, 'assets', 'OFL.txt'));

// ---------- 样式和脚本 ----------
let css = await fs.readFile(path.join(SITE, 'src', 'style.css'), 'utf8');
css = css.replace('__FONT_REGULAR__', fonts.Regular).replace('__FONT_BOLD__', fonts.Bold).replace('__HERO_BG__', hero ? hero.bg : '#000000');
const cssUrl = await writeHashed(path.join(DIST, 'assets'), 'style', '.css', css);
const jszip = await fs.readFile(path.join(SITE, 'node_modules', 'jszip', 'dist', 'jszip.min.js'));
const jszipUrl = await writeHashed(path.join(DIST, 'assets'), 'jszip', '.js', jszip);
const appUrl = await writeHashed(path.join(DIST, 'assets'), 'app', '.js', appSrc);

const assets = { css: cssUrl, fontBold: fonts.Bold };
const desc = cfg.description;
await fs.writeFile(path.join(DIST, 'index.html'),
  tpl(indexBody.replace('__APP__', appUrl).replace('__JSZIP__', jszipUrl), { title: cfg.title, desc, assets, page: 'home' }));
await fs.writeFile(path.join(DIST, 'license.html'), tpl(licenseBody, { title: `使用说明 - ${cfg.title}`, desc, assets, page: 'doc' }));
await fs.writeFile(path.join(DIST, '404.html'), tpl(notFoundBody, { title: `找不到 - ${cfg.title}`, desc, assets, page: 'doc' }));

await fs.writeFile(path.join(DIST, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#000"/><circle cx="32" cy="32" r="17" fill="none" stroke="#fff" stroke-width="6"/><path d="M24 33l6 6 11-13" fill="none" stroke="#E03A2F" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`);

await fs.writeFile(path.join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n');

// Cloudflare Pages 的响应头
await fs.writeFile(path.join(DIST, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/o/*
  Cache-Control: public, max-age=86400
/p/*
  Cache-Control: public, max-age=86400
/t/*
  Cache-Control: public, max-age=86400
`);

const distSize = (await fs.readdir(DIST, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length;
console.log(`完成：${videos.length} 支视频，${totalImages} 张图，输出 ${distSize} 个文件，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
for (const v of videos) console.log(`  ${v.id}  ${v.date || '----------'}  ${v.images.length} 张  ${v.title}`);
