const fs = require('fs');
const path = require('path');

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (name === '.' || name === '..') continue;
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function rmRecursive(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

/** Resolve rel path under root; throws if escapes. */
function safePath(root, relPath) {
  const rootAbs = path.resolve(root);
  const joined = path.resolve(rootAbs, path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!joined.startsWith(rootAbs + path.sep) && joined !== rootAbs) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return joined;
}

module.exports = { copyRecursive, rmRecursive, safePath };
