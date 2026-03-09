import { imageSize } from "image-size";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
    // Write to a temp file in the OS temp directory
    const tempFilePath = join(tmpdir(), `${randomUUID()}.media`);

    try {
      // Native Bun file writing
      await Bun.write(tempFilePath, buffer);

      // Native Bun process spawning
      const proc = Bun.spawn(
        [
          "ffprobe",
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
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        // Idiomatic Bun way to read streams into text
        const errorStr = await new Response(proc.stderr).text();
        throw new Error(`ffprobe failed. Error: ${errorStr}`);
      }

      const outputStr = await new Response(proc.stdout).text();
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
      // Clean up the temp file
      await unlink(tempFilePath).catch(() => {});
    }
  }

  throw new Error("Unsupported media content type.");
}
