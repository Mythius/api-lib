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
        #locate {
          position: absolute; top: 10px; right: 10px; z-index: 999;
          background: #fff; border: 2px solid rgba(0,0,0,.2); border-radius: 6px;
          width: 34px; height: 34px; cursor: pointer; display: flex; align-items: center;
          justify-content: center; font-size: 18px; box-shadow: 0 1px 5px rgba(0,0,0,.2);
          transition: background .15s;
        }
        #locate:hover { background: #f0f0f0; }
        #locate.loading { animation: spin .8s linear infinite; }
        #locate.error { color: #ef4444; }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
      <div id="wrap">
        <div id="map"></div>
        <button id="locate" title="Go to my location">&#8982;</button>
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

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

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

    const locateBtn = root.getElementById("locate");
    locateBtn.addEventListener("click", () => this._goToLocation(L, coordEl, hintEl));
  }

  _goToLocation(L, coordEl, hintEl) {
    if (!navigator.geolocation) {
      const btn = this.shadowRoot.getElementById("locate");
      btn.classList.add("error");
      btn.title = "Geolocation not supported";
      return;
    }

    const btn = this.shadowRoot.getElementById("locate");
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
