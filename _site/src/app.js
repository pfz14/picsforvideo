// pics.momoto520.com 的交互：看大图、多选、在浏览器里打包下载。
// 不用任何外部 CDN；打包用的 JSZip 在第一次打包时才加载。
(() => {
  'use strict';

  const data = JSON.parse(document.getElementById('data').textContent);
  const byKey = new Map();
  for (const v of data) for (const im of v.images) byKey.set(`${v.id}/${im.n}`, { v, im });

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
  const safe = (s) => s.replace(/[\\/:*?"<>|]+/g, '_').trim();

  // ---------- 在 B站、微信等 App 里打开时给提示 ----------
  const ua = navigator.userAgent;
  const inApp = /BiliApp|bili-universal|bili-inter|MicroMessenger|\bQQ\/|Weibo|xhsdiscover|aweme|NewsArticle|DingTalk/i.test(ua);
  if (inApp) $('.inapp').hidden = false;

  // ---------- 提示条 ----------
  const toastEl = $('.toast');
  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  // ---------- 多选 ----------
  const picked = new Set();
  const bar = $('.bar');
  const barCount = $('.bar-count');

  function render() {
    for (const tile of $$('.tile')) {
      const on = picked.has(tile.dataset.key);
      tile.classList.toggle('is-picked', on);
      tile.querySelector('.tile-check').setAttribute('aria-pressed', String(on));
    }
    let bytes = 0;
    for (const k of picked) bytes += byKey.get(k).im.bytes;
    bar.hidden = picked.size === 0;
    document.body.classList.toggle('has-bar', picked.size > 0);
    barCount.textContent = `已选 ${picked.size} 张，${mb(bytes)}`;
    if (lb.key) syncPick();
  }

  function toggle(key) {
    if (picked.has(key)) picked.delete(key); else picked.add(key);
    render();
  }

  document.addEventListener('click', (e) => {
    const check = e.target.closest('.tile-check');
    if (check) { toggle(check.closest('.tile').dataset.key); return; }
    const open = e.target.closest('.tile-open');
    if (open) {
      e.preventDefault();
      const sec = open.closest('.video');
      openLb(sec.dataset.id, Number(open.dataset.i));
    }
  });

  $('.js-clear').addEventListener('click', () => { picked.clear(); render(); });

  // ---------- 打包下载 ----------
  const jszipSrc = $('script[data-jszip]').dataset.jszip;
  let jszipReady = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!jszipReady) {
      jszipReady = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = jszipSrc;
        s.onload = () => resolve(window.JSZip);
        s.onerror = () => { jszipReady = null; reject(new Error('打包工具没加载出来')); };
        document.head.appendChild(s);
      });
    }
    return jszipReady;
  }

  let busy = false;
  async function zipKeys(keys, zipName) {
    if (busy) return;
    if (!keys.length) { toast('还没选图。点图右上角的圆圈选几张。'); return; }
    busy = true;
    $$('.js-zip-all, .js-zip-selected').forEach((b) => { b.disabled = true; });
    const items = keys.map((k) => byKey.get(k));
    const multi = new Set(items.map((x) => x.v.id)).size > 1;
    let done = 0;
    let failed = 0;
    try {
      toast(`正在准备打包…`, 0);
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      const used = new Set();
      let next = 0;
      const worker = async () => {
        while (next < items.length) {
          const { v, im } = items[next++];
          try {
            const res = await fetch(im.o);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            let name = (multi ? safe(v.title) + '/' : '') + safe(im.name);
            while (used.has(name)) name = name.replace(/(\.[^.]+)$/, '_$1');
            used.add(name);
            zip.file(name, blob, { binary: true });
          } catch {
            failed++;
          }
          done++;
          toast(`正在下载原图 ${done}/${items.length}`, 0);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (failed === items.length) throw new Error('全部失败');
      toast('正在打包…', 0);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safe(zipName) + '.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      if (failed) toast(`打包好了，开始下载。有 ${failed} 张没下载成功，网络可能断了，可以单独再下。`, 7000);
      else toast(inApp ? '打包好了。如果没有开始下载，请换到浏览器里打开这个页面。' : '打包好了，开始下载。', inApp ? 8000 : 3500);
    } catch {
      toast(inApp
        ? '在 App 里打包下载失败了。点右上角「…」，选「在浏览器打开」再试。'
        : '打包下载失败了，网络可能断了。再点一次试试。', 8000);
    } finally {
      busy = false;
      $$('.js-zip-all, .js-zip-selected').forEach((b) => { b.disabled = false; });
    }
  }

  $$('.js-zip-all').forEach((btn) => btn.addEventListener('click', () => {
    const v = data.find((x) => x.id === btn.dataset.id);
    zipKeys(v.images.map((im) => `${v.id}/${im.n}`), v.title);
  }));
  $('.js-zip-selected').addEventListener('click', () => {
    const keys = Array.from(picked);
    const ids = new Set(keys.map((k) => k.split('/')[0]));
    const name = ids.size === 1 ? data.find((x) => x.id === [...ids][0]).title + `（${keys.length}张）` : `风霜秋雨的图（${keys.length}张）`;
    zipKeys(keys, name);
  });

  // ---------- 看大图 ----------
  const lbEl = $('.lb');
  const lbImg = $('.lb-img');
  const lbName = $('.lb-name');
  const lbSize = $('.lb-size');
  const lbHint = $('.lb-hint');
  const lbFull = $('.lb-full');
  const lbDl = $('.lb-dl');
  const lbPick = $('.lb-pick');
  const lb = { vid: null, i: 0, key: null, lastFocus: null };

  function show() {
    const v = data.find((x) => x.id === lb.vid);
    const im = v.images[lb.i];
    lb.key = `${v.id}/${im.n}`;
    lbImg.src = im.p;
    lbImg.alt = im.name;
    lbName.textContent = `${v.title}　${lb.i + 1}/${v.images.length}　${im.name}`;
    lbSize.textContent = `原图 ${mb(im.bytes)}`;
    lbDl.href = im.o;
    lbDl.setAttribute('download', im.name);
    const isFull = im.p === im.o;
    lbFull.hidden = isFull;
    lbFull.textContent = `加载原图（${mb(im.bytes)}）`;
    lbHint.textContent = isFull ? '这就是原图，长按可以直接保存。' : '现在看的是压缩过的预览。想长按保存原图，先点「加载原图」。';
    syncPick();
    // 预读前后两张
    for (const d of [1, -1]) {
      const j = lb.i + d;
      if (j >= 0 && j < v.images.length) { const pre = new Image(); pre.src = v.images[j].p; }
    }
  }
  function syncPick() {
    const on = picked.has(lb.key);
    lbPick.setAttribute('aria-pressed', String(on));
    lbPick.textContent = on ? '已选中' : '选中';
  }
  function openLb(vid, i) {
    lb.vid = vid; lb.i = i; lb.lastFocus = document.activeElement;
    lbEl.hidden = false;
    document.body.classList.add('lb-open');
    show();
    history.pushState({ lb: true }, '');
    $('.lb-close').focus();
  }
  function closeLb(fromPop) {
    if (lbEl.hidden) return;
    lbEl.hidden = true;
    document.body.classList.remove('lb-open');
    lbImg.removeAttribute('src');
    lb.key = null;
    if (!fromPop && history.state && history.state.lb) history.back();
    if (lb.lastFocus) lb.lastFocus.focus();
  }
  function step(d) {
    const v = data.find((x) => x.id === lb.vid);
    const j = lb.i + d;
    if (j < 0 || j >= v.images.length) return;
    lb.i = j;
    show();
  }

  $('.lb-close').addEventListener('click', () => closeLb(false));
  $('.lb-prev').addEventListener('click', () => step(-1));
  $('.lb-next').addEventListener('click', () => step(1));
  lbPick.addEventListener('click', () => toggle(lb.key));
  lbFull.addEventListener('click', () => {
    const { im } = byKey.get(lb.key);
    lbFull.disabled = true;
    lbFull.textContent = '原图加载中…';
    const full = new Image();
    full.onload = () => {
      if (lb.key !== `${lb.vid}/${im.n}`) return;
      lbImg.src = im.o;
      lbFull.hidden = true;
      lbFull.disabled = false;
      lbHint.textContent = '已换成原图，长按可以直接保存。';
    };
    full.onerror = () => {
      lbFull.disabled = false;
      lbFull.textContent = '原图没加载出来，再点一次';
    };
    full.src = im.o;
  });
  window.addEventListener('popstate', () => closeLb(true));
  document.addEventListener('keydown', (e) => {
    if (lbEl.hidden) return;
    if (e.key === 'Escape') closeLb(false);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });

  // 左右滑动换图
  let sx = 0;
  let sy = 0;
  const stage = $('.lb-stage');
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (!sx) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    sx = 0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  render();
})();
