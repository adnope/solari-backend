import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runCommand } from "./subprocess.ts";

export async function generateThumbnail(
  buffer: Uint8Array | Buffer,
  mediaType: "image" | "video",
): Promise<Uint8Array> {
  const TARGET_SIZE = 400;
  const inputPath = join(tmpdir(), `${randomUUID()}.${mediaType === "image" ? "image" : "mp4"}`);

  try {
    await writeFile(inputPath, buffer);

    const proc = await runCommand(
      "ffmpeg",
      [
        "-i",
        inputPath,
        "-vf",
        `scale=${TARGET_SIZE}:${TARGET_SIZE}:force_original_aspect_ratio=increase,crop=${TARGET_SIZE}:${TARGET_SIZE}`,
        "-frames:v",
        "1",
        "-f",
        "webp",
        "-vcodec",
        "libwebp",
        "-quality",
        "80",
        "pipe:1",
      ],
      mediaType === "video" ? 20000 : 10000,
    );

    if (proc.exitCode !== 0 || proc.stdout.byteLength === 0) {
      throw new Error(`FFmpeg failed to generate ${mediaType} thumbnail.`);
    }

    return new Uint8Array(proc.stdout);
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}
