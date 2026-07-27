// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    RouteEntry,
    SKIP_DIR,
    collectRoutes,
    filterRoutes,
    isDynamicRouteMatch,
    normalizeInput,
    resolveIncludedKinds,
    toRouteSegment,
} from '../routes';
import { test } from './runner';

// A monorepo with an App Router project and a pages-router project,
// covering every folder convention the scanner has to understand.
const FIXTURE_FILES = [
    'apps/web/package.json',
    'apps/web/src/app/page.tsx',
    'apps/web/src/app/layout.tsx',
    'apps/web/src/app/blog/page.tsx',
    'apps/web/src/app/(marketing)/about/page.tsx',
    'apps/web/src/app/users/[id]/page.tsx',
    'apps/web/src/app/users/[id]/layout.tsx',
    'apps/web/src/app/docs/[...slug]/page.tsx',
    'apps/web/src/app/shop/[[...filters]]/page.tsx',
    'apps/web/src/app/api/health/route.ts',
    'apps/web/src/app/@modal/page.tsx',
    'apps/web/src/app/feed/@sidebar/trending/page.tsx',
    'apps/web/src/app/photos/(.)photo/[id]/page.tsx',
    'apps/web/src/app/settings/(..)(..)billing/page.tsx',
    'apps/web/src/app/_private/foo/page.tsx',
    'apps/web/src/app/blog/BlogCard.tsx',
    'apps/web/src/app/node_modules/pkg/app/page.tsx',
    'legacy/package.json',
    'legacy/pages/index.tsx',
    'legacy/pages/posts/index.tsx',
    'legacy/pages/posts/[slug].tsx',
    'legacy/pages/api/health.ts',
    'legacy/pages/api/users/[id].ts',
    'legacy/pages/_app.tsx',
    'legacy/pages/_document.tsx',
    'legacy/pages/index.test.tsx',
    'legacy/pages/types.d.ts',
    'legacy/pages/README.md',
];

let fixtureRoot: string;

function createFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'next-route-finder-'));
    for (const relative of FIXTURE_FILES) {
        const full = path.join(root, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, '');
    }
    return root;
}

function projectRoots(): string[] {
    return [fixtureRoot, path.join(fixtureRoot, 'apps/web'), path.join(fixtureRoot, 'legacy')];
}

async function scan(include?: string[]): Promise<RouteEntry[]> {
    return collectRoutes(projectRoots(), resolveIncludedKinds(include));
}

function routesOf(entries: RouteEntry[]): string[] {
    return entries.map(e => e.route);
}

function relativeFiles(entries: RouteEntry[]): string[] {
    return entries.map(e => path.relative(fixtureRoot, e.file).split(path.sep).join('/'));
}

test('setup: create fixture', () => {
    fixtureRoot = createFixture();
});

test('scans both routers across a monorepo, with default include', async () => {
    assert.deepStrictEqual(relativeFiles(await scan()), [
        'apps/web/src/app/@modal/page.tsx',
        'apps/web/src/app/page.tsx',
        'legacy/pages/index.tsx',
        'apps/web/src/app/(marketing)/about/page.tsx',
        'apps/web/src/app/api/health/route.ts',
        'legacy/pages/api/health.ts',
        'legacy/pages/api/users/[id].ts',
        'apps/web/src/app/blog/page.tsx',
        'apps/web/src/app/docs/[...slug]/page.tsx',
        'apps/web/src/app/feed/@sidebar/trending/page.tsx',
        'apps/web/src/app/photos/(.)photo/[id]/page.tsx',
        'legacy/pages/posts/index.tsx',
        'legacy/pages/posts/[slug].tsx',
        'apps/web/src/app/settings/(..)(..)billing/page.tsx',
        'apps/web/src/app/shop/[[...filters]]/page.tsx',
        'apps/web/src/app/users/[id]/page.tsx',
    ]);
});

test('root page resolves to "/" instead of being dropped', async () => {
    const roots = (await scan()).filter(e => e.route === '/');
    assert.deepStrictEqual(relativeFiles(roots), [
        'apps/web/src/app/@modal/page.tsx',
        'apps/web/src/app/page.tsx',
        'legacy/pages/index.tsx',
    ]);
});

test('app router folder conventions map to the served URL', async () => {
    const entries = await scan();
    const routeFor = (file: string) => entries.find(e => e.file.endsWith(file.split('/').join(path.sep)))?.route;
    assert.strictEqual(routeFor('(marketing)/about/page.tsx'), '/about', 'route group is transparent');
    assert.strictEqual(routeFor('@modal/page.tsx'), '/', 'parallel route slot is transparent');
    assert.strictEqual(routeFor('feed/@sidebar/trending/page.tsx'), '/feed/trending');
    assert.strictEqual(routeFor('photos/(.)photo/[id]/page.tsx'), '/photos/photo/[id]', 'intercept marker stripped');
    assert.strictEqual(routeFor('settings/(..)(..)billing/page.tsx'), '/settings/billing');
});

test('non routable files and folders are skipped', async () => {
    const files = relativeFiles(await scan(['page', 'layout', 'route']));
    for (const skipped of [
        '_private',           // app router private folder
        'BlogCard.tsx',       // app router only routes page/layout/route files
        'node_modules',       // never scanned
        '_app.tsx',
        '_document.tsx',
        'index.test.tsx',
        'types.d.ts',
        'README.md',
    ]) {
        assert.ok(!files.some(f => f.includes(skipped)), `${skipped} should not be indexed, got ${files.join(', ')}`);
    }
});

test('include setting controls layouts and route handlers', async () => {
    const defaults = await scan();
    assert.strictEqual(routesOf(defaults).filter(r => r === '/users/[id]').length, 1, 'layout excluded by default');

    const withLayouts = await scan(['page', 'layout', 'route']);
    assert.strictEqual(routesOf(withLayouts).filter(r => r === '/users/[id]').length, 2);

    const pagesOnly = await scan(['page']);
    assert.ok(!routesOf(pagesOnly).some(r => r.startsWith('/api')), 'route handlers excluded');
    assert.ok(!relativeFiles(pagesOnly).some(f => f.endsWith('layout.tsx')));

    // Invalid or empty settings fall back to the default instead of indexing nothing
    assert.deepStrictEqual(routesOf(await scan([])), routesOf(defaults));
    assert.deepStrictEqual(routesOf(await scan(['nonsense'])), routesOf(defaults));
    assert.deepStrictEqual(routesOf(await scan(undefined)), routesOf(defaults));
});

test('pages/api is classified as a route handler', async () => {
    const entries = await scan(['route']);
    assert.deepStrictEqual(relativeFiles(entries), [
        'apps/web/src/app/api/health/route.ts',
        'legacy/pages/api/health.ts',
        'legacy/pages/api/users/[id].ts',
    ]);
    assert.ok(entries.every(e => e.kind === 'route'));
});

test('a missing project root yields no routes and does not throw', async () => {
    assert.deepStrictEqual(await collectRoutes([path.join(fixtureRoot, 'nope')], resolveIncludedKinds(undefined)), []);
});

test('toRouteSegment classifies directories', () => {
    assert.strictEqual(toRouteSegment('users', true), 'users');
    assert.strictEqual(toRouteSegment('(marketing)', true), null);
    assert.strictEqual(toRouteSegment('@modal', true), null);
    assert.strictEqual(toRouteSegment('(.)photo', true), 'photo');
    assert.strictEqual(toRouteSegment('(..)(..)billing', true), 'billing');
    assert.strictEqual(toRouteSegment('(...)root', true), 'root');
    assert.strictEqual(toRouteSegment('_private', true), SKIP_DIR, 'private folder is not recursed into');
    assert.strictEqual(toRouteSegment('node_modules', true), SKIP_DIR);
    // The pages router has none of these conventions
    assert.strictEqual(toRouteSegment('(marketing)', false), '(marketing)');
    assert.strictEqual(toRouteSegment('_components', false), '_components');
});

test('normalizeInput adds the leading slash, trims and lowercases', () => {
    assert.strictEqual(normalizeInput('blog'), '/blog');
    assert.strictEqual(normalizeInput('  /Blog  '), '/blog');
    assert.strictEqual(normalizeInput('/blog///'), '/blog');
    assert.strictEqual(normalizeInput('/'), '/');
    assert.strictEqual(normalizeInput(''), '/');
});

test('isDynamicRouteMatch handles every dynamic segment form', () => {
    assert.ok(isDynamicRouteMatch('/users/[id]', '/users/123'));
    assert.ok(isDynamicRouteMatch('/users/[id]', '/users/[id]'));
    assert.ok(!isDynamicRouteMatch('/users/[id]', '/users'), 'needs exactly one segment');
    assert.ok(!isDynamicRouteMatch('/users/[id]', '/users/1/2'));
    assert.ok(!isDynamicRouteMatch('/users/[id]', '/posts/1'));

    assert.ok(isDynamicRouteMatch('/docs/[...slug]', '/docs/a'));
    assert.ok(isDynamicRouteMatch('/docs/[...slug]', '/docs/a/b/c'));
    assert.ok(!isDynamicRouteMatch('/docs/[...slug]', '/docs'), 'catch-all needs at least one segment');

    assert.ok(isDynamicRouteMatch('/shop/[[...filters]]', '/shop'), 'optional catch-all matches zero segments');
    assert.ok(isDynamicRouteMatch('/shop/[[...filters]]', '/shop/red/xl'));
    assert.ok(!isDynamicRouteMatch('/shop/[[...filters]]', '/store'));
});

test('filterRoutes finds pages by concrete URL, partial path and case', async () => {
    const entries = await scan();
    const match = (input: string) => routesOf(filterRoutes(entries, input));

    assert.deepStrictEqual(match('/users/123'), ['/users/[id]'], 'dynamic route by real URL');
    assert.deepStrictEqual(match('/docs/a/b'), ['/docs/[...slug]']);
    assert.deepStrictEqual(match('/shop/red/xl'), ['/shop/[[...filters]]']);
    assert.deepStrictEqual(match('/BLOG'), ['/blog'], 'case insensitive');
    assert.deepStrictEqual(match('/blog/'), ['/blog'], 'trailing slash ignored');
    assert.deepStrictEqual(match('/nothing-here'), []);
    assert.deepStrictEqual(match('post'), ['/posts', '/posts/[slug]'], 'partial path, shortest first');
});

test('a bare "/" matches only the root route', async () => {
    const entries = await scan();
    assert.ok(filterRoutes(entries, '/').every(e => e.route === '/'));
    assert.strictEqual(filterRoutes(entries, '/').length, 3);
});

test('exact matches rank above dynamic and partial ones', async () => {
    const entries = await scan();
    assert.strictEqual(filterRoutes(entries, '/posts')[0].route, '/posts', 'exact before partial');
    assert.strictEqual(filterRoutes(entries, '/api/health')[0].route, '/api/health');
});

test('teardown: remove fixture', () => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
});
