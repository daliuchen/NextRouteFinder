// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

import * as vscode from 'vscode';
import * as path from 'path';
import { RouteEntry, collectRoutes, filterRoutes, resolveIncludedKinds } from './routes';

// Upper bound on package.json lookups, keeps huge monorepos responsive
const MAX_PROJECT_ROOTS = 200;

const REFRESH_DEBOUNCE_MS = 500;

// Cache all routes
let allRoutes: RouteEntry[] = [];
let hasScanned = false;
let scanPromise: Promise<void> | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Kick off the first scan in the background, the command awaits it if needed
    void refreshRoutes();

    // Keep the cache in sync: creating/deleting/renaming a file invalidates it
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx}');
    let refreshTimer: NodeJS.Timeout | undefined;
    const scheduleRefresh = () => {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            void refreshRoutes();
        }, REFRESH_DEBOUNCE_MS);
    };
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
    context.subscriptions.push(
        watcher,
        vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('nextRouteFinder.include')) {
                scheduleRefresh();
            }
        }),
        new vscode.Disposable(() => {
            if (refreshTimer) {
                clearTimeout(refreshTimer);
            }
        })
    );

    const disposable = vscode.commands.registerCommand('next-route-finder.findRoute', async () => {
        // Show QuickPick, filter in-memory on allRoutes as user types
        const quickPick = vscode.window.createQuickPick<RouteQuickPickItem>();
        quickPick.placeholder = 'Enter Next.js route (e.g. /users/[id] or /blog)';
        quickPick.matchOnDescription = true;

        let hidden = false;
        quickPick.onDidHide(() => {
            hidden = true;
            quickPick.dispose();
        });
        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (selected && selected.file) {
                void openFile(selected.file);
                quickPick.hide();
            }
        });

        quickPick.busy = true;
        quickPick.show();
        await ensureRoutes();
        if (hidden) {
            return;
        }
        quickPick.busy = false;
        quickPick.items = toQuickPickItems(allRoutes);

        quickPick.onDidChangeValue((value) => {
            if (!value.trim()) {
                quickPick.items = toQuickPickItems(allRoutes);
                return;
            }
            const results = filterRoutes(allRoutes, value);
            if (results.length === 0) {
                quickPick.items = [{ label: 'No matching results', alwaysShow: true }];
            } else {
                quickPick.items = toQuickPickItems(results);
            }
        });
    });
    context.subscriptions.push(disposable);
}

interface RouteQuickPickItem extends vscode.QuickPickItem {
    file?: string;
}

function toQuickPickItems(entries: RouteEntry[]): RouteQuickPickItem[] {
    return entries.map(entry => ({
        label: entry.route,
        description: vscode.workspace.asRelativePath(entry.file),
        // QuickPick applies its own fuzzy filter on top of the items we set,
        // which would drop results our matcher deliberately kept (e.g. /users/123 -> /users/[id])
        alwaysShow: true,
        file: entry.file,
    }));
}

async function ensureRoutes(): Promise<void> {
    if (scanPromise) {
        return scanPromise;
    }
    if (!hasScanned) {
        return refreshRoutes();
    }
}

function refreshRoutes(): Promise<void> {
    if (!scanPromise) {
        scanPromise = scanWorkspace().finally(() => {
            scanPromise = undefined;
        });
    }
    return scanPromise;
}

async function scanWorkspace(): Promise<void> {
    const includedKinds = resolveIncludedKinds(vscode.workspace.getConfiguration('nextRouteFinder').get<string[]>('include'));
    try {
        allRoutes = await collectRoutes(await findProjectRoots(), includedKinds);
    } catch (err) {
        // A single unreadable directory must never take the whole extension down
        console.error('[next-route-finder] route scan failed', err);
    }
    hasScanned = true;
}

// Next.js projects are not necessarily at the workspace root (monorepos),
// so every package.json directory is a candidate project root.
async function findProjectRoots(): Promise<string[]> {
    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        roots.add(folder.uri.fsPath);
    }
    const packageJsons = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', MAX_PROJECT_ROOTS);
    for (const pkg of packageJsons) {
        roots.add(path.dirname(pkg.fsPath));
    }
    return [...roots];
}

async function openFile(filePath: string): Promise<void> {
    try {
        const document = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(document);
    } catch (err) {
        vscode.window.showErrorMessage(`Next Route Finder: cannot open ${filePath}`);
        console.error('[next-route-finder] open failed', err);
        // The cache is probably stale if the file is gone
        void refreshRoutes();
    }
}

// Everything that needs cleanup is registered on context.subscriptions
// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() { }
