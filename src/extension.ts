// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

import * as vscode from 'vscode';
import * as path from 'path';
import {
    ALL_ROUTE_KINDS,
    EMPTY_INDEX,
    RouteEntry,
    RouteIndex,
    RouteKind,
    ROUTE_FILE_EXTENSIONS,
    collectRoutes,
    filterRoutes,
    getRouteFromFileWithParent,
    hasDynamicSegment,
    resolveIncludedKinds,
    routeForFile,
    toDevServerUrl,
} from './routes';

// Upper bound on the project root lookups, keeps huge monorepos responsive
const MAX_PROJECT_ROOTS = 200;

const REFRESH_DEBOUNCE_MS = 500;

const NODE_MODULES_GLOB = '**/node_modules/**';

// Cache all routes
let index: RouteIndex = EMPTY_INDEX;
// Workspace relative paths, resolved once per scan rather than per keystroke
let displayPaths = new Map<string, string>();
let hasScanned = false;
let scanPromise: Promise<void> | undefined;

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'next-route-finder.copyRoute';

    // Kick off the first scan in the background, the commands await it if needed
    void refreshRoutes().then(updateStatusBar);

    // Keep the cache in sync: creating/deleting/renaming a file invalidates it.
    // Scoped to the route directories so unrelated writes do not trigger a rescan.
    const watcher = vscode.workspace.createFileSystemWatcher('**/{app,pages}/**/*.{ts,tsx,js,jsx,mdx}');
    let refreshTimer: NodeJS.Timeout | undefined;
    const scheduleRefresh = () => {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            void refreshRoutes().then(updateStatusBar);
        }, REFRESH_DEBOUNCE_MS);
    };
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);

    context.subscriptions.push(
        statusBarItem,
        watcher,
        vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('nextRouteFinder.include')) {
                scheduleRefresh();
            }
            if (event.affectsConfiguration('nextRouteFinder.showStatusBar')) {
                updateStatusBar();
            }
        }),
        vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar()),
        new vscode.Disposable(() => {
            if (refreshTimer) {
                clearTimeout(refreshTimer);
            }
        }),
        vscode.commands.registerCommand('next-route-finder.findRoute', findRoute),
        vscode.commands.registerCommand('next-route-finder.copyRoute', copyRoute),
        vscode.commands.registerCommand('next-route-finder.openInBrowser', openInBrowser),
        vscode.commands.registerCommand('next-route-finder.goToRelatedFile', goToRelatedFile),
    );
}

// ---------------------------------------------------------------------------
// route -> file
// ---------------------------------------------------------------------------

async function findRoute(): Promise<void> {
    // Show QuickPick, filter in-memory on the cached routes as the user types
    const quickPick = vscode.window.createQuickPick<RouteQuickPickItem>();
    quickPick.placeholder = 'Enter a route or paste a URL (e.g. /users/[id], /blog, http://localhost:3000/users/42)';
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
    quickPick.items = toQuickPickItems(index.routes);

    quickPick.onDidChangeValue((value) => {
        if (!value.trim()) {
            quickPick.items = toQuickPickItems(index.routes);
            return;
        }
        const results = filterRoutes(index.routes, value);
        quickPick.items = results.length > 0
            ? toQuickPickItems(results)
            : [{ label: 'No matching route', alwaysShow: true }];
    });
}

interface RouteQuickPickItem extends vscode.QuickPickItem {
    file?: string;
}

function toQuickPickItems(entries: RouteEntry[]): RouteQuickPickItem[] {
    if (entries.length === 0) {
        // Without this the picker is just blank and the user cannot tell why
        return [{
            label: 'No Next.js routes found in this workspace',
            detail: 'Looked for app/, src/app/, pages/ and src/pages/ next to every next.config.* and package.json',
            alwaysShow: true,
        }];
    }
    return entries.map(entry => ({
        label: entry.route,
        description: displayPaths.get(entry.file) ?? entry.file,
        // QuickPick applies its own fuzzy filter on top of the items we set,
        // which would drop results our matcher deliberately kept (e.g. /users/123 -> /users/[id])
        alwaysShow: true,
        file: entry.file,
    }));
}

// ---------------------------------------------------------------------------
// file -> route
// ---------------------------------------------------------------------------

function activeRoute(): { route: string, kind: RouteKind } | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
        return null;
    }
    return routeForFile(index, editor.document.uri.fsPath);
}

function updateStatusBar(): void {
    if (!vscode.workspace.getConfiguration('nextRouteFinder').get<boolean>('showStatusBar', true)) {
        statusBarItem.hide();
        return;
    }
    const found = activeRoute();
    if (!found) {
        statusBarItem.hide();
        return;
    }
    statusBarItem.text = found.kind === 'page' ? `$(link) ${found.route}` : `$(link) ${found.route} (${found.kind})`;
    statusBarItem.tooltip = `Next.js route of this file — click to copy "${found.route}"`;
    statusBarItem.show();
}

async function copyRoute(): Promise<void> {
    await ensureRoutes();
    const found = activeRoute();
    if (!found) {
        vscode.window.showInformationMessage('Next Route Finder: the active file does not serve a route');
        return;
    }
    await vscode.env.clipboard.writeText(found.route);
    vscode.window.setStatusBarMessage(`Copied ${found.route}`, 3000);
}

async function openInBrowser(): Promise<void> {
    await ensureRoutes();
    const found = activeRoute();
    if (!found) {
        vscode.window.showInformationMessage('Next Route Finder: the active file does not serve a route');
        return;
    }

    let route = found.route;
    if (hasDynamicSegment(route)) {
        // A URL with [id] in it is not openable, let the user fill the values in
        const filled = await vscode.window.showInputBox({
            prompt: 'Fill in the dynamic segments',
            value: route,
            valueSelection: [route.indexOf('['), route.length],
        });
        if (filled === undefined) {
            return;
        }
        route = filled.startsWith('/') ? filled : '/' + filled;
    }

    const origin = vscode.workspace.getConfiguration('nextRouteFinder').get<string>('devServerUrl', 'http://localhost:3000');
    await vscode.env.openExternal(vscode.Uri.parse(toDevServerUrl(origin, route)));
}

async function goToRelatedFile(): Promise<void> {
    await ensureRoutes();
    const editor = vscode.window.activeTextEditor;
    if (!editor || !activeRoute()) {
        vscode.window.showInformationMessage('Next Route Finder: the active file does not serve a route');
        return;
    }

    const current = editor.document.uri.fsPath;
    const dir = path.dirname(current);
    let siblings: [string, vscode.FileType][];
    try {
        siblings = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
    } catch {
        vscode.window.showInformationMessage(`Next Route Finder: cannot read ${dir}`);
        return;
    }

    const related = siblings
        .filter(([name, type]) => type === vscode.FileType.File && path.join(dir, name) !== current)
        .map(([name]) => ({ name, kind: kindOfRouteFile(name) }))
        .filter((candidate): candidate is { name: string, kind: RouteKind } => candidate.kind !== null)
        .sort((a, b) => ALL_ROUTE_KINDS.indexOf(a.kind) - ALL_ROUTE_KINDS.indexOf(b.kind));

    if (related.length === 0) {
        vscode.window.showInformationMessage('Next Route Finder: no related route files in this folder');
        return;
    }

    const picked = await vscode.window.showQuickPick(
        related.map(({ name, kind }) => ({ label: kind, description: name })),
        { placeHolder: `Related files in ${vscode.workspace.asRelativePath(dir)}` }
    );
    if (picked) {
        await openFile(path.join(dir, picked.description));
    }
}

/** The App Router kind of a bare filename, or null when it is not a route file. */
function kindOfRouteFile(fileName: string): RouteKind | null {
    if (!ROUTE_FILE_EXTENSIONS.includes(path.extname(fileName))) {
        return null;
    }
    return getRouteFromFileWithParent(fileName, true, [])?.kind ?? null;
}

// ---------------------------------------------------------------------------
// scanning
// ---------------------------------------------------------------------------

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
        index = await collectRoutes(await findProjectRoots(), includedKinds);
        displayPaths = new Map(index.routes.map(entry => [entry.file, vscode.workspace.asRelativePath(entry.file)]));
    } catch (err) {
        // A single unreadable directory must never take the whole extension down
        console.error('[next-route-finder] route scan failed', err);
    }
    hasScanned = true;
}

/**
 * Next.js projects are not necessarily at the workspace root (monorepos).
 * `next.config.*` is the strongest signal but it is optional, so package.json
 * directories are used as a fallback.
 */
async function findProjectRoots(): Promise<string[]> {
    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        roots.add(folder.uri.fsPath);
    }
    const configs = await vscode.workspace.findFiles('**/next.config.{js,cjs,mjs,ts,cts,mts}', NODE_MODULES_GLOB, MAX_PROJECT_ROOTS);
    for (const config of configs) {
        roots.add(path.dirname(config.fsPath));
    }
    // One over the cap, so that hitting it can be told apart from landing on it
    const packageJsons = await vscode.workspace.findFiles('**/package.json', NODE_MODULES_GLOB, MAX_PROJECT_ROOTS + 1);
    if (packageJsons.length > MAX_PROJECT_ROOTS) {
        console.warn(`[next-route-finder] more than ${MAX_PROJECT_ROOTS} package.json files, only the first ${MAX_PROJECT_ROOTS} are scanned for routes`);
    }
    for (const pkg of packageJsons.slice(0, MAX_PROJECT_ROOTS)) {
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
        void refreshRoutes().then(updateStatusBar);
    }
}

// Everything that needs cleanup is registered on context.subscriptions
// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() { }
