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
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
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
    
    // Convert markdown to HTML (simplified version - you might want to use a proper library)
    const htmlContent = convertMarkdownToHTML(content);
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${frontmatter.title || formatSlug(slug)} - ReviewIndex</title>
    <meta name="description" content="${frontmatter.description || 'Product review and analysis'}">
    <meta property="og:title" content="${frontmatter.title || formatSlug(slug)}">
    <meta property="og:description" content="${frontmatter.description || 'Product review and analysis'}">
    <meta property="og:type" content="article">
    ${frontmatter.image ? `<meta property="og:image" content="${frontmatter.image}">` : ''}
    
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
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${frontmatter.title || formatSlug(slug)}</h1>
            ${frontmatter.rating ? `<div class="rating">${'⭐'.repeat(parseInt(frontmatter.rating))} ${frontmatter.rating}/5</div>` : ''}
            ${frontmatter.description ? `<p>${frontmatter.description}</p>` : ''}
        </div>
        <div class="meta-info">
            <strong>Published:</strong> ${frontmatter.date || 'Recently'} | 
            <strong>Categories:</strong> ${frontmatter.categories || 'Review'}
        </div>
        
        <div class="content">
            ${htmlContent}
        </div>
        
        ${frontmatter.affiliateLink ? `
        <div style="background: #fff7ed; padding: 1rem; border-radius: 8px; margin: 2rem 0; text-align: center;">
            <h3>Where to Buy</h3>
            <a href="${frontmatter.affiliateLink}" target="_blank" style="background: #2563eb; color: white; padding: 1rem 2rem; text-decoration: none; border-radius: 6px; display: inline-block; margin: 1rem 0;">
                Check Price on Amazon
            </a>
            <p><small>Note: This is an affiliate link. We may earn a commission at no extra cost to you.</small></p>
        </div>
        ` : ''}
        
        <a href="/" class="back-link">← Back to All Reviews</a>
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
                    }
                    
                    frontmatter[key] = value;
                }
            });
        }
    }
    
    return { frontmatter, content: markdownContent };
}

function convertMarkdownToHTML(markdown) {
    // Simple markdown to HTML conversion
    return markdown
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/### (.*?)(<br>|$)/g, '<h3>$1</h3>')
        .replace(/## (.*?)(<br>|$)/g, '<h2>$1</h2>')
        .replace(/# (.*?)(<br>|$)/g, '<h1>$1</h1>')
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1">')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
}

function formatSlug(slug) {
    return slug.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function renderErrorPage(title, message) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>${title} - ReviewIndex</title>
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
