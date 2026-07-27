// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

// Minimal test runner. @types/node is pinned to v16 here, which predates the
// `node:test` typings, and the pure logic under test needs no extension host,
// so a few lines beat pulling in a framework.

type TestFn = () => void | Promise<void>;

const tests: { name: string, fn: TestFn }[] = [];

export function test(name: string, fn: TestFn): void {
    tests.push({ name, fn });
}

export async function run(): Promise<void> {
    let failed = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
        } catch (err) {
            failed++;
            console.log(`  ✗ ${name}`);
            console.log(String(err instanceof Error ? err.stack : err).split('\n').map(l => `      ${l}`).join('\n'));
        }
    }
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}
