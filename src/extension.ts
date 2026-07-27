// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const fsp = fs.promises;

const ROUTE_DIRS = [
    'src/app',
    'app',
    'src/pages',
    'pages',
];

const ROUTE_FILE_EXTENSIONS = ['.tsx', '.jsx', '.js', '.ts'];

type RouteKind = 'page' | 'layout' | 'route';

const ALL_ROUTE_KINDS: RouteKind[] = ['page', 'layout', 'route'];
const DEFAULT_ROUTE_KINDS: RouteKind[] = ['page', 'route'];

// Not routable: colocated tests, stories and type declarations
const NON_ROUTE_FILE_PATTERN = /\.(test|spec|stories|d)$/;

// Directories that can never contain routes, skipped while walking
const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'out', 'build', 'coverage']);

// Upper bound on package.json lookups, keeps huge monorepos responsive
const MAX_PROJECT_ROOTS = 200;

const REFRESH_DEBOUNCE_MS = 500;

interface RouteEntry {
    route: string;
    // Lowercased route, precomputed so that filtering stays case insensitive
    searchRoute: string;
    file: string;
    kind: RouteKind;
}

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
            const results = filterRoutes(value);
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

function normalizeInput(input: string): string {
    // Lowercased: real routes are case sensitive, but a search box should not be
    let value = input.trim().toLowerCase();
    if (!value.startsWith('/')) {
        value = '/' + value;
    }
    if (value.length > 1) {
        value = value.replace(/\/+$/, '');
    }
    return value;
}

function filterRoutes(input: string): RouteEntry[] {
    const normalized = normalizeInput(input);
    if (normalized === '/') {
        // A bare '/' means the root route, not "everything"
        return allRoutes.filter(r => r.route === '/');
    }
    const loose = normalized.slice(1);
    const matched: { entry: RouteEntry, rank: number }[] = [];
    for (const entry of allRoutes) {
        let rank: number;
        if (entry.searchRoute === normalized) {
            rank = 0;
        } else if (isDynamicRouteMatch(entry.searchRoute, normalized)) {
            rank = 1;
        } else if (entry.searchRoute.includes(loose)) {
            rank = 2;
        } else if (entry.route !== '/' && loose.includes(entry.searchRoute.slice(1))) {
            rank = 3;
        } else {
            continue;
        }
        matched.push({ entry, rank });
    }
    // Ranking matters now that alwaysShow bypasses QuickPick's own sorting
    matched.sort((a, b) => a.rank - b.rank || a.entry.route.length - b.entry.route.length || a.entry.route.localeCompare(b.entry.route));
    return matched.map(m => m.entry);
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
    const routes: RouteEntry[] = [];
    const includedKinds = getIncludedKinds();
    try {
        for (const projectRoot of await findProjectRoots()) {
            for (const dir of ROUTE_DIRS) {
                const absDir = path.join(projectRoot, dir);
                if (await isDirectory(absDir)) {
                    await scanAllRoutes(absDir, isAppRouterDir(dir), [], includedKinds, routes);
                }
            }
        }
    } catch (err) {
        // A single unreadable directory must never take the whole extension down
        console.error('[next-route-finder] route scan failed', err);
    }
    // A nested project root can be reached twice (e.g. app/ and src/app/ both present)
    const seen = new Set<string>();
    allRoutes = routes.filter(entry => {
        if (seen.has(entry.file)) {
            return false;
        }
        seen.add(entry.file);
        return true;
    }).sort((a, b) => a.route.localeCompare(b.route));
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

function isAppRouterDir(dir: string): boolean {
    return dir === 'app' || dir === 'src/app';
}

function getIncludedKinds(): Set<RouteKind> {
    const configured = vscode.workspace.getConfiguration('nextRouteFinder').get<string[]>('include');
    const kinds = new Set<RouteKind>(
        (configured ?? DEFAULT_ROUTE_KINDS).filter((kind): kind is RouteKind => (ALL_ROUTE_KINDS as string[]).includes(kind))
    );
    // An empty or fully invalid setting would silently index nothing
    return kinds.size > 0 ? kinds : new Set(DEFAULT_ROUTE_KINDS);
}

async function isDirectory(target: string): Promise<boolean> {
    try {
        return (await fsp.stat(target)).isDirectory();
    } catch {
        return false;
    }
}

async function scanAllRoutes(baseDir: string, isAppDir: boolean, parentRouteParts: string[], includedKinds: Set<RouteKind>, out: RouteEntry[]): Promise<void> {
    let entries: fs.Dirent[];
    try {
        entries = await fsp.readdir(baseDir, { withFileTypes: true });
    } catch (err) {
        // Permission errors / broken symlinks only skip this subtree
        console.error(`[next-route-finder] cannot read ${baseDir}`, err);
        return;
    }
    for (const entry of entries) {
        const fullPath = path.join(baseDir, entry.name);
        if (entry.isDirectory()) {
            const segment = toRouteSegment(entry.name, isAppDir);
            if (segment === SKIP_DIR) {
                continue;
            }
            const nextParts = segment === null ? parentRouteParts : [...parentRouteParts, segment];
            await scanAllRoutes(fullPath, isAppDir, nextParts, includedKinds, out);
        } else if (entry.isFile()) {
            const found = getRouteFromFileWithParent(entry.name, isAppDir, parentRouteParts, includedKinds);
            if (found) {
                out.push({ route: found.route, searchRoute: found.route.toLowerCase(), file: fullPath, kind: found.kind });
            }
        }
    }
}

// Returned instead of a segment name when the whole subtree is not routable
const SKIP_DIR = Symbol('skip');

/**
 * Maps a directory name to the route segment it contributes.
 * `null` means "recurse but contribute nothing", SKIP_DIR means "do not recurse".
 */
function toRouteSegment(name: string, isAppDir: boolean): string | null | typeof SKIP_DIR {
    if (IGNORED_DIRS.has(name)) {
        return SKIP_DIR;
    }
    if (!isAppDir) {
        return name;
    }
    // Private folder: opted out of routing entirely
    if (name.startsWith('_')) {
        return SKIP_DIR;
    }
    // Route group (folder) and parallel route slot @folder: transparent to the URL
    if (/^\(.*\)$/.test(name) || name.startsWith('@')) {
        return null;
    }
    // Intercepting route: (.)folder, (..)folder, (..)(..)folder, (...)folder.
    // The markers say which level is intercepted, the tail is the segment name.
    const intercepted = name.replace(/^(\(\.{1,3}\))+/, '');
    return intercepted === name ? name : (intercepted || null);
}

function getRouteFromFileWithParent(fileName: string, isAppDir: boolean, parentRouteParts: string[], includedKinds: Set<RouteKind>): { route: string, kind: RouteKind } | null {
    const ext = path.extname(fileName);
    if (!ROUTE_FILE_EXTENSIONS.includes(ext)) {
        return null;
    }
    const base = path.basename(fileName, ext);
    if (isAppDir) {
        if (!(ALL_ROUTE_KINDS as string[]).includes(base) || !includedKinds.has(base as RouteKind)) {
            return null;
        }
        // Do not include filename in route
        return { route: toRoute(parentRouteParts), kind: base as RouteKind };
    }
    // Pages router: _app / _document / _error and friends are not routable
    if (base.startsWith('_') || NON_ROUTE_FILE_PATTERN.test(base)) {
        return null;
    }
    const route = base === 'index' ? toRoute(parentRouteParts) : toRoute([...parentRouteParts, base]);
    // pages/api/* are the pages-router equivalent of App Router route handlers
    const kind: RouteKind = route === '/api' || route.startsWith('/api/') ? 'route' : 'page';
    return includedKinds.has(kind) ? { route, kind } : null;
}

// Always leading-slash based so that the root route is '/' instead of an empty
// (and therefore silently dropped) string
function toRoute(parts: string[]): string {
    return '/' + parts.join('/');
}

function isDynamicRouteMatch(fileRoute: string, routePath: string): boolean {
    const fileParts = fileRoute.split('/');
    const routeParts = routePath.split('/');
    for (let i = 0; i < fileParts.length; i++) {
        const part = fileParts[i];
        // [[...slug]] swallows every remaining segment, including none at all
        if (/^\[\[\.\.\..*\]\]$/.test(part)) {
            return true;
        }
        // [...slug] swallows every remaining segment, but needs at least one
        if (/^\[\.\.\..*\]$/.test(part)) {
            return routeParts.length > i;
        }
        if (i >= routeParts.length) {
            return false;
        }
        // [id] matches exactly one segment
        if (part.startsWith('[') && part.endsWith(']')) {
            continue;
        }
        if (part !== routeParts[i]) {
            return false;
        }
    }
    return fileParts.length === routeParts.length;
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

export function deactivate() { }
