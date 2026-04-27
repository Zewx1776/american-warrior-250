# Plan: American Warrior Blog Feed on Landing Page

## Context

The American Warrior 250 landing page (`index.html`) is currently a pure-product narrative — eras, products, film, origin, CTA. The main Swampfox Sanity site already publishes editorial blog posts tagged with the "american warrior" category at `https://www.swampfoxoptics.com/blog?category=american+warrior`. None of that content surfaces on the campaign page today.

Pulling in the latest 3 posts gives the campaign page an editorial dimension (story, history, ethos), drives traffic from the campaign back to the main site's blog, and keeps the campaign feeling alive between product drops.

**User decisions confirmed:**
- Cards are thumbnails — clicking redirects to the article on the main Swampfox site.
- Placement: new section between Origin and CTA Banner, **plus** a new nav bar item linking to `https://www.swampfoxoptics.com/blog?category=american+warrior`.
- Visual: 3-up grid of the latest 3 posts.
- **Architecture: bake posts into the HTML at build time on Vercel, refresh daily via a Vercel Cron + Deploy Hook so cards stay current without manual redeploys.**

## Reconnaissance findings (resolved)

A Sonnet recon agent confirmed all the integration unknowns:

| Item | Finding |
|---|---|
| Sanity projectId / dataset | `21lfjblb` / `production` |
| Post document type | `post` |
| Article URL pattern | `https://www.swampfoxoptics.com/{slug}` (NOT `/blog/{slug}` — slugs hang off the root) |
| Category field | `category` (array of refs to category docs) — filter by `"american-warrior" in category[]->slug.current` |
| Useful post fields | `title`, `slug.current`, `publishedAt`, `excerpt`, `thumbnail` (square crop, preferred for cards), `mainImage` |
| Direct Sanity API access | **Blocked.** Dataset is private; CORS rejects browser calls from the campaign domain |
| Sanity CDN images | **Public** — `https://cdn.sanity.io/images/21lfjblb/production/{hash}-{w}x{h}.{ext}?w=400&auto=format` works without auth |
| Public read path | Swampfox's Next.js exposes posts via `https://www.swampfoxoptics.com/_next/data/{buildId}/blog.json` with header `x-nextjs-data: 1`. No auth required, but the `buildId` rotates on every Swampfox deploy, so it must be discovered at fetch time by parsing `__NEXT_DATA__` from `/blog`. |
| Browser CORS on that endpoint | **Blocked** — server returns no `Access-Control-Allow-Origin`. Must be called server-side. |

## Approach — build-time bake with daily cron refresh

### 1. Build script — `scripts/build-posts.js`

A single Node script run as the Vercel build command. On each build it:
1. Fetches `https://www.swampfoxoptics.com/blog`, parses `__NEXT_DATA__` to extract the current Next.js `buildId`.
2. Fetches `https://www.swampfoxoptics.com/_next/data/{buildId}/blog.json` with header `x-nextjs-data: 1`.
3. Walks the JSON to find the `blog` section's `variants.blogPosts` array (~115 posts).
4. Filters by `category[].slug.current === "american-warrior"`, sorts by `publishedAt` desc, takes the top 3.
5. Renders three `<a class="story-card">…</a>` HTML strings, including:
   - `thumbnail` field rendered to `https://cdn.sanity.io/images/21lfjblb/production/{hash}-{w}x{h}.{ext}?w=800&auto=format`
   - Title, excerpt (clamped to 2 lines via CSS), formatted publishedAt date, gold "American Warrior" tag
   - `href="https://www.swampfoxoptics.com/{slug.current}"` with `target="_blank" rel="noopener"`
6. Reads `index.html`, replaces the marker block:
   ```html
   <!-- POSTS_INJECT_START --><!-- POSTS_INJECT_END -->
   ```
   with the rendered cards. Writes back in place. (No `dist/` — Vercel serves the modified `index.html` directly.)
7. If the fetch fails (Swampfox down, schema drift), the script exits 0 with the marker block left empty and the section's `display:none` fallback kicks in. Build never blocks deploys due to upstream issues.

Uses only Node built-ins (`https`, `fs`) — no `package.json` dependencies needed beyond Node itself.

### 2. `package.json` (new, minimal)

```json
{
  "name": "american-warrior-landing",
  "private": true,
  "scripts": {
    "build": "node scripts/build-posts.js"
  }
}
```

### 3. `vercel.json` (modified)

Add three things to the existing config:
- `"buildCommand": "npm run build"` — runs the post bake on every deploy
- `"outputDirectory": "."` — Vercel serves the repo root (with the modified index.html) as static
- A `crons` array with one entry that hits `/api/refresh` daily

### 4. `/api/refresh.js` — cron target

A tiny serverless function (15 lines). When the Vercel cron fires, this function POSTs to a **Vercel Deploy Hook URL** stored as an env var. That triggers a redeploy → which runs the build script → which rebakes fresh posts into `index.html`.

```js
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  await fetch(process.env.DEPLOY_HOOK_URL, { method: 'POST' });
  res.status(200).json({ ok: true, triggered: new Date().toISOString() });
}
```

Vercel automatically attaches the `CRON_SECRET` bearer header to its own cron requests, so unauthorized hits are rejected.

### 5. New page section + new nav item — in `index.html`

**New section** inserted between the closing `</section>` of `.origin-section` (~line 2367) and `<section class="cta-banner">` (~line 2370):

```html
<section class="stories-section" id="stories" aria-labelledby="stories-head">
  <div class="container">
    <div class="section-header reveal">
      <p class="section-label">Field Notes · The Long Watch</p>
      <h2 id="stories-head">Stories from the Warrior</h2>
      <p class="section-sub">Two and a half centuries of grit, gear, and the men who carried them.</p>
    </div>
    <div class="stories-grid">
      <!-- POSTS_INJECT_START -->
      <!-- POSTS_INJECT_END -->
    </div>
    <a class="stories-view-all"
       href="https://www.swampfoxoptics.com/blog?category=american+warrior"
       target="_blank" rel="noopener">View all stories →</a>
  </div>
</section>
```

If the marker block stays empty (build fetch failed), CSS `.stories-section:has(.stories-grid:empty) { display: none; }` hides the whole section so the page never shows a broken empty state.

**New nav item** "Stories" — added after the existing Eras dropdown in both the desktop nav and mobile hamburger menu. External link with `target="_blank" rel="noopener"` to `https://www.swampfoxoptics.com/blog?category=american+warrior`.

### 6. CSS — match existing design system

New CSS goes in the same `<style>` block (around line 1237 near `.origin-section` styles). Reuse existing tokens (`--gold`, `--charcoal`, `--font-head`, `--ease-out-expo`, `.section-label`, `.reveal`, `.delay-1/2/3`).

- `.stories-section` background: `var(--charcoal)`, padding `120px 0` to match neighbors.
- `.stories-grid`: CSS Grid, `grid-template-columns: repeat(3, 1fr)`, `gap: 32px`. Stacks to 1 column under `768px`.
- `.story-card`: dark card, gold border-bottom on hover (matches collection-grid card hover pattern), 1.02 scale on hover, transitions on `--ease-out-expo`.
- Image: `aspect-ratio: 4/5` (the `thumbnail` field is square but cropped tighter looks better in a grid card; or use `1/1` if we render the raw thumbnail), `object-fit: cover`.
- Excerpt clamped to 2 lines via `-webkit-line-clamp: 2`.
- Apply `.reveal .delay-1`, `.delay-2`, `.delay-3` so cards fade in sequentially with the existing IntersectionObserver (~line 2585) — no JS changes needed since cards are real HTML at page load.

## One-time Vercel setup (you do this once in the Vercel dashboard)

1. **Create a Deploy Hook** — Project Settings → Git → Deploy Hooks → "Create Hook" with name "Daily blog refresh". Vercel returns a URL like `https://api.vercel.com/v1/integrations/deploy/prj_xxx/yyy`.
2. **Add env var** `DEPLOY_HOOK_URL` in Project Settings → Environment Variables, paste the URL, scope: All Environments.
3. The `CRON_SECRET` env var is auto-provisioned by Vercel for cron-protected functions — nothing to do.

That's it. Cron jobs come built-in on Hobby tier (up to 2 daily crons free).

## Critical Files

| File | Status | Purpose |
|---|---|---|
| `index.html` | Modify | Add `<section class="stories-section">`, marker comment block, new nav item (desktop + mobile), new CSS |
| `scripts/build-posts.js` | New | Fetch + filter + render + inject |
| `package.json` | New | Declare `build` script |
| `vercel.json` | Modify | `buildCommand`, `outputDirectory`, `crons` array |
| `api/refresh.js` | New | Cron target — POSTs to Deploy Hook |

## Verification

1. **Local build dry-run**: run `node scripts/build-posts.js` locally. Confirm `index.html` is modified with three real `<a class="story-card">` elements between the marker comments. Open `index.html` in a browser, confirm cards render and clicking each one opens the correct article on swampfoxoptics.com.
2. **Push to a Vercel preview branch**: confirm the build runs, the deploy succeeds, and the preview URL shows fresh cards. Inspect the rendered HTML via View Source — cards should be real HTML, not JS-injected (proves build-time bake worked).
3. **Resize to <768px**: confirm grid stacks to 1 column and the new "Stories" nav item appears in the hamburger menu.
4. **Force a fetch failure** (temporarily change the Swampfox URL in the build script to a 404): confirm build still succeeds, the marker block stays empty, and the section is hidden via CSS — no broken empty state on the page.
5. **Cron + redeploy test**: manually hit `/api/refresh` with the cron bearer header (or trigger via Vercel dashboard's "Run cron now"). Confirm a redeploy fires in the Vercel dashboard within a few seconds and that the resulting build pulls the latest posts.
6. **GA4 / Meta Pixel**: confirm both still fire on page load (they're at the top of `<head>`, unaffected by the new section, but worth a quick check).
