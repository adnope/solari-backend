import { imageSize } from "image-size";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runCommand } from "./subprocess.ts";

export type MediaMetadata = {
  mediaType: "image" | "video";
  width: number;
  height: number;
  durationMs?: number | undefined;
};

export async function extractMediaMetadata(
  buffer: Uint8Array | Buffer,
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
    const tempFilePath = join(tmpdir(), `${randomUUID()}.media`);

    try {
      await writeFile(tempFilePath, buffer);

      const proc = await runCommand("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,duration",
        "-of",
        "json",
        tempFilePath,
      ]);

      if (proc.exitCode !== 0) {
        throw new Error(`ffprobe failed. Error: ${proc.stderr.toString("utf8")}`);
      }

      const outputStr = proc.stdout.toString("utf8");
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
      await unlink(tempFilePath).catch(() => {});
    }
  }

  throw new Error("Unsupported media content type.");
}
