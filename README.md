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

Public images belong in `public/images/`. Use descriptive alt text. For Markdown posts at `/writing/slug/` or `/work/slug/`, use `../../images/filename.jpg` for an image and `../../contact/` for a local page link. Relative paths work at both the temporary project address and the custom domain. In Astro components, use `withBase` from `src/lib/paths.ts` for local paths. Files under `public` are deployed even if no page links to them.

After reviewing changes, run the checks and build, commit the intended public files and push `main`. The GitHub Actions workflow checks, builds and deploys the site to GitHub Pages. Check the workflow result and live page after each release. GitHub Pages must be configured to use GitHub Actions as its publishing source.

## Site address

The intended custom domain is `https://exosquare.com`, with root base `/`. Local builds use that origin by default. The deployment workflow reads the actual Pages address: before the custom domain is connected, it uses `https://exosquare.github.io/website/` and includes the `/website` prefix on links and assets. When the Pages custom domain changes, rerun the workflow to build for its new origin/base.

To reproduce the temporary Pages build locally:

```sh
SITE_URL=https://exosquare.github.io BASE_PATH=/website npm run build
```

Custom-domain DNS and HTTPS setup are managed separately from source edits. Adding a repository file alone does not establish a working domain or certificate.

## Fonts

Space Mono is distributed under the [SIL Open Font License](public/licenses/Space-Mono-OFL.txt). Helvetica Neue font files retain their original vendor copyright and licence terms. This repository does not relicense third-party fonts.
