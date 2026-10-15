/* nextdash.cc: light/dark, the small-screen menu, one search box over the
   docs and the site, screenshots that open larger, and recordings that pause. */
(function () {
  'use strict';
  var site = window.ndwSite || {};
  var root = document.documentElement;

  /* Light and dark: follows the system until the reader picks one. */
  function effectiveTheme() {
    var set = root.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.querySelectorAll('[data-nd-theme]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('nd-theme', next); } catch (e) { /* private window */ }
    });
  });

  /* The menu on small screens. */
  var toggle = document.querySelector('.nd-menu-toggle');
  var nav = document.getElementById('nd-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* Search: the docs through their Pagefind index, the site through the
     WordPress search API, in one list under the box. */
  var form = document.querySelector('[data-nd-search]');
  if (form) {
    var input = form.querySelector('input[type="search"]');
    var box = form.querySelector('.nd-search-results');
    var pagefind = null;
    var timer = null;
    var seq = 0;
    var active = -1;

    var esc = function (s) {
      return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    };
    var loadPagefind = function () {
      if (!pagefind) {
        pagefind = import(site.docs + 'pagefind/pagefind.js').then(function (pf) {
          return pf.options ? pf.options({ baseUrl: site.docs }).then(function () { return pf; }) : pf;
        }).catch(function () { return null; });
      }
      return pagefind;
    };
    var hits = function () { return box.querySelectorAll('.nd-sr-hit'); };
    var close = function () { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    var open = function () { box.hidden = false; input.setAttribute('aria-expanded', 'true'); };
    var select = function (i) {
      var list = hits();
      if (!list.length) return;
      active = (i + list.length) % list.length;
      list.forEach(function (el, n) { el.setAttribute('aria-selected', n === active ? 'true' : 'false'); });
      list[active].scrollIntoView({ block: 'nearest' });
    };

    var docsResults = function (q) {
      return loadPagefind().then(function (pf) {
        if (!pf) return [];
        return pf.search(q).then(function (r) {
          return Promise.all(r.results.slice(0, 5).map(function (x) { return x.data(); }));
        }).then(function (list) {
          return list.map(function (d) {
            var sub = d.sub_results && d.sub_results[0];
            var title = d.meta && d.meta.title ? d.meta.title : 'Docs';
            var head = sub && sub.title && sub.title !== title ? title + ' › ' + sub.title : title;
            return { url: sub && sub.url ? sub.url : d.url, title: head, text: (sub && sub.excerpt) || d.excerpt || '' };
          });
        });
      }).catch(function () { return []; });
    };
    var siteResults = function (q) {
      if (!site.search) return Promise.resolve([]);
      var url = site.search + (site.search.indexOf('?') < 0 ? '?' : '&') + 'per_page=5&search=' + encodeURIComponent(q);
      return fetch(url).then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
        return (list || []).map(function (x) { return { url: x.url, title: x.title, text: x.subtype === 'post' ? 'News' : 'Page' }; });
      }).catch(function () { return []; });
    };

    var render = function (q, docs, pages) {
      var html = '';
      if (docs.length) {
        html += '<div class="nd-sr-group">Docs</div>';
        docs.forEach(function (h) { html += '<a class="nd-sr-hit" role="option" href="' + esc(h.url) + '"><b>' + esc(h.title) + '</b><small>' + h.text + '</small></a>'; });
      }
      if (pages.length) {
        html += '<div class="nd-sr-group">Site</div>';
        pages.forEach(function (h) { html += '<a class="nd-sr-hit" role="option" href="' + esc(h.url) + '"><b>' + esc(h.title) + '</b><small>' + esc(h.text) + '</small></a>'; });
      }
      if (!docs.length && !pages.length) html += '<span class="nd-sr-empty">Nothing found for “' + esc(q) + '”.</span>';
      html += '<a class="nd-sr-more" href="' + esc(site.docs) + '?q=' + encodeURIComponent(q) + '">Search the docs for “' + esc(q) + '” →</a>';
      box.innerHTML = html;
      active = -1;
      open();
    };

    var run = function () {
      var q = input.value.trim();
      if (q.length < 2) { close(); return; }
      var mine = ++seq;
      Promise.all([docsResults(q), siteResults(q)]).then(function (r) {
        if (mine !== seq) return;
        render(q, r[0], r[1]);
        if (window.umami && typeof window.umami.track === 'function') {
          window.umami.track('search', { q: q, site: 'site', results: r[0].length + r[1].length });
        }
      });
    };

    input.addEventListener('focus', loadPagefind, { once: true });
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 180); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (box.hidden) run(); else select(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); select(active - 1); }
      else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); hits()[active].click(); }
    });
    document.addEventListener('click', function (e) { if (!form.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) || document.activeElement.isContentEditable;
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); input.focus(); }
    });
  }

  /* Screenshots shown smaller than they are open full size in a dialog. */
  var zoomable = function (img) {
    return img.closest('.nd-content, .nd-hero-shot') && !img.closest('a') && img.naturalWidth > img.clientWidth * 1.15;
  };
  var dialog = null;
  var openShot = function (img) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'nd-lightbox';
      dialog.setAttribute('closedby', 'any');
      dialog.setAttribute('aria-label', 'Screenshot, full size');
      dialog.innerHTML = '<form method="dialog"><button class="nd-lightbox-close" aria-label="Close">×</button></form><img class="nd-lightbox-img" alt=""><p class="nd-lightbox-cap"></p>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', function (e) {
        var big = dialog.querySelector('.nd-lightbox-img');
        if (e.target === big) { dialog.close(); return; }
        if ('closedBy' in HTMLDialogElement.prototype || e.target !== dialog) return;
        var r = dialog.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) dialog.close();
      });
      dialog.addEventListener('close', function () { dialog.querySelector('.nd-lightbox-img').removeAttribute('src'); });
    }
    var big = dialog.querySelector('.nd-lightbox-img');
    var cap = dialog.querySelector('.nd-lightbox-cap');
    var fig = img.closest('figure');
    var caption = fig && fig.querySelector('figcaption');
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    cap.textContent = caption ? caption.textContent : '';
    cap.hidden = !cap.textContent;
    dialog.showModal();
  };
  document.addEventListener('click', function (e) {
    if (e.target instanceof HTMLImageElement && zoomable(e.target)) openShot(e.target);
  });
  document.addEventListener('pointerover', function (e) {
    var img = e.target;
    if (img instanceof HTMLImageElement && img.closest('.nd-content, .nd-hero-shot')) img.classList.toggle('nd-zoomable', !!zoomable(img));
  });

  /* Recordings play only while in view, and a button pauses them. */
  document.querySelectorAll('[data-nd-loop]').forEach(function (video) {
    var btn = video.parentNode.querySelector('[data-nd-loop-toggle]');
    var paused = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var sync = function () { if (btn) btn.textContent = video.paused ? 'Play' : 'Pause'; };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && !paused) video.play().catch(function () {}); else video.pause();
          sync();
        });
      }, { threshold: 0.4 }).observe(video);
    }
    if (btn) {
      btn.addEventListener('click', function () {
        paused = !video.paused;
        if (paused) video.pause(); else video.play().catch(function () {});
        sync();
      });
    }
  });
})();
