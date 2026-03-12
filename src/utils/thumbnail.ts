import sharp from "sharp";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export async function generateThumbnail(
  buffer: Uint8Array | Buffer,
  mediaType: "image" | "video",
): Promise<Uint8Array> {
  const TARGET_SIZE = 400;

  if (mediaType === "image") {
    return new Uint8Array(
      await sharp(buffer)
        .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "center" })
        .webp({ quality: 80 })
        .toBuffer(),
    );
  } else {
    const tempVideoPath = join(tmpdir(), `${randomUUID()}.mp4`);

    try {
      await Bun.write(tempVideoPath, buffer);

      const proc = Bun.spawn(
        [
          "ffmpeg",
          "-i",
          tempVideoPath,
          "-vframes",
          "1",
          "-f",
          "image2pipe",
          "-vcodec",
          "mjpeg",
          "pipe:1",
        ],
        { stdout: "pipe" },
      );

      const stdoutBuffer = await new Response(proc.stdout).arrayBuffer();
      const exitCode = await proc.exited;

      if (exitCode !== 0 || stdoutBuffer.byteLength === 0) {
        throw new Error("FFmpeg failed to extract frame from video.");
      }

      return new Uint8Array(
        await sharp(stdoutBuffer)
          .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "center" })
          .webp({ quality: 80 })
          .toBuffer(),
      );
    } finally {
      await unlink(tempVideoPath).catch(() => {});
    }
  }
}
