// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
import {
  unitTest,
  assert,
  assertEquals,
  assertStrContains
} from "./test_util.ts";

unitTest(function filesStdioFileDescriptors(): void {
  assertEquals(Deno.stdin.rid, 0);
  assertEquals(Deno.stdout.rid, 1);
  assertEquals(Deno.stderr.rid, 2);
});

unitTest({ perms: { read: true } }, async function filesCopyToStdout(): Promise<
  void
> {
  const filename = "cli/tests/fixture.json";
  const file = await Deno.open(filename);
  assert(file.rid > 2);
  const bytesWritten = await Deno.copy(Deno.stdout, file);
  const fileSize = Deno.statSync(filename).size;
  assertEquals(bytesWritten, fileSize);
  console.log("bytes written", bytesWritten);
  file.close();
});

unitTest(
  { perms: { read: true } },
  async function filesToAsyncIterator(): Promise<void> {
    const filename = "cli/tests/hello.txt";
    const file = await Deno.open(filename);

    let totalSize = 0;
    for await (const buf of Deno.toAsyncIterator(file)) {
      totalSize += buf.byteLength;
    }

    assertEquals(totalSize, 12);
    file.close();
  }
);

unitTest(async function readerToAsyncIterator(): Promise<void> {
  // ref: https://github.com/denoland/deno/issues/2330
  const encoder = new TextEncoder();

  class TestReader implements Deno.Reader {
    private offset = 0;
    private buf = new Uint8Array(encoder.encode(this.s));

    constructor(private readonly s: string) {}

    async read(p: Uint8Array): Promise<number | Deno.EOF> {
      const n = Math.min(p.byteLength, this.buf.byteLength - this.offset);
      p.set(this.buf.slice(this.offset, this.offset + n));
      this.offset += n;

      if (n === 0) {
        return Deno.EOF;
      }

      return n;
    }
  }

  const reader = new TestReader("hello world!");

  let totalSize = 0;
  for await (const buf of Deno.toAsyncIterator(reader)) {
    totalSize += buf.byteLength;
  }

  assertEquals(totalSize, 12);
});

unitTest(
  { perms: { write: false } },
  async function writePermFailure(): Promise<void> {
    const filename = "tests/hello.txt";
    const writeModes: Deno.OpenMode[] = ["w", "a", "x"];
    for (const mode of writeModes) {
      let err;
      try {
        await Deno.open(filename, mode);
      } catch (e) {
        err = e;
      }
      assert(!!err);
      assert(err instanceof Deno.errors.PermissionDenied);
      assertEquals(err.name, "PermissionDenied");
    }
  }
);

unitTest(async function openOptions(): Promise<void> {
  const filename = "cli/tests/fixture.json";
  let err;
  try {
    await Deno.open(filename, { write: false });
  } catch (e) {
    err = e;
  }
  assert(!!err);
  assertStrContains(
    err.message,
    "OpenOptions requires at least one option to be true"
  );

  try {
    await Deno.open(filename, { truncate: true, write: false });
  } catch (e) {
    err = e;
  }
  assert(!!err);
  assertStrContains(err.message, "'truncate' option requires 'write' option");

  try {
    await Deno.open(filename, { create: true, write: false });
  } catch (e) {
    err = e;
  }
  assert(!!err);
  assertStrContains(
    err.message,
    "'create' or 'createNew' options require 'write' or 'append' option"
  );

  try {
    await Deno.open(filename, { createNew: true, append: false });
  } catch (e) {
    err = e;
  }
  assert(!!err);
  assertStrContains(
    err.message,
    "'create' or 'createNew' options require 'write' or 'append' option"
  );
});

unitTest({ perms: { read: false } }, async function readPermFailure(): Promise<
  void
> {
  let caughtError = false;
  try {
    await Deno.open("package.json", "r");
    await Deno.open("cli/tests/fixture.json", "r");
  } catch (e) {
    caughtError = true;
    assert(e instanceof Deno.errors.PermissionDenied);
  }
  assert(caughtError);
});

unitTest(
  { perms: { write: true } },
  async function writeNullBufferFailure(): Promise<void> {
    const tempDir = Deno.makeTempDirSync();
    const filename = tempDir + "hello.txt";
    const w = {
      write: true,
      truncate: true,
      create: true
    };
    const file = await Deno.open(filename, w);

    // writing null should throw an error
    let err;
    try {
      // @ts-ignore
      await file.write(null);
    } catch (e) {
      err = e;
    }
    // TODO: Check error kind when dispatch_minimal pipes errors properly
    assert(!!err);

    file.close();
    await Deno.remove(tempDir, { recursive: true });
  }
);

unitTest(
  { perms: { write: true, read: true } },
  async function readNullBufferFailure(): Promise<void> {
    const tempDir = Deno.makeTempDirSync();
    const filename = tempDir + "hello.txt";
    const file = await Deno.open(filename, "w+");

    // reading into an empty buffer should return 0 immediately
    const bytesRead = await file.read(new Uint8Array(0));
    assert(bytesRead === 0);

    // reading file into null buffer should throw an error
    let err;
    try {
      // @ts-ignore
      await file.read(null);
    } catch (e) {
      err = e;
    }
    // TODO: Check error kind when dispatch_minimal pipes errors properly
    assert(!!err);

    file.close();
    await Deno.remove(tempDir, { recursive: true });
  }
);

unitTest(
  { perms: { write: false, read: false } },
  async function readWritePermFailure(): Promise<void> {
    const filename = "tests/hello.txt";
    const writeModes: Deno.OpenMode[] = ["r+", "w+", "a+", "x+"];
    for (const mode of writeModes) {
      let err;
      try {
        await Deno.open(filename, mode);
      } catch (e) {
        err = e;
      }
      assert(!!err);
      assert(err instanceof Deno.errors.PermissionDenied);
      assertEquals(err.name, "PermissionDenied");
    }
  }
);

unitTest(
  { perms: { read: true, write: true } },
  async function createFile(): Promise<void> {
    const tempDir = await Deno.makeTempDir();
    const filename = tempDir + "/test.txt";
    const f = await Deno.create(filename);
    let fileInfo = Deno.statSync(filename);
    assert(fileInfo.isFile());
    assert(fileInfo.size === 0);
    const enc = new TextEncoder();
    const data = enc.encode("Hello");
    await f.write(data);
    fileInfo = Deno.statSync(filename);
    assert(fileInfo.size === 5);
    f.close();

    // TODO: test different modes
    await Deno.remove(tempDir, { recursive: true });
  }
);

unitTest(
  { perms: { read: true, write: true } },
  async function openModeWrite(): Promise<void> {
    const tempDir = Deno.makeTempDirSync();
    const encoder = new TextEncoder();
    const filename = tempDir + "hello.txt";
    const data = encoder.encode("Hello world!\n");
    let file = await Deno.open(filename, "w");
    // assert file was created
    let fileInfo = Deno.statSync(filename);
    assert(fileInfo.isFile());
    assertEquals(fileInfo.size, 0);
    // write some data
    await file.write(data);
    fileInfo = Deno.statSync(filename);
    assertEquals(fileInfo.size, 13);
    // assert we can't read from file
    let thrown = false;
    try {
      const buf = new Uint8Array(20);
      await file.read(buf);
    } catch (e) {
      thrown = true;
    } finally {
      assert(thrown, "'w' mode shouldn't allow to read file");
    }
    file.close();
    // assert that existing file is truncated on open
    file = await Deno.open(filename, "w");
    file.close();
    const fileSize = Deno.statSync(filename).size;
    assertEquals(fileSize, 0);
    await Deno.remove(tempDir, { recursive: true });
  }
);

unitTest(
  { perms: { read: true, write: true } },
  async function openModeWriteRead(): Promise<void> {
    const tempDir = Deno.makeTempDirSync();
    const encoder = new TextEncoder();
    const filename = tempDir + "hello.txt";
    const data = encoder.encode("Hello world!\n");

    const file = await Deno.open(filename, "w+");
    const seekPosition = 0;
    // assert file was created
    let fileInfo = Deno.statSync(filename);
    assert(fileInfo.isFile());
    assertEquals(fileInfo.size, 0);
    // write some data
    await file.write(data);
    fileInfo = Deno.statSync(filename);
    assertEquals(fileInfo.size, 13);

    const buf = new Uint8Array(20);
    // seeking from beginning of a file
    const cursorPosition = await file.seek(
      seekPosition,
      Deno.SeekMode.SEEK_START
    );
    assertEquals(seekPosition, cursorPosition);
    const result = await file.read(buf);
    assertEquals(result, 13);
    file.close();

    await Deno.remove(tempDir, { recursive: true });
  }
);

unitTest({ perms: { read: true } }, async function seekStart(): Promise<void> {
  const filename = "cli/tests/hello.txt";
  const file = await Deno.open(filename);
  const seekPosition = 6;
  // Deliberately move 1 step forward
  await file.read(new Uint8Array(1)); // "H"
  // Skipping "Hello "
  // seeking from beginning of a file plus seekPosition
  const cursorPosition = await file.seek(
    seekPosition,
    Deno.SeekMode.SEEK_START
  );
  assertEquals(seekPosition, cursorPosition);
  const buf = new Uint8Array(6);
  await file.read(buf);
  const decoded = new TextDecoder().decode(buf);
  assertEquals(decoded, "world!");
  file.close();
});

unitTest({ perms: { read: true } }, function seekSyncStart(): void {
  const filename = "cli/tests/hello.txt";
  const file = Deno.openSync(filename);
  const seekPosition = 6;
  // Deliberately move 1 step forward
  file.readSync(new Uint8Array(1)); // "H"
  // Skipping "Hello "
  // seeking from beginning of a file plus seekPosition
  const cursorPosition = file.seekSync(seekPosition, Deno.SeekMode.SEEK_START);
  assertEquals(seekPosition, cursorPosition);
  const buf = new Uint8Array(6);
  file.readSync(buf);
  const decoded = new TextDecoder().decode(buf);
  assertEquals(decoded, "world!");
  file.close();
});

unitTest({ perms: { read: true } }, async function seekCurrent(): Promise<
  void
> {
  const filename = "cli/tests/hello.txt";
  const file = await Deno.open(filename);
  // Deliberately move 1 step forward
  await file.read(new Uint8Array(1)); // "H"
  // Skipping "ello "
  const seekPosition = 5;
  // seekPosition is relative to current cursor position after read
  const cursorPosition = await file.seek(
    seekPosition,
    Deno.SeekMode.SEEK_CURRENT
  );
  assertEquals(seekPosition + 1, cursorPosition);
  const buf = new Uint8Array(6);
  await file.read(buf);
  const decoded = new TextDecoder().decode(buf);
  assertEquals(decoded, "world!");
  file.close();
});

unitTest({ perms: { read: true } }, function seekSyncCurrent(): void {
  const filename = "cli/tests/hello.txt";
  const file = Deno.openSync(filename);
  // Deliberately move 1 step forward
  file.readSync(new Uint8Array(1)); // "H"
  // Skipping "ello "
  const seekPosition = 5;
  // seekPosition is relative to current cursor position after read
  const cursorPosition = file.seekSync(
    seekPosition,
    Deno.SeekMode.SEEK_CURRENT
  );
  assertEquals(seekPosition + 1, cursorPosition);
  const buf = new Uint8Array(6);
  file.readSync(buf);
  const decoded = new TextDecoder().decode(buf);
  assertEquals(decoded, "world!");
  file.close();
});

unitTest({ perms: { read: true } }, async function seekEnd(): Promise<void> {
  const filename = "cli/tests/hello.txt";
  const file = await Deno.open(filename);
  const seekPosition = -6;
  // seek from end of file that has 12 chars, 12 - 6  = 6
  const cursorPosition = await file.seek(seekPosition, Deno.SeekMode.SEEK_END);
  assertEquals(6, cursorPosition);
  const buf = new Uint8Array(6);
  await file.read(buf);
  const decoded = new TextDecoder().decode(buf);
  assertEquals(decoded, "world!");
  file.close();
});

unitTest({ perms: { read: true } }, function seekSyncEnd(): void {
  const filename = "cli/tests/hello.txt";
  const file = Deno.openSync(filename);
  const seekPosition = -6;
  // seek from end of file that has 12 chars, 12 - 6  = 6
  const cursorPosition = file.seekSync(seekPosition, Deno.SeekMode.SEEK_END);
  assertEquals(6, cursorPosition);
  const buf = new Uint8Array(6);
  file.readSync(buf);
  const decoded = new TextDecoder().decode(buf);
  assertEquals(decoded, "world!");
  file.close();
});

unitTest({ perms: { read: true } }, async function seekMode(): Promise<void> {
  const filename = "cli/tests/hello.txt";
  const file = await Deno.open(filename);
  let err;
  try {
    await file.seek(1, -1);
  } catch (e) {
    err = e;
  }
  assert(!!err);
  assert(err instanceof TypeError);
  assertStrContains(err.message, "Invalid seek mode");

  // We should still be able to read the file
  // since it is still open.
  const buf = new Uint8Array(1);
  await file.read(buf); // "H"
  assertEquals(new TextDecoder().decode(buf), "H");
  file.close();
});
