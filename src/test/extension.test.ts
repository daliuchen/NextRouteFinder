// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

// Exercises extension.ts against a stubbed editor: the commands, the status
// bar and the QuickPick, none of which routes.test.ts reaches.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createFixture, removeFixture } from './fixture';
import { Stub, installVscodeStub, settle } from './vscodeStub';
import { test } from './runner';

let root: string;
let stub: Stub;

const FIND_ROUTE = 'next-route-finder.findRoute';
const COPY_ROUTE = 'next-route-finder.copyRoute';
const OPEN_IN_BROWSER = 'next-route-finder.openInBrowser';
const GO_TO_RELATED = 'next-route-finder.goToRelatedFile';

function fixtureFile(relative: string): string {
    return path.join(root, relative);
}

function look(relative: string): void {
    stub.activeFile = fixtureFile(relative);
    stub.fireActiveEditorChanged();
}

test('setup: activate the extension against a stubbed editor', async () => {
    root = createFixture();
    stub = installVscodeStub(root);
    // Required lazily: the stub has to be in place before extension.ts loads
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const extension = require('../extension');
    extension.activate({ subscriptions: [] });
    await settle(200);

    assert.deepStrictEqual(Object.keys(stub.handlers).sort(), [GO_TO_RELATED, COPY_ROUTE, OPEN_IN_BROWSER, FIND_ROUTE].sort());
});

test('the watcher only covers the route directories', () => {
    assert.deepStrictEqual(
        stub.drain().filter(entry => entry.startsWith('watcher')),
        ['watcher(**/{app,pages}/**/*.{ts,tsx,js,jsx,mdx})'],
    );
});

test('findRoute resolves a pasted browser URL and opens the file', async () => {
    await stub.handlers[FIND_ROUTE]();
    const picker = stub.quickPick!;

    assert.deepStrictEqual(picker.type('http://localhost:3000/users/42').map(i => i.label), ['/users/[id]']);
    assert.deepStrictEqual(picker.type('http://localhost:3000/blog?tab=1#top').map(i => i.label), ['/blog']);
    assert.ok(picker.items.every(item => item.alwaysShow), 'without alwaysShow the editor filters our results away again');

    picker.accept(0);
    await settle();
    assert.deepStrictEqual(stub.drain(), ['OPEN apps/web/src/app/blog/page.tsx']);
});

test('findRoute says so when nothing matches', async () => {
    await stub.handlers[FIND_ROUTE]();
    assert.deepStrictEqual(stub.quickPick!.type('/definitely-not-here').map(i => i.label), ['No matching route']);
});

test('the status bar follows the active file', () => {
    assert.strictEqual(stub.statusBar.visible, false, 'nothing is open yet');

    look('apps/web/src/app/users/[id]/page.tsx');
    assert.deepStrictEqual([stub.statusBar.visible, stub.statusBar.text], [true, '$(link) /users/[id]']);

    look('apps/web/src/app/users/[id]/layout.tsx');
    assert.strictEqual(stub.statusBar.text, '$(link) /users/[id] (layout)', 'a layout is labelled as one');

    look('apps/web/package.json');
    assert.strictEqual(stub.statusBar.visible, false, 'a file that serves no route hides it');
});

test('the status bar can be turned off', () => {
    // Make it visible first, otherwise "still hidden" would prove nothing
    look('apps/web/src/app/blog/page.tsx');
    assert.strictEqual(stub.statusBar.visible, true);

    stub.config.showStatusBar = false;
    look('apps/web/src/app/blog/page.tsx');
    assert.strictEqual(stub.statusBar.visible, false);

    stub.config.showStatusBar = true;
    look('apps/web/src/app/blog/page.tsx');
    assert.strictEqual(stub.statusBar.text, '$(link) /blog');
});

test('copyRoute copies the route of the active file', async () => {
    look('apps/web/src/app/blog/page.tsx');
    await stub.handlers[COPY_ROUTE]();
    assert.deepStrictEqual(stub.drain(), ['CLIPBOARD /blog', 'TOAST Copied /blog']);

    look('apps/web/package.json');
    await stub.handlers[COPY_ROUTE]();
    assert.deepStrictEqual(stub.drain(), ['INFO Next Route Finder: the active file does not serve a route']);
});

test('openInBrowser asks for the dynamic segments first', async () => {
    look('apps/web/src/app/blog/page.tsx');
    await stub.handlers[OPEN_IN_BROWSER]();
    assert.deepStrictEqual(stub.drain(), ['BROWSER http://localhost:3000/blog']);

    look('apps/web/src/app/users/[id]/page.tsx');
    stub.inputBoxAnswer = '/users/42';
    await stub.handlers[OPEN_IN_BROWSER]();
    assert.deepStrictEqual(stub.drain(), [
        'showInputBox(value=/users/[id])',
        'BROWSER http://localhost:3000/users/42',
    ]);

    stub.inputBoxAnswer = undefined;
    await stub.handlers[OPEN_IN_BROWSER]();
    assert.deepStrictEqual(stub.drain(), ['showInputBox(value=/users/[id])'], 'cancelling opens nothing');
});

test('openInBrowser honours the configured dev server', async () => {
    stub.config.devServerUrl = 'http://127.0.0.1:4000/';
    look('apps/web/src/app/blog/page.tsx');
    await stub.handlers[OPEN_IN_BROWSER]();
    assert.deepStrictEqual(stub.drain(), ['BROWSER http://127.0.0.1:4000/blog']);
    stub.config.devServerUrl = 'http://localhost:3000';
});

test('goToRelatedFile lists the other files of the folder', async () => {
    look('apps/web/src/app/blog/page.tsx');
    stub.quickPickAnswer = 0;
    await stub.handlers[GO_TO_RELATED]();
    assert.deepStrictEqual(stub.drain(), [
        'showQuickPick(loading:loading.tsx, error:error.tsx, not-found:not-found.tsx, template:template.tsx)',
        'OPEN apps/web/src/app/blog/loading.tsx',
    ]);

    look('apps/web/src/app/users/[id]/page.tsx');
    await stub.handlers[GO_TO_RELATED]();
    assert.deepStrictEqual(stub.drain(), [
        'showQuickPick(layout:layout.tsx)',
        'OPEN apps/web/src/app/users/[id]/layout.tsx',
    ]);
});

test('goToRelatedFile has nothing to offer in the pages router', async () => {
    look('legacy/pages/posts/index.tsx');
    await stub.handlers[GO_TO_RELATED]();
    assert.deepStrictEqual(stub.drain(), ['INFO Next Route Finder: no related route files in this folder']);
});

test('a route whose file disappeared reports an error instead of failing silently', async () => {
    const deleted = fixtureFile('apps/web/src/app/blog/page.tsx');
    fs.rmSync(deleted);

    // The extension logs the cause, which is the point, but it would look like
    // a broken test run
    const logged = console.error;
    console.error = () => { /* expected here */ };
    try {
        await stub.handlers[FIND_ROUTE]();
        stub.quickPick!.type('/blog');
        stub.quickPick!.accept(0);
        await settle(100);
    } finally {
        console.error = logged;
    }

    const errors = stub.drain().filter(entry => entry.startsWith('ERROR'));
    assert.strictEqual(errors.length, 1, 'the user is told the file is gone');
    assert.ok(errors[0].includes('cannot open'));

    fs.writeFileSync(deleted, '');
});

test('teardown: remove fixture', () => {
    removeFixture(root);
});
