import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("console.log EPIPE propagation to process.stdout", () => {
  test("console.log emits error on process.stdout when pipe breaks", async () => {
    // In Node.js, console.log routes through process.stdout.write().
    // When EPIPE occurs, the error is emitted on process.stdout.
    // This test verifies that Bun matches this behavior.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        process.stdout.on("error", (err) => {
          if (err.code === "EPIPE") {
            process.stderr.write("EPIPE_ON_STDOUT\\n");
            process.exit(0);
          }
        });

        // Write in a loop, yielding periodically so the error event can fire.
        async function main() {
          for (let i = 0; i < 100000; i++) {
            console.log("line " + i);
            if (i % 1000 === 0) await new Promise(r => setImmediate(r));
          }
          // All writes completed without EPIPE
          process.stderr.write("NO_EPIPE\\n");
          process.exit(1);
        }
        main();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read a little then close stdout to trigger EPIPE
    const reader = proc.stdout.getReader();
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);
    reader.releaseLock();
    // Kill the stdout stream to cause EPIPE on the child's next write
    proc.stdout.cancel();

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // The child process should have received EPIPE on process.stdout
    expect(stderr).toContain("EPIPE_ON_STDOUT");
    expect(exitCode).toBe(0);
  });

  test("console.log writes go through process.stdout", async () => {
    // Verify that console.log output is routed through process.stdout
    // by checking that a custom process.stdout.write sees the data
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const originalWrite = process.stdout.write;
        let intercepted = false;

        process.stdout.write = function(chunk, ...args) {
          if (typeof chunk === "string" && chunk.includes("hello from console.log")) {
            intercepted = true;
          }
          return originalWrite.call(this, chunk, ...args);
        };

        console.log("hello from console.log");

        process.stderr.write("INTERCEPTED:" + intercepted + "\\n");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("hello from console.log");
    expect(stderr).toContain("INTERCEPTED:true");
    expect(exitCode).toBe(0);
  });

  test("console.error writes go through process.stderr", async () => {
    // Verify that console.error output is routed through process.stderr
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const originalWrite = process.stderr.write;
        let intercepted = false;

        process.stderr.write = function(chunk, ...args) {
          if (typeof chunk === "string" && chunk.includes("hello from console.error")) {
            intercepted = true;
          }
          return originalWrite.call(this, chunk, ...args);
        };

        console.error("hello from console.error");

        // Use stdout to report the result since we intercepted stderr
        process.stdout.write("INTERCEPTED:" + intercepted + "\\n");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("hello from console.error");
    expect(stdout).toContain("INTERCEPTED:true");
    expect(exitCode).toBe(0);
  });
});
