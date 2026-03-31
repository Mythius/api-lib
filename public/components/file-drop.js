// <file-drop accept="image/*" multiple max-size-mb="5" label="Drop files here"></file-drop>
// Events: change → { files: File[] }
// Methods: getFiles(), clear()

class FileDrop extends HTMLElement {
  constructor() {
    super();
    this._files = [];
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const shadow = this.attachShadow({ mode: "open" });
    this._shadow = shadow;
    const accept   = this.getAttribute("accept") || "*/*";
    const multiple = this.hasAttribute("multiple");
    const label    = this.getAttribute("label") || "Drag & drop files here";
    const maxMB    = parseFloat(this.getAttribute("max-size-mb") || "0");

    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .zone {
          border: 2px dashed #d1d5db; border-radius: 12px; padding: 32px 20px;
          text-align: center; cursor: pointer; background: #fafafa;
          transition: border-color .15s, background .15s;
        }
        .zone.drag { border-color: #6366f1; background: #eef2ff; }
        .zone.has-files { padding-bottom: 12px; }
        .icon { font-size: 36px; }
        .label { margin: 8px 0 4px; font-size: 15px; color: #374151; font-weight: 500; }
        .hint  { font-size: 12px; color: #9ca3af; margin-bottom: 0; }
        input[type="file"] { display: none; }
        .file-list { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; text-align: left; }
        .file-item {
          display: flex; align-items: center; gap: 8px;
          background: #f3f4f6; border-radius: 8px; padding: 6px 10px; font-size: 13px;
        }
        .file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #111827; }
        .file-size { color: #6b7280; white-space: nowrap; }
        .file-remove {
          background: none; border: none; cursor: pointer;
          color: #9ca3af; font-size: 16px; padding: 0; line-height: 1;
        }
        .file-remove:hover { color: #ef4444; }
        .error { margin-top: 6px; font-size: 12px; color: #ef4444; }
      </style>
      <div class="zone" id="zone" tabindex="0" role="button" aria-label="${label}">
        <div class="icon">&#128193;</div>
        <div class="label">${label}</div>
        <div class="hint">or click to browse${accept !== "*/*" ? " · " + accept : ""}${maxMB ? " · max " + maxMB + " MB" : ""}</div>
        <input type="file" id="input" accept="${accept}" ${multiple ? "multiple" : ""} />
        <div class="file-list" id="list"></div>
        <div class="error" id="error"></div>
      </div>`;

    const zone  = shadow.getElementById("zone");
    const input = shadow.getElementById("input");

    zone.addEventListener("click",   (e) => { if (e.target !== zone && !zone.contains(e.target)) return; input.click(); });
    zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") input.click(); });

    input.addEventListener("change", () => this._addFiles([...input.files]));

    zone.addEventListener("dragover",  (e) => { e.preventDefault(); zone.classList.add("drag"); });
    zone.addEventListener("dragleave", ()  => zone.classList.remove("drag"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag");
      this._addFiles([...e.dataTransfer.files]);
    });
  }

  _addFiles(incoming) {
    const maxBytes = parseFloat(this.getAttribute("max-size-mb") || "0") * 1024 * 1024;
    const accept   = this.getAttribute("accept") || "";
    const multiple = this.hasAttribute("multiple");
    const errEl    = this._shadow.getElementById("error");
    let errors = [];

    const valid = incoming.filter((f) => {
      if (maxBytes && f.size > maxBytes) { errors.push(`${f.name} exceeds size limit`); return false; }
      if (accept && accept !== "*/*") {
        const patterns = accept.split(",").map((a) => a.trim());
        const ok = patterns.some((p) => {
          if (p.endsWith("/*")) return f.type.startsWith(p.replace("/*", "/"));
          if (p.startsWith(".")) return f.name.endsWith(p);
          return f.type === p;
        });
        if (!ok) { errors.push(`${f.name} not accepted`); return false; }
      }
      return true;
    });

    errEl.textContent = errors.join(" · ");

    if (multiple) {
      const names = new Set(this._files.map((f) => f.name));
      valid.forEach((f) => { if (!names.has(f.name)) this._files.push(f); });
    } else {
      this._files = valid.slice(0, 1);
    }

    this._renderList();
    this._dispatch();
  }

  _renderList() {
    const list = this._shadow.getElementById("list");
    const zone = this._shadow.getElementById("zone");
    zone.classList.toggle("has-files", this._files.length > 0);
    list.innerHTML = this._files.map((f, i) => `
      <div class="file-item">
        <span class="file-name">${this._esc(f.name)}</span>
        <span class="file-size">${this._fmtSize(f.size)}</span>
        <button class="file-remove" data-i="${i}" title="Remove">&#215;</button>
      </div>`).join("");
    list.querySelectorAll(".file-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._files.splice(Number(btn.dataset.i), 1);
        this._renderList();
        this._dispatch();
      });
    });
  }

  _dispatch() {
    this.dispatchEvent(new CustomEvent("change", {
      bubbles: true, composed: true,
      detail: { files: [...this._files] },
    }));
  }

  _fmtSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  _esc(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  getFiles() { return [...this._files]; }
  clear()    { this._files = []; this._renderList(); this._dispatch(); }
}

customElements.define("file-drop", FileDrop);
