# ExoSquare website

The Astro source for ExoSquare's static website. Work and Writing start empty. The site uses Markdown/MDX content, local fonts and plain browser JavaScript. No database or CMS is required.

## Develop and check

Use Node.js 24 or later and the committed npm lockfile:

```sh
npm ci
npm run dev
```

Open the local URL printed by Astro. Astro may run the development server in the background; stop it with `npx astro dev stop` when finished.

```sh
npm run check
npm run build
npm run preview
```

The build validates content punctuation and schema, generates the static site, then checks local links and HTML structure. `dist` is generated output and is not committed. `npm run format` formats source files.

## Publish writing or projects

Add a Markdown or MDX file under `src/content/articles/` or `src/content/projects/`. Filenames become URL slugs. The schema in `src/content.config.ts` defines the supported fields. An article needs `title`, `topic` and `standfirst`; a project needs `title`, `topic`, `summary` and its `record` fields.

Entries default to `draft: true`. Use `npm run dev:drafts` to review them locally. To publish, set `draft: false` and `publishedAt` to the real publication date in `YYYY-MM-DD` form. Dates do not schedule releases: every non-draft is included in the next build. A project status also needs a real `statusChecked` date.

**This repository is public.** Draft status hides a page from the built website, not its committed source. Keep all unpublished drafting and unapproved assets in a separate private workspace. Transfer only approved content and its approved assets into this repository, reviewing an explicit list of files before staging. Do not bulk-sync another working folder or its Git history. Only add files intended to be public; do not commit local documents, credentials or private notes.

For Markdown article images, place approved files in `src/assets/images/` and reference them relative to the content source, for example `![Description](../../assets/images/filename.jpg)`. Astro processes these images and supplies the correct deployment path. For posts at `/writing/slug/` or `/work/slug/`, use `../../contact/` for a local page link. Use descriptive alt text. Raw public assets can live in `public/images/`; reference them through the base-aware `Figure` component in MDX. In Astro components, use `withBase` from `src/lib/paths.ts` for local paths. Files under `public` are deployed even if no page links to them.

After reviewing changes, push a feature branch and open a pull request. Publishing CI checks root-domain and project-path builds, all local page/asset references, and desktop/mobile browser behavior. Merge after the required `Publishing checks` succeeds. The main-branch workflow validates the actual production build, deploys that same artifact and checks live delivery. Check the workflow result and live page after each release. GitHub Pages must be configured to use GitHub Actions as its publishing source.

## Site address

The intended custom domain is `https://exosquare.com`, with root base `/`. Local builds use that origin by default. The deployment workflow reads the actual Pages address: before the custom domain is connected, it uses `https://exosquare.github.io/website/` and includes the `/website` prefix on links and assets. When the Pages custom domain changes, rerun the workflow to build for its new origin/base.

To reproduce the temporary Pages build locally:

```sh
SITE_URL=https://exosquare.github.io BASE_PATH=/website npm run build
```

Custom-domain DNS and HTTPS setup are managed separately from source edits. Adding a repository file alone does not establish a working domain or certificate.

## Browser checks

```sh
npx playwright install chromium
npm run build
npm run test:browser
```

The browser suite discovers built pages, including new writing. It checks structural behavior, local images, font loading, navigation and theme persistence. It does not assert article counts, headlines, pixel screenshots or third-party availability. Tests use isolated browser contexts, a pinned Chromium version, one worker and no retries. Playwright waits for the server and observable page states instead of fixed sleeps. Failure traces/screenshots are retained for diagnosis.

PR checks run for every change, including article-only changes. They do not deploy. After merging, production is validated again using the configured Pages address. Live-delivery checks run only after deployment and retry transient network/CDN failures separately from the required PR check.

## Fonts

Space Mono is distributed under the [SIL Open Font License](public/licenses/Space-Mono-OFL.txt). Helvetica Neue font files retain their original vendor copyright and licence terms. This repository does not relicense third-party fonts.
