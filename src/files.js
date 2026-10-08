'use strict';

const nodePath = require('node:path');
const nodeFs = require('node:fs/promises');
const { ToolInputError } = require('./errors');

// /v2/image/edit rejects a base64 image above this with 413 IMAGE_TOO_LARGE
// (API_V2_DOCUMENTATION.md § POST /v2/image/edit). Checking here turns a paid
// round-trip into an instant, actionable message.
const MAX_EDIT_IMAGE_B64_BYTES = 491520;

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function safeStem(stem) {
  return String(stem).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'aibuddy';
}

function createFiles({ outputDir, fs = nodeFs } = {}) {
  return {
    outputDir: outputDir || null,

    // Returns the absolute path written, or null when no output dir is configured.
    async saveBase64(base64, mimeType, stem) {
      if (!outputDir) return null;
      const dir = nodePath.resolve(outputDir);
      await fs.mkdir(dir, { recursive: true });
      const file = nodePath.join(dir, `${safeStem(stem)}.${EXT_BY_MIME[mimeType] || 'bin'}`);
      await fs.writeFile(file, Buffer.from(base64, 'base64'));
      return file;
    },

    async loadImage({ image_path: imagePath, image_base64: imageBase64, image_mime_type: mime } = {}) {
      let base64;
      let mimeType = mime;
      if (imagePath) {
        // Only image files: an agent steered by an injected prompt must not be
        // able to upload ~/.ssh/id_rsa or a .env file as the "image".
        const ext = nodePath.extname(imagePath).slice(1).toLowerCase();
        if (!MIME_BY_EXT[ext]) {
          throw new ToolInputError(`image_path must be a .png, .jpg, .jpeg, .webp or .gif file, not "${nodePath.basename(imagePath)}".`);
        }
        let buf;
        try {
          buf = await fs.readFile(nodePath.resolve(imagePath));
        } catch (err) {
          throw new ToolInputError(`Could not read image_path "${imagePath}" (${err.code || err.message}).`);
        }
        base64 = buf.toString('base64');
        if (!mimeType) mimeType = MIME_BY_EXT[ext];
      } else if (imageBase64) {
        base64 = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
      } else {
        throw new ToolInputError('Provide image_path or image_base64.');
      }
      if (base64.length > MAX_EDIT_IMAGE_B64_BYTES) {
        throw new ToolInputError(
          `Image is ${Math.round(base64.length / 1024)} KB once encoded; the limit is 480 KB. Resize to about 1024px and save as JPEG.`,
        );
      }
      return { base64, mimeType: mimeType || 'image/jpeg' };
    },
  };
}

module.exports = { createFiles, MAX_EDIT_IMAGE_B64_BYTES };
