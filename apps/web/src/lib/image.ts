/** Reads an image file, downsizes it (phone screenshots can be 5–10 MB) and returns a data URL for upload. */
export async function imageToDataUrl(file: File, maxSide = 1800, quality = 0.85): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|heic|heif)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error('Choose a PNG, JPG or WEBP image');
  }
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the image'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('This image format is not supported. Take a screenshot (PNG/JPG) instead.'));
    i.src = raw;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024 && /^image\/(png|jpe?g|webp)$/i.test(file.type)) return raw;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
