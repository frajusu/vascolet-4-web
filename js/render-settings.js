// In-memory render preference, applied on boot and whenever Options is changed.
export const RenderSettings = { filterTextures: true };
export function setTextureFiltering(enabled, canvas = null) {
  RenderSettings.filterTextures = enabled !== false;
  if (canvas) canvas.style.imageRendering = RenderSettings.filterTextures ? "auto" : "pixelated";
}
