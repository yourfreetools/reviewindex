// functions/review/[...slug].js
export async function onRequest(context) {
    const { request, params } = context;
    const slug = params.slug;
    
    try {
        // If it's a direct file request for .md, redirect to proper URL
        if (slug.endsWith('.md')) {
            const cleanSlug = slug.replace('.md', '');
            return Response.redirect(`${new URL(request.url).origin}/review/${cleanSlug}`, 301);
        }

        // Fetch the markdown content from GitHub
        const postContent = await fetchPostContent(slug, context.env.GITHUB_TOKEN);
        
        if (!postContent) {
            return renderErrorPage('Review not found', 'The requested review could not be found.');
        }

        // Convert markdown to HTML and render the post
        const htmlContent = await renderPostPage(postContent, slug, request.url);
        return new Response(htmlContent, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
            }
        });

    } catch (error) {
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
    // Parse frontmatter and content
    const { frontmatter, content } = parseMarkdown(markdownContent);
    
    // Convert markdown to HTML with proper heading hierarchy
    const htmlContent = convertMarkdownToHTML(content);
    
    // Generate canonical URL
    const canonicalUrl = `https://reviewindex.pages.dev/review/${slug}`;
    
    // Generate schema markup
    const schemaMarkup = generateSchemaMarkup(frontmatter, slug, canonicalUrl);
    
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
    ${frontmatter.image ? `<meta property="og:image" content="${escapeHtml(frontmatter.image)}">` : ''}
    <meta property="og:site_name" content="ReviewIndex">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(frontmatter.title || formatSlug(slug))}">
    <meta name="twitter:description" content="${escapeHtml(frontmatter.description || 'Comprehensive product review and analysis')}">
    ${frontmatter.image ? `<meta name="twitter:image" content="${escapeHtml(frontmatter.image)}">` : ''}
    
    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    ${schemaMarkup}
    </script>
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', system-ui, sans-serif; 
            line-height: 1.6; 
            color: #333;
            background: #f5f5f5;
        }
        .container { 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px; 
            background: white;
            min-height: 100vh;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
        }
        .header { 
            text-align: center; 
            padding: 2rem 0; 
            border-bottom: 1px solid #eee;
            margin-bottom: 2rem;
        }
        .rating { 
            color: #f59e0b; 
            font-size: 1.5rem; 
            margin: 1rem 0;
        }
        .content { 
            font-size: 1.1rem; 
            line-height: 1.8;
        }
        .content img { 
            max-width: 100%; 
            height: auto; 
            margin: 1rem 0;
            border-radius: 8px;
        }
        .back-link { 
            display: inline-block; 
            margin-top: 2rem; 
            color: #2563eb; 
            text-decoration: none;
        }
        .meta-info {
            background: #f8fafc;
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0;
            font-size: 0.9rem;
            color: #666;
        }
        
        /* SEO-friendly heading hierarchy */
        .content h2 {
            margin: 2rem 0 1rem 0;
            color: #1a202c;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 0.5rem;
        }
        
        .content h3 {
            margin: 1.5rem 0 0.75rem 0;
            color: #2d3748;
        }
        
        .content p {
            margin-bottom: 1rem;
        }
        
        .content ul, .content ol {
            margin: 1rem 0;
            padding-left: 2rem;
        }
        
        .content li {
            margin-bottom: 0.5rem;
        }
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
        
        ${frontmatter.affiliateLink ? `
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

function parseMarkdown(content) {
    const frontmatter = {};
    let markdownContent = content;
    
    // Parse YAML frontmatter
    if (content.startsWith('---')) {
        const end = content.indexOf('---', 3);
        if (end !== -1) {
            const yaml = content.substring(3, end).trim();
            markdownContent = content.substring(end + 3).trim();
            
            yaml.split('\n').forEach(line => {
                const colon = line.indexOf(':');
                if (colon > 0) {
                    const key = line.substring(0, colon).trim();
                    let value = line.substring(colon + 1).trim();
                    
                    // Remove quotes
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    } else if (value.startsWith("'") && value.endsWith("'")) {
                        value = value.substring(1, value.length - 1);
                    }
                    
                    frontmatter[key] = value;
                }
            });
        }
    }
    
    return { frontmatter, content: markdownContent };
}

function convertMarkdownToHTML(markdown) {
    // Enhanced markdown to HTML conversion with proper heading hierarchy
    let html = markdown
        // Convert headings with proper hierarchy (H1 is already used for title)
        .replace(/^# (.*)$/gm, '<h2>$1</h2>')  // # → H2
        .replace(/^## (.*)$/gm, '<h3>$1</h3>') // ## → H3  
        .replace(/^### (.*)$/gm, '<h4>$1</h4>') // ### → H4
        
        // Handle bold and italic
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        
        // Handle images with proper alt text
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" loading="lazy">')
        
        // Handle links
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" rel="noopener">$1</a>')
        
        // Handle paragraphs (convert double newlines to paragraphs)
        .replace(/\n\n+/g, '</p><p>')
        .replace(/(<h[2-4]>.*?<\/h[2-4]>)/g, '</p>$1<p>');
    
    // Wrap content in paragraphs and clean up empty paragraphs
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[2-4]>.*?<\/h[2-4]>)<\/p>/g, '$1');
    
    // Handle lists properly
    html = html.replace(/^- (.*?)(?=\n-|\n\n|$)/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    return html;
}

function generateSchemaMarkup(frontmatter, slug, url) {
    const rating = parseInt(frontmatter.rating) || 4;
    const title = frontmatter.title || formatSlug(slug);
    
    return JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        "name": title.replace(/ - Honest Review$/, '').replace(/^Best /, ''),
        "description": frontmatter.description || 'Comprehensive product review and analysis',
        "review": {
            "@type": "Review",
            "reviewRating": {
                "@type": "Rating",
                "ratingValue": rating.toString(),
                "bestRating": "5"
            },
            "author": {
                "@type": "Organization",
                "name": "ReviewIndex"
            },
            "publisher": {
                "@type": "Organization",
                "name": "ReviewIndex"
            }
        },
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": rating.toString(),
            "reviewCount": "1"
        }
    }, null, 2);
}

function formatSlug(slug) {
    return slug.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderErrorPage(title, message) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <title>${title} - ReviewIndex</title>
    <meta name="robots" content="noindex">
    <style>
        body { font-family: system-ui; text-align: center; padding: 4rem; background: #f5f5f5; }
        .error-container { background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: #dc2626; margin-bottom: 1rem; }
        a { color: #2563eb; text-decoration: none; }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>⚠️ ${title}</h1>
        <p>${message}</p>
        <p><a href="/">← Return to Homepage</a></p>
    </div>
</body>
</html>`;
    
    return new Response(html, { 
        status: 404,
        headers: { 'Content-Type': 'text/html' }
    });
}
