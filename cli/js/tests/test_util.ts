// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

import { assert, assertEquals } from "../../../std/testing/asserts.ts";
export {
  assert,
  assertThrows,
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertStrictEq,
  assertStrContains,
  unreachable,
  fail
} from "../../../std/testing/asserts.ts";
export { readLines } from "../../../std/io/bufio.ts";
export { parse as parseArgs } from "../../../std/flags/mod.ts";

export interface Permissions {
  read: boolean;
  write: boolean;
  net: boolean;
  env: boolean;
  run: boolean;
  plugin: boolean;
  hrtime: boolean;
}

export function fmtPerms(perms: Permissions): string {
  const p = Object.keys(perms)
    .filter((e): boolean => perms[e as keyof Permissions] === true)
    .map(key => `--allow-${key}`);

  if (p.length) {
    return p.join(" ");
  }

  return "<no permissions>";
}

const isGranted = async (name: Deno.PermissionName): Promise<boolean> =>
  (await Deno.permissions.query({ name })).state === "granted";

export async function getProcessPermissions(): Promise<Permissions> {
  return {
    run: await isGranted("run"),
    read: await isGranted("read"),
    write: await isGranted("write"),
    net: await isGranted("net"),
    env: await isGranted("env"),
    plugin: await isGranted("plugin"),
    hrtime: await isGranted("hrtime")
  };
}

export function permissionsMatch(
  processPerms: Permissions,
  requiredPerms: Permissions
): boolean {
  for (const permName in processPerms) {
    if (
      processPerms[permName as keyof Permissions] !==
      requiredPerms[permName as keyof Permissions]
    ) {
      return false;
    }
  }

  return true;
}

export const permissionCombinations: Map<string, Permissions> = new Map();

function permToString(perms: Permissions): string {
  const r = perms.read ? 1 : 0;
  const w = perms.write ? 1 : 0;
  const n = perms.net ? 1 : 0;
  const e = perms.env ? 1 : 0;
  const u = perms.run ? 1 : 0;
  const p = perms.plugin ? 1 : 0;
  const h = perms.hrtime ? 1 : 0;
  return `permR${r}W${w}N${n}E${e}U${u}P${p}H${h}`;
}

function registerPermCombination(perms: Permissions): void {
  const key = permToString(perms);
  if (!permissionCombinations.has(key)) {
    permissionCombinations.set(key, perms);
  }
}

export async function registerUnitTests(): Promise<void> {
  const processPerms = await getProcessPermissions();

  for (const unitTestDefinition of REGISTERED_UNIT_TESTS) {
    if (unitTestDefinition.skip) {
      continue;
    }

    if (!permissionsMatch(processPerms, unitTestDefinition.perms)) {
      continue;
    }

    Deno.test(unitTestDefinition);
  }
}

function normalizeTestPermissions(perms: UnitTestPermissions): Permissions {
  return {
    read: !!perms.read,
    write: !!perms.write,
    net: !!perms.net,
    run: !!perms.run,
    env: !!perms.env,
    plugin: !!perms.plugin,
    hrtime: !!perms.hrtime
  };
}

// Wrap `TestFunction` in additional assertion that makes sure
// the test case does not leak async "ops" - ie. number of async
// completed ops after the test is the same as number of dispatched
// ops. Note that "unref" ops are ignored since in nature that are
// optional.
function assertOps(fn: Deno.TestFunction): Deno.TestFunction {
  return async function asyncOpSanitizer(): Promise<void> {
    const pre = Deno.metrics();
    await fn();
    const post = Deno.metrics();
    // We're checking diff because one might spawn HTTP server in the background
    // that will be a pending async op before test starts.
    assertEquals(
      post.opsDispatchedAsync - pre.opsDispatchedAsync,
      post.opsCompletedAsync - pre.opsCompletedAsync,
      `Test case is leaking async ops.
    Before:
      - dispatched: ${pre.opsDispatchedAsync}
      - completed: ${pre.opsCompletedAsync}
    After: 
      - dispatched: ${post.opsDispatchedAsync}
      - completed: ${post.opsCompletedAsync}`
    );
  };
}

// Wrap `TestFunction` in additional assertion that makes sure
// the test case does not "leak" resources - ie. resource table after
// the test has exactly the same contents as before the test.
function assertResources(fn: Deno.TestFunction): Deno.TestFunction {
  return async function resourceSanitizer(): Promise<void> {
    const pre = Deno.resources();
    await fn();
    const post = Deno.resources();
    const msg = `Test case is leaking resources.
    Before: ${JSON.stringify(pre, null, 2)}
    After: ${JSON.stringify(post, null, 2)}`;
    assertEquals(pre, post, msg);
  };
}

interface UnitTestPermissions {
  read?: boolean;
  write?: boolean;
  net?: boolean;
  env?: boolean;
  run?: boolean;
  plugin?: boolean;
  hrtime?: boolean;
}

interface UnitTestOptions {
  skip?: boolean;
  perms?: UnitTestPermissions;
}

interface UnitTestDefinition {
  name: string;
  fn: Deno.TestFunction;
  skip?: boolean;
  perms: Permissions;
}

export const REGISTERED_UNIT_TESTS: UnitTestDefinition[] = [];

export function unitTest(fn: Deno.TestFunction): void;
export function unitTest(options: UnitTestOptions, fn: Deno.TestFunction): void;
export function unitTest(
  optionsOrFn: UnitTestOptions | Deno.TestFunction,
  maybeFn?: Deno.TestFunction
): void {
  assert(optionsOrFn, "At least one argument is required");

  let options: UnitTestOptions;
  let name: string;
  let fn: Deno.TestFunction;

  if (typeof optionsOrFn === "function") {
    options = {};
    fn = optionsOrFn;
    name = fn.name;
    assert(name, "Missing test function name");
  } else {
    options = optionsOrFn;
    assert(maybeFn, "Missing test function definition");
    assert(
      typeof maybeFn === "function",
      "Second argument should be test function definition"
    );
    fn = maybeFn;
    name = fn.name;
    assert(name, "Missing test function name");
  }

  if (options.skip) {
    return;
  }

  const normalizedPerms = normalizeTestPermissions(options.perms || {});
  registerPermCombination(normalizedPerms);

  const unitTestDefinition: UnitTestDefinition = {
    name,
    fn: assertResources(assertOps(fn)),
    skip: !!options.skip,
    perms: normalizedPerms
  };

  REGISTERED_UNIT_TESTS.push(unitTestDefinition);
}

export interface ResolvableMethods<T> {
  resolve: (value?: T | PromiseLike<T>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reject: (reason?: any) => void;
}

export type Resolvable<T> = Promise<T> & ResolvableMethods<T>;

export function createResolvable<T>(): Resolvable<T> {
  let methods: ResolvableMethods<T>;
  const promise = new Promise<T>((resolve, reject): void => {
    methods = { resolve, reject };
  });
  // TypeScript doesn't know that the Promise callback occurs synchronously
  // therefore use of not null assertion (`!`)
  return Object.assign(promise, methods!) as Resolvable<T>;
}

export class SocketReporter implements Deno.TestReporter {
  private encoder: TextEncoder;

  constructor(private conn: Deno.Conn) {
    this.encoder = new TextEncoder();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async write(msg: any): Promise<void> {
    const encodedMsg = this.encoder.encode(`${JSON.stringify(msg)}\n`);
    await Deno.writeAll(this.conn, encodedMsg);
  }

  async start(msg: Deno.TestEventStart): Promise<void> {
    await this.write(msg);
  }

  async result(msg: Deno.TestEventResult): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serializedMsg: any = { ...msg };

    // Error is a JS object, so we need to turn it into string to
    // send over socket.
    if (serializedMsg.result.error) {
      serializedMsg.result.error = String(serializedMsg.result.error.stack);
    }

    await this.write(serializedMsg);
  }

  async end(msg: Deno.TestEventEnd): Promise<void> {
    await this.write(msg);
  }

  close(): void {
    this.conn.close();
  }
}

unitTest(function permissionsMatches(): void {
  assert(
    permissionsMatch(
      {
        read: true,
        write: false,
        net: false,
        env: false,
        run: false,
        plugin: false,
        hrtime: false
      },
      normalizeTestPermissions({ read: true })
    )
  );

  assert(
    permissionsMatch(
      {
        read: false,
        write: false,
        net: false,
        env: false,
        run: false,
        plugin: false,
        hrtime: false
      },
      normalizeTestPermissions({})
    )
  );

  assertEquals(
    permissionsMatch(
      {
        read: false,
        write: true,
        net: true,
        env: true,
        run: true,
        plugin: true,
        hrtime: true
      },
      normalizeTestPermissions({ read: true })
    ),
    false
  );

  assertEquals(
    permissionsMatch(
      {
        read: true,
        write: false,
        net: true,
        env: false,
        run: false,
        plugin: false,
        hrtime: false
      },
      normalizeTestPermissions({ read: true })
    ),
    false
  );

  assert(
    permissionsMatch(
      {
        read: true,
        write: true,
        net: true,
        env: true,
        run: true,
        plugin: true,
        hrtime: true
      },
      {
        read: true,
        write: true,
        net: true,
        env: true,
        run: true,
        plugin: true,
        hrtime: true
      }
    )
  );
});

/*
 * Ensure all unit test files (e.g. xxx_test.ts) are present as imports in
 * cli/js/tests/unit_tests.ts as it is easy to miss this out
 */
unitTest(
  { perms: { read: true } },
  async function assertAllUnitTestFilesImported(): Promise<void> {
    const directoryTestFiles = Deno.readdirSync("./cli/js/tests/")
      .map(k => k.name)
      .filter(
        file =>
          file!.endsWith(".ts") &&
          !file!.endsWith("unit_tests.ts") &&
          !file!.endsWith("test_util.ts") &&
          !file!.endsWith("unit_test_runner.ts")
      );
    const unitTestsFile: Uint8Array = Deno.readFileSync(
      "./cli/js/tests/unit_tests.ts"
    );
    const importLines = new TextDecoder("utf-8")
      .decode(unitTestsFile)
      .split("\n")
      .filter(line => line.startsWith("import"));
    const importedTestFiles = importLines.map(
      relativeFilePath => relativeFilePath.match(/\/([^\/]+)";/)![1]
    );

    directoryTestFiles.forEach(dirFile => {
      if (!importedTestFiles.includes(dirFile!)) {
        throw new Error(
          "cil/js/tests/unit_tests.ts is missing import of test file: cli/js/" +
            dirFile
        );
      }
    });
  }
);
