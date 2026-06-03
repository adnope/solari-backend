import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";

export type CommandOutput = {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
};

function readStream(stream: Readable | null): Promise<Buffer> {
  if (!stream) {
    return Promise.resolve(Buffer.alloc(0));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.once("error", reject);
    stream.once("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

export async function runCommand(
  command: string,
  args: readonly string[],
  timeoutMs = 15000,
): Promise<CommandOutput> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command '${command}' exceeded ${timeoutMs}ms timeout.`));
    }, timeoutMs);

    const stdoutPromise = readStream(child.stdout);
    const stderrPromise = readStream(child.stderr);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (exitCode) => {
      clearTimeout(timer);
      Promise.all([stdoutPromise, stderrPromise])
        .then(([stdout, stderr]) => {
          resolve({ exitCode, stdout, stderr });
        })
        .catch(reject);
    });
  });
}
