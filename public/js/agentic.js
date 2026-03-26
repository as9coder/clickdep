var AgenticCode=(()=>{var x=Object.defineProperty;var R=Object.getOwnPropertyDescriptor;var O=Object.getOwnPropertyNames;var W=Object.prototype.hasOwnProperty;var B=(n,t)=>{for(var i in t)x(n,i,{get:t[i],enumerable:!0})},D=(n,t,i,a)=>{if(t&&typeof t=="object"||typeof t=="function")for(let r of O(t))!W.call(n,r)&&r!==i&&x(n,r,{get:()=>t[r],enumerable:!(a=R(t,r))||a.enumerable});return n};var J=n=>D(x({},"__esModule",{value:!0}),n);var Q={};B(Q,{mount:()=>G});async function $(n,t,i){let a=localStorage.getItem("clickdep_token")||"",r=await fetch(`/api/agent/sessions/${encodeURIComponent(n)}/chat`,{method:"POST",headers:{"Content-Type":"application/json",...a?{Authorization:`Bearer ${a}`}:{}},body:JSON.stringify({message:t})});if(!r.ok){let d=r.statusText;try{let o=await r.json();o.error&&(d=o.error)}catch{}throw new Error(d)}let w=r.body?.getReader();if(!w)throw new Error("No response body");let S=new TextDecoder,y="";for(;;){let{done:d,value:o}=await w.read();if(d)break;y+=S.decode(o,{stream:!0});let p=y.split(`

`);y=p.pop()??"";for(let L of p){let k=L.split(`
`);for(let T of k){if(!T.startsWith("data: "))continue;let m=T.slice(6).trim();if(m)try{let c=JSON.parse(m);i(c)}catch{}}}}if(y.trim())for(let d of y.split(`
`)){if(!d.startsWith("data: "))continue;let o=d.slice(6).trim();if(o)try{i(JSON.parse(o))}catch{}}}var U=["A landing page for a coffee roastery with hero, menu section, and contact form.","A minimal dashboard with sidebar, KPI cards, and a chart placeholder.","A portfolio site with project grid and dark theme.","A single-page calculator with keyboard support."],A="clickdep_agentic_session";async function z(n){let t=localStorage.getItem("clickdep_token")||"",i=await fetch(n,{headers:{...t?{Authorization:`Bearer ${t}`}:{}}}),a=await i.json();if(!i.ok)throw new Error(a.error||"Request failed");return a}async function I(n,t){let i=localStorage.getItem("clickdep_token")||"",a=await fetch(n,{method:"POST",headers:{"Content-Type":"application/json",...i?{Authorization:`Bearer ${i}`}:{}},body:t?JSON.stringify(t):void 0}),r=await a.json();if(!a.ok)throw new Error(r.error||"Request failed");return r}function u(n){let t=document.createElement("div");return t.textContent=n,t.innerHTML}function K(n){try{let t=JSON.stringify(n,null,2);return t.length>4e3?t.slice(0,4e3)+`
\u2026`:t}catch{return String(n)}}function F(n){if(n.status!=="running"||!n.port)return null;let t=window.App?.baseDomain;return t?`http://${n.name}.${t}/`:`http://localhost:${n.port}/`}function P(n){n.innerHTML="",n.classList.add("agentic-page");let t=document.createElement("div");t.className="agentic-root",t.innerHTML=`
    <div class="agentic-hero">
      <div class="agentic-badge">Agentic \xB7 OpenRouter</div>
      <h1 class="agentic-title">Build a web app from one prompt</h1>
      <p class="agentic-sub">
        Describe what you want; the agent edits an isolated workspace, runs commands, and can deploy to Web Hosting.
        Configure your <strong>OpenRouter API key</strong> and <strong>model</strong> in
        <a href="#/settings">Settings</a>.
      </p>
    </div>

    <div class="agentic-toolbar">
      <button type="button" class="btn btn-ghost btn-sm" id="agentic-new-session">New session</button>
      <span id="agentic-session-label" class="text-sm text-muted mono"></span>
      <a href="#/hosting" class="btn btn-ghost btn-sm" style="margin-left:auto">Web Hosting</a>
    </div>

    <div class="agentic-layout">
      <section class="agentic-panel agentic-panel--prompt" aria-labelledby="agentic-prompt-label">
        <div class="agentic-chat-scroll">
          <div id="agentic-log" class="agentic-log" aria-live="polite"></div>
        </div>
        <label id="agentic-prompt-label" class="agentic-label" for="agentic-input">Message</label>
        <textarea
          id="agentic-input"
          class="agentic-textarea agentic-input-main"
          rows="8"
          placeholder="Example: Scaffold a static site and deploy it with deploy_to_clickdep when ready."
          spellcheck="true"
        ></textarea>
        <div class="agentic-presets" role="group" aria-label="Quick prompts">
          <span class="agentic-presets-label">Try</span>
          <div id="agentic-chips" class="agentic-chips"></div>
        </div>
        <div class="agentic-actions">
          <button type="button" id="agentic-send" class="btn btn-primary agentic-btn-primary">
            <span class="agentic-btn-text">Send</span>
            <span class="agentic-btn-spinner hidden" aria-hidden="true"></span>
          </button>
          <button type="button" id="agentic-clear" class="btn btn-ghost">Clear</button>
        </div>
        <p class="agentic-hint text-sm text-muted">
          After a successful deploy, the live site can appear in the preview when the container is running.
        </p>
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
            title="Deployed site preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          ></iframe>
          <div id="agentic-empty" class="agentic-empty">
            <div class="agentic-empty-icon">\u25C7</div>
            <p id="agentic-empty-text">Send a message to chat with the agent. After deploy, the site may load here.</p>
          </div>
        </div>
      </section>
    </div>
  `,n.appendChild(t);let i=t.querySelector("#agentic-log"),a=t.querySelector("#agentic-input"),r=t.querySelector("#agentic-send"),w=t.querySelector("#agentic-clear"),S=t.querySelector("#agentic-new-session"),y=t.querySelector("#agentic-session-label"),d=t.querySelector("#agentic-chips"),o=t.querySelector("#agentic-iframe"),p=t.querySelector("#agentic-frame-wrap"),L=t.querySelector("#agentic-status"),k=t.querySelector(".agentic-btn-text"),T=t.querySelector(".agentic-btn-spinner"),m=t.querySelector("#agentic-empty-text");U.forEach(e=>{let s=document.createElement("button");s.type="button",s.className="agentic-chip",s.textContent=e.length>48?`${e.slice(0,46)}\u2026`:e,s.title=e,s.addEventListener("click",()=>{a.value=e,a.focus()}),d.appendChild(s)});let c=localStorage.getItem(A),H=!1,b=null,E=()=>{y.textContent=c?`Session: ${c.slice(0,8)}\u2026`:"No session"};E();let g=(e,s)=>{let l={idle:"Idle",busy:"Working\u2026",ready:"Live",pending:"Waiting for deploy\u2026"};L.textContent=s||l[e];let h=e==="ready"?"agentic-status--ready":e==="busy"||e==="pending"?"agentic-status--busy":"agentic-status--idle";L.className=`agentic-status ${h}`},f=()=>{b&&(clearInterval(b),b=null)},_=async e=>{f(),g("pending","Waiting for site\u2026"),m.textContent="Deploy queued or building \u2014 preview appears when the container is running.",p.classList.remove("agentic-preview-frame-wrap--ready"),o.removeAttribute("src");let s=async()=>{try{let h=await z(`/api/projects/${encodeURIComponent(e)}`),j=F(h);j&&(o.src=j,p.classList.add("agentic-preview-frame-wrap--ready"),g("ready"),f(),m.textContent="Send a message to chat with the agent. After deploy, the site may load here.")}catch{}};await s();let l=0;b=setInterval(()=>{l++,l>60?(f(),g("idle","Preview timeout"),m.textContent="Open the project in Web Hosting if the preview did not load (some sites block iframes)."):s()},2e3)},C=e=>{if(H=e,r.disabled=e,w.disabled=e,a.disabled=e,S.disabled=e,k.classList.toggle("hidden",e),T.classList.toggle("hidden",!e),e){g("busy");return}b?g("pending"):p.classList.contains("agentic-preview-frame-wrap--ready")?g("ready"):g("idle")},q=async()=>c||(c=(await I("/api/agent/sessions",{title:"Agentic"})).id,localStorage.setItem(A,c),E(),c),v=e=>{let s=document.createElement("div");s.className="agentic-msg-block",s.innerHTML=e,i.appendChild(s),i.scrollTop=i.scrollHeight},N=e=>{if(e.type==="assistant")v(`<div class="agentic-msg agentic-msg--assistant"><div class="agentic-msg-role">Agent</div><pre class="agentic-msg-body">${u(e.content||"")}</pre></div>`);else if(e.type==="tool_start")v(`<div class="agentic-msg agentic-msg--tool"><div class="agentic-msg-role">Tool \xB7 ${u(e.name)}</div><div class="agentic-msg-meta mono">${u(e.args_preview||"")}</div></div>`);else if(e.type==="tool_end"){let s=K(e.result),l="";if(e.result&&typeof e.result=="object"&&e.result!==null&&"project_id"in e.result){let h=e.result.project_id;h&&(l=`<p class="agentic-deploy-link"><a href="#/project/${h}">Open in Web Hosting \u2192</a></p>`,e.name==="deploy_to_clickdep"&&_(h))}v(`<div class="agentic-msg agentic-msg--toolresult"><div class="agentic-msg-role">Result \xB7 ${u(e.name)}</div><pre class="agentic-msg-body agentic-msg-json">${u(s)}</pre>${l}</div>`)}else e.type==="error"&&v(`<div class="agentic-msg agentic-msg--error">${u(e.message)}</div>`)},M=async()=>{let e=a.value.trim();if(!(!e||H)){C(!0),v(`<div class="agentic-msg agentic-msg--user"><div class="agentic-msg-role">You</div><pre class="agentic-msg-body">${u(e)}</pre></div>`),a.value="";try{let s=await q();await $(s,e,l=>{l.type!=="done"&&N(l)})}catch(s){v(`<div class="agentic-msg agentic-msg--error">${u(s.message)}</div>`)}finally{C(!1)}}};return r.addEventListener("click",()=>void M()),a.addEventListener("keydown",e=>{(e.ctrlKey||e.metaKey)&&e.key==="Enter"&&(e.preventDefault(),M())}),w.addEventListener("click",()=>{a.value="",i.innerHTML="",o.removeAttribute("src"),p.classList.remove("agentic-preview-frame-wrap--ready"),f(),g("idle"),m.textContent="Send a message to chat with the agent. After deploy, the site may load here."}),S.addEventListener("click",async()=>{if(confirm("Start a new session? Current thread is left on the server.")){c=null,localStorage.removeItem(A),E(),i.innerHTML="",a.value="",o.removeAttribute("src"),p.classList.remove("agentic-preview-frame-wrap--ready"),f(),g("idle"),m.textContent="Send a message to chat with the agent. After deploy, the site may load here.";try{c=(await I("/api/agent/sessions",{title:"Agentic"})).id,localStorage.setItem(A,c),E(),window.App?.toast?.("New session","success")}catch(e){window.App?.toast?.(e.message,"error")}}}),()=>{f(),n.classList.remove("agentic-page"),n.innerHTML=""}}var G=P;return J(Q);})();
//# sourceMappingURL=agentic.js.map
