import sharp from "sharp";

export async function generateThumbnail(
  buffer: Uint8Array,
  mediaType: "image" | "video",
): Promise<Uint8Array> {
  const TARGET_SIZE = 400; // 400x400 feed thumbnail size

  if (mediaType === "image") {
    return await sharp(buffer)
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "center" })
      .webp({ quality: 80 })
      .toBuffer();
  } else {
    // For video: Extract the first frame using FFmpeg natively via Bun.spawn
    // 1. Write video buffer to a fast temporary file
    const tempVideoPath = `/tmp/${Bun.randomUUIDv7()}.mp4`;
    await Bun.write(tempVideoPath, buffer);

    try {
      // 2. Spawn ffmpeg to read the video and output a single JPEG frame to stdout
      const proc = Bun.spawn([
        "ffmpeg",
        "-i",
        tempVideoPath,
        "-vframes",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1", // Output to stdout
      ]);

      const frameBuffer = await new Response(proc.stdout).arrayBuffer();
      const exitCode = await proc.exited;

      if (exitCode !== 0 || frameBuffer.byteLength === 0) {
        throw new Error("FFmpeg failed to extract frame from video.");
      }

      // 3. Compress the extracted frame with sharp
      return new Uint8Array(
        await sharp(frameBuffer)
          .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "center" })
          .webp({ quality: 80 })
          .toBuffer(),
      );
    } finally {
      // 4. Always clean up the temp file
      try {
        await Bun.file(tempVideoPath).delete();
      } catch (err) {
        // Ignore deletion errors
      }
    }
  }
}
