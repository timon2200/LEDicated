const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function zoomAround({ durationSec, zoom, startSec, anchorSec, factor, maxZoom = 32 }) {
  const nextZoom = clamp(zoom * factor, 1, maxZoom);
  const oldVisible = durationSec / zoom;
  const nextVisible = durationSec / nextZoom;
  const fraction = clamp((anchorSec - startSec) / oldVisible, 0, 1);
  return { zoom: nextZoom, startSec: clamp(anchorSec - fraction * nextVisible, 0, Math.max(0, durationSec - nextVisible)) };
}

export function panByPixels({ durationSec, zoom, startSec, deltaPx, widthPx }) {
  const visible = durationSec / zoom;
  return clamp(startSec + deltaPx / widthPx * visible, 0, Math.max(0, durationSec - visible));
}
