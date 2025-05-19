let currentDate = new Date();

function pad(n) { return String(n).padStart(2, '0'); }

function loadDay(date) {
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());

  const dayLabel = `${yyyy}-${mm}-${dd}`;
  document.getElementById('current-day').textContent = dayLabel;

  const url = `${STORAGE_BASE}/${yyyy}/${mm}/${dd}/index.json`;

  fetch(url)
    .then(res => res.ok ? res.json() : Promise.reject("No index"))
    .then(data => {
      renderSnapshots(data.snapshots);
    })
    .catch(() => {
      renderSnapshots([]);
    });
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

  const periodOrder = ['early', 'midday', 'late', 'night'];
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

        img.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openLightbox(img.src, img.alt);
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
}

document.getElementById('prev-day').onclick = () => {
  currentDate.setDate(currentDate.getDate() - 1);
  loadDay(currentDate);
};

document.getElementById('next-day').onclick = () => {
  currentDate.setDate(currentDate.getDate() + 1);
  loadDay(currentDate);
};

loadDay(currentDate);