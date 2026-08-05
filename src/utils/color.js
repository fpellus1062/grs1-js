'use strict';

function normalizeHexColor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const h = raw.slice(1).toUpperCase();
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  return null;
}

function getHexLuminance(hexColor) {
  const hex = normalizeHexColor(hexColor);
  if (!hex) return null;

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function hexToArgb(hexColor, alpha) {
  const hex = normalizeHexColor(hexColor);
  if (!hex) return null;
  return `${String(alpha || 'FF').toUpperCase()}${hex.slice(1)}`;
}

function textArgbForHexBackground(hexColor, options) {
  const opts = options || {};
  const luminance = getHexLuminance(hexColor);
  if (luminance == null) return opts.fallback || 'FF212529';

  const threshold = Number.isFinite(Number(opts.threshold))
    ? Number(opts.threshold)
    : 140;
  return luminance >= threshold
    ? opts.dark || 'FF212529'
    : opts.light || 'FFFFFFFF';
}

function textHexForHexBackground(hexColor, options) {
  const opts = options || {};
  const luminance = getHexLuminance(hexColor);
  if (luminance == null) return opts.fallback || '#212529';

  const threshold = Number.isFinite(Number(opts.threshold))
    ? Number(opts.threshold)
    : 140;
  return luminance >= threshold
    ? opts.dark || '#212529'
    : opts.light || '#FFFFFF';
}

module.exports = {
  normalizeHexColor,
  getHexLuminance,
  hexToArgb,
  textArgbForHexBackground,
  textHexForHexBackground,
};