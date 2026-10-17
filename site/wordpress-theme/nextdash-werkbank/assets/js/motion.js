/*
 * The moving parts of the homepage and Features: the hero's looks, cards that
 * play their recording on hover, the terminal that types the command, figures
 * that count up and sections that fade in. With reduced motion asked for,
 * the looks hold still, the terminal and figures show their end at once and
 * nothing fades.
 */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- hero looks ---------- */
  document.querySelectorAll('[data-nd-looks]').forEach(function (root) {
    var imgs = Array.prototype.slice.call(root.querySelectorAll('.nd-looks-shot img'));
    var bar = root.querySelector('.nd-looks');
    var chips = Array.prototype.slice.call(root.querySelectorAll('.nd-look-chip'));
    var at = 0;
    var timer = null;
    var auto = !reduce;

    var show = function (i) {
      at = i;
      imgs.forEach(function (im, k) {
        if (k === i && im.loading === 'lazy') im.loading = 'eager';
        im.classList.toggle('is-on', k === i);
      });
      chips.forEach(function (c, k) { c.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
      // Restart the little timer line under the chip.
      if (auto) { bar.classList.remove('is-auto'); void bar.offsetWidth; bar.classList.add('is-auto'); }
      // The next one starts loading while this one is shown.
      var next = imgs[(i + 1) % imgs.length];
      if (next && next.loading === 'lazy') next.loading = 'eager';
    };
    var stop = function () { auto = false; clearInterval(timer); bar.classList.remove('is-auto'); };

    chips.forEach(function (c, k) { c.addEventListener('click', function () { stop(); show(k); }); });
    if (auto) {
      bar.classList.add('is-auto');
      timer = setInterval(function () { if (!document.hidden) show((at + 1) % imgs.length); }, 5000);
    }
  });

  /* ---------- cards with a recording ---------- */
  var canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  document.querySelectorAll('.nd-mcard[data-loop]').forEach(function (card) {
    if (reduce || !canHover) return;
    var media = card.querySelector('.nd-mcard-media');
    var video = null;
    var start = function () {
      if (!video) {
        video = document.createElement('video');
        video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
        video.setAttribute('aria-hidden', 'true');
        video.src = card.getAttribute('data-loop');
        media.insertBefore(video, media.querySelector('.nd-mcard-play'));
      }
      video.currentTime = 0;
      var p = video.play();
      if (p && p.then) p.then(function () { card.classList.add('is-playing'); }).catch(function () {});
    };
    var halt = function () { card.classList.remove('is-playing'); if (video) video.pause(); };
    card.addEventListener('mouseenter', start);
    card.addEventListener('mouseleave', halt);
    card.addEventListener('focus', start);
    card.addEventListener('blur', halt);
  });

  /* ---------- terminal ---------- */
  var typeTerm = function (pre) {
    if (pre.dataset.done) return;
    pre.dataset.done = '1';
    var cmd = pre.getAttribute('data-cmd');
    var out = JSON.parse(pre.getAttribute('data-out') || '[]');
    var line = function (l) {
      var cls = l.charAt(0) === '✔' ? 'ok' : (l.charAt(0) === '$' ? 'p' : 'dim');
      if (cls === 'ok') return '<span class="ok">✔</span>' + escapeHtml(l.slice(1));
      if (cls === 'p') return '<span class="p">$</span>' + escapeHtml(l.slice(1));
      return '<span class="dim">' + escapeHtml(l) + '</span>';
    };
    if (reduce) {
      pre.innerHTML = '<span class="p">$</span> ' + escapeHtml(cmd) + '\n' + out.map(line).join('\n');
      return;
    }
    pre.innerHTML = '<span class="p">$</span> <span data-typed></span><span class="nd-cursor"></span>';
    var typed = pre.querySelector('[data-typed]');
    var i = 0;
    var t = setInterval(function () {
      typed.textContent = cmd.slice(0, ++i);
      if (i < cmd.length) return;
      clearInterval(t);
      var k = 0;
      var o = setInterval(function () {
        var cur = pre.querySelector('.nd-cursor');
        if (cur) cur.remove();
        pre.insertAdjacentHTML('beforeend', '\n' + line(out[k++]) + '<span class="nd-cursor"></span>');
        if (k >= out.length) clearInterval(o);
      }, 380);
    }, 70);
  };
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- figures ---------- */
  var countUp = function (root) {
    if (root.dataset.done) return;
    root.dataset.done = '1';
    root.querySelectorAll('b[data-to]').forEach(function (b) {
      var to = Number(b.getAttribute('data-to'));
      var fmt = function (v) { return b.hasAttribute('data-sep') ? v.toLocaleString('en') : String(v); };
      if (reduce) { b.textContent = fmt(to); return; }
      var t0 = performance.now();
      var step = function (t) {
        var p = Math.min(1, (t - t0) / 1400);
        b.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };

  /* ---------- in view: fade in, type, count ---------- */
  var seen = function (el) {
    el.classList.add('is-in');
    var pre = el.matches('[data-nd-term]') ? el : el.querySelector('[data-nd-term]');
    if (pre) typeTerm(pre);
    var stats = el.matches('[data-nd-stats]') ? el : el.querySelector('[data-nd-stats]');
    if (stats) countUp(stats);
  };
  var targets = document.querySelectorAll('.nd-reveal, [data-nd-term], [data-nd-stats]');
  if (!('IntersectionObserver' in window)) { targets.forEach(seen); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      seen(e.target);
    });
  }, { threshold: 0.2 });
  targets.forEach(function (el) { io.observe(el); });
})();
