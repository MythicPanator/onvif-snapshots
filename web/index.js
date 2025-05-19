
function loadLatest() {
  PRESETS.forEach(preset => {
    const imgEl = document.getElementById(`img-${preset}`);
    if (!imgEl) return;

    // assuming your function writes "latest/<filename>" and
    // each preset always produces a consistent filename pattern,
    // e.g. snapshot_front.jpg, snapshot_back.jpg, etc.
    //
    // If instead you get generic names like snapshot_1.jpg,
    // you’ll need to know which one belongs to which preset.
    //
    // But if you’ve set your onvif_client to write distinct names:
    imgEl.src = `${STORAGE_BASE}/latest/snapshot_${preset}.jpg`;
    /*
    imgEl.onerror = () => {
      imgEl.alt = 'No live image';
      imgEl.src = '/placeholders/no-data.png';
    };
    */
  });
}

// Run on first load
loadLatest();
