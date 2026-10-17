// Shrinks an image to fit a maxSize × maxSize square and returns a JPEG data
// URL. Keeps profile pictures small; the API rejects images over ~200 KB.
export const resizeImage = (file: File, maxSize = 256): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Could not process image'));
        return;
      }
      // JPEG has no transparency; use white instead of black behind transparent PNGs
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };

    img.src = url;
  });
