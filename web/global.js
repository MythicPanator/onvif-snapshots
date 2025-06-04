const STORAGE_BASE = 'https://utivist5vhfj4cenlybqry2.z6.web.core.windows.net';
const PRESETS = ['1', '2', '3', '4'];
const IS_HISTORY = window.location.pathname.includes('history.html');
const IS_INDEX   = !IS_HISTORY;   // covers index.html or “/”


// ===== Lightbox (navigation, context, and accessibility) =====
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxPrev = document.getElementById('lightbox-prev');
const lightboxNext = document.getElementById('lightbox-next');
const lightboxPeriod = document.getElementById('lightbox-period');
const lightboxDate = document.getElementById('lightbox-date');
const lightboxNoImage = document.getElementById('lightbox-no-image');
let lastFocusedElement = null;

// Utility: format “YYYY-MM-DD”
function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Utility: parse “YYYY-MM-DD”
function parseDateStr(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const PERIODS = ['night', 'early', 'midday', 'late'];
const PERIOD_LABELS = {
  early: '🌅 Morgunn',
  midday: '☀️ Dagur',
  late: '🌇 Kvöld',
  night: '🌙 Nótt'
};

// Internal state
let snapshotsByDay = {};
let daysList = [];
let currentLightbox = { dayIdx: 0, periodIdx: 0, imgIdx: 0 };

// Group snapshots by their period
function groupSnapshotsByPeriod(snapshots) {
  const periods = {};
  snapshots.forEach(snap => {
    const fn = snap.path.split('/').pop();
    const period = fn.split('_')[0];
    if (!periods[period]) periods[period] = [];
    periods[period].push(snap);
  });
  PERIODS.forEach(p => {
    if (periods[p]) periods[p].sort((a, b) => Number(a.preset) - Number(b.preset));
  });
  return periods;
}

// Fetch snapshots for a specific day (cache result)
async function fetchDay(dateStr) {
  if (dateStr in snapshotsByDay) return dateStr;
  const dateObj = parseDateStr(dateStr);
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const url = `${STORAGE_BASE}/${yyyy}/${mm}/${dd}/index.json`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error();
    const data = await resp.json();
    const dayKey = data.date || dateStr;
    snapshotsByDay[dayKey] = groupSnapshotsByPeriod(data.snapshots || []);
    daysList = Array.from(new Set([...daysList, dayKey])).sort();
    return dayKey;
  } catch {
    return null;
  }
}

// Update the lightbox display
function updateLightbox() {
  const { dayIdx, periodIdx, imgIdx } = currentLightbox;
  const date = daysList[dayIdx];
  const period = PERIODS[periodIdx];
  const images = (snapshotsByDay[date] && snapshotsByDay[date][period]) || [];

  if (IS_HISTORY) {
    const url = new URL(window.location.href);
    url.searchParams.set('date', date);
    url.searchParams.set('period', PERIODS[periodIdx]);
    url.searchParams.set('cam', PRESETS[imgIdx]); // imgIdx corresponds to preset index
    window.history.pushState({}, '', url);}
  
  lightboxDate.textContent = date;
  if (window.location.pathname.includes('history.html')) {
    lightboxPeriod.style.display = '';
    lightboxPeriod.textContent = PERIOD_LABELS[period];
  } else {
    lightboxPeriod.style.display = 'none';
  }

  if (images[imgIdx]) {
    const snap = images[imgIdx];
    lightboxImg.src = `${STORAGE_BASE}/${snap.path}`;
    lightboxImg.alt = `Mynd frá ${date} – ${period}`;
    lightboxImg.style.display = '';
    lightboxNoImage.style.display = 'none';
  } else {
    lightboxImg.style.display = 'none';
    lightboxNoImage.textContent = 'Engin mynd tiltæk í þessu tímabili eða á þessum degi.';
    lightboxNoImage.style.display = '';
  }
}

// Show end-of-gallery message
function showEndMessage(msg) {
  lightboxImg.style.display = 'none';
  lightboxNoImage.textContent = msg || 'Engar fleiri myndir tiltækar';
  lightboxNoImage.style.display = '';
}

// Navigate images, supporting cross-day
async function navigateLightbox(dir) {
  // —— index.html (“latest” view) rules ——————————
  if (IS_INDEX) {
    if (dir > 0) {                 // right / next → block
      showEndMessage('Þetta er nýjasta myndin');
      return;
    }
    // left / prev → jump into the History page
    const date = daysList[currentLightbox.dayIdx] || formatDate(new Date());
    window.location.href = `history.html?date=${date}`;
    return;
  }
  
  let { dayIdx, periodIdx, imgIdx } = currentLightbox;

  if (daysList.length === 0) {
    showEndMessage('Engar myndir tiltækar');
    return;
  }

  const currentDate = daysList[dayIdx];
  const currentPeriod = PERIODS[periodIdx];
  const images = (snapshotsByDay[currentDate] && snapshotsByDay[currentDate][currentPeriod]) || [];
  imgIdx += dir;

  const tryStep = async (step) => {
    const newDate = parseDateStr(currentDate);
    newDate.setDate(newDate.getDate() + step);
    const newStr = formatDate(newDate);
    const fetched = await fetchDay(newStr);
    if (!fetched) return null;

    const newIdx = daysList.indexOf(fetched);
    for (let i = step > 0 ? 0 : PERIODS.length - 1; step > 0 ? i < PERIODS.length : i >= 0; i += step > 0 ? 1 : -1) {
      const arr = snapshotsByDay[fetched][PERIODS[i]];
      if (arr && arr.length) return { dayIdx: newIdx, periodIdx: i, imgIdx: step > 0 ? 0 : arr.length - 1 };
    }
    return null;
  };

  if (imgIdx >= 0 && imgIdx < images.length) {
    currentLightbox.imgIdx = imgIdx;
    updateLightbox();
    return;
  }

  let newPeriodIdx = periodIdx + dir;
  while (newPeriodIdx >= 0 && newPeriodIdx < PERIODS.length) {
    const newImages = snapshotsByDay[currentDate][PERIODS[newPeriodIdx]];
    if (newImages && newImages.length) {
      currentLightbox = {
        dayIdx,
        periodIdx: newPeriodIdx,
        imgIdx: dir > 0 ? 0 : newImages.length - 1
      };
      updateLightbox();
      return;
    }
    newPeriodIdx += dir;
  }

  const stepped = await tryStep(dir);
  if (stepped) {
    currentLightbox = stepped;
    updateLightbox();
  } else {
    showEndMessage('Engar fleiri myndir tiltækar');
  }
}


  // Keep focus inside lightbox
function trapFocus(e) {
  if (lightbox.getAttribute('aria-hidden') !== 'false') return;
  const focusable = [lightboxPrev, lightboxNext, lightboxClose];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.key === 'Tab') {
    const isInside = focusable.includes(document.activeElement);

    if (!isInside) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

async function openLightbox(a = 0, b = 0, c = 0) {
  let dayKey, periodIdx, imgIdx;

  // new signature: (dayKey, periodIdx, imgIdx)
  if (typeof a === 'string') {
    dayKey    = a;
    periodIdx = b;
    imgIdx    = c;
  } else {                    // legacy signature: (periodIdx, imgIdx) → assume today
    dayKey    = formatDate(new Date());
    periodIdx = a;
    imgIdx    = b;
  }
  
  lastFocusedElement = document.activeElement;

  await fetchDay(dayKey);                       // ensure that exact day is in cache
  currentLightbox.dayIdx    = daysList.indexOf(dayKey);
  currentLightbox.periodIdx = periodIdx;
  currentLightbox.imgIdx    = imgIdx;

  updateLightbox();

  lightboxNext.style.display = '';
  lightbox.setAttribute('aria-hidden', 'false');


  document.body.style.overflow = 'hidden';
  //lightboxPrev.focus();
  
  if (IS_HISTORY) {
    const url = new URL(window.location.href);
    url.searchParams.set('date', dayKey);
    url.searchParams.set('period', PERIODS[periodIdx]);
    url.searchParams.set('cam', PRESETS[imgIdx]); // imgIdx corresponds to preset index
    window.history.pushState({}, '', url);
  }
}


// Close and restore focus
function closeLightbox() {
  lightbox.setAttribute('aria-hidden', 'true');
  lightboxImg.src = '';
  document.body.style.overflow = '';
  if (lastFocusedElement) lastFocusedElement.focus();

  if (IS_HISTORY) {
    const url = new URL(window.location.href);
    url.searchParams.delete('period');
    url.searchParams.delete('cam');
    window.history.pushState({}, '', url);
  }
  
}

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date') || formatDate(new Date());

  const fetched = await fetchDay(selectedDate);
  if (fetched) {
    currentLightbox.dayIdx = daysList.indexOf(fetched);
  }

 

  // Setup lightbox triggers
  document.querySelectorAll('#snapshot-grid .tile img').forEach((img, idx) => {
    if (IS_INDEX) {
      img.addEventListener('click', () => openLightbox(0, idx));
      img.addEventListener('keydown', e => {
        if (['Enter', ' '].includes(e.key)) {
          e.preventDefault();
          openLightbox(0, idx);
        }
      });
    }
  });

  lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
  lightboxNext.addEventListener('click', () => navigateLightbox(1));
  lightboxClose.addEventListener('click', closeLightbox);

  [lightboxPrev, lightboxNext, lightboxClose].forEach(btn => {
    btn.addEventListener('keydown', e => {
      if (['Enter', ' '].includes(e.key)) {
        e.preventDefault();
        btn.click();
      }
    });
  });

  lightbox.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);

  document.addEventListener('keydown', e => {
    if (lightbox.getAttribute('aria-hidden') === 'false') {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') navigateLightbox(-1);
      else if (e.key === 'ArrowRight') navigateLightbox(1);
      else trapFocus(e);
    }
  });
});
