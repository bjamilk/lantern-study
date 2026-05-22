/**
 * Compresses an image file using standard HTML5 Canvas.
 * Supports resizing and outputting as WebP (with JPEG fallback).
 */
export const compressImage = (
  file: File,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    outputType?: 'base64' | 'file';
  } = {}
): Promise<string | File> => {
  const {
    maxWidth = 800,
    maxHeight = 800,
    quality = 0.75,
    outputType = 'file',
  } = options;

  return new Promise((resolve, reject) => {
    // Check if the file is an image
    if (!file.type.startsWith('image/')) {
      return reject(new Error('File is not an image'));
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = width / height;
          if (width > height) {
            width = maxWidth;
            height = Math.round(maxWidth / ratio);
          } else {
            height = maxHeight;
            width = Math.round(maxHeight * ratio);
          }
        }

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Could not get canvas context'));
        }

        // Draw image
        ctx.drawImage(img, 0, 0, width, height);

        // Determine format: WebP is preferred
        const format = 'image/webp';

        if (outputType === 'base64') {
          try {
            const dataUrl = canvas.toDataURL(format, quality);
            resolve(dataUrl);
          } catch (e) {
            // Fallback if canvas.toDataURL(format) fails
            try {
              const fallbackUrl = canvas.toDataURL('image/jpeg', quality);
              resolve(fallbackUrl);
            } catch (err) {
              reject(err);
            }
          }
        } else {
          try {
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  return reject(new Error('Canvas to Blob conversion failed'));
                }
                const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                  type: format,
                  lastModified: Date.now(),
                });
                resolve(compressedFile);
              },
              format,
              quality
            );
          } catch (e) {
            // Fallback to jpeg blob
            try {
              canvas.toBlob(
                (blob) => {
                  if (!blob) {
                    return reject(new Error('Canvas to Blob conversion failed'));
                  }
                  const compressedFile = new File([blob], file.name, {
                    type: 'image/jpeg',
                    lastModified: Date.now(),
                  });
                  resolve(compressedFile);
                },
                'image/jpeg',
                quality
              );
            } catch (err) {
              reject(err);
            }
          }
        }
      };

      img.onerror = (err) => reject(err);
      img.src = event.target?.result as string;
    };

    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
};
