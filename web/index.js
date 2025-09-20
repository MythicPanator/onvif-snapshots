
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

// ===== Staleness detection and banner =====
async function tryInfoJsonAndRender() {
  const grid = document.getElementById('snapshot-grid');
  if (!grid) return false;

  try {
    const base = `${STORAGE_BASE}/latest/info.json`;
    const cb = base.includes('?') ? `&cb=${Date.now()}` : `?cb=${Date.now()}`;
    const res = await fetch(base + cb, { cache: 'no-store' });
    if (!res.ok) return false;
    const info = await res.json();

    // Optionally align image filenames from manifest
    if (info && info.presets) {
      PRESETS.forEach(p => {
        const entry = info.presets && info.presets[p];
        if (entry && entry.filename) {
          const imgEl = document.getElementById(`img-${p}`);
          if (imgEl) imgEl.src = `${STORAGE_BASE}/latest/${entry.filename}`;
        }
      });
    }

    // Determine lastUpdated iso string
    let lastUpdatedIso = info.lastUpdated;
    if (!lastUpdatedIso && info && info.presets) {
      const all = Object.values(info.presets)
        .map(p => p && p.updatedAt)
        .filter(Boolean)
        .sort();
      lastUpdatedIso = all.length ? all[all.length - 1] : null;
    }
    if (!lastUpdatedIso) return false;

    const mostRecent = Date.parse(lastUpdatedIso);
    if (Number.isNaN(mostRecent)) return false;

    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysStale = Math.floor((now - mostRecent) / msPerDay);

    if (daysStale >= 1) {
      grid.classList.add('stale');
      let banner = document.getElementById('stale-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'stale-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        grid.appendChild(banner);
      }
      const unit = daysStale === 1 ? 'dag' : 'daga';
      banner.textContent = `Myndir hafa ekki verið uppfærðar í ${daysStale} ${unit}.`;
    }
    return true;
  } catch (_) {
    return false; // fallback to HEAD-based method
  }
}

async function getLastModified(url) {
  try {
    // Add cache-busting to avoid CDN/browser cache skew
    const bust = url.includes('?') ? `&cb=${Date.now()}` : `?cb=${Date.now()}`;
    const res = await fetch(url + bust, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return null;
    const lm = res.headers.get('last-modified');
    return lm ? new Date(lm) : null;
  } catch (e) {
    // Likely CORS when running locally; fail soft
    return null;
  }
}

async function checkStalenessAndRenderBanner() {
  const grid = document.getElementById('snapshot-grid');
  if (!grid) return;

  const urls = PRESETS.map(p => `${STORAGE_BASE}/latest/snapshot_${p}.jpg`);
  const dates = await Promise.all(urls.map(getLastModified));
  const validDates = dates.filter(Boolean).map(d => d.getTime());
  if (validDates.length === 0) {
    // Could not determine (e.g., local dev CORS); skip visual marker
    return;
  }

  const mostRecent = Math.max(...validDates);
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysStale = Math.floor((now - mostRecent) / msPerDay);

  if (daysStale >= 1) {
    grid.classList.add('stale');
    let banner = document.getElementById('stale-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'stale-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      grid.appendChild(banner);
    }
    const unit = daysStale === 1 ? 'dag' : 'daga';
    banner.textContent = `Myndir hafa ekki verið uppfærðar í ${daysStale} ${unit}.`;
  }
}

// Kick off staleness check after images are set
tryInfoJsonAndRender().then(ok => {
  if (!ok) checkStalenessAndRenderBanner();
});
