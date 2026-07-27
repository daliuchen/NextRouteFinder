<div align="center">
  <img src="./icon.png" alt="icon" width="100" />
  <h1>Next.js Route Finder</h1>
</div>

A VSCode extension that helps you quickly locate Next.js pages by route path, with instant search and fuzzy matching.

## Features

1. **Instant Search**: See matching routes as you type (no need to press Enter)
2. **Exact Match**: Find pages by their exact route path
3. **Fuzzy Match**: Find pages even with partial route paths, case insensitive
4. **Dynamic Route Match**: Support for Next.js dynamic routes — `[id]`, catch-all `[...slug]` and optional catch-all `[[...slug]]`
5. **Supports both `app/` and `pages/` directories** (including `src/app` and `src/pages`)
6. **App Router conventions**: route groups `(group)`, parallel route slots `@slot`, intercepting routes `(.)folder` and private folders `_folder` are resolved to the URL they actually serve
7. **Monorepo aware**: every `package.json` directory in the workspace is treated as a candidate Next.js project, so `apps/web/app/...` is found too
8. **Always up to date**: the route index refreshes automatically when files are added, renamed or deleted

## Usage

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac) to open the command palette
2. Type "Find Next.js Route" and select the command
3. Start typing the route path you want to find (e.g., `/users/[id]`, `/blog`, `user`)
4. The extension will:
   - Instantly show all matching routes as you type
   - Open the file directly if there's only one match
   - Show a quick pick menu if multiple matches are found

## Examples

- `/users/[id]` - Finds dynamic user profile pages
- `/blog` - Finds the blog index page
- `/products` - Finds product-related pages
- `user` - Fuzzy matches any user-related pages (e.g., `user_profile`, `users`)
- `[slug]` - Matches any dynamic route with `[slug]`

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `nextRouteFinder.include` | `["page", "route"]` | Which files to index. `page` = pages, `route` = route handlers (`app/**/route.ts`, `pages/api/**`), `layout` = layouts. Layouts share their route with the sibling page, so enabling `layout` gives you two entries per route. |

## Known Limitations

- In the `pages/` router, Next.js turns *every* file under `pages/` into a route, so colocated components (`pages/components/Card.tsx`) are listed as well. Only `_`-prefixed, `.d.ts`, `.test.*`, `.spec.*` and `.stories.*` files are filtered out. A custom `pageExtensions` config is not read.
- Intercepting routes are listed at their file system path (`app/photos/(.)photo/[id]` → `/photos/photo/[id]`) rather than at the URL they intercept.

## Requirements

- VSCode 1.60.0 or higher
- Next.js project with an `app` or `pages` directory (supports `src/app`, `app`, `src/pages`, `pages`)
- pnpm 8.15.4 or higher

## Installation

1. Clone this repository
2. Run `pnpm install`
3. Press F5 to start debugging
4. The extension will be installed in your VSCode instance

## Development

```bash
# Install dependencies
pnpm install

# Compile the extension
pnpm run compile

# Watch for changes
pnpm run watch

# Run tests
pnpm test
```

## License

This project is licensed under the [MIT License](./LICENSE). 