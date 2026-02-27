/**
 * Load an image from a URL and slice it into tiles of the given size.
 * Returns an array of data URLs for each tile.
 */
export async function extractTiles(
  imageUrl: string,
  tileSize: number,
): Promise<string[]> {
  const img = await loadImage(imageUrl);

  const cols = Math.floor(img.width / tileSize);
  const rows = Math.floor(img.height / tileSize);
  const tiles: string[] = [];

  const canvas = document.createElement("canvas");
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext("2d")!;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.clearRect(0, 0, tileSize, tileSize);
      ctx.drawImage(
        img,
        c * tileSize,
        r * tileSize,
        tileSize,
        tileSize,
        0,
        0,
        tileSize,
        tileSize,
      );

      // Skip fully transparent tiles
      const data = ctx.getImageData(0, 0, tileSize, tileSize).data;
      let hasContent = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 10) {
          hasContent = true;
          break;
        }
      }

      if (hasContent) {
        tiles.push(canvas.toDataURL("image/png"));
      }
    }
  }

  return tiles;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}
