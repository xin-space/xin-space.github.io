/* Xin Liu — site script.
   Essays are Markdown files under posts/, registered by slug in posts/index.json.
   Each file starts with a front-matter block (title, date, lang, tags, summary, draft).
   blog.html renders the list and, when the URL hash names a slug, that post. index.html shows the latest few. */
(function (global) {
  'use strict';

  var SITE = 'Xin Liu';
  var KATEX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js';
  var MATH_OUTPUT = 'mathml'; // 'htmlAndMathml' gives KaTeX's full rendering but needs katex.css linked in blog.html

  /* ---------- theme toggle ---------- */
  function initTheme() {
    var root = document.documentElement;
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = root.getAttribute('data-theme');
      var dark = cur ? cur === 'dark' : !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
      var next = dark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function parseFrontmatter(raw) {
    var meta = {}, body = raw;
    var m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
    if (m) {
      body = raw.slice(m[0].length);
      m[1].split(/\r?\n/).forEach(function (line) {
        var i = line.indexOf(':');
        if (i < 0) return;
        var k = line.slice(0, i).trim();
        var v = line.slice(i + 1).trim();
        if (/^\[.*\]$/.test(v)) {
          v = v.slice(1, -1).split(',').map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); }).filter(Boolean);
        } else {
          v = v.replace(/^["']|["']$/g, '');
        }
        meta[k] = v;
      });
    }
    return { meta: meta, body: body };
  }

  function fmtDate(p) {
    var parts = (p.date || '').split('-').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return p.date || '';
    if (p.lang === 'zh') return parts[0] + '年' + parts[1] + '月' + parts[2] + '日';
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function stats(p) {
    var cjk = (p.body.match(/[㐀-鿿豈-﫿]/g) || []).length;
    var words = (p.body.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
    var mins = Math.max(1, Math.round(cjk / 400 + words / 230));
    if (p.lang === 'zh') return '约 ' + cjk.toLocaleString() + ' 字 · ' + mins + ' 分钟';
    return words.toLocaleString() + ' words · ' + mins + ' min read';
  }

  function tagsHtml(p) {
    if (!p.tags || !p.tags.length) return '';
    return ' · ' + p.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join(' ');
  }

  /* ---------- loading ---------- */
  var cache = null;

  function loadPosts() {
    if (cache) return Promise.resolve(cache);
    return fetch('posts/index.json', { cache: 'no-cache' })
      .then(function (res) { if (!res.ok) throw new Error('posts/index.json ' + res.status); return res.json(); })
      .then(function (idx) {
        var slugs = Array.isArray(idx) ? idx : (idx.posts || []);
        return Promise.all(slugs.map(function (slug) {
          return fetch('posts/' + slug + '.md', { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) { console.warn('post not found: posts/' + slug + '.md'); return null; }
            return r.text().then(function (raw) {
              var fm = parseFrontmatter(raw), meta = fm.meta;
              var tags = meta.tags || [];
              if (typeof tags === 'string') tags = tags.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
              return {
                slug: slug,
                title: meta.title || slug,
                date: meta.date || '',
                lang: String(meta.lang || 'zh').toLowerCase().slice(0, 2),
                tags: tags,
                summary: meta.summary || '',
                draft: /^(true|yes|1)$/i.test(String(meta.draft || '')),
                body: fm.body
              };
            });
          });
        }));
      })
      .then(function (posts) {
        cache = posts.filter(Boolean).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
        return cache;
      });
  }

  /* ---------- markdown ---------- */
  function ensureKatex() {
    if (global.katex) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = KATEX_URL; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function renderMarkdown(md) {
    var slots = [];
    function keep(text) { slots.push(text); return '@@SLOT' + (slots.length - 1) + '@@'; }
    // 1. protect code from the math and footnote passes
    md = md.replace(/```[\s\S]*?```/g, keep);
    md = md.replace(/`[^`\n]+`/g, keep);
    // 2. math: $$…$$ and $…$ ; \$ is a literal dollar
    var maths = [];
    md = md.replace(/\\\$/g, '@@ESCDOLLAR@@');
    md = md.replace(/\$\$([\s\S]+?)\$\$/g, function (m, tex) { maths.push({ tex: tex.trim(), display: true }); return '@@MATH' + (maths.length - 1) + '@@'; });
    md = md.replace(/\$([^\s$][^$\n]*?)\$/g, function (m, tex) { maths.push({ tex: tex.trim(), display: false }); return '@@MATH' + (maths.length - 1) + '@@'; });
    md = md.replace(/@@ESCDOLLAR@@/g, '$');
    // 3. footnotes: [^id] in the text, "[^id]: text" on its own line anywhere
    var defs = {}, order = [];
    md = md.replace(/^\[\^([^\]\s]+)\]:[ \t]*(.+)$/gm, function (m, id, text) { defs[id] = text; return ''; });
    md = md.replace(/\[\^([^\]\s]+)\]/g, function (m, id) {
      if (!(id in defs)) return m;
      var n = order.indexOf(id);
      if (n < 0) { order.push(id); n = order.length - 1; }
      n += 1;
      return '<sup class="fnref" id="fnref-' + n + '"><a href="#" data-jump="fn-' + n + '">' + n + '</a></sup>';
    });
    // 4. put code back, parse
    md = md.replace(/@@SLOT(\d+)@@/g, function (m, i) { return slots[+i]; });
    var html = global.marked.parse(md, { gfm: true, breaks: false });
    html = html.replace(/<table>/g, '<div class="tbl"><table>').replace(/<\/table>/g, '</table></div>');
    var notes = order.map(function (id, i) { return { n: i + 1, html: global.marked.parseInline(defs[id]) }; });
    // 5. math
    var mathReady = maths.length ? ensureKatex().then(function () { return true; }, function () { return false; }) : Promise.resolve(false);
    return mathReady.then(function (ok) {
      html = html.replace(/@@MATH(\d+)@@/g, function (m, i) {
        var item = maths[+i];
        if (ok && global.katex) {
          try {
            return '<span class="' + (item.display ? 'math-display' : 'math-inline') + '">' +
              global.katex.renderToString(item.tex, { displayMode: item.display, output: MATH_OUTPUT, throwOnError: false }) + '</span>';
          } catch (e) {}
        }
        return '<code>' + esc(item.tex) + '</code>';
      });
      return { html: html, notes: notes };
    });
  }

  /* ---------- views ---------- */
  function renderList(posts, el) {
    if (!posts.length) { el.innerHTML = '<p class="notice">No essays yet.</p>'; return; }
    var year = null, html = '';
    posts.forEach(function (p) {
      var y = (p.date || '').slice(0, 4);
      if (y !== year) { year = y; html += '<h3 class="year">' + esc(y) + '</h3>'; }
      html += '<article class="post-item">' +
        '<h2 class="post-item-title"><a href="#' + encodeURIComponent(p.slug) + '">' + esc(p.title) + '</a></h2>' +
        (p.summary ? '<p class="post-item-summary">' + esc(p.summary) + '</p>' : '') +
        '<p class="post-item-meta">' + esc(fmtDate(p)) + ' · ' + esc(stats(p)) + tagsHtml(p) + '</p>' +
        '</article>';
    });
    el.innerHTML = html;
  }

  function renderPost(p, el) {
    return renderMarkdown(p.body).then(function (r) {
      var back = p.lang === 'zh' ? '← 全部随笔' : '← all essays';
      el.innerHTML = '<article class="post" lang="' + esc(p.lang) + '">' +
        '<p class="post-back"><a href="#">' + back + '</a></p>' +
        '<header><h1 class="post-title">' + esc(p.title) + '</h1>' +
        '<p class="post-meta">' + esc(fmtDate(p)) + ' · ' + esc(stats(p)) + tagsHtml(p) + '</p></header>' +
        '<div class="post-body">' + r.html + '</div>' +
        (r.notes.length ? '<section class="footnotes"><ol>' + r.notes.map(function (n) {
          return '<li id="fn-' + n.n + '">' + n.html + ' <a href="#" class="fn-back" data-jump="fnref-' + n.n + '" aria-label="back to text">↩</a></li>';
        }).join('') + '</ol></section>' : '') +
        '</article>';
      var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.querySelectorAll('[data-jump]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var t = document.getElementById(a.getAttribute('data-jump'));
          if (t) t.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        });
      });
    });
  }

  function startBlog() {
    var listEl = document.getElementById('blog-list');
    var postEl = document.getElementById('blog-post');
    var headEl = document.getElementById('blog-head');
    return loadPosts().then(function (posts) {
      var bySlug = {};
      posts.forEach(function (p) { bySlug[p.slug] = p; });
      renderList(posts.filter(function (p) { return !p.draft; }), listEl);
      function route() {
        var slug = '';
        try { slug = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
        var p = bySlug[slug];
        if (p) {
          headEl.hidden = true; listEl.hidden = true; postEl.hidden = false;
          document.title = p.title + ' · ' + SITE;
          return renderPost(p, postEl).then(function () { global.scrollTo(0, 0); });
        }
        postEl.hidden = true; postEl.innerHTML = '';
        headEl.hidden = false; listEl.hidden = false;
        document.title = 'blog · ' + SITE;
      }
      global.addEventListener('hashchange', route);
      return route();
    }, function (err) {
      console.error(err);
      listEl.innerHTML = '<p class="notice">Could not load <code>posts/index.json</code>. If this page was opened as a local file, serve the folder over HTTP instead (for example <code>python -m http.server</code>, then open <code>http://localhost:8000/blog.html</code>).</p>';
    });
  }

  function renderLatest(el, n) {
    if (!el) return Promise.resolve();
    var all = '<tr><td class="date"></td><td><a href="blog.html">all essays →</a></td></tr>';
    return loadPosts().then(function (posts) {
      posts = posts.filter(function (p) { return !p.draft; });
      if (!posts.length) { el.innerHTML = all; return; }
      el.innerHTML = posts.slice(0, n || 3).map(function (p) {
        return '<tr><td class="date">' + esc(p.date) + '</td><td><a href="blog.html#' + encodeURIComponent(p.slug) + '">' + esc(p.title) + '</a></td></tr>';
      }).join('') + all;
    }, function () { el.innerHTML = all; });
  }

  global.XLBlog = { initTheme: initTheme, loadPosts: loadPosts, startBlog: startBlog, renderLatest: renderLatest };
})(window);
