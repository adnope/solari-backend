import sharp from "sharp";

export async function generateThumbnail(
  buffer: Uint8Array,
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
    const tempVideoPath = await Deno.makeTempFile({ suffix: ".mp4" });

    try {
      await Deno.writeFile(tempVideoPath, buffer);

      const command = new Deno.Command("ffmpeg", {
        args: [
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
        stdout: "piped",
      });

      const { code, stdout } = await command.output();

      if (code !== 0 || stdout.length === 0) {
        throw new Error("FFmpeg failed to extract frame from video.");
      }

      return new Uint8Array(
        await sharp(stdout)
          .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "center" })
          .webp({ quality: 80 })
          .toBuffer(),
      );
    } finally {
      await Deno.remove(tempVideoPath).catch(() => {});
    }
  }
}
