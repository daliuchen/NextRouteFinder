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

// Cache all routes
let allRoutes: { route: string, file: string, source: string }[] = [];

export function activate(context: vscode.ExtensionContext) {
    // 1. Scan all routes on activation
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const rootPath = workspaceFolders[0].uri.fsPath;
        allRoutes = [];
        for (const dir of ROUTE_DIRS) {
            const absDir = path.join(rootPath, dir);
            if (fs.existsSync(absDir)) {
                allRoutes.push(...scanAllRoutes(absDir, dir.includes('app'), [], dir));
            }
        }
    }

    let disposable = vscode.commands.registerCommand('next-route-finder.findRoute', async () => {
        // Show QuickPick, filter in-memory on allRoutes as user types
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = 'Enter Next.js route (e.g. /users/[id] or /blog)';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const rootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
        quickPick.items = allRoutes.map(match => ({
            label: path.relative(rootPath, match.file),
            description: match.route,
            file: match.file
        }));

        function filterRoutes(input: string) {
            if (!input) return [];
            const normalized = input.startsWith('/') ? input.slice(1) : input;
            return allRoutes.filter(r =>
                r.route === normalized ||
                isDynamicRouteMatch(r.route, normalized) ||
                r.route.includes(normalized) ||
                normalized.includes(r.route)
            );
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
                quickPick.items = results.map(match => ({
                    label: path.relative(rootPath, match.file),
                    description: match.route,
                    file: match.file
                }));
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
}

function scanAllRoutes(baseDir: string, isAppDir: boolean, parentRouteParts: string[] = [], source: string): { route: string, file: string, source: string }[] {
    const routes: { route: string, file: string, source: string }[] = [];
    const filesAndDirs = fs.readdirSync(baseDir);
    for (const name of filesAndDirs) {
        const fullPath = path.join(baseDir, name);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            // If the directory is wrapped in parentheses, recurse but do not add to route
            if (/^\(.*\)$/.test(name)) {
                routes.push(...scanAllRoutes(fullPath, isAppDir, parentRouteParts, source));
            } else {
                routes.push(...scanAllRoutes(fullPath, isAppDir, [...parentRouteParts, name], source));
            }
        } else {
            let route = getRouteFromFileWithParent(fullPath, isAppDir, parentRouteParts);
            if (route) {
                routes.push({ route, file: fullPath, source });
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