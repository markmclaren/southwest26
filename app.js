/* ── app.js — South West Visit 2026 ──────────────────────────
   Vanilla JS · MapLibre GL JS · OpenFreeMap tiles
   Data source: places.geojson  (edit that file to update content)
──────────────────────────────────────────────────────────────── */

'use strict';

// ── CONFIG ────────────────────────────────────────────────────
const GEOJSON_URL = 'places.geojson';
const MAP_STYLE   = 'https://tiles.openfreemap.org/styles/bright';
const MAP_CENTER  = [-2.35, 51.35];
const MAP_ZOOM    = 8.5;

// ── CATEGORY HELPERS ─────────────────────────────────────────
const CAT_CLASS = {
  'Itinerary Stop': 'stop',
  'Food Option':    'food',
};

function catClass(cat) { return CAT_CLASS[cat] || 'stop'; }

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
}

function googleMapsDirectionsUrl(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  const destination = encodeURIComponent(`${lat},${lng}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
}

// ── STATE ─────────────────────────────────────────────────────
let allFeatures  = [];
let activeDay    = 'all';                                   // 'all' | ISO date string
let activeCats   = new Set(['Itinerary Stop', 'Food Option']);
let activeMarker = null;
let markers      = [];

// ── MAP INIT ─────────────────────────────────────────────────
const map = new maplibregl.Map({
  container: 'map',
  style: MAP_STYLE,
  center: MAP_CENTER,
  zoom: MAP_ZOOM,
  attributionControl: { compact: true },
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.FullscreenControl(), 'top-right');

// ── LOAD DATA ─────────────────────────────────────────────────
fetch(GEOJSON_URL)
  .then(r => r.json())
  .then(data => {
    allFeatures = data.features;
    buildDayFilters();
    buildCatToggles();
    buildSidebar();
    addMarkers();
    applyFilters();
    panToVisibleCentroid();
  })
  .catch(err => console.error('Failed to load places.geojson:', err));

// ── VISIBILITY LOGIC ─────────────────────────────────────────
function isVisible(feature) {
  const p   = feature.properties;
  const cat = p.category;
  const iso = p.date || null;

  // Category must be active
  if (!activeCats.has(cat)) return false;

  // Day filter: benchmarks (no date) always show when their category is on
  if (activeDay === 'all') return true;
  if (!iso) return true;          // undated items always show
  return iso === activeDay;
}

function applyFilters() {
  // Sidebar items
  document.querySelectorAll('.place-item').forEach(li => {
    const idx  = parseInt(li.dataset.idx, 10);
    const show = isVisible(allFeatures[idx]);
    li.classList.toggle('hidden', !show);
  });

  // Map markers
  markers.forEach(({ el, feature }) => {
    el.style.display = isVisible(feature) ? '' : 'none';
  });
}

function panToVisibleCentroid() {
  const day = (activeDay || '').trim();
  const targets = day === 'all'
    ? allFeatures.filter(isVisible)
    : allFeatures.filter(feature => {
      const p = feature.properties;
      return activeCats.has(p.category) && (p.date || '').trim() === day;
    });

  if (!targets.length) return;

  // Popups can auto-pan the map and offset centering; close them before recentering.
  markers.forEach(({ marker }) => marker.getPopup().remove());

  if (targets.length === 1) {
    const [lng, lat] = targets[0].geometry.coordinates;
    map.easeTo({ center: [lng, lat], duration: 700 });
    return;
  }

  let lngSum = 0;
  let latSum = 0;

  targets.forEach(feature => {
    const [lng, lat] = feature.geometry.coordinates;
    lngSum += lng;
    latSum += lat;
  });

  map.easeTo({
    center: [lngSum / targets.length, latSum / targets.length],
    duration: 700,
  });
}

// ── DAY FILTERS ───────────────────────────────────────────────
function buildDayFilters() {
  const bar = document.getElementById('filterBar').querySelector('.day-filter-row');
  const daySelect = document.getElementById('daySelect');

  const dates = [...new Set(
    allFeatures.map(f => f.properties.date).filter(Boolean)
  )].sort();

  if (daySelect) {
    daySelect.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All';
    daySelect.appendChild(allOption);

    dates.forEach(iso => {
      const option = document.createElement('option');
      option.value = iso;
      option.textContent = formatDate(iso);
      daySelect.appendChild(option);
    });

    daySelect.value = activeDay;
    daySelect.addEventListener('change', (e) => setDay(e.target.value));
  }

  dates.forEach(iso => {
    const btn = document.createElement('button');
    btn.className    = 'btn btn-filter';
    btn.dataset.filter = iso;
    btn.textContent  = formatDate(iso);
    btn.addEventListener('click', () => setDay(iso));
    bar.appendChild(btn);
  });

  document.querySelector('[data-filter="all"]')
    .addEventListener('click', () => setDay('all'));
}

function setDay(value) {
  activeDay = value;
  document.querySelectorAll('.btn-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === value);
  });

  const daySelect = document.getElementById('daySelect');
  if (daySelect && daySelect.value !== value) {
    daySelect.value = value;
  }

  applyFilters();
  panToVisibleCentroid();
}

// ── CATEGORY TOGGLES ─────────────────────────────────────────
function buildCatToggles() {
  document.querySelectorAll('.btn-cat-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (activeCats.has(cat)) {
        // Don't allow deselecting all categories
        if (activeCats.size === 1) return;
        activeCats.delete(cat);
        btn.classList.remove('active');
      } else {
        activeCats.add(cat);
        btn.classList.add('active');
      }
      applyFilters();
    });
  });
}

// ── SIDEBAR LIST ──────────────────────────────────────────────
function buildSidebar() {
  const list = document.getElementById('placeList');
  list.innerHTML = '';

  allFeatures.forEach((feature, idx) => {
    const p  = feature.properties;
    const li = document.createElement('li');
    li.className      = 'place-item';
    li.dataset.idx    = idx;
    li.dataset.date   = p.date || '';
    li.dataset.cat    = p.category;

    li.innerHTML = `
      <span class="place-dot ${catClass(p.category)}"></span>
      <div class="place-info">
        <p class="place-title">${p.title}</p>
        <div class="place-meta">
          ${p.date ? `<span class="place-date">${formatDate(p.date)}</span>` : ''}
          <span class="place-cat">${p.category}</span>
        </div>
      </div>
    `;

    li.addEventListener('click', () => {
      flyTo(feature);
      openDetail(feature, idx);
      setActiveItem(li);
    });

    list.appendChild(li);
  });
}

function setActiveItem(el) {
  document.querySelectorAll('.place-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
}

// ── MAP MARKERS ───────────────────────────────────────────────
function addMarkers() {
  markers = [];

  allFeatures.forEach((feature, idx) => {
    const p = feature.properties;
    const [lng, lat] = feature.geometry.coordinates;
    const directionsHref = googleMapsDirectionsUrl(feature);

    // Outer wrapper — MapLibre anchors this; must NOT be CSS-transformed
    const el = document.createElement('div');
    el.className = 'map-marker-wrap';
    el.title = p.title;
    // Inner pin — rotation lives here so the anchor stays accurate
    const pin = document.createElement('div');
    pin.className = `map-marker ${catClass(p.category)}`;
    el.appendChild(pin);

    const popup = new maplibregl.Popup({
      offset: 18,
      closeButton: false,
      closeOnClick: false,
      maxWidth: '240px',
    }).setHTML(`
      <div class="popup-title">${p.title}</div>
      ${p.date ? `<div style="font-size:0.72rem;color:#64748b;margin-bottom:4px">${formatDate(p.date)}</div>` : ''}
      <div class="popup-desc">${p.description}</div>
      <a class="popup-link" href="${directionsHref}" target="_blank" rel="noopener">Directions in Google Maps ↗</a>
      ${p.website ? `<a class="popup-link" href="${p.website}" target="_blank" rel="noopener">Visit website ↗</a>` : ''}
    `);

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .setPopup(popup)
      .addTo(map);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (marker.getPopup().isOpen()) {
        marker.getPopup().remove();
      } else {
        markers.forEach(m => m.marker.getPopup().remove());
        marker.togglePopup();
      }
      openDetail(feature, idx);
      setActiveItem(document.querySelector(`.place-item[data-idx="${idx}"]`));
      scrollSidebarToItem(idx);
      setActiveMarker(pin);
    });

    markers.push({ el, pin, feature, marker });
  });
}

function setActiveMarker(el) {
  if (activeMarker) activeMarker.classList.remove('active');
  activeMarker = el;
  if (el) el.classList.add('active');
}

function flyTo(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 11), duration: 800 });
}

function scrollSidebarToItem(idx) {
  const li = document.querySelector(`.place-item[data-idx="${idx}"]`);
  if (li) li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── DETAIL PANEL ──────────────────────────────────────────────
const detailPanel   = document.getElementById('detailPanel');
const detailOverlay = document.getElementById('detailOverlay');
const detailBody    = document.getElementById('detailBody');
const detailClose   = document.getElementById('detailClose');

function openDetail(feature, idx) {
  const p   = feature.properties;
  const cls = catClass(p.category);
  const directionsHref = googleMapsDirectionsUrl(feature);

  detailBody.innerHTML = `
    <span class="detail-cat-badge ${cls}">${p.category}</span>
    <h2>${p.title}</h2>
    ${p.date ? `
      <div class="detail-date">
        <i class="bi bi-calendar3"></i>
        ${formatDate(p.date)}
      </div>` : ''}
    ${p.who ? `
      <div class="detail-who">
        <i class="bi bi-people"></i>
        ${p.who}
      </div>` : ''}
    <p class="detail-desc">${p.description}</p>
    <a class="btn-website" href="${directionsHref}" target="_blank" rel="noopener">
      <i class="bi bi-map"></i> Directions in Google Maps
    </a>
    ${p.website ? `
      <a class="btn-website" href="${p.website}" target="_blank" rel="noopener">
        <i class="bi bi-box-arrow-up-right"></i> Visit website
      </a>` : ''}
  `;

  detailPanel.classList.add('open');
  detailOverlay.classList.add('open');
}

function closeDetail() {
  detailPanel.classList.remove('open');
  detailOverlay.classList.remove('open');
  setActiveItem(null);
  setActiveMarker(null);
  markers.forEach(m => m.marker.getPopup().remove());
}

detailClose.addEventListener('click', closeDetail);
detailOverlay.addEventListener('click', closeDetail);
map.on('click', () => {
  if (detailPanel.classList.contains('open')) closeDetail();
});
