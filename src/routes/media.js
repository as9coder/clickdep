const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { stmts, DATA_DIR } = require('../db');

const MEDIA_DIR = path.join(DATA_DIR, 'media');

// Multer config: 100MB limit, images/videos/gifs only
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, MEDIA_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${crypto.randomUUID()}${ext}`);
    }
});

const ALLOWED_MIMES = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'image/apng'
];

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIMES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} not allowed. Only images, videos, and GIFs are supported.`));
        }
    }
});

function generateSlug(originalName) {
    // Strip extension, clean up name, add random hex
    const base = path.basename(originalName, path.extname(originalName))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20);
    const hex = crypto.randomBytes(4).toString('hex');
    return `${base || 'file'}-${hex}`;
}

// Upload file
router.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const id = crypto.randomUUID();
        const slug = generateSlug(req.file.originalname);

        stmts.insertMedia.run(
            id, slug, req.file.originalname, req.file.mimetype,
            req.file.size, req.file.filename, 'embed'
        );

        const media = stmts.getMediaById.get(id);

        // Build the embed URL
        const baseDomain = (() => {
            try {
                const { stmts: s } = require('../db');
                const setting = s.getSetting.get('base_domain');
                return setting ? setting.value : '';
            } catch (e) { return ''; }
        })();

        res.json({
            ...media,
            embed_url: baseDomain ? `https://${slug}.${baseDomain}` : slug
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Multer error handler
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large. Maximum size is 100MB.' });
        }
        return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
});

// List all media
router.get('/', (req, res) => {
    try {
        const files = stmts.getAllMedia.all();
        const stats = stmts.countMedia.get();

        // Build base domain for URLs
        let baseDomain = '';
        try {
            const setting = stmts.getSetting.get('base_domain');
            baseDomain = setting ? setting.value : '';
        } catch (e) { }

        const enriched = files.map(f => ({
            ...f,
            embed_url: baseDomain ? `https://${f.slug}.${baseDomain}` : f.slug
        }));

        res.json({ files: enriched, stats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete media
router.delete('/:id', (req, res) => {
    try {
        const media = stmts.getMediaById.get(req.params.id);
        if (!media) return res.status(404).json({ error: 'File not found' });

        // Delete from disk
        const filePath = path.join(MEDIA_DIR, media.file_path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // Delete from DB
        stmts.deleteMedia.run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
