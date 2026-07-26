/* ── app.js — South West Visit 2026 ──────────────────────────
   Vanilla JS · MapLibre GL JS · OpenFreeMap tiles
   Data source: places.geojson  (edit that file to update content)
──────────────────────────────────────────────────────────────── */

'use strict';

// ── CONFIG ────────────────────────────────────────────────────
const GEOJSON_URL = 'places.geojson?v=7';
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const MAP_CENTER = [-2.35, 51.35];
const MAP_ZOOM = 8.5;
const DEBUG_PAN = false;

// ── CATEGORY HELPERS ─────────────────────────────────────────
const CAT_CLASS = {
  'Itinerary Stop': 'stop',
  'Food Option': 'food',
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

function debugPan(event, details = {}) {
  if (!DEBUG_PAN) return;
  const center = map.getCenter();
  const msg = `[PAN_DEBUG] ${event} | activeDay: ${activeDay} | center: [${center.lng.toFixed(6)}, ${center.lat.toFixed(6)}] | zoom: ${map.getZoom().toFixed(3)} | details: ${JSON.stringify(details)}`;
  console.log(msg);
}

// ── STATE ─────────────────────────────────────────────────────
let allFeatures = [];
let activeDay = 'all';                                   // 'all' | ISO date string
let activeCats = new Set(['Itinerary Stop', 'Food Option']);
let activeMarker = null;
let markers = [];
let pendingPanRaf = null;

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

map.on('movestart', () => {
  debugPan('movestart', { moving: map.isMoving() });
});

map.on('moveend', () => {
  debugPan('moveend', { moving: map.isMoving() });
});

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

    // Ensure the default "All" view fits visible markers on first paint.
    if (map.loaded()) {
      schedulePanToVisibleCentroid('initial-load');
    } else {
      map.once('load', () => schedulePanToVisibleCentroid('initial-load'));
    }

  })
  .catch(err => console.error('Failed to load places.geojson:', err));

// ── VISIBILITY LOGIC ─────────────────────────────────────────
function isVisible(feature) {
  const p = feature.properties;
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
    const idx = parseInt(li.dataset.idx, 10);
    const show = isVisible(allFeatures[idx]);
    li.classList.toggle('hidden', !show);
  });

  // Map markers
  markers.forEach(({ el, feature }) => {
    el.style.display = isVisible(feature) ? '' : 'none';
  });
}

function computeGeographicCentroid(features) {
  let x = 0;
  let y = 0;
  let z = 0;

  features.forEach(feature => {
    const [lng, lat] = feature.geometry.coordinates;
    const lngRad = (lng * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);

    x += cosLat * Math.cos(lngRad);
    y += cosLat * Math.sin(lngRad);
    z += Math.sin(latRad);
  });

  x /= features.length;
  y /= features.length;
  z /= features.length;

  const lng = Math.atan2(y, x);
  const hyp = Math.sqrt((x * x) + (y * y));
  const lat = Math.atan2(z, hyp);

  return [(lng * 180) / Math.PI, (lat * 180) / Math.PI];
}

function computeCentroid(features) {
  if (typeof turf !== 'undefined') {
    const points = features.map(feature => turf.point(feature.geometry.coordinates));
    const fc = turf.featureCollection(points);

    if (typeof turf.centerMean === 'function') {
      return { coordinates: turf.centerMean(fc).geometry.coordinates, method: 'turf.centerMean' };
    }

    return { coordinates: turf.centroid(fc).geometry.coordinates, method: 'turf.centroid' };
  }

  return { coordinates: computeGeographicCentroid(features), method: 'geographic-fallback' };
}

function panToVisibleCentroid() {
  const day = (activeDay || '').trim();
  const targets = day === 'all'
    ? allFeatures.filter(feature => activeCats.has(feature.properties.category))
    : allFeatures.filter(isVisible);

  debugPan('panToVisibleCentroid:targets', {
    day,
    targetCount: targets.length,
    targetTitles: targets.map(f => f.properties.title),
  });

  if (!targets.length) {
    debugPan('panToVisibleCentroid:no-targets');
    return;
  }

  // Cancel any in-flight animation so a previous "All" pan cannot override this one.
  map.stop();
  debugPan('panToVisibleCentroid:after-stop', { moving: map.isMoving() });


  if (targets.length === 1) {
    const [lng, lat] = targets[0].geometry.coordinates;
    debugPan('panToVisibleCentroid:single', {
      destination: [lng, lat],
      title: targets[0].properties.title,
    });
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 12), duration: 700 });
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  targets.forEach(feature => bounds.extend(feature.geometry.coordinates));

  const isMobile = window.matchMedia('(max-width: 991px)').matches;
  const padding = isMobile
    ? { top: 88, right: 28, bottom: 28, left: 28 }
    : { top: 120, right: 72, bottom: 72, left: 72 };

  map.fitBounds(bounds, {
    padding,
    duration: 700,
    maxZoom: 12,
  });
  debugPan('panToVisibleCentroid:fitBounds', {
    count: targets.length,
    bounds: bounds.toArray(),
  });
}

function schedulePanToVisibleCentroid(reason) {
  if (pendingPanRaf !== null) {
    cancelAnimationFrame(pendingPanRaf);
  }

  pendingPanRaf = requestAnimationFrame(() => {
    pendingPanRaf = null;
    map.resize();
    debugPan('schedulePanToVisibleCentroid:after-resize', { reason });
    panToVisibleCentroid();
  });
}

// ── DAY CAROUSEL ──────────────────────────────────────────────
let carouselDates = [];   // ['all', '2026-07-28', '2026-07-29', ...]
let carouselIndex = 0;   // index into carouselDates

function buildDayFilters() {
  const dates = [...new Set(
    allFeatures.map(f => f.properties.date).filter(Boolean)
  )].sort();

  carouselDates = ['all', ...dates];
  carouselIndex = 0;  // start on 'All'

  const prevBtn  = document.getElementById('dayPrev');
  const nextBtn  = document.getElementById('dayNext');

  prevBtn.addEventListener('click', () => {
    if (carouselIndex > 0) {
      carouselIndex--;
      applyCarousel();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (carouselIndex < carouselDates.length - 1) {
      carouselIndex++;
      applyCarousel();
    }
  });

  applyCarousel();
}

function applyCarousel() {
  const value  = carouselDates[carouselIndex];
  const label  = document.getElementById('dayCarouselLabel');
  const prevBtn = document.getElementById('dayPrev');
  const nextBtn = document.getElementById('dayNext');

  label.textContent = value === 'all' ? 'All Days' : formatDate(value);
  prevBtn.disabled  = carouselIndex === 0;
  nextBtn.disabled  = carouselIndex === carouselDates.length - 1;

  setDay(value, 'carousel');
}

function setDay(value, source = 'unknown') {
  debugPan('setDay:start', { value, source });
  activeDay = value;

  // Keep carouselIndex in sync if setDay is called from elsewhere
  if (source !== 'carousel') {
    const idx = carouselDates.indexOf(value);
    if (idx !== -1) carouselIndex = idx;
    applyCarousel();
    return;
  }

  applyFilters();
  debugPan('setDay:after-applyFilters', {
    visibleCount: allFeatures.filter(isVisible).length,
  });
  schedulePanToVisibleCentroid(`setDay:${source}`);
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
    const p = feature.properties;
    const li = document.createElement('li');
    li.className = 'place-item';
    li.dataset.idx = idx;
    li.dataset.date = p.date || '';
    li.dataset.cat = p.category;

    li.innerHTML = `
      <span class="place-dot ${catClass(p.category)}"></span>
      <div class="place-info">
        <p class="place-title">${p.title}</p>
        <div class="place-meta">
          ${p.date ? `<span class="place-date">${formatDate(p.date)}</span>` : ''}
          <span class="place-cat">${p.category}</span>
          ${p.heritage_organization ? `<span class="place-heritage">${p.heritage_organization}</span>` : ''}
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

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
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

function detailHeroMarkup(p) {
  const src = p.image || p.image_backup;
  if (!src) return '';

  const fallbackAttr = p.image_backup && p.image && p.image !== p.image_backup
    ? ` data-fallback="${p.image_backup}"`
    : '';

  return `
      <div class="detail-hero">
        <img src="${src}" alt="${p.title}" loading="lazy"${fallbackAttr}
             onerror="if (this.dataset.fallback && this.src !== this.dataset.fallback) { this.src = this.dataset.fallback; this.dataset.fallback = ''; } else { this.closest('.detail-hero').remove(); }">
      </div>`;
}

// ── DETAIL PANEL ──────────────────────────────────────────────
const detailPanel = document.getElementById('detailPanel');
const detailOverlay = document.getElementById('detailOverlay');
const detailBody = document.getElementById('detailBody');
const detailClose = document.getElementById('detailClose');

function scheduleMarkup(schedule) {
  if (!schedule || !schedule.length) return '';
  const rows = schedule.map(s =>
    `<tr><td class="sched-time">${s.time}</td><td class="sched-act">${s.activity}</td></tr>`
  ).join('');
  return `
    <div class="detail-schedule">
      <div class="detail-schedule-heading"><i class="bi bi-clock"></i> Schedule</div>
      <table class="sched-table"><tbody>${rows}</tbody></table>
    </div>`;
}

function openDetail(feature, idx) {
  const p = feature.properties;
  const cls = catClass(p.category);
  const directionsHref = googleMapsDirectionsUrl(feature);

  detailBody.innerHTML = `
    ${detailHeroMarkup(p)}
    <div class="detail-content">
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
      ${p.heritage_organization ? `
        <div class="detail-heritage">
          <i class="bi bi-bank"></i>
          ${p.heritage_organization}
        </div>` : ''}
      <p class="detail-desc">${p.description}</p>
      ${scheduleMarkup(p.schedule)}
      <a class="btn-website" href="${directionsHref}" target="_blank" rel="noopener">
        <i class="bi bi-map"></i> Directions in Google Maps
      </a>
      ${p.website ? `
        <a class="btn-website" href="${p.website}" target="_blank" rel="noopener">
          <i class="bi bi-box-arrow-up-right"></i> Visit website
        </a>` : ''}
    </div>
  `;

  detailPanel.classList.add('open');
  detailOverlay.classList.add('open');
}

function closeDetail() {
  detailPanel.classList.remove('open');
  detailOverlay.classList.remove('open');
  setActiveItem(null);
  setActiveMarker(null);
}

detailClose.addEventListener('click', closeDetail);
detailOverlay.addEventListener('click', closeDetail);
map.on('click', () => {
  if (detailPanel.classList.contains('open')) closeDetail();
});

// Sidebar list toggling logic
const toggleListBtn = document.getElementById('toggleListBtn');
if (toggleListBtn) {
  toggleListBtn.addEventListener('click', () => {
    const mainRow = document.querySelector('.main-row');
    const isCollapsed = mainRow.classList.toggle('sidebar-collapsed');

    // Update button content
    const icon = toggleListBtn.querySelector('i');
    const text = toggleListBtn.querySelector('.btn-text');
    if (isCollapsed) {
      if (icon) icon.className = 'bi bi-layout-sidebar-inset';
      if (text) text.textContent = 'Show List';
    } else {
      if (icon) icon.className = 'bi bi-layout-sidebar';
      if (text) text.textContent = 'Hide List';
    }

    // Resize map to fit new dimensions
    setTimeout(() => {
      map.resize();
    }, 250); // Allow CSS transitions to complete
  });
}
