// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const ROUTE_DIRS = [
    'src/app',
    'app',
    'src/pages',
    'pages',
];

const APP_ROUTE_FILENAMES = ['page.tsx', 'page.jsx', 'page.js', 'page.ts', 'layout.tsx', 'layout.jsx', 'layout.js', 'layout.ts', 'route.ts', 'route.js'];
const PAGE_ROUTE_FILENAMES = ['.tsx', '.jsx', '.js', '.ts'];
const ROUTE_FILE_EXTENSIONS = [...new Set([...APP_ROUTE_FILENAMES.map(name => path.extname(name)), ...PAGE_ROUTE_FILENAMES])];

type RouteEntry = {
    route: string;
    file: string;
    source: string;
    workspaceName: string;
    workspaceRoot: string;
};

// Cache all routes
let allRoutes: RouteEntry[] = [];

function normalizeRoutePath(input: string): string {
    return input.trim().replace(/^\/+|\/+$/g, '');
}

function routeToDisplay(route: string): string {
    return route ? `/${route}` : '/';
}

function buildRouteItem(route: RouteEntry, isMultiRoot: boolean): vscode.QuickPickItem & { file: string } {
    const relativePath = path.relative(route.workspaceRoot, route.file);
    return {
        label: isMultiRoot ? `${route.workspaceName}: ${relativePath}` : relativePath,
        description: routeToDisplay(route.route),
        file: route.file,
    };
}

function scoreRouteMatch(route: string, query: string): number | null {
    if (!query) {
        return 1;
    }

    if (route === query) {
        return 100;
    }

    if (isDynamicRouteMatch(route, query)) {
        return 90;
    }

    if (route.startsWith(query)) {
        return 80;
    }

    if (route.includes(query)) {
        return 70;
    }

    if (query.includes(route)) {
        return 60;
    }

    let cursor = 0;
    for (const char of route) {
        if (char === query[cursor]) {
            cursor += 1;
        }
        if (cursor === query.length) {
            return 50;
        }
    }

    return null;
}

function rebuildAllRoutes() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    allRoutes = [];

    if (!workspaceFolders) {
        return;
    }

    for (const folder of workspaceFolders) {
        const rootPath = folder.uri.fsPath;
        for (const dir of ROUTE_DIRS) {
            const absDir = path.join(rootPath, dir);
            if (fs.existsSync(absDir)) {
                allRoutes.push(...scanAllRoutes(absDir, dir.includes('app'), [], dir, folder.name, rootPath));
            }
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    // 1. Scan all routes on activation
    rebuildAllRoutes();

    // 2. Auto-refresh route cache when route files change
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    let refreshTimer: NodeJS.Timeout | undefined;
    const scheduleRefresh = () => {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
        refreshTimer = setTimeout(() => {
            rebuildAllRoutes();
        }, 200);
    };

    for (const folder of workspaceFolders) {
        for (const dir of ROUTE_DIRS) {
            const pattern = new vscode.RelativePattern(folder, `${dir}/**/*`);
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            const shouldRefresh = (uri: vscode.Uri) => {
                const normalized = uri.fsPath.replace(/\\/g, '/');
                return ROUTE_FILE_EXTENSIONS.some(ext => normalized.endsWith(ext));
            };

            watcher.onDidCreate((uri) => {
                if (shouldRefresh(uri)) {
                    scheduleRefresh();
                }
            });
            watcher.onDidChange((uri) => {
                if (shouldRefresh(uri)) {
                    scheduleRefresh();
                }
            });
            watcher.onDidDelete((uri) => {
                if (shouldRefresh(uri)) {
                    scheduleRefresh();
                }
            });

            context.subscriptions.push(watcher);
        }
    }

    let disposable = vscode.commands.registerCommand('next-route-finder.findRoute', async () => {
        // Show QuickPick, filter in-memory on allRoutes as user types
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = 'Enter Next.js route (e.g. /users/[id] or /blog)';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        const isMultiRoot = (vscode.workspace.workspaceFolders?.length || 0) > 1;
        quickPick.items = [];

        function filterRoutes(input: string) {
            const normalized = normalizeRoutePath(input);

            return allRoutes
                .map(route => ({ route, score: scoreRouteMatch(route.route, normalized) }))
                .filter((item): item is { route: RouteEntry; score: number } => item.score !== null)
                .sort((a, b) => {
                    if (b.score !== a.score) {
                        return b.score - a.score;
                    }
                    if (a.route.route.length !== b.route.route.length) {
                        return a.route.route.length - b.route.route.length;
                    }
                    return a.route.route.localeCompare(b.route.route);
                })
                .map(item => item.route);
        }

        quickPick.onDidChangeValue((value) => {
            if (!value) {
                quickPick.items = [];
                return;
            }
            const results = filterRoutes(value);
            if (results.length === 0) {
                quickPick.items = [{ label: 'No matching results', description: '', alwaysShow: true }];
            } else {
                quickPick.items = results.map(match => buildRouteItem(match, isMultiRoot));
            }
        });
        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (selected && (selected as any).file) {
                openFile((selected as any).file);
                quickPick.hide();
            }
        });
        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
    });
    context.subscriptions.push(disposable);
    context.subscriptions.push({
        dispose: () => {
            if (refreshTimer) {
                clearTimeout(refreshTimer);
            }
        }
    });
}

function scanAllRoutes(baseDir: string, isAppDir: boolean, parentRouteParts: string[] = [], source: string, workspaceName: string, workspaceRoot: string): RouteEntry[] {
    const routes: RouteEntry[] = [];
    const filesAndDirs = fs.readdirSync(baseDir);
    for (const name of filesAndDirs) {
        const fullPath = path.join(baseDir, name);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            // If the directory is wrapped in parentheses, recurse but do not add to route
            if (/^\(.*\)$/.test(name)) {
                routes.push(...scanAllRoutes(fullPath, isAppDir, parentRouteParts, source, workspaceName, workspaceRoot));
            } else {
                routes.push(...scanAllRoutes(fullPath, isAppDir, [...parentRouteParts, name], source, workspaceName, workspaceRoot));
            }
        } else {
            let route = getRouteFromFileWithParent(fullPath, isAppDir, parentRouteParts);
            if (route !== null) {
                routes.push({ route, file: fullPath, source, workspaceName, workspaceRoot });
            }
        }
    }
    return routes;
}

function getRouteFromFileWithParent(filePath: string, isAppDir: boolean, parentRouteParts: string[]): string | null {
    const rel = filePath.replace(/\\/g, '/');
    let routeParts = parentRouteParts.filter(part => !/^\(.*\)$/.test(part));
    if (isAppDir) {
        const match = APP_ROUTE_FILENAMES.find(f => rel.endsWith('/' + f));
        if (!match) return null;
        // Do not include filename in route
        let route = routeParts.join('/');
        return route;
    } else {
        if (!PAGE_ROUTE_FILENAMES.some(ext => rel.endsWith(ext))) return null;
        // File name part
        let fileName = path.basename(filePath, path.extname(filePath));
        if (fileName !== 'index') {
            routeParts = [...routeParts, fileName];
        }
        let route = routeParts.join('/');
        return route;
    }
}

function isDynamicRouteMatch(fileRoute: string, routePath: string): boolean {
    const fileParts = fileRoute.split('/');
    const routeParts = routePath.split('/');
    if (fileParts.length !== routeParts.length) {
        return false;
    }
    return fileParts.every((part, index) => {
        if (part.startsWith('[') && part.endsWith(']')) {
            return true;
        }
        return part === routeParts[index];
    });
}

function openFile(filePath: string) {
    vscode.workspace.openTextDocument(filePath).then(document => {
        vscode.window.showTextDocument(document);
    });
}

export function deactivate() {} 
