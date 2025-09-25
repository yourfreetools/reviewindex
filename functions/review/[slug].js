export async function onRequest(context) {
    const { request, params } = context;
    const slug = params.slug;

    try {
        // Redirect .md requests to proper URL
        if (slug.endsWith('.md')) {
            const cleanSlug = slug.replace('.md', '');
            return Response.redirect(`${new URL(request.url).origin}/review/${cleanSlug}`, 301);
        }

        const postContent = await fetchPostContent(slug, context.env.GITHUB_TOKEN);

        if (!postContent) {
            return renderErrorPage('Review not found', 'The requested review could not be found.');
        }

        const htmlContent = await renderPostPage(postContent, slug, request.url);
        return new Response(htmlContent, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
            }
        });

    } catch (error) {
        console.error('Server Error:', error);
        return renderErrorPage('Server Error', 'An error occurred while loading the review.');
    }
}

async function fetchPostContent(slug, githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    const filePath = `content/reviews/${slug}.md`;

    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'Review-Index-App',
                    'Accept': 'application/vnd.github.v3.raw'
                }
            }
        );

        if (response.status === 200) {
            return await response.text();
        }
        return null;
    } catch (error) {
        console.error('Error fetching post:', error);
        return null;
    }
}

async function renderPostPage(markdownContent, slug, requestUrl) {
    const { frontmatter, content } = parseMarkdown(markdownContent);
    const htmlContent = convertMarkdownToHTML(content);

    const canonicalUrl = `https://reviewindex.pages.dev/review/${slug}`;
    const schemaMarkup = generateSchemaMarkup(frontmatter, slug, canonicalUrl);
    const socialImage = frontmatter.image || 'https://reviewindex.pages.dev/default-social-image.jpg';

    // Avoid duplicate affiliate links
    const affiliateRendered = frontmatter.affiliateLink && htmlContent.includes(frontmatter.affiliateLink);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(frontmatter.title || formatSlug(slug))} - ReviewIndex</title>
<meta name="description" content="${escapeHtml(frontmatter.description || 'Comprehensive product review and analysis')}">
<link rel="canonical" href="${canonicalUrl}">

<!-- Open Graph -->
<meta property="og:title" content="${escapeHtml(frontmatter.title || formatSlug(slug))}">
<meta property="og:description" content="${escapeHtml(frontmatter.description || 'Comprehensive product review and analysis')}">
<meta property="og:type" content="article">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:image" content="${escapeHtml(socialImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="ReviewIndex">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(frontmatter.title || formatSlug(slug))}">
<meta name="twitter:description" content="${escapeHtml(frontmatter.description || 'Comprehensive product review and analysis')}">
<meta name="twitter:image" content="${escapeHtml(socialImage)}">
<meta name="twitter:image:alt" content="${escapeHtml(frontmatter.title || formatSlug(slug))} product review">

<!-- Schema.org JSON-LD -->
<script type="application/ld+json">${schemaMarkup}</script>

<style>
/* Keep your original SEO-friendly CSS here */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', system-ui, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; }
.container { max-width: 800px; margin: 0 auto; padding: 20px; background: white; min-height: 100vh; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
.header { text-align: center; padding: 2rem 0; border-bottom: 1px solid #eee; margin-bottom: 2rem; }
.rating { color: #f59e0b; font-size: 1.5rem; margin: 1rem 0; }
.content { font-size: 1.1rem; line-height: 1.8; }
.content img { max-width: 100%; height: auto; margin: 1rem 0; border-radius: 8px; }
.back-link { display: inline-block; margin-top: 2rem; color: #2563eb; text-decoration: none; }
.meta-info { background: #f8fafc; padding: 1rem; border-radius: 8px; margin: 1rem 0; font-size: 0.9rem; color: #666; }
.content h2 { margin: 2rem 0 1rem 0; color: #1a202c; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
.content h3 { margin: 1.5rem 0 0.75rem 0; color: #2d3748; }
.content h4 { margin: 1rem 0 0.5rem 0; color: #4a5568; }
.content p { margin-bottom: 1rem; }
.content ul, .content ol { margin: 1rem 0; padding-left: 2rem; }
.content li { margin-bottom: 0.5rem; }
.content strong { font-weight: 600; }
.content em { font-style: italic; }
</style>
</head>
<body>
<div class="container">
<header class="header" role="banner">
    <h1>${escapeHtml(frontmatter.title || formatSlug(slug))}</h1>
    ${frontmatter.rating ? `<div class="rating" aria-label="Rating: ${frontmatter.rating} out of 5 stars">${'⭐'.repeat(parseInt(frontmatter.rating))} ${frontmatter.rating}/5</div>` : ''}
    ${frontmatter.description ? `<p>${escapeHtml(frontmatter.description)}</p>` : ''}
</header>

<div class="meta-info">
    <strong>Published:</strong> ${frontmatter.date || 'Recently'} | 
    <strong>Categories:</strong> ${frontmatter.categories || 'Review'} |
    <strong>Review by:</strong> ReviewIndex Team
</div>

<main class="content" role="main">
    ${htmlContent}
</main>

<!-- YouTube Video Embed -->
${frontmatter.youtubeId ? `
<aside style="margin: 2rem 0; text-align: center;" aria-label="YouTube Video">
    <iframe 
        width="100%" 
        height="480" 
        src="${frontmatter.youtubeId.replace('https://youtu.be/', 'https://www.youtube.com/embed/')}" 
        title="YouTube video player" 
        frameborder="0" 
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
        allowfullscreen>
    </iframe>
</aside>
` : ''}

<!-- Affiliate Link (only if not already in content) -->
${frontmatter.affiliateLink && !affiliateRendered ? `
<aside style="background: #fff7ed; padding: 1.5rem; border-radius: 8px; margin: 2rem 0; text-align: center;" aria-label="Where to buy">
    <h2>Where to Buy</h2>
    <a href="${frontmatter.affiliateLink}" target="_blank" rel="nofollow sponsored" style="background: #2563eb; color: white; padding: 1rem 2rem; text-decoration: none; border-radius: 6px; display: inline-block; margin: 1rem 0;">
        Check Current Price on Amazon
    </a>
    <p><small>Note: This is an affiliate link. We may earn a commission at no extra cost to you.</small></p>
</aside>
` : ''}

<nav aria-label="Breadcrumb navigation">
    <a href="/" class="back-link">← Back to All Reviews</a>
</nav>
</div>
</body>
</html>`;
}

// parseMarkdown, convertMarkdownToHTML, generateSchemaMarkup, formatSlug, escapeHtml, renderErrorPage remain exactly as in your original code.
