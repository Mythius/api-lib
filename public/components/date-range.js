// <date-range start="2024-01-01" end="2024-12-31" label-start="From" label-end="To"></date-range>
// Events: change → { start: string, end: string, valid: boolean }
// Methods: getValue() → { start, end }

class DateRange extends HTMLElement {
  connectedCallback() {
    this._render();
  }

  _render() {
    const shadow = this.attachShadow({ mode: "open" });
    const start = this.getAttribute("start") || "";
    const end   = this.getAttribute("end")   || "";
    const lStart = this.getAttribute("label-start") || "Start date";
    const lEnd   = this.getAttribute("label-end")   || "End date";
    const min    = this.getAttribute("min")  || "";
    const max    = this.getAttribute("max")  || "";

    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
        .field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
        label { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
        input[type="date"] {
          padding: 8px 12px; font-size: 14px; color: #111827;
          border: 1px solid #d1d5db; border-radius: 8px; outline: none;
          background: #fff; width: 100%; box-sizing: border-box;
        }
        input[type="date"]:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,.15); }
        input[type="date"].error { border-color: #ef4444; }
        .sep { display: flex; align-items: center; padding-bottom: 9px; color: #9ca3af; font-size: 18px; }
        .msg { font-size: 12px; color: #ef4444; margin-top: 4px; min-height: 16px; }
      </style>
      <div class="row">
        <div class="field">
          <label for="start">${lStart}</label>
          <input type="date" id="start" value="${start}" ${min ? `min="${min}"` : ""} ${max ? `max="${max}"` : ""} />
        </div>
        <div class="sep">&#8594;</div>
        <div class="field">
          <label for="end">${lEnd}</label>
          <input type="date" id="end" value="${end}" ${min ? `min="${min}"` : ""} ${max ? `max="${max}"` : ""} />
        </div>
      </div>
      <div class="msg" id="msg"></div>`;

    const startEl = shadow.getElementById("start");
    const endEl   = shadow.getElementById("end");
    const msg     = shadow.getElementById("msg");

    const validate = () => {
      const s = startEl.value;
      const e = endEl.value;
      let error = "";
      if (s && e && s > e) error = `${lEnd} must be after ${lStart}`;
      msg.textContent = error;
      startEl.classList.toggle("error", !!error);
      endEl.classList.toggle("error",   !!error);
      if (!error) {
        // Keep end min in sync with start
        if (s) endEl.min = s;
      }
      this.dispatchEvent(new CustomEvent("change", {
        bubbles: true, composed: true,
        detail: { start: s, end: e, valid: !error && !!(s && e) },
      }));
    };

    startEl.addEventListener("change", validate);
    endEl.addEventListener("change",   validate);
    this._shadow = shadow;
  }

  getValue() {
    return {
      start: this._shadow?.getElementById("start")?.value ?? "",
      end:   this._shadow?.getElementById("end")?.value   ?? "",
    };
  }
}

customElements.define("date-range", DateRange);
