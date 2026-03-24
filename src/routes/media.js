const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { stmts, DATA_DIR } = require('../db');

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const MAX_UPLOAD = 500 * 1024 * 1024; // 500MB — videos / large files

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const bid = req._bucketId;
    if (!bid) return cb(new Error('bucketId missing'));
    const dir = path.join(MEDIA_DIR, bid);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD },
});

function embedUrlForSlug(slug, baseDomain, originalName) {
  if (!baseDomain) return slug;
  const root = `https://${slug}.${baseDomain}/`;
  return root;
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

// ─── Upload (multipart file; bucketId required as query — parsed before multer destination) ─────

router.post('/upload', (req, res, next) => {
  const bucketId = req.query && req.query.bucketId;
  if (!bucketId || typeof bucketId !== 'string') {
    return res.status(400).json({ error: 'Select a bucket and pass bucketId as a query parameter (e.g. ?bucketId=…).' });
  }
  const bucket = stmts.getBucket.get(String(bucketId).trim());
  if (!bucket) {
    return res.status(400).json({ error: 'Invalid or unknown bucket.' });
  }
  req._bucketId = bucket.id;
  next();
}, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const bucket = stmts.getBucket.get(req._bucketId);
    if (!bucket) return res.status(400).json({ error: 'Bucket missing.' });

    const relPath = path.join(bucket.id, req.file.filename);
    const id = uuidv4();
    const slug = generateMediaSlug(bucket.name, req.file.originalname);

    stmts.insertMedia.run(
      id,
      slug,
      req.file.originalname,
      req.file.mimetype || 'application/octet-stream',
      req.file.size,
      relPath,
      'embed',
      bucket.id
    );

    const media = stmts.getMediaById.get(id);
    const baseDomain = getBaseDomainValue();

    res.json({
      ...media,
      embed_url: embedUrlForSlug(slug, baseDomain, req.file.originalname),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large. Maximum size is ${MAX_UPLOAD / (1024 * 1024)}MB.` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

router.get('/', (req, res) => {
  try {
    const files = stmts.getAllMedia.all();
    const stats = stmts.countMedia.get();
    const baseDomain = getBaseDomainValue();

    const enriched = files.map((f) => ({
      ...f,
      embed_url: embedUrlForSlug(f.slug, baseDomain, f.original_name),
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
