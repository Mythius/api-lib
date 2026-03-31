// <map-picker lat="51.505" lng="-0.09" zoom="13"></map-picker>
// Properties: lat, lng, zoom, readonly
// Events: change → { lat, lng, display }
// Methods: getValue() → { lat, lng }

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

function loadLeaflet() {
  if (window._leafletReady) return window._leafletReady;
  window._leafletReady = new Promise((resolve) => {
    if (window.L) return resolve(window.L);
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = LEAFLET_CSS;
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.onload = () => resolve(window.L);
    document.head.appendChild(script);
  });
  return window._leafletReady;
}

class MapPicker extends HTMLElement {
  static get observedAttributes() { return ["lat", "lng", "zoom", "readonly"]; }

  constructor() {
    super();
    this._lat = null;
    this._lng = null;
    this._marker = null;
    this._map = null;
  }

  connectedCallback() {
    this._render();
    loadLeaflet().then((L) => this._initMap(L));
  }

  attributeChangedCallback(name, _old, val) {
    if (!this._map) return;
    if (name === "lat" || name === "lng") this._updateMarker();
    if (name === "zoom") this._map.setZoom(Number(val));
  }

  _render() {
    const shadow = this.attachShadow({ mode: "open" });
    // Leaflet CSS must be injected into the shadow root — it won't pierce the
    // shadow boundary from document.head, which causes tile distortion/misalignment.
    shadow.innerHTML = `
      <link rel="stylesheet" href="${LEAFLET_CSS}" />
      <style>
        :host { display: block; }
        #wrap { position: relative; width: 100%; height: var(--map-height, 400px); }
        #map  { width: 100%; height: 100%; border-radius: var(--map-radius, 8px); }
        #coords {
          position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
          background: rgba(0,0,0,.65); color: #fff; font: 12px/1.4 monospace;
          padding: 4px 10px; border-radius: 20px; pointer-events: none; z-index: 999;
          white-space: nowrap;
        }
        #coords.hidden { display: none; }
        #hint {
          position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
          background: rgba(255,255,255,.85); color: #333; font: 13px/1.4 sans-serif;
          padding: 4px 12px; border-radius: 20px; pointer-events: none; z-index: 999;
          white-space: nowrap;
        }
        #hint.hidden { display: none; }
        #search-wrap {
          position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
          z-index: 1000; width: min(360px, calc(100% - 120px));
        }
        #search-wrap.hidden { display: none; }
        #search-input {
          width: 100%; box-sizing: border-box;
          padding: 8px 36px 8px 14px; font-size: 14px; color: #111827;
          border: none; border-radius: 8px; outline: none;
          background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.25);
        }
        #search-input:focus { box-shadow: 0 2px 12px rgba(99,102,241,.35); }
        #search-clear {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; color: #9ca3af;
          font-size: 16px; padding: 0; line-height: 1; display: none;
        }
        #search-clear.visible { display: block; }
        #search-clear:hover { color: #374151; }
        #search-results {
          margin-top: 4px; background: #fff; border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,.15); overflow: hidden; display: none;
        }
        #search-results.open { display: block; }
        .sr-item {
          padding: 9px 14px; font-size: 13px; color: #111827; cursor: pointer;
          border-bottom: 1px solid #f3f4f6; line-height: 1.4;
        }
        .sr-item:last-child { border-bottom: none; }
        .sr-item:hover, .sr-item.focused { background: #f3f4f6; }
        .sr-item .sr-type { font-size: 11px; color: #9ca3af; margin-left: 6px; }
        .sr-empty, .sr-loading { padding: 10px 14px; font-size: 13px; color: #9ca3af; }
        .leaflet-locate-btn {
          background: #fff; border: none; border-radius: 4px;
          width: 30px; height: 30px; cursor: pointer; display: flex; align-items: center;
          justify-content: center; font-size: 18px;
          box-shadow: 0 1px 5px rgba(0,0,0,.4);
          transition: background .15s;
        }
        .leaflet-locate-btn:hover { background: #f4f4f4; }
        .leaflet-locate-btn.loading { animation: spin .8s linear infinite; display: inline-block; }
        .leaflet-locate-btn.error { color: #ef4444; }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
      <div id="wrap">
        <div id="map"></div>
        <div id="search-wrap" class="hidden">
          <input id="search-input" type="text" placeholder="Search address…" autocomplete="off" />
          <button id="search-clear" title="Clear">&#215;</button>
          <div id="search-results"></div>
        </div>
        <div id="coords" class="hidden"></div>
        <div id="hint">Click map to drop a pin</div>
      </div>`;
  }

  _initMap(L) {
    const root    = this.shadowRoot;
    const mapEl   = root.getElementById("map");
    const coordEl = root.getElementById("coords");
    const hintEl  = root.getElementById("hint");

    const initLat  = parseFloat(this.getAttribute("lat")  ?? "20");
    const initLng  = parseFloat(this.getAttribute("lng")  ?? "0");
    const initZoom = parseInt(this.getAttribute("zoom") ?? "2", 10);
    const isReadonly = this.hasAttribute("readonly");

    const map = L.map(mapEl).setView([initLat, initLng], initZoom);
    this._map = map;
    // Recalculate container size after shadow DOM has fully rendered
    setTimeout(() => map.invalidateSize(), 0);

    const baseLayers = {
      "Map": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
        maxZoom: 19,
      }),
      "Satellite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "© Esri, Maxar, Earthstar Geographics",
        maxZoom: 19,
      }),
      "Hybrid": L.layerGroup([
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          attribution: "© Esri, Maxar, Earthstar Geographics",
          maxZoom: 19,
        }),
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
          maxZoom: 19,
          opacity: 0.4,
        }),
      ]),
    };

    baseLayers["Map"].addTo(map);
    L.control.layers(baseLayers, {}, { position: "topright", collapsed: false }).addTo(map);

    // Locate button as a proper Leaflet control (bottomright, avoids layer switcher)
    const LocateControl = L.Control.extend({
      options: { position: "bottomright" },
      onAdd: () => {
        const btn = L.DomUtil.create("button", "leaflet-locate-btn");
        btn.title = "Go to my location";
        btn.innerHTML = "⌖";
        L.DomEvent.on(btn, "click", L.DomEvent.stopPropagation);
        L.DomEvent.on(btn, "click", L.DomEvent.preventDefault);
        L.DomEvent.on(btn, "click", () => this._goToLocation(L, btn, coordEl, hintEl));
        return btn;
      },
    });
    new LocateControl().addTo(map);

    // If lat/lng are set as attributes, drop initial pin
    if (this.hasAttribute("lat") && this.hasAttribute("lng")) {
      this._placeMarker(L, initLat, initLng, coordEl, hintEl);
    }

    if (!isReadonly) {
      map.on("click", (e) => {
        this._placeMarker(L, e.latlng.lat, e.latlng.lng, coordEl, hintEl);
        this._dispatch();
      });
    }

    if (this.hasAttribute("search")) {
      this._initSearch(L, coordEl, hintEl);
    }
  }

  _initSearch(L, coordEl, hintEl) {
    const root      = this.shadowRoot;
    const wrap      = root.getElementById("search-wrap");
    const input     = root.getElementById("search-input");
    const clearBtn  = root.getElementById("search-clear");
    const results   = root.getElementById("search-results");

    wrap.classList.remove("hidden");

    // Prevent map clicks/drags from firing while interacting with the search bar
    wrap.addEventListener("mousedown", (e) => e.stopPropagation());
    wrap.addEventListener("touchstart", (e) => e.stopPropagation());

    let debounceTimer = null;
    let focused = -1;

    input.addEventListener("input", () => {
      const q = input.value.trim();
      clearBtn.classList.toggle("visible", q.length > 0);
      clearTimeout(debounceTimer);
      if (q.length < 3) { this._closeResults(results); return; }
      results.innerHTML = `<div class="sr-loading">Searching…</div>`;
      results.classList.add("open");
      debounceTimer = setTimeout(() => this._geocode(q, results, input, clearBtn, L, coordEl, hintEl), 400);
    });

    input.addEventListener("keydown", (e) => {
      const items = results.querySelectorAll(".sr-item");
      if (e.key === "ArrowDown")  { e.preventDefault(); focused = Math.min(focused + 1, items.length - 1); this._focusItem(items, focused); }
      else if (e.key === "ArrowUp") { e.preventDefault(); focused = Math.max(focused - 1, 0); this._focusItem(items, focused); }
      else if (e.key === "Enter" && focused >= 0) { items[focused]?.click(); }
      else if (e.key === "Escape") { this._closeResults(results); input.blur(); }
    });

    clearBtn.addEventListener("click", () => {
      input.value = "";
      clearBtn.classList.remove("visible");
      this._closeResults(results);
      input.focus();
    });

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (!this.contains(e.target)) this._closeResults(results);
    });
  }

  async _geocode(query, resultsEl, input, clearBtn, L, coordEl, hintEl) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
      const res  = await fetch(url, { headers: { "Accept-Language": navigator.language || "en" } });
      const data = await res.json();

      if (!data.length) {
        resultsEl.innerHTML = `<div class="sr-empty">No results found</div>`;
        return;
      }

      resultsEl.innerHTML = data.map((item, i) => {
        const type = item.type ? item.type.replace(/_/g, " ") : "";
        return `<div class="sr-item" data-i="${i}" data-lat="${item.lat}" data-lng="${item.lon}"
                     data-bbox='${JSON.stringify(item.boundingbox)}'>
                  ${this._esc(item.display_name)}
                  ${type ? `<span class="sr-type">${this._esc(type)}</span>` : ""}
                </div>`;
      }).join("");

      resultsEl.querySelectorAll(".sr-item").forEach((el) => {
        el.addEventListener("click", () => {
          const lat  = parseFloat(el.dataset.lat);
          const lng  = parseFloat(el.dataset.lng);
          const bbox = JSON.parse(el.dataset.bbox); // [s, n, w, e]

          // Fly to bounding box for a natural zoom level, then pin
          this._map.fitBounds([[bbox[0], bbox[2]], [bbox[1], bbox[3]]], { maxZoom: 17 });
          this._placeMarker(L, lat, lng, coordEl, hintEl);
          this._dispatch();

          input.value = el.firstChild.textContent.trim();
          clearBtn.classList.add("visible");
          this._closeResults(resultsEl);
        });
      });
    } catch {
      resultsEl.innerHTML = `<div class="sr-empty">Search unavailable</div>`;
    }
  }

  _focusItem(items, index) {
    items.forEach((el, i) => el.classList.toggle("focused", i === index));
    items[index]?.scrollIntoView({ block: "nearest" });
  }

  _closeResults(resultsEl) {
    resultsEl.classList.remove("open");
    resultsEl.innerHTML = "";
    const root = this.shadowRoot;
    if (root) root.getElementById("search-wrap")._focused = -1;
  }

  _esc(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  _goToLocation(L, btn, coordEl, hintEl) {
    if (!navigator.geolocation) {
      btn.classList.add("error");
      btn.title = "Geolocation not supported";
      return;
    }

    btn.classList.add("loading");
    btn.title = "Locating…";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.classList.remove("loading");
        btn.title = "Go to my location";
        const { latitude: lat, longitude: lng } = pos.coords;
        this._map.setView([lat, lng], 15);
        this._placeMarker(L, lat, lng, coordEl, hintEl);
        this._dispatch();
      },
      (err) => {
        btn.classList.remove("loading");
        btn.classList.add("error");
        btn.title = err.code === 1 ? "Location permission denied" : "Could not get location";
        setTimeout(() => { btn.classList.remove("error"); btn.title = "Go to my location"; }, 3000);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  _placeMarker(L, lat, lng, coordEl, hintEl) {
    this._lat = lat;
    this._lng = lng;
    if (this._marker) this._marker.setLatLng([lat, lng]);
    else this._marker = L.marker([lat, lng]).addTo(this._map);
    coordEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    coordEl.classList.remove("hidden");
    hintEl.classList.add("hidden");
  }

  _updateMarker() {
    if (!window.L || !this._map) return;
    const lat = parseFloat(this.getAttribute("lat"));
    const lng = parseFloat(this.getAttribute("lng"));
    const root = this.shadowRoot;
    this._placeMarker(window.L, lat, lng,
      root.getElementById("coords"),
      root.getElementById("hint"));
  }

  _dispatch() {
    this.dispatchEvent(new CustomEvent("change", {
      bubbles: true, composed: true,
      detail: { lat: this._lat, lng: this._lng,
                display: `${this._lat.toFixed(6)}, ${this._lng.toFixed(6)}` },
    }));
  }

  getValue() {
    return this._lat !== null ? { lat: this._lat, lng: this._lng } : null;
  }

  // Programmatically set pin
  setPin(lat, lng) {
    if (!this._map || !window.L) return;
    const root = this.shadowRoot;
    this._placeMarker(window.L, lat, lng,
      root.getElementById("coords"),
      root.getElementById("hint"));
    this._map.setView([lat, lng]);
  }
}

customElements.define("map-picker", MapPicker);
