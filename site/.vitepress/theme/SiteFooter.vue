<script setup lang="ts">
declare const __DOCS_REF__: string
const ref = __DOCS_REF__ === 'WORKTREE' ? 'development version' : __DOCS_REF__
</script>

<template>
  <footer class="nd-footer">
    <div class="nd-footer-inner">
      <p class="nd-footer-links">
        <span>Manual for nextDash {{ ref }}</span>
        <a href="https://nextdash.cc/about/">About</a>
        <a href="https://github.com/jordibrouwer/nextdash/blob/main/LICENSE">MIT licence</a>
        <a href="https://github.com/jordibrouwer/nextdash/blob/dev/CHANGELOG.md">Changelog</a>
        <a href="https://nextdash.cc/feed/">RSS</a>
      </p>
      <pre class="nd-ascii" aria-hidden="true">┌┐┌┌─┐─┐ ┬┌┬┐┌┬┐┌─┐┌─┐┬ ┬
│││├┤ ┌┴┬┘ │  ││├─┤└─┐├─┤
┘└┘└─┘┴ └─ ┴ ─┴┘┴ ┴└─┘┴ ┴</pre>
    </div>
  </footer>
</template>
