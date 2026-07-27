# Changelog

## 0.1.0

### Added

- **Paste a URL to find the page.** `http://localhost:3000/users/42?tab=profile` from the browser, an error report or a log line resolves to `app/users/[id]/page.tsx`. Origin, query string and fragment are stripped and percent-escapes are decoded.
- **The route of the current file in the status bar.** Click it to copy the route. Turn it off with `nextRouteFinder.showStatusBar`.
- **Copy Route of Current File** and **Open Route of Current File in Browser** commands. Dynamic routes ask for the segment values before opening; the origin comes from `nextRouteFinder.devServerUrl`.
- **Go to Related Route File** command: jump between the `page`, `layout`, `loading`, `error`, `not-found`, `template` and `default` files of the folder you are in.
- `loading`, `error`, `not-found`, `template`, `default` and `global-error` files can be searched by adding `special` to `nextRouteFinder.include`.
- `.mdx` pages are indexed.
- Default keybinding `Ctrl+Alt+R` / `Cmd+Alt+R` for **Find Next.js Route**.
- `nextRouteFinder.include` setting to choose what the search list contains.

### Fixed

- **Dynamic route search returned nothing.** Searching `/users/123` matched `/users/[id]` internally, but VS Code applied its own fuzzy filter on top of the results and dropped them again, so the picker looked empty.
- **The root route could never be found.** `app/page.tsx` and `pages/index.tsx` produced an empty route string that was then discarded.
- **Nothing was found in a monorepo.** Only the four route directories directly under the first workspace folder were scanned. Every `next.config.*` and `package.json` directory is now a candidate project root, across all workspace folders.
- **An unreadable directory disabled the whole extension.** The scan ran synchronously before the command was registered, so a permission error or broken symlink meant the command never existed. It is asynchronous now and failures skip only the affected subtree.
- **The route list never refreshed.** It was built once at activation, so new or renamed pages needed a window reload and deleted ones failed silently.
- Catch-all routes were not matched: `/docs/a/b` now finds `docs/[...slug]`, and `[[...slug]]` matches zero or more segments.
- Layouts no longer duplicate every entry in the list.
- App Router folder conventions are resolved to the URL actually served: private `_folder`s are skipped, parallel route slots (`@modal`) and intercepting markers (`(.)`, `(..)`, `(...)`) no longer leak into the route.
- The pages router no longer lists `_app`, `_document`, `*.d.ts` or colocated test and story files as routes.
- Searching is case insensitive and tolerates trailing slashes.
- Results are ranked, exact matches first.
- The picker explains itself when no Next.js project was found, instead of showing an empty list.

## 0.0.1

- Initial release: find a page by its route path.
