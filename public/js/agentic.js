var AgenticCode=(()=>{var k=Object.defineProperty;var M=Object.getOwnPropertyDescriptor;var j=Object.getOwnPropertyNames;var _=Object.prototype.hasOwnProperty;var $=(n,t)=>{for(var s in t)k(n,s,{get:t[s],enumerable:!0})},I=(n,t,s,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of j(t))!_.call(n,a)&&a!==s&&k(n,a,{get:()=>t[a],enumerable:!(i=M(t,a))||i.enumerable});return n};var N=n=>I(k({},"__esModule",{value:!0}),n);var K={};$(K,{mount:()=>B});async function T(n,t,s){let i=localStorage.getItem("clickdep_token")||"",a=await fetch(`/api/agent/sessions/${encodeURIComponent(n)}/chat`,{method:"POST",headers:{"Content-Type":"application/json",...i?{Authorization:`Bearer ${i}`}:{}},body:JSON.stringify({message:t})});if(!a.ok){let c=a.statusText;try{let l=await a.json();l.error&&(c=l.error)}catch{}throw new Error(c)}let h=a.body?.getReader();if(!h)throw new Error("No response body");let w=new TextDecoder,g="";for(;;){let{done:c,value:l}=await h.read();if(c)break;g+=w.decode(l,{stream:!0});let y=g.split(`

`);g=y.pop()??"";for(let S of y){let r=S.split(`
`);for(let m of r){if(!m.startsWith("data: "))continue;let p=m.slice(6).trim();if(p)try{let v=JSON.parse(p);s(v)}catch{}}}}if(g.trim())for(let c of g.split(`
`)){if(!c.startsWith("data: "))continue;let l=c.slice(6).trim();if(l)try{s(JSON.parse(l))}catch{}}}var P=["Scaffold a Vite + React + TypeScript app with a clean landing page and deploy it to ClickDep.","Build a single-page dashboard with a sidebar, three KPI cards, and a placeholder chart area.","Create a static HTML/CSS portfolio with dark theme and responsive grid."],b="clickdep_agentic_session";async function q(n){let t=localStorage.getItem("clickdep_token")||"",s=await fetch(n,{headers:{...t?{Authorization:`Bearer ${t}`}:{}}}),i=await s.json();if(!s.ok)throw new Error(i.error||"Request failed");return i}async function O(n,t){let s=localStorage.getItem("clickdep_token")||"",i=await fetch(n,{method:"PUT",headers:{"Content-Type":"application/json",...s?{Authorization:`Bearer ${s}`}:{}},body:JSON.stringify(t)}),a=await i.json();if(!i.ok)throw new Error(a.error||"Request failed")}async function L(n,t){let s=localStorage.getItem("clickdep_token")||"",i=await fetch(n,{method:"POST",headers:{"Content-Type":"application/json",...s?{Authorization:`Bearer ${s}`}:{}},body:t?JSON.stringify(t):void 0}),a=await i.json();if(!i.ok)throw new Error(a.error||"Request failed");return a}function d(n){let t=document.createElement("div");return t.textContent=n,t.innerHTML}function R(n){try{let t=JSON.stringify(n,null,2);return t.length>4e3?t.slice(0,4e3)+`
\u2026`:t}catch{return String(n)}}function A(n){n.innerHTML="",n.classList.add("agentic-page");let t=document.createElement("div");t.className="agentic-root agentic-root--full",t.innerHTML=`
    <div class="agentic-hero">
      <div class="agentic-badge">Agentic Code \xB7 OpenRouter</div>
      <h1 class="agentic-title">Build &amp; deploy web apps with an agent</h1>
      <p class="agentic-sub">
        Filesystem, shell, background jobs, web search, and one-click deploy to Web Hosting (same dashboard as manual deploys). Configure your OpenRouter key below.
      </p>
    </div>

    <div class="agentic-config settings-card" id="agentic-config">
      <h3 class="agentic-label">OpenRouter</h3>
      <div class="agentic-config-row">
        <div class="form-group" style="flex:1;min-width:200px;margin:0">
          <label>API key</label>
          <input type="password" id="agentic-api-key" placeholder="sk-or-..." autocomplete="off">
        </div>
        <div class="form-group" style="flex:1;min-width:200px;margin:0">
          <label>Model</label>
          <input type="text" id="agentic-model" placeholder="minimax/minimax-m2.7">
        </div>
        <button type="button" class="btn btn-primary" id="agentic-save-config" style="height:42px;align-self:flex-end">Save</button>
      </div>
      <p id="agentic-config-status" class="text-sm text-muted" style="margin-top:8px"></p>
    </div>

    <div class="agentic-toolbar">
      <button type="button" class="btn btn-ghost btn-sm" id="agentic-new-session">New session</button>
      <span id="agentic-session-label" class="text-sm text-muted mono"></span>
      <a href="#/hosting" class="btn btn-ghost btn-sm" style="margin-left:auto">Web Hosting</a>
    </div>

    <div class="agentic-chat-wrap">
      <div id="agentic-log" class="agentic-log" aria-live="polite"></div>
    </div>

    <div class="agentic-compose">
      <label class="agentic-label" for="agentic-input">Message</label>
      <textarea id="agentic-input" class="agentic-textarea agentic-input-main" rows="4" placeholder="Describe what to build, or ask the agent to run deploy_to_clickdep with a project_name when ready\u2026"></textarea>
      <div class="agentic-presets" style="margin-top:10px">
        <span class="agentic-presets-label">Try</span>
        <div id="agentic-chips" class="agentic-chips"></div>
      </div>
      <div class="agentic-actions" style="margin-top:12px">
        <button type="button" id="agentic-send" class="btn btn-primary">Send</button>
        <span class="text-xs text-muted">Ctrl+Enter to send</span>
      </div>
    </div>
  `,n.appendChild(t);let s=t.querySelector("#agentic-log"),i=t.querySelector("#agentic-input"),a=t.querySelector("#agentic-send"),h=t.querySelector("#agentic-new-session"),w=t.querySelector("#agentic-session-label"),g=t.querySelector("#agentic-save-config"),c=t.querySelector("#agentic-api-key"),l=t.querySelector("#agentic-model"),y=t.querySelector("#agentic-config-status"),S=t.querySelector("#agentic-chips");P.forEach(e=>{let o=document.createElement("button");o.type="button",o.className="agentic-chip",o.textContent=e.length>52?`${e.slice(0,50)}\u2026`:e,o.title=e,o.addEventListener("click",()=>{i.value=e,i.focus()}),S.appendChild(o)});let r=localStorage.getItem(b),m=!1,p=()=>{w.textContent=r?`Session: ${r.slice(0,8)}\u2026`:"No session"};p();let v=async()=>{try{let e=await q("/api/agent/config");y.textContent=e.hasKey?`Key saved (${e.keyHint||"****"}). Model: ${e.model}`:"Add an API key from openrouter.ai",l.value=e.model||"minimax/minimax-m2.7"}catch(e){y.textContent=e.message}};v(),g.addEventListener("click",async()=>{try{await O("/api/agent/config",{apiKey:c.value.trim(),model:l.value.trim()||"minimax/minimax-m2.7"}),c.value="",window.App?.toast?.("Settings saved","success"),await v()}catch(e){window.App?.toast?.(e.message,"error")}});let H=async()=>r||(r=(await L("/api/agent/sessions",{title:"Agentic"})).id,localStorage.setItem(b,r),p(),r),u=e=>{let o=document.createElement("div");o.className="agentic-msg-block",o.innerHTML=e,s.appendChild(o),s.scrollTop=s.scrollHeight},C=e=>{if(e.type==="assistant")u(`<div class="agentic-msg agentic-msg--assistant"><div class="agentic-msg-role">Agent</div><pre class="agentic-msg-body">${d(e.content||"")}</pre></div>`);else if(e.type==="tool_start")u(`<div class="agentic-msg agentic-msg--tool"><div class="agentic-msg-role">Tool \xB7 ${d(e.name)}</div><div class="agentic-msg-meta mono">${d(e.args_preview||"")}</div></div>`);else if(e.type==="tool_end"){let o=R(e.result),f="";if(e.result&&typeof e.result=="object"&&e.result!==null&&"project_id"in e.result){let x=e.result.project_id;x&&(f=`<p class="agentic-deploy-link"><a href="#/project/${x}">Open in Web Hosting \u2192</a></p>`)}u(`<div class="agentic-msg agentic-msg--toolresult"><div class="agentic-msg-role">Result \xB7 ${d(e.name)}</div><pre class="agentic-msg-body agentic-msg-json">${d(o)}</pre>${f}</div>`)}else e.type==="error"&&u(`<div class="agentic-msg agentic-msg--error">${d(e.message)}</div>`)},E=async()=>{let e=i.value.trim();if(!(!e||m)){m=!0,a.disabled=!0,u(`<div class="agentic-msg agentic-msg--user"><div class="agentic-msg-role">You</div><pre class="agentic-msg-body">${d(e)}</pre></div>`),i.value="";try{let o=await H();await T(o,e,f=>{f.type!=="done"&&C(f)})}catch(o){u(`<div class="agentic-msg agentic-msg--error">${d(o.message)}</div>`)}finally{m=!1,a.disabled=!1}}};return a.addEventListener("click",()=>void E()),i.addEventListener("keydown",e=>{(e.ctrlKey||e.metaKey)&&e.key==="Enter"&&(e.preventDefault(),E())}),h.addEventListener("click",async()=>{if(confirm("Start a new session? Current thread is left on the server.")){r=null,localStorage.removeItem(b),p(),s.innerHTML="";try{r=(await L("/api/agent/sessions",{title:"Agentic"})).id,localStorage.setItem(b,r),p(),window.App?.toast?.("New session","success")}catch(e){window.App?.toast?.(e.message,"error")}}}),()=>{n.classList.remove("agentic-page"),n.innerHTML=""}}var B=A;return N(K);})();
//# sourceMappingURL=agentic.js.map
