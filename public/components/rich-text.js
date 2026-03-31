// <rich-text placeholder="Type here..." value="<b>Hello</b>"></rich-text>
// Properties: value (HTML string)
// Events: change → { html, text }
// Methods: getValue() → html string,  setValue(html)

class RichText extends HTMLElement {
  connectedCallback() {
    this._render();
  }

  _render() {
    const shadow = this.attachShadow({ mode: "open" });
    const placeholder = this.getAttribute("placeholder") || "";
    const initial     = this.getAttribute("value") || "";

    shadow.innerHTML = `
      <style>
        :host { display: block; font-family: sans-serif; }
        .toolbar {
          display: flex; flex-wrap: wrap; gap: 2px;
          padding: 6px 8px; background: #f3f4f6;
          border: 1px solid #d1d5db; border-bottom: none;
          border-radius: 8px 8px 0 0;
        }
        button {
          background: none; border: 1px solid transparent; border-radius: 4px;
          padding: 3px 7px; cursor: pointer; font-size: 13px; color: #374151;
          min-width: 28px; line-height: 1.4;
        }
        button:hover { background: #e5e7eb; border-color: #d1d5db; }
        button.active { background: #dbeafe; border-color: #93c5fd; color: #1d4ed8; }
        .sep { width: 1px; background: #d1d5db; margin: 2px 4px; }
        .editor {
          min-height: var(--editor-height, 160px);
          padding: 10px 14px;
          border: 1px solid #d1d5db; border-radius: 0 0 8px 8px;
          outline: none; overflow-y: auto;
          font-size: 14px; line-height: 1.6; color: #111827;
          background: #fff;
        }
        .editor:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,.15); }
        .editor:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af; pointer-events: none;
        }
        a { color: #2563eb; }
      </style>
      <div class="toolbar">
        <button data-cmd="bold"        title="Bold"><b>B</b></button>
        <button data-cmd="italic"      title="Italic"><i>I</i></button>
        <button data-cmd="underline"   title="Underline"><u>U</u></button>
        <button data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
        <div class="sep"></div>
        <button data-cmd="h1"  title="Heading 1">H1</button>
        <button data-cmd="h2"  title="Heading 2">H2</button>
        <button data-cmd="h3"  title="Heading 3">H3</button>
        <div class="sep"></div>
        <button data-cmd="insertUnorderedList" title="Bullet list">&#8226; List</button>
        <button data-cmd="insertOrderedList"   title="Numbered list">1. List</button>
        <button data-cmd="indent"   title="Indent">&#8677;</button>
        <button data-cmd="outdent"  title="Outdent">&#8676;</button>
        <div class="sep"></div>
        <button data-cmd="justifyLeft"   title="Align left">&#8676;L</button>
        <button data-cmd="justifyCenter" title="Align center">&#8596;C</button>
        <button data-cmd="justifyRight"  title="Align right">R&#8677;</button>
        <div class="sep"></div>
        <button data-cmd="createLink" title="Insert link">&#128279;</button>
        <button data-cmd="unlink"     title="Remove link">&#128279;&#x20E0;</button>
        <div class="sep"></div>
        <button data-cmd="removeFormat" title="Clear formatting">&#215; Format</button>
      </div>
      <div class="editor" contenteditable="true" data-placeholder="${placeholder}">${initial}</div>`;

    const editor  = shadow.querySelector(".editor");
    const buttons = shadow.querySelectorAll("button[data-cmd]");

    // Toolbar clicks
    buttons.forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep editor focused
        const cmd = btn.dataset.cmd;
        if (cmd === "h1" || cmd === "h2" || cmd === "h3") {
          document.execCommand("formatBlock", false, cmd);
        } else if (cmd === "createLink") {
          const url = prompt("Enter URL:");
          if (url) document.execCommand("createLink", false, url);
        } else {
          document.execCommand(cmd, false, null);
        }
        this._updateActiveStates(shadow);
        this._dispatch(editor);
      });
    });

    // Update active states & emit on edits
    editor.addEventListener("keyup",   () => { this._updateActiveStates(shadow); this._dispatch(editor); });
    editor.addEventListener("mouseup", () => this._updateActiveStates(shadow));
    editor.addEventListener("input",   () => this._dispatch(editor));
  }

  _updateActiveStates(shadow) {
    shadow.querySelectorAll("button[data-cmd]").forEach((btn) => {
      const cmd = btn.dataset.cmd;
      if (["h1","h2","h3"].includes(cmd)) {
        const node = window.getSelection()?.anchorNode;
        const block = node?.nodeType === 3 ? node.parentElement : node;
        btn.classList.toggle("active", block?.tagName?.toLowerCase() === cmd);
      } else {
        try { btn.classList.toggle("active", document.queryCommandState(cmd)); } catch {}
      }
    });
  }

  _dispatch(editor) {
    this.dispatchEvent(new CustomEvent("change", {
      bubbles: true, composed: true,
      detail: { html: editor.innerHTML, text: editor.innerText },
    }));
  }

  getValue() {
    return this.shadowRoot?.querySelector(".editor")?.innerHTML ?? "";
  }

  setValue(html) {
    const editor = this.shadowRoot?.querySelector(".editor");
    if (editor) editor.innerHTML = html;
  }
}

customElements.define("rich-text", RichText);
