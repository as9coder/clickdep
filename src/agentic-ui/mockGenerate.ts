/**
 * Temporary client-side preview until the real agent API exists.
 * Produces a self-contained HTML document for the sandboxed iframe.
 */
export function mockGenerateOneShot(prompt: string): string {
  const safe = escapeHtml(prompt.slice(0, 200) || 'your idea');
  const hue = hashHue(prompt);
  return `<!DOCTYPE html>
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
      background: linear-gradient(145deg, hsl(${hue}, 35%, 12%), hsl(${(hue + 40) % 360}, 30%, 8%));
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
    <p style="margin-top:12px;font-style:italic;opacity:0.9">“${safe}”</p>
    <span class="tag">Production agent + deploy will plug in here.</span>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
