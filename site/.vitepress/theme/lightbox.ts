// Screenshots in the docs open full size in a modal dialog. One dialog
// serves every page; clicks are caught on the document, so it keeps working
// as VitePress swaps pages without a reload.

// Only pictures shown noticeably smaller than their real size are worth enlarging.
const isZoomable = (img: HTMLImageElement) =>
  img.closest('.vp-doc') !== null && !img.closest('a') && img.naturalWidth > img.clientWidth * 1.15

export function installLightbox () {
  if (document.getElementById('nd-lightbox')) return

  const dialog = document.createElement('dialog')
  dialog.id = 'nd-lightbox'
  dialog.className = 'nd-lightbox'
  dialog.setAttribute('closedby', 'any')
  dialog.setAttribute('aria-label', 'Screenshot, full size')
  dialog.innerHTML = `
    <form method="dialog"><button class="nd-lightbox-close" aria-label="Close">×</button></form>
    <img class="nd-lightbox-img" alt="">
    <p class="nd-lightbox-cap"></p>`
  document.body.append(dialog)

  const big = dialog.querySelector<HTMLImageElement>('.nd-lightbox-img')!
  const caption = dialog.querySelector<HTMLParagraphElement>('.nd-lightbox-cap')!

  const open = (img: HTMLImageElement) => {
    big.src = img.currentSrc || img.src
    big.alt = img.alt
    caption.textContent = img.closest('figure')?.querySelector('figcaption')?.textContent ?? ''
    caption.hidden = !caption.textContent
    dialog.showModal()
  }

  // Clicking the enlarged picture closes it as well.
  dialog.addEventListener('click', (event) => {
    if (event.target === big) { dialog.close(); return }
    // Light dismiss for browsers without closedby (Safari): a click on the backdrop.
    if ('closedBy' in HTMLDialogElement.prototype || event.target !== dialog) return
    const r = dialog.getBoundingClientRect()
    const inside = r.top <= event.clientY && event.clientY <= r.bottom && r.left <= event.clientX && event.clientX <= r.right
    if (!inside) dialog.close()
  })
  dialog.addEventListener('close', () => big.removeAttribute('src'))

  document.addEventListener('click', (event) => {
    const img = event.target
    if (img instanceof HTMLImageElement && isZoomable(img)) open(img)
  })
  document.addEventListener('keydown', (event) => {
    const img = event.target
    if ((event.key === 'Enter' || event.key === ' ') && img instanceof HTMLImageElement && isZoomable(img)) {
      event.preventDefault()
      open(img)
    }
  })
  // Mark what can be enlarged: a zoom cursor, and a stop in the tab order.
  document.addEventListener('pointerover', (event) => {
    const img = event.target
    if (img instanceof HTMLImageElement && img.closest('.vp-doc')) img.classList.toggle('nd-zoomable', isZoomable(img))
  })
  document.addEventListener('focusin', (event) => {
    const img = event.target
    if (img instanceof HTMLImageElement && img.closest('.vp-doc')) img.classList.toggle('nd-zoomable', isZoomable(img))
  })
}
