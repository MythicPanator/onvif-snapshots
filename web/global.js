const STORAGE_BASE = 'https://utivist5vhfj4cenlybqry2.z6.web.core.windows.net';
const PRESETS = ['1', '2', '3', '4'];

// Lightbox modal logic
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
let lastFocusedElement = null;

function openLightbox(imgSrc, imgAlt) {
  lastFocusedElement = document.activeElement;
  lightboxImg.src = imgSrc;
  lightboxImg.alt = imgAlt;
  lightbox.setAttribute('aria-hidden', 'false');
  lightboxClose.focus();
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.setAttribute('aria-hidden', 'true');
  lightboxImg.src = '';
  document.body.style.overflow = '';
  if (lastFocusedElement) lastFocusedElement.focus();
}

// Open lightbox on image click or keyboard enter/space
document.body.addEventListener('click', e => {
  if (e.target.tagName === 'IMG' && e.target.closest('.tile')) {
    openLightbox(e.target.src, e.target.alt);
  }
});

// Enable keyboard access to images
PRESETS.forEach(preset => {
  const imgEl = document.getElementById(`img-${preset}`);
  if (imgEl) {
    imgEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightbox(imgEl.src, imgEl.alt);
      }
    });
  }
});

lightboxClose.onclick = closeLightbox;

lightbox.onclick = e => {
  if (e.target === lightbox || e.target.classList.contains('lightbox-backdrop')) {
    closeLightbox();
  }
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeLightbox();
});