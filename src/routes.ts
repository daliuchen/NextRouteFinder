// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

// Route discovery and matching. Deliberately free of any `vscode` import so
// that it can be unit tested without launching an extension host.

import * as path from 'path';
import * as fs from 'fs';

const fsp = fs.promises;

export const ROUTE_DIRS = [
    'src/app',
    'app',
    'src/pages',
    'pages',
];

export const ROUTE_FILE_EXTENSIONS = ['.tsx', '.jsx', '.js', '.ts', '.mdx'];

/** Every App Router file kind. The file's basename is the kind, e.g. `loading.tsx`. */
export type RouteKind =
    | 'page'
    | 'layout'
    | 'route'
    | 'loading'
    | 'error'
    | 'not-found'
    | 'template'
    | 'default'
    | 'global-error';

export const ALL_ROUTE_KINDS: RouteKind[] = ['page', 'layout', 'route', 'loading', 'error', 'not-found', 'template', 'default', 'global-error'];

/** The states of a route that are not the route itself. Grouped behind one setting value. */
export const SPECIAL_ROUTE_KINDS: RouteKind[] = ['loading', 'error', 'not-found', 'template', 'default', 'global-error'];

/** What the `nextRouteFinder.include` setting accepts. */
export type IncludeOption = 'page' | 'layout' | 'route' | 'special';

export const ALL_INCLUDE_OPTIONS: IncludeOption[] = ['page', 'layout', 'route', 'special'];
export const DEFAULT_INCLUDE_OPTIONS: IncludeOption[] = ['page', 'route'];

// Not routable: colocated tests, stories and type declarations
const NON_ROUTE_FILE_PATTERN = /\.(test|spec|stories|d)$/;

// Directories that can never contain routes, skipped while walking
export const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'out', 'build', 'coverage']);

export interface RouteEntry {
    route: string;
    // Lowercased route, precomputed so that filtering stays case insensitive
    searchRoute: string;
    file: string;
    kind: RouteKind;
}

export interface RouteDir {
    dir: string;
    isAppDir: boolean;
}

export interface RouteIndex {
    routes: RouteEntry[];
    /** The route directories that were actually found, used for file -> route lookups. */
    dirs: RouteDir[];
}

export const EMPTY_INDEX: RouteIndex = { routes: [], dirs: [] };

export function resolveIncludedKinds(configured: string[] | undefined): Set<RouteKind> {
    const options = (configured ?? DEFAULT_INCLUDE_OPTIONS)
        .filter((option): option is IncludeOption => (ALL_INCLUDE_OPTIONS as string[]).includes(option));
    // An empty or fully invalid setting would silently index nothing
    const effective = options.length > 0 ? options : DEFAULT_INCLUDE_OPTIONS;
    const kinds = new Set<RouteKind>();
    for (const option of effective) {
        if (option === 'special') {
            SPECIAL_ROUTE_KINDS.forEach(kind => kinds.add(kind));
        } else {
            kinds.add(option);
        }
    }
    return kinds;
}

export function isAppRouterDir(dir: string): boolean {
    return dir === 'app' || dir === 'src/app';
}

/**
 * Walks every route directory of every project root. Routes are deduplicated
 * by file and sorted by route.
 */
export async function collectRoutes(projectRoots: string[], includedKinds: Set<RouteKind>): Promise<RouteIndex> {
    const routes: RouteEntry[] = [];
    const dirs: RouteDir[] = [];
    for (const projectRoot of projectRoots) {
        for (const dir of ROUTE_DIRS) {
            const absDir = path.join(projectRoot, dir);
            if (await isDirectory(absDir)) {
                dirs.push({ dir: absDir, isAppDir: isAppRouterDir(dir) });
                await scanAllRoutes(absDir, isAppRouterDir(dir), [], includedKinds, routes);
            }
        }
    }
    // A nested project root can be reached twice (e.g. app/ and src/app/ both present)
    const seen = new Set<string>();
    const deduped = routes
        .filter(entry => {
            if (seen.has(entry.file)) {
                return false;
            }
            seen.add(entry.file);
            return true;
        })
        .sort((a, b) => a.route.localeCompare(b.route) || a.file.localeCompare(b.file));
    return { routes: deduped, dirs };
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
            const found = getRouteFromFileWithParent(entry.name, isAppDir, parentRouteParts);
            if (found && includedKinds.has(found.kind)) {
                out.push({ route: found.route, searchRoute: found.route.toLowerCase(), file: fullPath, kind: found.kind });
            }
        }
    }
}

// Returned instead of a segment name when the whole subtree is not routable
export const SKIP_DIR = Symbol('skip');

/**
 * Maps a directory name to the route segment it contributes.
 * `null` means "recurse but contribute nothing", SKIP_DIR means "do not recurse".
 */
export function toRouteSegment(name: string, isAppDir: boolean): string | null | typeof SKIP_DIR {
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

export function getRouteFromFileWithParent(fileName: string, isAppDir: boolean, parentRouteParts: string[]): { route: string, kind: RouteKind } | null {
    const ext = path.extname(fileName);
    if (!ROUTE_FILE_EXTENSIONS.includes(ext)) {
        return null;
    }
    const base = path.basename(fileName, ext);
    if (isAppDir) {
        if (!(ALL_ROUTE_KINDS as string[]).includes(base)) {
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
    return { route, kind };
}

/**
 * The reverse direction: which route does this file serve? Works for any file
 * below a known route directory, regardless of the `include` setting.
 */
export function routeForFile(index: RouteIndex, filePath: string): { route: string, kind: RouteKind } | null {
    const target = path.resolve(filePath);
    // Longest match wins, so a nested project beats its parent
    const containing = index.dirs
        .filter(({ dir }) => target.startsWith(dir + path.sep))
        .sort((a, b) => b.dir.length - a.dir.length)[0];
    if (!containing) {
        return null;
    }
    const parts = path.relative(containing.dir, target).split(path.sep);
    const fileName = parts[parts.length - 1];
    const routeParts: string[] = [];
    for (const part of parts.slice(0, -1)) {
        const segment = toRouteSegment(part, containing.isAppDir);
        if (segment === SKIP_DIR) {
            return null;
        }
        if (segment !== null) {
            routeParts.push(segment);
        }
    }
    return getRouteFromFileWithParent(fileName, containing.isAppDir, routeParts);
}

// Always leading-slash based so that the root route is '/' instead of an empty
// (and therefore silently dropped) string
export function toRoute(parts: string[]): string {
    return '/' + parts.join('/');
}

/**
 * Turns whatever the user pasted into a route path: a bare route, or a full
 * URL copied from the browser, an error report or a log line.
 */
export function normalizeInput(input: string): string {
    let value = input.trim();

    // scheme://host[:port]
    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
    // host[:port] with no scheme, only when a path follows. The last label has
    // to be letters only, otherwise a route like `v1.0/docs` looks like a host.
    value = value.replace(/^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?=\/)/i, '');
    // query string and fragment
    value = value.split(/[?#]/)[0];

    try {
        value = decodeURIComponent(value);
    } catch {
        // Leave malformed percent-escapes alone
    }

    // Lowercased: real routes are case sensitive, but a search box should not be
    value = value.trim().toLowerCase();
    if (!value.startsWith('/')) {
        value = '/' + value;
    }
    if (value.length > 1) {
        value = value.replace(/\/+$/, '');
    }
    return value;
}

export function filterRoutes(routes: RouteEntry[], input: string): RouteEntry[] {
    const normalized = normalizeInput(input);
    if (normalized === '/') {
        // A bare '/' means the root route, not "everything"
        return routes.filter(r => r.route === '/');
    }
    const loose = normalized.slice(1);
    const matched: { entry: RouteEntry, rank: number }[] = [];
    for (const entry of routes) {
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
    // Ranking matters because alwaysShow bypasses QuickPick's own sorting
    matched.sort((a, b) => a.rank - b.rank || a.entry.route.length - b.entry.route.length || a.entry.route.localeCompare(b.entry.route));
    return matched.map(m => m.entry);
}

export function isDynamicRouteMatch(fileRoute: string, routePath: string): boolean {
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

export function hasDynamicSegment(route: string): boolean {
    return route.split('/').some(part => part.startsWith('[') && part.endsWith(']'));
}

/** Joins a dev server origin and a route into a URL that can be opened. */
export function toDevServerUrl(origin: string, route: string): string {
    return origin.replace(/\/+$/, '') + (route === '/' ? '/' : route);
}
