// functions/review/[...slug].js
export async function onRequest(context) {
  const { request, params, env } = context;
  const slug = params.slug;

  try {
    if (typeof slug === 'string' && slug.endsWith('.md')) {
      const clean = slug.replace('.md', '');
      return Response.redirect(`${new URL(request.url).origin}/review/${clean}`, 301);
    }

    const rawMd = await fetchPostContent(slug, env.GITHUB_TOKEN);
    if (!rawMd) return renderErrorPage('Review not found', 'The requested review could not be found.');

    let { frontmatter, content } = parseMarkdown(rawMd);
    frontmatter = frontmatter || {};

    let relatedPosts = [];
    if (frontmatter.checked) {
      const saved = frontmatter.related || [];
      if (Array.isArray(saved)) {
        relatedPosts = saved.map(r => ({
          slug: r.slug,
          title: r.title || formatSlug(r.slug),
          description: r.description || '',
          image: r.image || '/default-thumbnail.jpg',
          categories: r.categories || []
        }));
      }
    } else {
      const fresh = await findRelatedPostsFromGitHub(frontmatter, slug, env.GITHUB_TOKEN);
      relatedPosts = (fresh || []).slice(0, 3);

      frontmatter.related = relatedPosts.map(p => ({
        slug: p.slug,
        title: p.title,
        description: p.description || '',
        image: p.image || '/default-thumbnail.jpg',
        categories: p.categories || []
      }));
      frontmatter.checked = true;

      try {
        await updateMarkdownFileWithRelated(slug, rawMd, frontmatter, env.GITHUB_TOKEN);
        console.log(`✅ Wrote related posts into ${slug}.md`);
      } catch (err) {
        console.error('Failed to write related posts to GitHub:', err);
      }
    }

    const htmlContent = convertMarkdownToHTML(content);
    const fullHtml = await renderPostPage(frontmatter, htmlContent, slug, request.url, relatedPosts);

    return new Response(fullHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      }
    });

  } catch (err) {
    console.error('Unhandled error in onRequest:', err);
    return renderErrorPage('Server Error', 'An error occurred while loading the review.');
  }
}

// -------------------- GitHub helpers --------------------
async function fetchPostContent(slug, githubToken) {
  const REPO_OWNER = 'yourfreetools';
  const REPO_NAME = 'reviewindex';
  const filePath = `content/reviews/${slug}.md`;
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${githubToken}`,
        'User-Agent': 'Review-Index-App',
        Accept: 'application/vnd.github.v3.raw'
      }
    });

    if (res.status === 200) return await res.text();
    console.error('fetchPostContent status', res.status, await safeText(res));
    return null;
  } catch (err) { console.error('fetchPostContent error', err); return null; }
}

async function updateMarkdownFileWithRelated(slug, oldContent, frontmatter, githubToken) {
  const REPO_OWNER = 'yourfreetools';
  const REPO_NAME = 'reviewindex';
  const filePath = `content/reviews/${slug}.md`;
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;

  const yamlLines = [];
  for (const [key, val] of Object.entries(frontmatter)) {
    if (Array.isArray(val)) {
      if (val.length > 0 && typeof val[0] === 'object') {
        yamlLines.push(`${key}:`);
        for (const obj of val) {
          yamlLines.push(`  - slug: "${escapeYaml(String(obj.slug || ''))}"`);
          yamlLines.push(`    title: "${escapeYaml(String(obj.title || ''))}"`);
          yamlLines.push(`    description: "${escapeYaml(String(obj.description || ''))}"`);
          yamlLines.push(`    image: "${escapeYaml(String(obj.image || '/default-thumbnail.jpg'))}"`);
          const cats = (obj.categories || []).map(c => `"${escapeYaml(String(c))}"`).join(', ');
          yamlLines.push(`    categories: [${cats}]`);
        }
      } else {
        const inline = val.map(v => `"${escapeYaml(String(v))}"`).join(', ');
        yamlLines.push(`${key}: [${inline}]`);
      }
    } else if (typeof val === 'boolean') yamlLines.push(`${key}: ${val}`);
    else if (val && typeof val === 'object') {
      yamlLines.push(`${key}:`);
      for (const [k2, v2] of Object.entries(val)) {
        if (Array.isArray(v2)) yamlLines.push(`  ${k2}: [${v2.map(x => `"${escapeYaml(String(x))}"`).join(', ')}]`);
        else yamlLines.push(`  ${k2}: "${escapeYaml(String(v2))}"`);
      }
    } else yamlLines.push(`${key}: "${escapeYaml(String(val))}"`);
  }

  const getRes = await fetch(apiUrl, {
    headers: { Authorization: `token ${githubToken}`, 'User-Agent': 'Review-Index-App', Accept: 'application/vnd.github.v3+json' }
  });
  if (!getRes.ok) throw new Error(`Failed to get file metadata: ${getRes.status} ${await safeText(getRes)}`);

  const fileMeta = await getRes.json();
  const sha = fileMeta.sha;
  const { content: body } = parseMarkdown(oldContent);
  const newMd = `---\n${yamlLines.join('\n')}\n---\n\n${body}`;
  const encoded = base64Encode(newMd);

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `token ${githubToken}`,
      'User-Agent': 'Review-Index-App',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Add related posts and checked flag to ${slug}.md`,
      content: encoded,
      sha
    })
  });

  if (!putRes.ok) throw new Error(`Failed to update file: ${putRes.status} ${await safeText(putRes)}`);
  return true;
}

function base64Encode(str) {
  try { if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(str))); } catch (_) {}
  if (typeof Buffer !== 'undefined') return Buffer.from(str).toString('base64');
  throw new Error('No base64 encoder available');
}

async function safeText(res) { try { return await res.text(); } catch { return '[no body]'; } }
function escapeYaml(s) { return String(s).replace(/"/g, '\\"'); }

// -------------------- Markdown parsing --------------------
function parseMarkdown(md) {
  const result = { frontmatter: {}, content: md };
  if (!md || !md.startsWith('---')) return result;
  const endIndex = md.indexOf('---', 3);
  if (endIndex === -1) return result;
  const yamlBlock = md.substring(3, endIndex).trim();
  const body = md.substring(endIndex + 3).trim();
  result.content = body;
  result.frontmatter = parseYAMLBlock(yamlBlock);
  return result;
}

function parseYAMLBlock(yaml) {
  const lines = yaml.split(/\r?\n/);
  const fm = {}; let i = 0;
  while (i < lines.length) {
    let line = lines[i]; if (/^\s*$/.test(line)) { i++; continue; }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/); if (!m) { i++; continue; }
    const key = m[1]; let rest = m[2];

    if (rest === '') {
      const next = lines[i+1] || '';
      if (/^\s*-\s+/.test(next) || /^\s*-\s*$/.test(next)) {
        const arr = []; i++;
        while (i < lines.length && /^\s*-\s*/.test(lines[i])) {
          let itemLine = lines[i].replace(/^\s*-\s*/, ''); const item = {};
          if (itemLine && /:/.test(itemLine)) { const pm = itemLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/); if (pm) item[pm[1]] = parseValue(pm[2]); i++; }
          else if (!itemLine) { i++; while (i < lines.length && /^\s{2,}[A-Za-z0-9_-]+:/.test(lines[i])) { const prop = lines[i].trim(); const pm = prop.match(/^([A-Za-z0-9_-]+):\s*(.*)$/); if (pm) item[pm[1]] = parseValue(pm[2]); i++; } } else { i++; }
          if (item.categories && typeof item.categories === 'string' && item.categories.startsWith('[')) item.categories = parseArrayInline(item.categories);
          arr.push(item);
        }
        fm[key] = arr; continue;
      } else {
        const obj = {}; i++;
        while (i < lines.length && /^\s{2,}[A-Za-z0-9_-]+:/.test(lines[i])) { const prop = lines[i].trim(); const pm = prop.match(/^([A-Za-z0-9_-]+):\s*(.*)$/); if (pm) obj[pm[1]] = parseValue(pm[2]); i++; }
        fm[key] = obj; continue;
      }
    } else { if (rest.startsWith('[') && rest.endsWith(']')) fm[key] = parseArrayInline(rest); else fm[key] = parseValue(rest); }
    i++;
  }
  return fm;
}

function parseValue(s) { if (typeof s !== 'string') return s; const t = s.trim(); if (t === '') return ''; if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.substring(1, t.length-1); if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true'; return t; }
function parseArrayInline(text) { const inner = text.trim().replace(/^\[/,'').replace(/\]$/,''); if (inner.trim()==='') return []; return inner.split(',').map(x => parseValue(x.trim().replace(/^"|"$/g,''))); }

// -------------------- Related posts discovery --------------------
async function findRelatedPostsFromGitHub(currentFrontmatter, currentSlug, githubToken) {
  try {
    const all = await fetchAllPostsMetadata(githubToken);
    if (!Array.isArray(all) || all.length === 0) return [];

    const currentCats = normalizeCategories(currentFrontmatter.categories || []).filter(c => c !== 'reviews');
    const related = [];

    for (const p of all) {
      if (!p || !p.slug || p.slug === currentSlug) continue;
      const pcats = normalizeCategories(p.categories || []).filter(c => c !== 'reviews');
      const matches = currentCats.filter(c => pcats.includes(c));
      if (matches.length > 0) related.push({
        title: p.title || formatSlug(p.slug),
        slug: p.slug,
        description: p.description || '',
        image: p.image || '/default-thumbnail.jpg',
        categories: matches,
        matchCount: matches.length
      });
    }

    related.sort((a,b) => (b.matchCount||0) - (a.matchCount||0));
    return related;
  } catch(err){ console.error('findRelatedPostsFromGitHub error', err); return []; }
}

async function fetchAllPostsMetadata(githubToken) {
  const REPO_OWNER='yourfreetools', REPO_NAME='reviewindex';
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/reviews`;

  try {
    const res = await fetch(apiUrl, { headers:{ Authorization:`token ${githubToken}`, 'User-Agent':'Review-Index-App', Accept:'application/vnd.github.v3+json' }});
    if (!res.ok){ console.error('fetchAllPostsMetadata failed', res.status, await safeText(res)); return []; }

    const files = await res.json();
    const mdFiles = (files||[]).filter(f=>f.name&&f.name.endsWith('.md')).slice(0,50);
    const posts=[];

    for(const f of mdFiles){
      try{
        const rawUrl = f.download_url || `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/content/reviews/${f.name}`;
        const r = await fetch(rawUrl, { headers:{ 'User-Agent':'Review-Index-App' }});
        if(r.ok){
          const txt = await r.text();
          const { frontmatter } = parseMarkdown(txt);
          posts.push({
            slug: f.name.replace('.md',''),
            title: frontmatter.title,
            description: frontmatter.description,
            image: frontmatter.image,
            categories: frontmatter.categories
          });
        }
      }catch(err){ console.error('Error reading post file', f.name, err); }
    }
    return posts;
  }catch(err){ console.error('fetchAllPostsMetadata error', err); return []; }
}

// -------------------- Rendering --------------------
function convertMarkdownToHTML(markdown) {
  if(!markdown) return '';
  let html = markdown.replace(/^# (.*$)/gm,'<h2>$1</h2>')
                     .replace(/^## (.*$)/gm,'<h3>$1</h3>')
                     .replace(/^### (.*$)/gm,'<h4>$1</h4>')
                     .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
                     .replace(/\*(.*?)\*/g,'<em>$1</em>')
                     .replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>')
                     .replace(/`([^`]+)`/g,'<code>$1</code>')
                     .replace(/^> (.*)$/gm,'<blockquote>$1</blockquote>')
                     .replace(/!\[(.*?)\]\((.*?)\)/g,'<img src="$2" alt="$1" loading="lazy" class="content-image">')
                     .replace(/\[(.*?)\]\((.*?)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');

  return html;
}

function generateYouTubeEmbed(youtubeUrl,title){
  if(!youtubeUrl) return '';
  function getYouTubeId(url){ const m=url.match(/^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/); return (m&&m[7].length===11)?m[7]:null;}
  const id = getYouTubeId(youtubeUrl); if(!id) return '';
  return `<section class="youtube-embed"><div class="video-wrapper" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden"><iframe src="https://www.youtube.com/embed/${escapeHtml(id)}" title="${escapeHtml(title)}" style="position:absolute;top:0;left:0;width:100%;height:100%;" allowfullscreen></iframe></div></section>`;
}

function renderCheckPriceButton(link){
  if(!link) return '';
  return `<aside style="background:linear-gradient(135deg,#fff7ed,#fed7aa);padding:1rem;border-radius:8px;margin-top:1.5rem"><a href="${escapeHtml(link)}" target="_blank" rel="nofollow sponsored" style="background:#2563eb;color:#fff;padding:.75rem 1rem;border-radius:8px;text-decoration:none">Check Current Price</a></aside>`;
}

async function renderPostPage(frontmatter, htmlContent, slug, requestUrl, relatedPosts=[]){
  const canonicalUrl = `https://reviewindex.pages.dev/review/${slug}`;
  const youtubeEmbed = frontmatter.youtubeId ? generateYouTubeEmbed(frontmatter.youtubeId, frontmatter.title||formatSlug(slug)) : '';
  const relatedPostsHTML = generateRelatedPostsHTML(relatedPosts, frontmatter.categories);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(frontmatter.title||formatSlug(slug))} - ReviewIndex</title></head><body><div class="container"><header><h1>${escapeHtml(frontmatter.title||formatSlug(slug))}</h1></header>${youtubeEmbed}<main>${htmlContent}</main>${relatedPostsHTML}${renderCheckPriceButton(frontmatter.affiliateLink)}</div></body></html>`;
}

function generateRelatedPostsHTML(relatedPosts,currentCategories){
  if(!relatedPosts||relatedPosts.length===0) return '';
  return `<section style="margin-top:2rem"><h2>🔗 Related Reviews</h2><div style="display:grid;gap:12px;">${relatedPosts.map(p=>`<a class="related-item" href="/review/${encodeURIComponent(p.slug)}"><div class="related-thumbnail"><img src="${escapeHtml(p.image||'/default-thumbnail.jpg')}" alt="${escapeHtml(p.title)}"></div><div><h3>${escapeHtml(p.title)}</h3>${p.description?`<p>${escapeHtml(p.description)}</p>`:''}</div></a>`).join('')}</div></section>`;
}

// -------------------- Utils --------------------
function escapeHtml(str){ if(!str&&str!=='') return ''; return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function formatSlug(slug){ return String(slug).split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' '); }
function renderErrorPage(title,msg){ return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(msg)}</p></body></html>`; }
