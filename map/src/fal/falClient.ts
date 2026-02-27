const FAL_API_URL = "https://queue.fal.run/fal-ai/fast-sdxl";

/**
 * Generate a tileset image using FAL API.
 * Returns the URL of the generated image.
 */
export async function generateTileImage(prompt: string): Promise<string> {
  const apiKey = import.meta.env.VITE_FAL_API_KEY;
  if (!apiKey) throw new Error("VITE_FAL_API_KEY not set");

  const fullPrompt = `${prompt}, pixel art tileset, 16x16 tiles, top-down RPG, seamless, game asset, sprite sheet`;

  const res = await fetch(FAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify({
      prompt: fullPrompt,
      negative_prompt: "blurry, 3d, realistic, photo, text, watermark",
      image_size: "square",
      num_inference_steps: 25,
      num_images: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FAL API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // FAL queue model — may need to poll for result
  if (data.request_id && data.status === "IN_QUEUE") {
    return await pollForResult(data.request_id, apiKey);
  }

  // Direct result
  if (data.images?.[0]?.url) {
    return data.images[0].url;
  }

  throw new Error("Unexpected FAL API response");
}

async function pollForResult(
  requestId: string,
  apiKey: string,
  maxAttempts = 30,
): Promise<string> {
  const statusUrl = `https://queue.fal.run/fal-ai/fast-sdxl/requests/${requestId}/status`;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const res = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
    });

    if (!res.ok) continue;
    const data = await res.json();

    if (data.status === "COMPLETED") {
      const resultUrl = `https://queue.fal.run/fal-ai/fast-sdxl/requests/${requestId}`;
      const resultRes = await fetch(resultUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });
      const result = await resultRes.json();
      if (result.images?.[0]?.url) return result.images[0].url;
      throw new Error("No image in completed result");
    }

    if (data.status === "FAILED") {
      throw new Error("FAL generation failed");
    }
  }

  throw new Error("FAL generation timed out");
}
