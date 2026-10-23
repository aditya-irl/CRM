/**
 * Client-side image compression & downsampling utility for Web Admin.
 * Preserves document sharpness while avoiding multi-megabyte payload bottlenecks.
 */
export async function compressImageFile(file: File, maxDimension: number = 1600, quality: number = 0.85): Promise<File> {
  const mime = file.type || '';
  if (mime === 'application/pdf' || mime === 'image/svg+xml') {
    return file;
  }
  // Allow image/* or empty/octet-stream types from camera captures
  const isCandidateImage = mime.startsWith('image/') || !mime || mime === 'application/octet-stream';
  if (!isCandidateImage) {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(file);
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => resolve(file);
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const rawName = file.name || 'photo.jpg';
            const baseName = rawName.includes('.') ? rawName.replace(/\.[^/.]+$/, '') : rawName;
            const outputName = `${baseName}.jpg`;

            if (blob.size < file.size || file.size > 200 * 1024 || !file.type || file.name !== outputName) {
              const compressedFile = new File([blob], outputName, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
