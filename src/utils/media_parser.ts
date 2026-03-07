import { imageSize } from "image-size";

export type MediaMetadata = {
  mediaType: "image" | "video";
  width: number;
  height: number;
  durationMs?: number;
};

export async function extractMediaMetadata(
  buffer: Uint8Array,
  contentType: string,
): Promise<MediaMetadata> {
  if (contentType.startsWith("image/")) {
    const dimensions = imageSize(buffer);
    if (!dimensions.width || !dimensions.height) {
      throw new Error("Could not parse valid image dimensions.");
    }
    return {
      mediaType: "image",
      width: dimensions.width,
      height: dimensions.height,
    };
  }

  if (contentType.startsWith("video/")) {
    // Write to a temp file because ffprobe requires a file to seek through atoms/headers safely
    const tempFilePath = await Deno.makeTempFile({ suffix: ".media" });
    try {
      await Deno.writeFile(tempFilePath, buffer);

      const command = new Deno.Command("ffprobe", {
        args: [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height,duration",
          "-of",
          "json",
          tempFilePath,
        ],
      });

      const { code, stdout, stderr } = await command.output();

      if (code !== 0) {
        throw new Error(
          `ffprobe failed. Error: ${new TextDecoder().decode(stderr)}`,
        );
      }

      const outputStr = new TextDecoder().decode(stdout);
      const data = JSON.parse(outputStr);
      const stream = data.streams?.[0];

      if (!stream || !stream.width || !stream.height) {
        throw new Error("No valid video stream found in the file.");
      }

      return {
        mediaType: "video",
        width: Number(stream.width),
        height: Number(stream.height),
        durationMs: stream.duration ? Math.round(Number(stream.duration) * 1000) : undefined,
      };
    } finally {
      await Deno.remove(tempFilePath);
    }
  }

  throw new Error("Unsupported media content type.");
}
