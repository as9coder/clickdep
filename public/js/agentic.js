var AgenticCode=(()=>{var d=Object.defineProperty;var w=Object.getOwnPropertyDescriptor;var f=Object.getOwnPropertyNames;var x=Object.prototype.hasOwnProperty;var L=(t,e)=>{for(var i in e)d(t,i,{get:e[i],enumerable:!0})},T=(t,e,i,r)=>{if(e&&typeof e=="object"||typeof e=="function")for(let s of f(e))!x.call(t,s)&&s!==i&&d(t,s,{get:()=>e[s],enumerable:!(r=w(e,s))||r.enumerable});return t};var E=t=>T(d({},"__esModule",{value:!0}),t);var S={};L(S,{mount:()=>A});function u(t){let e=k(t.slice(0,200)||"your idea"),i=H(t);return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; }
    body {
      font-family: system-ui, sans-serif;
      min-height: 100vh;
      background: linear-gradient(145deg, hsl(${i}, 35%, 12%), hsl(${(i+40)%360}, 30%, 8%));
      color: #e8eaef;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      max-width: 420px;
      width: 100%;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 28px;
      backdrop-filter: blur(8px);
    }
    h1 { font-size: 1.35rem; font-weight: 600; margin-bottom: 12px; }
    p { opacity: 0.85; line-height: 1.55; font-size: 0.95rem; }
    .tag { display: inline-block; margin-top: 16px; font-size: 0.75rem; opacity: 0.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Preview build</h1>
    <p>This is a <strong>demo</strong> shell. Your prompt was understood as:</p>
    <p style="margin-top:12px;font-style:italic;opacity:0.9">\u201C${e}\u201D</p>
    <span class="tag">Production agent + deploy will plug in here.</span>
  </div>
</body>
</html>`}function k(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function H(t){let e=0;for(let i=0;i<t.length;i++)e=Math.imul(31,e)+t.charCodeAt(i)|0;return Math.abs(e)%360}var M=["A landing page for a coffee roastery with hero, menu section, and contact form.","A minimal dashboard with sidebar, KPI cards, and a chart placeholder.","A portfolio site with project grid and dark theme.","A single-page calculator with keyboard support."];function h(t){t.innerHTML="",t.classList.add("agentic-page");let e=document.createElement("div");e.className="agentic-root",e.innerHTML=`
    <div class="agentic-hero">
      <div class="agentic-badge">Agentic \xB7 Frontend preview</div>
      <h1 class="agentic-title">Build a web app from one prompt</h1>
      <p class="agentic-sub">
        Describe what you want. The full pipeline will generate production-ready UI in one shot \u2014 this screen is the composer + live preview shell.
      </p>
    </div>

    <div class="agentic-layout">
      <section class="agentic-panel agentic-panel--prompt" aria-labelledby="agentic-prompt-label">
        <label id="agentic-prompt-label" class="agentic-label">Prompt</label>
        <textarea
          id="agentic-prompt"
          class="agentic-textarea"
          rows="10"
          placeholder="Example: A responsive pricing page with three tiers, FAQ accordion, and a sticky header with logo."
          spellcheck="true"
        ></textarea>

        <div class="agentic-presets" role="group" aria-label="Quick prompts">
          <span class="agentic-presets-label">Try</span>
          <div id="agentic-chips" class="agentic-chips"></div>
        </div>

        <div class="agentic-actions">
          <button type="button" id="agentic-generate" class="btn btn-primary agentic-btn-primary">
            <span class="agentic-btn-text">Generate web app</span>
            <span class="agentic-btn-spinner hidden" aria-hidden="true"></span>
          </button>
          <button type="button" id="agentic-clear" class="btn btn-ghost">Clear</button>
        </div>
        <p class="agentic-hint text-sm text-muted">Backend + real model wiring comes next. For now, preview uses a safe demo HTML shell.</p>
      </section>

      <section class="agentic-panel agentic-panel--preview" aria-labelledby="agentic-preview-label">
        <div class="agentic-preview-header">
          <h2 id="agentic-preview-label" class="agentic-preview-title">Live preview</h2>
          <span id="agentic-status" class="agentic-status agentic-status--idle">Idle</span>
        </div>
        <div id="agentic-frame-wrap" class="agentic-preview-frame-wrap">
          <iframe
            id="agentic-iframe"
            class="agentic-iframe"
            title="Generated app preview"
            sandbox="allow-same-origin"
          ></iframe>
          <div id="agentic-empty" class="agentic-empty">
            <div class="agentic-empty-icon">\u25C7</div>
            <p>Run a prompt to render a one-shot preview here.</p>
          </div>
        </div>
      </section>
    </div>
  `,t.appendChild(e);let i=e.querySelector("#agentic-prompt"),r=e.querySelector("#agentic-generate"),s=e.querySelector("#agentic-clear"),o=e.querySelector("#agentic-iframe"),c=e.querySelector("#agentic-frame-wrap"),l=e.querySelector("#agentic-status"),b=e.querySelector("#agentic-chips"),v=e.querySelector(".agentic-btn-text"),y=e.querySelector(".agentic-btn-spinner");M.forEach(a=>{let n=document.createElement("button");n.type="button",n.className="agentic-chip",n.textContent=a.length>48?`${a.slice(0,46)}\u2026`:a,n.title=a,n.addEventListener("click",()=>{i.value=a,i.focus()}),b.appendChild(n)});let p=null,g=a=>{r.disabled=a,s.disabled=a,i.disabled=a,v.classList.toggle("hidden",a),y.classList.toggle("hidden",!a);let n=c.classList.contains("agentic-preview-frame-wrap--ready");l.textContent=a?"Generating\u2026":n?"Ready":"Idle",l.className=`agentic-status ${a?"agentic-status--busy":n?"agentic-status--ready":"agentic-status--idle"}`},m=()=>{let a=i.value.trim();if(!a){window.App?.toast?.("Enter a prompt first","warning"),i.focus();return}g(!0),c.classList.remove("agentic-preview-frame-wrap--ready"),o.srcdoc="",p=setTimeout(()=>{let n=u(a);o.srcdoc=n,c.classList.add("agentic-preview-frame-wrap--ready"),g(!1),window.App?.toast?.("Preview generated (demo shell)","success")},900)};return r.addEventListener("click",m),s.addEventListener("click",()=>{i.value="",o.srcdoc="",c.classList.remove("agentic-preview-frame-wrap--ready"),l.textContent="Idle",l.className="agentic-status agentic-status--idle"}),i.addEventListener("keydown",a=>{(a.ctrlKey||a.metaKey)&&a.key==="Enter"&&(a.preventDefault(),m())}),()=>{p&&clearTimeout(p),t.classList.remove("agentic-page"),t.innerHTML=""}}var A=h;return E(S);})();
//# sourceMappingURL=agentic.js.map
