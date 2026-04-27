// scripts/build-posts.js — bakes 3 latest American Warrior posts into index.html at Vercel build time

'use strict';

const fs = require('fs');
const path = require('path');

const BLOG_URL = 'https://www.swampfoxoptics.com/blog';
const SANITY_PROJECT = '21lfjblb';
const SANITY_DATASET = 'production';
const INDEX_PATH = path.resolve(__dirname, '..', 'index.html');
const INJECT_RE = /(<!-- POSTS_INJECT_START -->)[\s\S]*?(<!-- POSTS_INJECT_END -->)/;

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function assetRefToUrl(ref) {
  // ref: "image-abc123def456-1280x1280-jpg"
  // out: "https://cdn.sanity.io/images/21lfjblb/production/abc123def456-1280x1280.jpg?w=800&auto=format"
  if (!ref) return '';
  const withoutPrefix = ref.replace(/^image-/, '');
  // last hyphen-separated segment is the extension
  const lastHyphen = withoutPrefix.lastIndexOf('-');
  if (lastHyphen === -1) return '';
  const body = withoutPrefix.slice(0, lastHyphen);
  const ext = withoutPrefix.slice(lastHyphen + 1);
  return `https://cdn.sanity.io/images/${SANITY_PROJECT}/${SANITY_DATASET}/${body}.${ext}?w=800&auto=format`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
    .format(d)
    .toUpperCase();
}

function buildCard(post, n) {
  const slug = post.slug && post.slug.current ? post.slug.current : '#';
  const ref =
    (post.thumbnail && post.thumbnail.asset && post.thumbnail.asset._ref) ||
    (post.mainImage && post.mainImage.asset && post.mainImage.asset._ref) ||
    '';
  const imageUrl = assetRefToUrl(ref);
  const title = esc(post.title || '');
  const excerpt = esc(post.excerpt || '');
  const publishedAtIso = post.publishedAt || '';
  const formattedDate = formatDate(publishedAtIso);

  return `        <a class="story-card reveal delay-${n}" href="https://www.swampfoxoptics.com/${slug}" target="_blank" rel="noopener">
          <div class="story-card-image">
            <img src="${imageUrl}" alt="${title}" loading="lazy" />
          </div>
          <div class="story-card-body">
            <span class="story-card-tag">American Warrior</span>
            <h3 class="story-card-title">${title}</h3>
            <p class="story-card-excerpt">${excerpt}</p>
            <time class="story-card-date" datetime="${publishedAtIso}">${formattedDate}</time>
          </div>
        </a>`;
}

// ── fetch helpers ─────────────────────────────────────────────────────────────

async function fetchText(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Fetch /blog page and extract __NEXT_DATA__
  const html = await fetchText(BLOG_URL, {
    'User-Agent': 'Mozilla/5.0 (compatible; AmericanWarriorBuild/1.0)',
  });

  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!nextDataMatch) throw new Error('__NEXT_DATA__ not found in /blog HTML');

  const nextData = JSON.parse(nextDataMatch[1]);
  const buildId = nextData.buildId;
  if (!buildId) throw new Error('buildId missing from __NEXT_DATA__');

  // 2. Fetch blog.json via Next.js data route
  const dataUrl = `https://www.swampfoxoptics.com/_next/data/${buildId}/blog.json`;
  const blogJson = await fetchJson(dataUrl, {
    'x-nextjs-data': '1',
    'User-Agent': 'Mozilla/5.0 (compatible; AmericanWarriorBuild/1.0)',
  });

  // 3. Walk to blogPosts array
  const sections = blogJson?.pageProps?.data?.pageData?.sections;
  if (!Array.isArray(sections)) throw new Error('sections array not found in blog.json');

  const blogSection = sections.find((s) => s._type === 'blog');
  if (!blogSection) throw new Error('blog section not found in sections');

  const allPosts = blogSection?.variants?.blogPosts;
  if (!Array.isArray(allPosts)) throw new Error('blogPosts array not found');

  // 4. Filter, sort, take top 3
  const filtered = allPosts
    .filter(
      (post) =>
        Array.isArray(post.category) &&
        post.category.some((c) => c?.slug?.current === 'american-warrior')
    )
    .sort((a, b) => {
      const da = a.publishedAt || '';
      const db = b.publishedAt || '';
      return db < da ? -1 : db > da ? 1 : 0;
    })
    .slice(0, 3);

  // 5. Build card HTML
  const cards = filtered.map((post, i) => buildCard(post, i + 1));
  const injection = cards.length > 0 ? '\n' + cards.join('\n') + '\n        ' : '';

  // 6. Read index.html, replace marker block, write back
  const source = fs.readFileSync(INDEX_PATH, 'utf8');
  if (!INJECT_RE.test(source)) throw new Error('POSTS_INJECT markers not found in index.html');

  const updated = source.replace(
    INJECT_RE,
    `$1${injection}$2`
  );
  fs.writeFileSync(INDEX_PATH, updated, 'utf8');

  // 7. Success log
  const titles = filtered.map((p) => p.title || '(untitled)').join(' | ');
  console.log(
    `[build-posts] OK — baked ${filtered.length} post(s): ${titles}`
  );
}

main().catch((err) => {
  process.stderr.write(`[build-posts] FAILED: ${err.message}\n`);
  // Leave index.html untouched (or ensure markers are empty) — never block a deploy
  try {
    const source = fs.readFileSync(INDEX_PATH, 'utf8');
    if (INJECT_RE.test(source)) {
      const cleaned = source.replace(INJECT_RE, '$1$2');
      fs.writeFileSync(INDEX_PATH, cleaned, 'utf8');
    }
  } catch (_) {
    // ignore secondary failure
  }
  process.exit(0);
});
