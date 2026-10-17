/*
 * The theme gallery (filters and a large view that pages through what they
 * show) and the homepage slider. Loaded only on the pages that have them.
 */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- gallery ---------- */
  document.querySelectorAll('[data-nd-gallery]').forEach(function (root) {
    var items = Array.prototype.slice.call(root.querySelectorAll('.nd-gal-grid > li'));
    var count = root.querySelector('[data-gal-count]');
    var state = { kind: 'theme', mode: 'all', group: 'all', look: 'all', surface: 'all', backdrop: 'all' };
    // The rows that narrow one kind: only that kind's row is shown.
    var ROW = { theme: 'group', look: 'look', surface: 'surface', backdrop: 'backdrop' };

    var visible = function () { return items.filter(function (li) { return !li.hidden; }); };

    var search = root.querySelector('[data-gal-search]');
    var words = [];

    var apply = function () {
      // A search looks through every kind at once (keeping the mode), so the
      // rows that narrow one kind stand aside while it is on.
      var finding = words.length > 0;
      root.classList.toggle('is-finding', finding);
      root.querySelectorAll('[data-gal-row]').forEach(function (row) { row.hidden = finding || row.getAttribute('data-gal-row') !== state.kind; });
      var own = ROW[state.kind];
      var n = 0;
      // "dark" or "light" in a search is the mode, not a word to look for:
      // a light theme's description can say "dark" too.
      var modeWord = words.filter(function (w) { return w === 'dark' || w === 'light'; })[0];
      var textWords = words.filter(function (w) { return w !== 'dark' && w !== 'light'; });
      items.forEach(function (li) {
        var d = li.dataset;
        var show = (state.mode === 'all' || d.mode === state.mode)
          && (!finding || !modeWord || d.mode === modeWord)
          && (finding
            ? textWords.every(function (w) { return d.find.indexOf(w) !== -1; })
            : d.kind === state.kind && (state[own] === 'all' || d[own] === state[own]));
        li.hidden = !show;
        if (show) n++;
      });
      if (finding) {
        count.textContent = n ? n + (n === 1 ? ' picture' : ' pictures') + ' for “' + search.value.trim() + '”' : 'Nothing for “' + search.value.trim() + '”. Try a material such as glass or paper, or a look such as frosted.';
        return;
      }
      var total = items.filter(function (li) { return li.dataset.kind === state.kind; }).length;
      count.textContent = n === total ? n + ' pictures' : n + ' of ' + total + ' pictures';
    };

    var timer;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
        apply();
      }, 120);
    });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; words = []; apply(); }
    });
    // ?find=slate opens the gallery on that search, ?show=look on the looks,
    // for links from elsewhere.
    var params = new URLSearchParams(location.search);
    var shown = params.get('show');
    var showBtn = shown && root.querySelector('[data-gal-filter="kind"][data-gal-value="' + shown.replace(/[^a-z]/g, '') + '"]');
    if (showBtn) {
      state.kind = shown;
      showBtn.parentNode.querySelectorAll('[data-gal-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === showBtn ? 'true' : 'false'); });
      requestAnimationFrame(function () { root.scrollIntoView({ block: 'start' }); });
    }
    var asked = params.get('find');
    if (asked) {
      search.value = asked;
      words = asked.toLowerCase().split(/\s+/).filter(Boolean);
      requestAnimationFrame(function () { root.scrollIntoView({ block: 'start' }); });
    }

    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-gal-filter]');
      if (!b) return;
      var f = b.getAttribute('data-gal-filter');
      state[f] = b.getAttribute('data-gal-value');
      // Choosing what to show ends a search, which looked through all of it.
      if (f === 'kind' && words.length) { search.value = ''; words = []; }
      b.parentNode.querySelectorAll('[data-gal-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      apply();
    });

    // The large view: the picture, its caption, and the arrows to page through what is shown.
    var dialog = document.createElement('dialog');
    dialog.className = 'nd-lightbox nd-gal-view';
    dialog.innerHTML = '<form method="dialog"><button class="nd-lightbox-close" aria-label="Close">×</button></form>'
      + '<button type="button" class="nd-gal-nav nd-gal-prev" aria-label="Previous">‹</button>'
      + '<img class="nd-lightbox-img" alt=""><p class="nd-lightbox-cap"></p>'
      + '<button type="button" class="nd-gal-nav nd-gal-next" aria-label="Next">›</button>';
    document.body.appendChild(dialog);
    var big = dialog.querySelector('.nd-lightbox-img');
    var cap = dialog.querySelector('.nd-lightbox-cap');
    var at = -1;
    var show = function (i) {
      var list = visible();
      if (!list.length) return;
      at = (i + list.length) % list.length;
      var btn = list[at].querySelector('.nd-gal-item');
      big.src = btn.getAttribute('data-full');
      big.alt = btn.querySelector('img').alt;
      cap.textContent = btn.getAttribute('data-cap') + '  ·  ' + (at + 1) + ' / ' + list.length;
    };
    root.addEventListener('click', function (e) {
      var btn = e.target.closest('.nd-gal-item');
      if (!btn) return;
      show(visible().indexOf(btn.parentNode));
      dialog.showModal();
    });
    dialog.querySelector('.nd-gal-prev').addEventListener('click', function () { show(at - 1); });
    dialog.querySelector('.nd-gal-next').addEventListener('click', function () { show(at + 1); });
    big.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
    });
    dialog.addEventListener('close', function () { big.removeAttribute('src'); });

    apply();
  });

  /* ---------- homepage slider ---------- */
  document.querySelectorAll('[data-nd-slider]').forEach(function (root) {
    var slides = Array.prototype.slice.call(root.querySelectorAll('.nd-slide'));
    var dots = Array.prototype.slice.call(root.querySelectorAll('[data-slide-to]'));
    var pause = root.querySelector('[data-slide-pause]');
    var at = 0;
    var timer = null;
    var paused = reduce;
    var held = false;

    var go = function (i) {
      at = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) {
        s.classList.toggle('is-on', k === at);
        if (k === at) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
      });
      dots.forEach(function (d, k) { if (k === at) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
      // The next picture starts loading while this one is shown.
      var next = slides[(at + 1) % slides.length].querySelector('img');
      if (next && next.loading === 'lazy') next.loading = 'eager';
    };
    var tick = function () {
      clearInterval(timer);
      if (!paused && !held) timer = setInterval(function () { go(at + 1); }, 4500);
    };
    var setPaused = function (p) {
      paused = p;
      pause.textContent = p ? 'Play' : 'Pause';
      pause.setAttribute('aria-pressed', p ? 'true' : 'false');
      tick();
    };

    root.querySelector('[data-slide-prev]').addEventListener('click', function () { go(at - 1); tick(); });
    root.querySelector('[data-slide-next]').addEventListener('click', function () { go(at + 1); tick(); });
    dots.forEach(function (d) { d.addEventListener('click', function () { go(Number(d.getAttribute('data-slide-to'))); tick(); }); });
    pause.addEventListener('click', function () { setPaused(!paused); });
    // Held still while the pointer or the keyboard is on it, so a slide can be read.
    root.addEventListener('mouseenter', function () { held = true; tick(); });
    root.addEventListener('mouseleave', function () { held = false; tick(); });
    root.addEventListener('focusin', function () { held = true; tick(); });
    root.addEventListener('focusout', function () { held = false; tick(); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { go(at - 1); }
      if (e.key === 'ArrowRight') { go(at + 1); }
    });
    // Swipe on a touch screen.
    var x0 = null;
    root.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { go(at + (dx < 0 ? 1 : -1)); tick(); }
      x0 = null;
    });
    document.addEventListener('visibilitychange', function () { held = document.hidden; tick(); });

    setPaused(paused);
  });
})();
