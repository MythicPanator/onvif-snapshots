// index.js

async function loadLatest() {
  const todayStr = formatDate(new Date());
  await fetchDay(todayStr); 

  PRESETS.forEach((preset, idx) => {
    const imgEl = document.getElementById(`img-${preset}`);
    if (!imgEl) return;

    imgEl.src = `${STORAGE_BASE}/latest/snapshot_${preset}.jpg`;

    imgEl.addEventListener('click', () => openLightbox(0, idx));
    imgEl.addEventListener('keydown', e => {
      if (['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openLightbox(0, idx);
      }
    });
  });
}

(async () => {
  await loadLatest();
})();
