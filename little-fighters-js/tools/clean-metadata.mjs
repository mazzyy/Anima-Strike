/**
 * macOS can create AppleDouble sidecars on external/non-native filesystems.
 * Names such as ._fighter.js match JavaScript discovery patterns, but their
 * contents are binary metadata, not modules.
 *
 * Remove only files with both the sidecar name and an AppleDouble header.
 * Never follow symlinks or delete an ordinary source file based on its name.
 */
import { open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPLEDOUBLE_MAGIC = 0x00051607;
const APPLEDOUBLE_VERSIONS = new Set([0x00010000, 0x00020000]);
const HEADER_BYTES = 26;

async function isAppleDouble(path) {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await file.read(header, 0, HEADER_BYTES, 0);
    return bytesRead === HEADER_BYTES
      && header.readUInt32BE(0) === APPLEDOUBLE_MAGIC
      && APPLEDOUBLE_VERSIONS.has(header.readUInt32BE(4));
  } finally {
    await file.close();
  }
}

async function cleanDirectory(directory) {
  let removed = 0;
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      removed += await cleanDirectory(path);
    } else if (
      entry.isFile()
      && entry.name.startsWith('._')
      && await isAppleDouble(path)
    ) {
      await unlink(path);
      removed += 1;
    }
  }

  return removed;
}

// Resolve relative to this script, not the shell's working directory.
// Avoid assets, vendor libraries, node_modules, and build output.
let removed = 0;
for (const relative of ['../renderer/src/', '../electron/', '../tools/']) {
  removed += await cleanDirectory(fileURLToPath(new URL(relative, import.meta.url)));
}

if (removed > 0) {
  console.log(`Removed ${removed} AppleDouble metadata sidecar(s).`);
}
