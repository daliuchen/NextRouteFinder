// Copyright (c) 2025 LiuChen
// Licensed under the MIT License.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * A monorepo with an App Router project and a pages-router project,
 * covering every folder convention the scanner has to understand.
 */
export const FIXTURE_FILES = [
    'apps/web/package.json',
    'apps/web/src/app/page.tsx',
    'apps/web/src/app/layout.tsx',
    'apps/web/src/app/blog/page.tsx',
    'apps/web/src/app/blog/loading.tsx',
    'apps/web/src/app/blog/error.tsx',
    'apps/web/src/app/blog/not-found.tsx',
    'apps/web/src/app/blog/template.tsx',
    'apps/web/src/app/(marketing)/about/page.tsx',
    'apps/web/src/app/users/[id]/page.tsx',
    'apps/web/src/app/users/[id]/layout.tsx',
    'apps/web/src/app/docs/[...slug]/page.tsx',
    'apps/web/src/app/shop/[[...filters]]/page.tsx',
    'apps/web/src/app/api/health/route.ts',
    'apps/web/src/app/@modal/page.tsx',
    'apps/web/src/app/@modal/default.tsx',
    'apps/web/src/app/feed/@sidebar/trending/page.tsx',
    'apps/web/src/app/photos/(.)photo/[id]/page.tsx',
    'apps/web/src/app/settings/(..)(..)billing/page.tsx',
    'apps/web/src/app/_private/foo/page.tsx',
    'apps/web/src/app/blog/BlogCard.tsx',
    'apps/web/src/app/node_modules/pkg/app/page.tsx',
    'apps/web/src/app/global-error.tsx',
    'apps/web/src/app/guide/page.mdx',
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

export function createFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'next-route-finder-'));
    for (const relative of FIXTURE_FILES) {
        const full = path.join(root, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, '');
    }
    return root;
}

export function removeFixture(root: string): void {
    fs.rmSync(root, { recursive: true, force: true });
}

/** The project roots a workspace scan would discover in the fixture. */
export function fixtureProjectRoots(root: string): string[] {
    return [root, path.join(root, 'apps/web'), path.join(root, 'legacy')];
}
