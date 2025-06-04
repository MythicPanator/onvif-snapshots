let currentDate = new Date();
let currentDateStr  = ""; 

function pad(n) { return String(n).padStart(2, '0'); }

async function loadDay(date, updateUrl = false) {

  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());

  const dayLabel = `${yyyy}-${mm}-${dd}`;
  document.getElementById('current-day').textContent = dayLabel;

  const dateStr = `${yyyy}-${mm}-${dd}`;
  const url = `${STORAGE_BASE}/${yyyy}/${mm}/${dd}/index.json`;

  currentDateStr = dayLabel;

  try {
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('date', dateStr);
      window.history.pushState({}, '', url);
    }
    
    const res = await fetch(url);
    if (!res.ok) throw new Error("No index");
    const data = await res.json();

    // ✅ Update snapshotsByDay and daysList globally
    if (!snapshotsByDay[dateStr]) {
      snapshotsByDay[dateStr] = groupSnapshotsByPeriod(data.snapshots || []);
      daysList = Array.from(new Set([...daysList, dateStr])).sort();
    }

    const allowedPresets = new Set(['1', '2', '3', '4']);
    const filtered = data.snapshots.filter(entry => allowedPresets.has(String(entry.preset)));
    renderSnapshots(filtered);
  } catch {
    renderSnapshots([]);
  }
}


function renderSnapshots(snapshots) {
  const grid = document.getElementById('snapshot-grid');
  grid.innerHTML = '';

  if (!snapshots.length) {
    grid.innerHTML = '<p>Engar myndir fundust fyrir þennan dag.</p>';
    return;
  }

  const groups = {};
  for (const entry of snapshots) {
    const match = entry.path.match(/\/(\w+)_\d{4}-\d{2}-\d{2}/);
    const period = match ? match[1] : 'unknown';
    if (!groups[period]) groups[period] = [];
    groups[period].push(entry);
  }

  const periodOrder = ['night', 'early', 'midday', 'late'];
  const presetLabels = {
    '1': 'Suður',
    '2': 'Suður að Baldvinsskála',
    '3': 'Norður',
    '4': 'Vestur'
  };
  const periodLabels = {
    early: '🌅 Morgunn',
    midday: '☀️ Miðdegi',
    late: '🌇 Síðdegi',
    night: '🌙 Nótt'
  };
  
  
  Object.entries(groups)
    .sort((a, b) => periodOrder.indexOf(a[0]) - periodOrder.indexOf(b[0]))
    .forEach(([period, entries]) => {
      const section = document.createElement('section');
      const title = document.createElement('h2');
      title.textContent = periodLabels[period] || period;

      section.appendChild(title);

      const row = document.createElement('div');
      row.className = 'period-row';

      entries.sort((a, b) => a.preset.localeCompare(b.preset));

      entries.forEach(entry => {
        const wrapper = document.createElement('div');
        wrapper.className = 'tile';

        const img = document.createElement('img');
        img.src = `${STORAGE_BASE}/${entry.path}`;
        img.alt = `Myndavél ${entry.preset} – ${entry.time}`;
        img.loading = 'lazy';
        img.setAttribute('role', 'button');
        img.setAttribute('tabindex', '0');

        const periodIdx = periodOrder.indexOf(period);
        const entryIdx = entries.indexOf(entry); // safe because you're still inside `entries.forEach(...)`
      
        img.addEventListener('click', () => openLightbox(currentDateStr, periodIdx, entryIdx));
        img.addEventListener('keydown', e => {
          if (['Enter', ' '].includes(e.key)) {
            e.preventDefault();
            openLightbox(currentDateStr, periodIdx, entryIdx);
          }
        });


        const caption = document.createElement('p');
        caption.textContent = presetLabels[entry.preset] || `Myndavél ${entry.preset}`;


        wrapper.appendChild(img);
        wrapper.appendChild(caption);
        row.appendChild(wrapper);
      });

      section.appendChild(row);
      grid.appendChild(section);
    });
    
    // After thumbnails are rendered, re-bind lightbox triggers
    const dateStr = document.getElementById('current-day').textContent;

    let globalImgIdx = 0; // Reset across all periods
    Object.entries(groups).sort((a, b) =>
      periodOrder.indexOf(a[0]) - periodOrder.indexOf(b[0])
    )
}

document.getElementById('prev-day').onclick = () => {
  currentDate.setDate(currentDate.getDate() - 1);
  loadDay(currentDate, true);
};

document.getElementById('next-day').onclick = () => {
  currentDate.setDate(currentDate.getDate() + 1);
  loadDay(currentDate, true);
};

(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const dateParam = urlParams.get('date');
  if (dateParam) {
    const [yyyy, mm, dd] = dateParam.split('-').map(Number);
    currentDate = new Date(yyyy, mm - 1, dd);
  }
  
  await loadDay(currentDate);

  const periodParam = urlParams.get('period');
  const camParam = urlParams.get('cam');  // preset index

  if (periodParam && camParam) {
    const periodIdx = ['night', 'early', 'midday', 'late'].indexOf(periodParam);
    const camIdx = ['1', '2', '3', '4'].indexOf(camParam); // use same logic as sort
    if (periodIdx !== -1 && camIdx !== -1) {
      openLightbox(formatDate(currentDate), periodIdx, camIdx);
    }
  }

})();
