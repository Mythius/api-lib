// <tag-input placeholder="Add tag..." value="['react','vue']" max="10"></tag-input>
// Properties: tags (array)
// Events: change → { tags: string[] }
// Methods: getTags(), addTag(str), clear()

class TagInput extends HTMLElement {
  constructor() {
    super();
    this._tags = [];
  }

  connectedCallback() {
    try {
      const raw = this.getAttribute("value");
      if (raw) this._tags = JSON.parse(raw);
    } catch {}
    this._render();
  }

  _render() {
    const shadow = this.attachShadow({ mode: "open" });
    const placeholder = this.getAttribute("placeholder") || "Add tag…";
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .wrap {
          display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
          padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 8px;
          background: #fff; cursor: text; min-height: 42px;
        }
        .wrap:focus-within { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,.15); }
        .tag {
          display: flex; align-items: center; gap: 4px;
          background: #e0e7ff; color: #3730a3;
          padding: 2px 8px; border-radius: 20px; font-size: 13px;
        }
        .tag button {
          background: none; border: none; cursor: pointer;
          color: #6366f1; font-size: 15px; padding: 0; line-height: 1;
        }
        .tag button:hover { color: #c7254e; }
        input {
          flex: 1; min-width: 120px; border: none; outline: none;
          font-size: 14px; background: transparent; color: #111827;
        }
        input::placeholder { color: #9ca3af; }
      </style>
      <div class="wrap" id="wrap">
        <input type="text" id="input" placeholder="${placeholder}" autocomplete="off" />
      </div>`;

    this._shadow = shadow;
    this._renderTags();

    const input = shadow.getElementById("input");
    const wrap  = shadow.getElementById("wrap");

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        this._addFromInput();
      } else if (e.key === "Backspace" && !input.value && this._tags.length) {
        this._removeTag(this._tags.length - 1);
      }
    });

    input.addEventListener("blur", () => this._addFromInput());
    wrap.addEventListener("click", () => input.focus());
  }

  _renderTags() {
    const shadow = this._shadow;
    shadow.querySelectorAll(".tag").forEach((t) => t.remove());
    const input = shadow.getElementById("input");
    this._tags.forEach((tag, i) => {
      const span = document.createElement("span");
      span.className = "tag";
      span.innerHTML = `${this._escape(tag)}<button type="button" aria-label="Remove">&#215;</button>`;
      span.querySelector("button").addEventListener("click", (e) => {
        e.stopPropagation();
        this._removeTag(i);
      });
      shadow.getElementById("wrap").insertBefore(span, input);
    });
  }

  _addFromInput() {
    const input = this._shadow.getElementById("input");
    const val   = input.value.replace(/,/g, "").trim();
    if (!val) return;
    this.addTag(val);
    input.value = "";
  }

  addTag(str) {
    const max = parseInt(this.getAttribute("max") ?? "999", 10);
    if (this._tags.includes(str) || this._tags.length >= max) return;
    this._tags.push(str);
    this._renderTags();
    this._dispatch();
  }

  _removeTag(index) {
    this._tags.splice(index, 1);
    this._renderTags();
    this._dispatch();
  }

  _dispatch() {
    this.dispatchEvent(new CustomEvent("change", {
      bubbles: true, composed: true,
      detail: { tags: [...this._tags] },
    }));
  }

  _escape(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  getTags()  { return [...this._tags]; }
  clear()    { this._tags = []; this._renderTags(); this._dispatch(); }
}

customElements.define("tag-input", TagInput);
