const fs = require('fs');
const path = require('path');

const EMBED_BOT_RES = [
  /discordbot/i,
  /twitterbot/i,
  /facebookexternalhit/i,
  /slackbot/i,
  /linkedinbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /pinterest/i,
  /skypeuripreview/i,
  /vkshare/i,
  /redditbot/i,
  /embedly/i,
  /iframely/i,
  /opengraph/i,
];

function isEmbedBot(ua) {
  if (!ua) return false;
  return EMBED_BOT_RES.some((re) => re.test(ua));
}

function isInlineVisualMime(mime) {
  if (!mime) return false;
  if (mime.startsWith('image/')) return true;
  if (mime.startsWith('video/')) return true;
  return false;
}

function canOpenInBrowser(mime) {
  if (!mime) return false;
  if (mime === 'application/pdf') return true;
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json' || mime === 'application/javascript') return true;
  return false;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function streamMediaFile(res, filePath, mediaFile, inline) {
  res.setHeader('Content-Type', mediaFile.mime_type || 'application/octet-stream');
  res.setHeader('Content-Length', mediaFile.file_size);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const disp = inline ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disp}; filename="${encodeURIComponent(mediaFile.original_name)}"`);
  return fs.createReadStream(filePath).pipe(res);
}

function buildOgTags(mediaFile, rawUrl) {
  const mime = mediaFile.mime_type || '';
  const title = escapeHtml(mediaFile.original_name);
  if (mime.startsWith('image/')) {
    return `
    <meta property="og:type" content="website">
    <meta property="og:title" content="${title}">
    <meta property="og:image" content="${rawUrl}">
    <meta property="og:image:type" content="${escapeHtml(mime)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${rawUrl}">`;
  }
  if (mime.startsWith('video/')) {
    return `
    <meta property="og:type" content="video.other">
    <meta property="og:title" content="${title}">
    <meta property="og:video:url" content="${rawUrl}">
    <meta property="og:video:type" content="${escapeHtml(mime)}">
    <meta name="twitter:card" content="player">
    <meta name="twitter:player" content="${rawUrl}">`;
  }
  return `
    <meta property="og:type" content="website">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="Shared file — ClickDep">
    <meta name="twitter:card" content="summary">`;
}

function sendOgHtml(res, mediaFile, rawUrl) {
  const og = buildOgTags(mediaFile, rawUrl);
  const title = escapeHtml(mediaFile.original_name);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${og}
</head>
<body></body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.send(html);
}

function sendFilePreviewHtml(res, mediaFile, rawUrl) {
  const title = escapeHtml(mediaFile.original_name);
  const mime = mediaFile.mime_type || '';
  const open = canOpenInBrowser(mime);
  const iframe = open
    ? `<iframe src="${rawUrl}" title="${title}" style="width:min(900px,100%);height:70vh;border:1px solid var(--b,#333);border-radius:8px;background:#111"></iframe>`
    : `<div style="padding:32px;font:500 1rem system-ui;color:#888">Preview not available for this type. Use Download or Open.</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0d0d12;color:#e8e8ef;font-family:system-ui,sans-serif;padding:24px;box-sizing:border-box}
    .card{max-width:920px;width:100%;text-align:center}
    h1{font-size:1rem;font-weight:600;margin:0 0 20px;word-break:break-all;opacity:.95}
    .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:20px}
    a.btn{display:inline-block;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600}
    a.primary{background:#6c5ce7;color:#fff}
    a.ghost{background:#2a2a35;color:#e8e8ef;border:1px solid #444}
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    ${iframe}
    <div class="actions">
      <a class="btn primary" href="${rawUrl}?download=1" download>Download</a>
      ${open ? `<a class="btn ghost" href="${rawUrl}" target="_blank" rel="noopener">Open in new tab</a>` : ''}
    </div>
  </div>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.send(html);
}

/**
 * Serves media on a slug subdomain. /raw streams bytes; / is OG for bots, visual inline for humans, or preview HTML for other files.
 */
function handleMediaSubdomain(req, res, mediaFile, subdomain, getBaseDomain, dataDir) {
  const mediaDir = path.join(dataDir, 'media');
  const filePath = path.join(mediaDir, mediaFile.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

  const baseDomain = getBaseDomain();
  const host = baseDomain ? `${subdomain}.${baseDomain}` : subdomain;
  const rawUrl = `https://${host}/raw`;

  const pathname = (req.path || '/').split('?')[0] || '/';
  const isRaw = pathname === '/raw' || pathname.startsWith('/raw/');
  const forceDownload = req.query.download === '1' || req.query.download === 'true';
  const ua = req.headers['user-agent'] || '';

  if (isEmbedBot(ua) && !isRaw) {
    return sendOgHtml(res, mediaFile, rawUrl);
  }

  if (isRaw) {
    if (forceDownload) {
      res.setHeader('Content-Type', mediaFile.mime_type || 'application/octet-stream');
      res.setHeader('Content-Length', mediaFile.file_size);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(mediaFile.original_name)}"`);
      return fs.createReadStream(filePath).pipe(res);
    }
    return streamMediaFile(res, filePath, mediaFile, true);
  }

  if (isInlineVisualMime(mediaFile.mime_type)) {
    return streamMediaFile(res, filePath, mediaFile, true);
  }

  return sendFilePreviewHtml(res, mediaFile, rawUrl);
}

module.exports = {
  handleMediaSubdomain,
  isEmbedBot,
};
