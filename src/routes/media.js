const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const busboy = require('busboy');
const { pipeline } = require('stream/promises');
const { v4: uuidv4 } = require('uuid');
const { stmts, DATA_DIR } = require('../db');

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const MAX_UPLOAD = 500 * 1024 * 1024; // 500MB — videos / large files

/** Larger buffers = fewer syscalls when writing big videos to disk */
const WRITE_HWM = 4 * 1024 * 1024;
const PARSE_HWM = 1024 * 1024;

function sanitizePart(str, maxLen) {
  const s = String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
  return s || 'x';
}

function random5() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += chars[crypto.randomInt(0, chars.length)];
  return out;
}

/**
 * Host-safe slug: bucketname-filename-storage-xxxxx (DNS label ≤ 63 chars; no '=' — use -storage-).
 */
function generateMediaSlug(bucketName, originalFilename) {
  const ext = path.extname(originalFilename);
  const base = path.basename(originalFilename, ext);
  const partB = sanitizePart(bucketName, 22);
  const partF = sanitizePart(base, 28);

  for (let attempt = 0; attempt < 24; attempt++) {
    const r = random5();
    const tail = `-storage-${r}`;
    let b = partB;
    let f = partF;
    let slug = `${b}-${f}${tail}`;
    if (slug.length > 63) {
      const reserve = tail.length;
      const avail = 63 - reserve;
      const half = Math.floor(avail / 2);
      b = b.slice(0, Math.max(1, half));
      f = f.slice(0, Math.max(1, avail - b.length - 1));
      slug = `${b}-${f}${tail}`;
      if (slug.length > 63) slug = slug.slice(0, 63);
    }
    const row = stmts.getMediaBySlug.get(slug);
    if (!row) return slug;
  }
  throw new Error('Could not allocate a unique link. Try again.');
}

function embedUrlForSlug(slug, baseDomain) {
  if (!baseDomain) return slug;
  return `https://${slug}.${baseDomain}/`;
}

function getBaseDomainValue() {
  try {
    const setting = stmts.getSetting.get('base_domain');
    return setting ? setting.value : '';
  } catch (e) {
    return '';
  }
}

// ─── Buckets ─────────────────────────────────

router.post('/buckets', express.json(), (req, res) => {
  try {
    const name = (req.body && req.body.name && String(req.body.name).trim()) || '';
    if (!name || name.length > 64) {
      return res.status(400).json({ error: 'Bucket name is required (max 64 characters).' });
    }
    const dup = stmts.getBucketByName.get(name);
    if (dup) return res.status(409).json({ error: 'A bucket with this name already exists.' });

    const id = uuidv4();
    stmts.insertBucket.run(id, name);
    const row = stmts.getBucket.get(id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/buckets', (req, res) => {
  try {
    const buckets = stmts.getAllBuckets.all();
    res.json({ buckets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/buckets/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'legacy-bucket') {
      return res.status(400).json({ error: 'The Legacy bucket cannot be deleted.' });
    }
    const bucket = stmts.getBucket.get(id);
    if (!bucket) return res.status(404).json({ error: 'Bucket not found' });
    const { count } = stmts.countMediaInBucket.get(id);
    if (count > 0) {
      return res.status(400).json({ error: 'Bucket must be empty before it can be deleted.' });
    }
    stmts.deleteBucket.run(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Upload: streaming multipart (busboy + large write buffer — faster than multer for big files) ─────

router.post('/upload', (req, res) => {
  const bucketId = req.query && req.query.bucketId;
  if (!bucketId || typeof bucketId !== 'string') {
    return res.status(400).json({ error: 'Select a bucket and pass bucketId as a query parameter (e.g. ?bucketId=…).' });
  }
  const bucket = stmts.getBucket.get(String(bucketId).trim());
  if (!bucket) {
    return res.status(400).json({ error: 'Invalid or unknown bucket.' });
  }

  let bb;
  try {
    bb = busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_UPLOAD,
        files: 1,
        fields: 2,
        parts: 5,
      },
      highWaterMark: PARSE_HWM,
      fileHwm: WRITE_HWM,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  let responded = false;
  const safeJson = (status, body) => {
    if (responded) return;
    responded = true;
    res.status(status).json(body);
  };

  let fileHandled = false;
  let destPath = null;

  bb.on('file', (fieldname, fileStream, info) => {
    if (fieldname !== 'file') {
      fileStream.resume();
      return;
    }
    if (fileHandled) {
      fileStream.resume();
      return;
    }
    fileHandled = true;

    const origName = (info.filename && String(info.filename)) || 'upload.bin';
    const mime = info.mimeType || 'application/octet-stream';
    const ext = path.extname(origName).toLowerCase();
    const destName = `${crypto.randomUUID()}${ext}`;
    const dir = path.join(MEDIA_DIR, bucket.id);
    destPath = path.join(dir, destName);

    const writeStream = fs.createWriteStream(destPath, { highWaterMark: WRITE_HWM });

    fileStream.on('limit', () => {
      writeStream.destroy();
      try {
        if (destPath && fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch (e) { /* ignore */ }
      safeJson(413, { error: `File too large. Maximum size is ${MAX_UPLOAD / (1024 * 1024)}MB.` });
    });

    (async () => {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        await pipeline(fileStream, writeStream);
      } catch (e) {
        try {
          if (destPath && fs.existsSync(destPath)) fs.unlinkSync(destPath);
        } catch (e2) { /* ignore */ }
        if (!responded) safeJson(500, { error: e.message || 'Upload failed' });
        return;
      }

      const st = await fs.promises.stat(destPath);
      const slug = generateMediaSlug(bucket.name, origName);
      const id = uuidv4();
      stmts.insertMedia.run(
        id,
        slug,
        origName,
        mime,
        st.size,
        path.join(bucket.id, destName),
        'embed',
        bucket.id
      );
      const media = stmts.getMediaById.get(id);
      const baseDomain = getBaseDomainValue();
      if (!responded) {
        responded = true;
        res.json({
          ...media,
          embed_url: embedUrlForSlug(slug, baseDomain),
        });
      }
    })().catch((e) => {
      try {
        if (destPath && fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch (e2) { /* ignore */ }
      if (!responded) safeJson(500, { error: e.message || 'Upload failed' });
    });
  });

  bb.on('error', (err) => {
    if (!responded) safeJson(400, { error: err.message });
  });

  bb.on('close', () => {
    if (!fileHandled && !responded) {
      safeJson(400, { error: 'No file uploaded' });
    }
  });

  req.on('aborted', () => {
    try {
      bb.destroy();
    } catch (e) { /* ignore */ }
  });

  req.pipe(bb);
});

router.get('/', (req, res) => {
  try {
    const files = stmts.getAllMedia.all();
    const stats = stmts.countMedia.get();
    const baseDomain = getBaseDomainValue();

    const enriched = files.map((f) => ({
      ...f,
      embed_url: embedUrlForSlug(f.slug, baseDomain),
    }));

    res.json({ files: enriched, stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const media = stmts.getMediaById.get(req.params.id);
    if (!media) return res.status(404).json({ error: 'File not found' });

    const filePath = path.join(MEDIA_DIR, media.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    stmts.deleteMedia.run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
