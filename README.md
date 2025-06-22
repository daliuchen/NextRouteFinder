<div align="center">
  <img src="./icon.png" alt="icon" width="100" />
  <h1>Next.js Route Finder</h1>
</div>

A VSCode extension that helps you quickly locate Next.js pages by route path, with instant search and fuzzy matching.

## Features

1. **Instant Search**: See matching routes as you type (no need to press Enter)
2. **Exact Match**: Find pages by their exact route path
3. **Fuzzy Match**: Find pages even with partial route paths
4. **Dynamic Route Match**: Support for Next.js dynamic routes (e.g., `[id]`, `[slug]`)
5. **Supports both `app/` and `pages/` directories** (including `src/app` and `src/pages`)

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