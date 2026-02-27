/**
 * AES-256-GCM encryption for storing sensitive data (env_vars) in the database.
 * The key is derived from a server-side secret stored in an env var or auto-generated
 * and persisted in the data directory — it is NEVER stored in the database itself.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, '..', 'data', '.encryption_key');
const ALGORITHM = 'aes-256-gcm';

// Load or generate the 256-bit encryption key
function loadKey() {
    // Prefer env var (for production)
    if (process.env.CLICKDEP_ENCRYPTION_KEY) {
        const k = Buffer.from(process.env.CLICKDEP_ENCRYPTION_KEY, 'hex');
        if (k.length === 32) return k;
    }

    // Fall back to key file in data directory
    if (fs.existsSync(KEY_FILE)) {
        return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
    }

    // Auto-generate and persist
    const key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
    console.log('[ClickDep] Generated new encryption key at', KEY_FILE);
    return key;
}

const KEY = loadKey();

/**
 * Encrypts a plain text string using AES-256-GCM.
 * Returns a prefixed string: "enc:iv:authTag:ciphertext" (all hex-encoded).
 */
function encrypt(plaintext) {
    if (!plaintext) return plaintext;

    // Don't double-encrypt
    if (typeof plaintext === 'string' && plaintext.startsWith('enc:')) return plaintext;

    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a string previously encrypted with encrypt().
 * Returns the original plaintext. Returns the input unchanged if not encrypted.
 */
function decrypt(ciphertext) {
    if (!ciphertext || !ciphertext.startsWith('enc:')) return ciphertext;

    try {
        const parts = ciphertext.split(':');
        if (parts.length !== 4) return '';

        const iv = Buffer.from(parts[1], 'hex');
        const authTag = Buffer.from(parts[2], 'hex');
        const encrypted = Buffer.from(parts[3], 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);

        return decrypted.toString('utf8');
    } catch (e) {
        // Auth tag mismatch = tampered data
        console.error('[ClickDep] Encryption: failed to decrypt (data may be tampered)');
        return '';
    }
}

module.exports = { encrypt, decrypt };
