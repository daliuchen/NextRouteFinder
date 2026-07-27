// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

// A stand-in for the `vscode` module, enough of it to drive extension.ts and
// observe what it does. Installed into the module loader so that requiring the
// extension picks it up instead of the real API, which only exists inside a
// running editor.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from 'fs';
import * as path from 'path';

export interface Stub {
    /** Everything the extension did that a user would notice, in order. */
    log: string[];
    /** Returns the log and clears it. */
    drain(): string[];
    /** Commands the extension registered. */
    handlers: Record<string, () => Promise<void>>;
    /** Settings the extension reads. */
    config: { include?: string[], showStatusBar: boolean, devServerUrl: string };
    statusBar: { text: string, tooltip: string, command: string, visible: boolean };
    quickPick: QuickPickStub | undefined;
    /** The file the user is looking at. */
    activeFile: string | null;
    /** Fires onDidChangeActiveTextEditor. */
    fireActiveEditorChanged(): void;
    /** What showInputBox returns; undefined means the user cancelled. */
    inputBoxAnswer: string | undefined;
    /** Which entry showQuickPick returns. */
    quickPickAnswer: number;
}

export interface QuickPickStub {
    items: { label: string, description?: string, detail?: string, alwaysShow?: boolean }[];
    busy: boolean;
    /** Types into the picker and returns the resulting items. */
    type(value: string): QuickPickStub['items'];
    /** Accepts the item at `position`. */
    accept(position: number): void;
}

const noop = { dispose() { /* nothing to release */ } };

export function installVscodeStub(workspaceRoot: string): Stub {
    const listeners: Record<string, ((arg?: any) => void)[]> = {};
    const on = (name: string) => (cb: (arg?: any) => void) => {
        (listeners[name] = listeners[name] ?? []).push(cb);
        return noop;
    };

    const stub: Stub = {
        log: [],
        drain() { return this.log.splice(0, this.log.length); },
        handlers: {},
        config: { include: undefined, showStatusBar: true, devServerUrl: 'http://localhost:3000' },
        statusBar: { text: '', tooltip: '', command: '', visible: false },
        quickPick: undefined,
        activeFile: null,
        fireActiveEditorChanged() { (listeners['editor'] ?? []).forEach(cb => cb()); },
        inputBoxAnswer: undefined,
        quickPickAnswer: 0,
    };

    const relative = (target: string) => path.relative(workspaceRoot, target).split(path.sep).join('/');

    const vscode = {
        Disposable: class {
            constructor(private readonly onDispose?: () => void) { }
            dispose() { this.onDispose?.(); }
        },
        StatusBarAlignment: { Left: 1, Right: 2 },
        FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
        Uri: {
            file: (target: string) => ({ fsPath: target, scheme: 'file', toString: () => target }),
            parse: (value: string) => ({ fsPath: value, scheme: 'https', toString: () => value }),
        },
        workspace: {
            workspaceFolders: [{ uri: { fsPath: workspaceRoot } }],
            async findFiles(include: string, _exclude: string, max: number) {
                const wanted = include.includes('next.config')
                    ? /^next\.config\.(js|cjs|mjs|ts|cts|mts)$/
                    : /^package\.json$/;
                const found: { fsPath: string }[] = [];
                (function walk(dir: string) {
                    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                        if (entry.isDirectory()) {
                            if (entry.name !== 'node_modules') {
                                walk(path.join(dir, entry.name));
                            }
                        } else if (wanted.test(entry.name)) {
                            found.push({ fsPath: path.join(dir, entry.name) });
                        }
                    }
                })(workspaceRoot);
                return found.slice(0, max);
            },
            createFileSystemWatcher(glob: string) {
                stub.log.push(`watcher(${glob})`);
                return { onDidCreate: on('create'), onDidChange: on('change'), onDidDelete: on('delete'), dispose() { /* noop */ } };
            },
            onDidChangeWorkspaceFolders: on('folders'),
            onDidChangeConfiguration: on('config'),
            getConfiguration: () => ({
                get: (key: keyof Stub['config'], fallback?: unknown) => stub.config[key] ?? fallback,
            }),
            asRelativePath: relative,
            async openTextDocument(target: string) {
                if (!fs.existsSync(target)) {
                    throw new Error(`ENOENT: ${target}`);
                }
                return { uri: { fsPath: target, scheme: 'file' } };
            },
            fs: {
                async readDirectory(uri: { fsPath: string }) {
                    return fs.readdirSync(uri.fsPath, { withFileTypes: true })
                        .map(entry => [entry.name, entry.isDirectory() ? 2 : 1]);
                },
            },
        },
        window: {
            get activeTextEditor() {
                return stub.activeFile ? { document: { uri: { fsPath: stub.activeFile, scheme: 'file' } } } : undefined;
            },
            onDidChangeActiveTextEditor: on('editor'),
            createStatusBarItem() {
                Object.assign(stub.statusBar, { text: '', tooltip: '', command: '', visible: false });
                return Object.assign(stub.statusBar, {
                    show() { stub.statusBar.visible = true; },
                    hide() { stub.statusBar.visible = false; },
                    dispose() { /* noop */ },
                });
            },
            createQuickPick() {
                const onValue: ((value: string) => void)[] = [];
                const onAccept: (() => void)[] = [];
                const onHide: (() => void)[] = [];
                const picker = {
                    value: '',
                    items: [] as QuickPickStub['items'],
                    busy: false,
                    placeholder: '',
                    matchOnDescription: false,
                    selectedItems: [] as QuickPickStub['items'],
                    onDidChangeValue(cb: (value: string) => void) { onValue.push(cb); return noop; },
                    onDidAccept(cb: () => void) { onAccept.push(cb); return noop; },
                    onDidHide(cb: () => void) { onHide.push(cb); return noop; },
                    show() { /* noop */ },
                    hide() { onHide.forEach(cb => cb()); },
                    dispose() { /* noop */ },
                    type(value: string) {
                        picker.value = value;
                        onValue.forEach(cb => cb(value));
                        return picker.items;
                    },
                    accept(position: number) {
                        picker.selectedItems = [picker.items[position]];
                        onAccept.forEach(cb => cb());
                    },
                };
                stub.quickPick = picker as unknown as QuickPickStub;
                return picker;
            },
            async showQuickPick(items: { label: string, description?: string }[]) {
                stub.log.push(`showQuickPick(${items.map(i => `${i.label}:${i.description}`).join(', ')})`);
                return items[stub.quickPickAnswer];
            },
            async showInputBox(options: { value?: string }) {
                stub.log.push(`showInputBox(value=${options.value})`);
                return stub.inputBoxAnswer;
            },
            async showTextDocument(document: { uri: { fsPath: string } }) {
                stub.log.push(`OPEN ${relative(document.uri.fsPath)}`);
            },
            showErrorMessage: (message: string) => stub.log.push(`ERROR ${message}`),
            showInformationMessage: (message: string) => stub.log.push(`INFO ${message}`),
            setStatusBarMessage: (message: string) => stub.log.push(`TOAST ${message}`),
        },
        commands: {
            registerCommand(id: string, handler: () => Promise<void>) {
                stub.handlers[id] = handler;
                return noop;
            },
        },
        env: {
            clipboard: { writeText: async (text: string) => stub.log.push(`CLIPBOARD ${text}`) },
            openExternal: async (uri: { toString(): string }) => stub.log.push(`BROWSER ${uri.toString()}`),
        },
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Module = require('module');
    const load = Module._load;
    Module._load = function (request: string, ...rest: unknown[]) {
        return request === 'vscode' ? vscode : load.call(this, request, ...rest);
    };

    return stub;
}

/** Lets pending promises and microtasks settle. */
export function settle(ms = 20): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
