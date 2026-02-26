import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "../../harness";

test("#7251 console.log emits EPIPE on process.stdout when pipe is broken", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.stdout.on('error', (err) => {
        if (err.code === 'EPIPE') {
          process.stderr.write('EPIPE_RECEIVED\\n');
          process.exit(0);
        }
      });

      let count = 0;
      function writeLoop() {
        if (count > 100000) {
          process.stderr.write('TIMEOUT\\n');
          process.exit(1);
        }
        console.log('line ' + count++);
        setImmediate(writeLoop);
      }
      writeLoop();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  expect(value).toBeDefined();
  await reader.cancel();

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("EPIPE_RECEIVED");
  expect(exitCode).toBe(0);
});

test("#7251 process.stdout.write emits EPIPE when pipe is broken", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.stdout.on('error', (err) => {
        if (err.code === 'EPIPE') {
          process.stderr.write('EPIPE_RECEIVED\\n');
          process.exit(0);
        }
      });

      let count = 0;
      function writeLoop() {
        if (count > 100000) {
          process.stderr.write('TIMEOUT\\n');
          process.exit(1);
        }
        process.stdout.write('line ' + count++ + '\\n');
        setImmediate(writeLoop);
      }
      writeLoop();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  expect(value).toBeDefined();
  await reader.cancel();

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("EPIPE_RECEIVED");
  expect(exitCode).toBe(0);
});
