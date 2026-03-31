// <combobox-input placeholder="Search..." options='["Apple","Banana","Cherry"]'></combobox-input>
// Attributes: options (JSON array), placeholder, value, allow-custom (allows free-text values)
// Events: change → { value: string }
// Methods: getValue(), setValue(str), setOptions(arr)

class ComboboxInput extends HTMLElement {
  constructor() {
    super();
    this._options = [];
    this._open = false;
    this._focused = -1;
  }

  connectedCallback() {
    try {
      const raw = this.getAttribute("options");
      if (raw) this._options = JSON.parse(raw);
    } catch {}
    this._render();
  }

  static get observedAttributes() { return ["options"]; }
  attributeChangedCallback(name, _old, val) {
    if (name === "options") {
      try { this._options = JSON.parse(val); } catch {}
      if (this._shadow) this._filter(this._shadow.getElementById("input").value);
    }
  }

  _render() {
    const shadow = this.attachShadow({ mode: "open" });
    this._shadow  = shadow;
    const placeholder = this.getAttribute("placeholder") || "Search…";
    const initial     = this.getAttribute("value") || "";
    shadow.innerHTML = `
      <style>
        :host { display: block; position: relative; }
        .wrap { position: relative; }
        input {
          width: 100%; box-sizing: border-box;
          padding: 8px 32px 8px 12px; font-size: 14px; color: #111827;
          border: 1px solid #d1d5db; border-radius: 8px; outline: none;
          background: #fff;
        }
        input:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,.15); }
        .arrow {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          pointer-events: none; color: #6b7280; font-size: 10px;
        }
        .dropdown {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 1000;
          background: #fff; border: 1px solid #d1d5db; border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,.1); max-height: 220px; overflow-y: auto;
          display: none;
        }
        .dropdown.open { display: block; }
        .option {
          padding: 8px 14px; font-size: 14px; color: #111827; cursor: pointer;
        }
        .option:hover, .option.focused { background: #f3f4f6; }
        .option.selected { font-weight: 600; color: #4f46e5; }
        .empty { padding: 10px 14px; font-size: 13px; color: #9ca3af; }
      </style>
      <div class="wrap">
        <input id="input" type="text" placeholder="${placeholder}" value="${initial}" autocomplete="off" />
        <span class="arrow">&#9660;</span>
        <div class="dropdown" id="dropdown"></div>
      </div>`;

    const input    = shadow.getElementById("input");
    const dropdown = shadow.getElementById("dropdown");

    input.addEventListener("focus", () => { this._open = true; this._filter(input.value); dropdown.classList.add("open"); });
    input.addEventListener("input", () => { this._open = true; dropdown.classList.add("open"); this._filter(input.value); });
    input.addEventListener("keydown", (e) => this._onKey(e, input, dropdown));

    document.addEventListener("click", (e) => {
      if (!this.contains(e.target)) this._close(input, dropdown);
    });

    this._filter("");
  }

  _filter(query) {
    const dropdown = this._shadow.getElementById("dropdown");
    const q = query.toLowerCase();
    const matches = this._options.filter((o) => o.toLowerCase().includes(q));
    const current = this._shadow.getElementById("input").value;
    if (!matches.length) {
      dropdown.innerHTML = `<div class="empty">No options found</div>`;
      return;
    }
    dropdown.innerHTML = matches.map((o, i) => {
      const sel = o === current ? " selected" : "";
      return `<div class="option${sel}" data-value="${this._escape(o)}" data-i="${i}">${this._highlight(o, q)}</div>`;
    }).join("");
    dropdown.querySelectorAll(".option").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this._select(el.dataset.value);
      });
    });
    this._focused = -1;
  }

  _highlight(str, q) {
    if (!q) return this._escape(str);
    const i = str.toLowerCase().indexOf(q);
    if (i === -1) return this._escape(str);
    return this._escape(str.slice(0, i)) +
      `<mark style="background:#fef08a;border-radius:2px">${this._escape(str.slice(i, i + q.length))}</mark>` +
      this._escape(str.slice(i + q.length));
  }

  _select(val) {
    const input    = this._shadow.getElementById("input");
    const dropdown = this._shadow.getElementById("dropdown");
    input.value = val;
    this._close(input, dropdown);
    this.dispatchEvent(new CustomEvent("change", { bubbles: true, composed: true, detail: { value: val } }));
  }

  _onKey(e, input, dropdown) {
    const items = dropdown.querySelectorAll(".option");
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this._focused = Math.min(this._focused + 1, items.length - 1);
      this._highlightFocused(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this._focused = Math.max(this._focused - 1, 0);
      this._highlightFocused(items);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (this._focused >= 0 && items[this._focused]) {
        this._select(items[this._focused].dataset.value);
      } else if (this.hasAttribute("allow-custom") && input.value) {
        this._select(input.value);
      }
    } else if (e.key === "Escape") {
      this._close(input, dropdown);
    }
  }

  _highlightFocused(items) {
    items.forEach((el, i) => el.classList.toggle("focused", i === this._focused));
    if (this._focused >= 0) items[this._focused].scrollIntoView({ block: "nearest" });
  }

  _close(input, dropdown) {
    this._open = false;
    dropdown.classList.remove("open");
    // If allow-custom is not set, revert to last valid selection if input doesn't match options
    if (!this.hasAttribute("allow-custom")) {
      if (!this._options.includes(input.value)) input.value = "";
    }
  }

  _escape(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  getValue()           { return this._shadow?.getElementById("input")?.value ?? ""; }
  setValue(val)        { if (this._shadow) { this._shadow.getElementById("input").value = val; } }
  setOptions(arr)      { this._options = arr; if (this._shadow) this._filter(this._shadow.getElementById("input").value); }
}

customElements.define("combobox-input", ComboboxInput);
