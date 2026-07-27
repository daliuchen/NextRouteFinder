<div align="center">
  <img src="./icon.png" alt="icon" width="100" />
  <h1>Next.js Route Finder</h1>
  <p>Move between Next.js routes and files in both directions, without leaving the keyboard.</p>
</div>

## Route → file

Press `Cmd+Alt+R` (`Ctrl+Alt+R` on Windows/Linux) and type. Results appear as you type, and a single match opens straight away.

| Type this | To reach |
| --- | --- |
| `/blog` | `app/blog/page.tsx` |
| `/users/123` | `app/users/[id]/page.tsx` |
| `/docs/getting-started/install` | `app/docs/[...slug]/page.tsx` |
| `http://localhost:3000/users/42?tab=profile` | `app/users/[id]/page.tsx` |
| `user` | anything with `user` in the route |

That fourth row is the one to remember: **paste a URL straight from the browser, a Sentry issue or a log line** and land on the source file. The origin, query string and fragment are stripped for you.

## File → route

Open any page and its route is in the status bar. Click it to copy.

| Command | Default keybinding |
| --- | --- |
| Find Next.js Route | `Cmd+Alt+R` / `Ctrl+Alt+R` |
| Copy Route of Current File | — |
| Open Route of Current File in Browser | — |
| Go to Related Route File | — |

**Open in Browser** opens the current page on your dev server; if the route has dynamic segments it asks for the values first. **Go to Related Route File** jumps between the `page`, `layout`, `loading`, `error`, `not-found`, `template` and `default` files of the folder you are in.

All commands are under the `Next Route Finder:` prefix in the command palette. Add your own keybindings in `Preferences: Open Keyboard Shortcuts`.

## What gets indexed

Both routers, in `app/`, `src/app/`, `pages/` and `src/pages/`, for **every** Next.js project in the workspace — each `next.config.*` and `package.json` directory is a candidate root, so monorepos and multi-root workspaces work.

App Router folder conventions are resolved to the URL actually served:

| On disk | Route |
| --- | --- |
| `app/(marketing)/about/page.tsx` | `/about` |
| `app/@modal/default.tsx` | `/` |
| `app/photos/(.)photo/[id]/page.tsx` | `/photos/photo/[id]` |
| `app/_private/foo/page.tsx` | not a route |

The index refreshes by itself when files are added, renamed or deleted.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `nextRouteFinder.include` | `["page", "route"]` | What the search list contains. `page`, `route` (route handlers and `pages/api`), `layout`, and `special` (`loading`, `error`, `not-found`, `template`, `default`, `global-error`). Everything except `page` and `route` shares a route with its sibling page, so adding them means several entries per route. Does not affect the status bar or Go to Related Route File. |
| `nextRouteFinder.showStatusBar` | `true` | Show the current file's route in the status bar. |
| `nextRouteFinder.devServerUrl` | `http://localhost:3000` | Origin used by Open Route of Current File in Browser. |

## Known Limitations

- In the `pages/` router, Next.js turns *every* file under `pages/` into a route, so colocated components (`pages/components/Card.tsx`) are listed as well. Only `_`-prefixed, `.d.ts`, `.test.*`, `.spec.*` and `.stories.*` files are filtered out. A custom `pageExtensions` config is not read.
- Intercepting routes are listed at their file system path (`app/photos/(.)photo/[id]` → `/photos/photo/[id]`) rather than at the URL they intercept.
- In a workspace with more than 200 `package.json` files, only the first 200 are considered. Projects with a `next.config.*` are always included.

## Installation

Install [Next.js Route Finder](https://marketplace.visualstudio.com/items?itemName=EthanLiuChen.next-route-finder) from the Marketplace, or run:

```
ext install EthanLiuChen.next-route-finder
```

## Requirements

- VSCode 1.60.0 or higher
- A Next.js project with an `app` or `pages` directory (`src/app`, `app`, `src/pages` or `pages`)

## Development

```bash
pnpm install     # install dependencies
pnpm run compile # build once
pnpm run watch   # rebuild on change
pnpm test        # compile, lint and run the test suite
```

Press `F5` to launch an Extension Development Host with the extension loaded.

Route discovery and matching live in [`src/routes.ts`](./src/routes.ts) and import no VS Code API, so they are covered by plain unit tests in [`src/test`](./src/test). [`src/extension.ts`](./src/extension.ts) holds the editor integration.

## License

This project is licensed under the [MIT License](./LICENSE).
