// Successful and in-flight requests are shared. Failures reject and may be retried.
export const A = {
  images: new Map(), texts: new Map(), imagePromises: new Map(), xmlPromises: new Map(),
  queue: [], loaded: 0, total: 0,
};
const assetPath = path => String(path).replace(/\\/g, "/");
let batchId = 0;

export function loadImage(path) {
  path = assetPath(path);
  if (A.imagePromises.has(path)) return A.imagePromises.get(path);
  const promise = A.images.has(path) ? Promise.resolve(A.images.get(path)) : new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { image.onload = image.onerror = null; A.images.set(path, image); resolve(image); };
    image.onerror = () => { image.onload = image.onerror = null; reject(new Error(`Image load failed: ${path}`)); };
    image.src = path;
  });
  A.imagePromises.set(path, promise);
  promise.catch(() => { if (A.imagePromises.get(path) === promise) A.imagePromises.delete(path); });
  return promise;
}

export async function loadAssets(manifest, onProgress) {
  const id = ++batchId, total = manifest.length;
  let loaded = 0;
  A.total = total; A.loaded = 0; A.queue = [...manifest];
  return Promise.all(manifest.map(async path => {
    const image = await loadImage(path);
    loaded++;
    if (id === batchId) A.loaded = loaded;
    onProgress?.(loaded, total);
    return image;
  }));
}

export function img(path) { return A.images.get(assetPath(path)); }

export function loadXML(path) {
  path = assetPath(path);
  if (A.xmlPromises.has(path)) return A.xmlPromises.get(path);
  const promise = (async () => {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText || ""}`.trim());
      const text = await response.text();
      const doc = new DOMParser().parseFromString(text, "text/xml");
      const error = doc.getElementsByTagName("parsererror")[0];
      if (!doc.documentElement || error) throw new Error(`Malformed XML: ${error?.textContent || "empty document"}`);
      A.texts.set(path, text);
      return doc;
    } catch (cause) { throw new Error(`XML load failed: ${path}: ${cause.message}`, { cause }); }
  })();
  A.xmlPromises.set(path, promise);
  promise.catch(() => { if (A.xmlPromises.get(path) === promise) A.xmlPromises.delete(path); });
  return promise;
}
