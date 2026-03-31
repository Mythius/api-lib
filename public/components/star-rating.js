// <star-rating value="3" max="5" size="28" readonly></star-rating>
// Events: change → { value: number }
// Methods: getValue(), setValue(n)

class StarRating extends HTMLElement {
  static get observedAttributes() { return ["value", "max", "readonly"]; }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    if (this._shadow) this._update();
  }

  _render() {
    const shadow = this.attachShadow({ mode: "open" });
    this._shadow = shadow;
    const size = this.getAttribute("size") || "28";
    shadow.innerHTML = `
      <style>
        :host { display: inline-flex; align-items: center; gap: 2px; }
        button {
          background: none; border: none; padding: 0; cursor: pointer;
          font-size: ${size}px; line-height: 1; color: #d1d5db;
          transition: color .1s, transform .1s;
        }
        button:hover, button.hovered { color: #fbbf24; }
        button.filled  { color: #f59e0b; }
        button:active  { transform: scale(.85); }
        button[disabled] { cursor: default; pointer-events: none; }
        .label { font-size: 13px; color: #6b7280; margin-left: 6px; }
      </style>
      <div id="stars"></div>
      <span class="label" id="label"></span>`;

    this._update();
  }

  _update() {
    const shadow   = this._shadow;
    const max      = parseInt(this.getAttribute("max") || "5", 10);
    const val      = parseFloat(this.getAttribute("value") || "0");
    const readonly = this.hasAttribute("readonly");
    const starsEl  = shadow.getElementById("stars");
    const labelEl  = shadow.getElementById("label");

    starsEl.innerHTML = Array.from({ length: max }, (_, i) => {
      const n    = i + 1;
      const full = n <= val;
      const half = !full && n - 0.5 <= val;
      const icon = full ? "&#9733;" : half ? "&#11240;" : "&#9733;";
      const cls  = full || half ? "filled" : "";
      return `<button type="button" data-n="${n}" class="${cls}" ${readonly ? "disabled" : ""}>${icon}</button>`;
    }).join("");

    labelEl.textContent = val > 0 ? `${val} / ${max}` : "";

    if (!readonly) {
      const buttons = starsEl.querySelectorAll("button");
      buttons.forEach((btn) => {
        btn.addEventListener("mouseenter", () => {
          const n = Number(btn.dataset.n);
          buttons.forEach((b, i) => b.classList.toggle("hovered", i < n));
        });
        btn.addEventListener("mouseleave", () => {
          buttons.forEach((b) => b.classList.remove("hovered"));
        });
        btn.addEventListener("click", () => {
          const n = Number(btn.dataset.n);
          // Click same star again → clear
          const current = parseFloat(this.getAttribute("value") || "0");
          const next = current === n ? 0 : n;
          this.setAttribute("value", String(next));
          this.dispatchEvent(new CustomEvent("change", {
            bubbles: true, composed: true,
            detail: { value: next },
          }));
        });
      });
    }
  }

  getValue()  { return parseFloat(this.getAttribute("value") || "0"); }
  setValue(n) { this.setAttribute("value", String(n)); }
}

customElements.define("star-rating", StarRating);
