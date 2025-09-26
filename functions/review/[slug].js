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
        console.error('Error rendering page:', error);
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
    
    // Get social image with fallback
    const socialImage = frontmatter.image || 'https://reviewindex.pages.dev/default-social-image.jpg';
    
    // Generate YouTube embed if YouTube ID exists
    const youtubeEmbed = frontmatter.youtubeId ? generateYouTubeEmbed(frontmatter.youtubeId, frontmatter.title || formatSlug(slug)) : '';

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
            padding: 20px;
        }
        .container { 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 40px; 
            background: white;
            min-height: 100vh;
            box-shadow: 0 0 30px rgba(0,0,0,0.1);
            border-radius: 12px;
        }
        .header { 
            text-align: center; 
            padding: 2rem 0; 
            border-bottom: 2px solid #f0f0f0;
            margin-bottom: 2rem;
        }
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            color: #1a202c;
            line-height: 1.2;
        }
        .rating { 
            color: #f59e0b; 
            font-size: 1.5rem; 
            margin: 1rem 0;
        }
        .content { 
            font-size: 1.1rem; 
            line-height: 1.8;
            color: #2d3748;
        }
        .content img { 
            max-width: 100%; 
            height: auto; 
            margin: 2rem 0;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .back-link { 
            display: inline-block; 
            margin-top: 3rem; 
            color: #2563eb; 
            text-decoration: none;
            font-weight: 600;
            padding: 0.5rem 1rem;
            border: 2px solid #2563eb;
            border-radius: 6px;
            transition: all 0.3s ease;
        }
        .back-link:hover {
            background: #2563eb;
            color: white;
        }
        .meta-info {
            background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
            padding: 1.5rem;
            border-radius: 12px;
            margin: 2rem 0;
            font-size: 0.95rem;
            color: #4a5568;
            border-left: 4px solid #2563eb;
        }
        
        /* YouTube Embed Styles */
        .youtube-embed {
            margin: 3rem 0;
            text-align: center;
            background: #fef7ed;
            padding: 2rem;
            border-radius: 12px;
            border: 2px solid #fed7aa;
        }
        .youtube-embed h3 {
            margin-bottom: 1.5rem;
            color: #1a202c;
            font-size: 1.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        .video-wrapper {
            position: relative;
            width: 100%;
            height: 0;
            padding-bottom: 56.25%; /* 16:9 aspect ratio */
            margin: 1.5rem 0;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        }
        .video-wrapper iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border: none;
        }
        .video-caption {
            margin-top: 1rem;
            color: #666;
            font-size: 0.9rem;
        }
        
        /* SEO-friendly heading hierarchy */
        .content h2 {
            margin: 3rem 0 1.5rem 0;
            color: #1a202c;
            border-bottom: 3px solid #e2e8f0;
            padding-bottom: 0.75rem;
            font-size: 1.8rem;
        }
        
        .content h3 {
            margin: 2rem 0 1rem 0;
            color: #2d3748;
            font-size: 1.4rem;
        }
        
        .content h4 {
            margin: 1.5rem 0 0.75rem 0;
            color: #4a5568;
            font-size: 1.2rem;
        }
        
        .content p {
            margin-bottom: 1.5rem;
            font-size: 1.1rem;
            line-height: 1.7;
        }
        
        .content ul, .content ol {
            margin: 1.5rem 0;
            padding-left: 2.5rem;
        }
        
        .content li {
            margin-bottom: 0.75rem;
            line-height: 1.6;
        }
        
        .content strong {
            font-weight: 600;
            color: #1a202c;
        }
        
        .content em {
            font-style: italic;
            color: #4a5568;
        }
        
        .content blockquote {
            border-left: 4px solid #2563eb;
            padding-left: 1.5rem;
            margin: 2rem 0;
            color: #4a5568;
            font-style: italic;
            background: #f8fafc;
            padding: 1.5rem;
            border-radius: 0 8px 8px 0;
        }
        
        .content code {
            background: #f1f5f9;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
        }
        
        .content pre {
            background: #1a202c;
            color: #e2e8f0;
            padding: 1.5rem;
            border-radius: 8px;
            overflow-x: auto;
            margin: 2rem 0;
        }
        
        .content pre code {
            background: none;
            padding: 0;
            color: inherit;
        }
        
        /* Responsive design */
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            .container {
                padding: 20px;
            }
            .header h1 {
                font-size: 2rem;
            }
            .content {
                font-size: 1rem;
            }
            .youtube-embed {
                margin: 2rem 0;
                padding: 1.5rem;
            }
        }
        
        /* Animation for better UX */
        .container {
            animation: fadeInUp 0.6s ease-out;
        }
        
        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header" role="banner">
            <h1>${escapeHtml(frontmatter.title || formatSlug(slug))}</h1>
            ${frontmatter.rating ? `<div class="rating" aria-label="Rating: ${frontmatter.rating} out of 5 stars">${'⭐'.repeat(parseInt(frontmatter.rating))} ${frontmatter.rating}/5</div>` : ''}
            ${frontmatter.description ? `<p style="font-size: 1.2rem; color: #4a5568;">${escapeHtml(frontmatter.description)}</p>` : ''}
        </header>
        
        <div class="meta-info">
            <strong>Published:</strong> ${frontmatter.date || 'Recently'} | 
            <strong>Categories:</strong> ${frontmatter.categories || 'Review'} |
            <strong>Review by:</strong> ReviewIndex Team
        </div>
        
        <!-- YouTube Video Embed - Placed strategically after header but before main content -->
        ${youtubeEmbed}
        
        <main class="content" role="main">
            ${htmlContent}
        </main>
        
        ${frontmatter.affiliateLink ? `
        <aside style="background: linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%); padding: 2rem; border-radius: 12px; margin: 3rem 0; text-align: center; border: 2px solid #fdba74;" aria-label="Where to buy">
            <h2 style="color: #1a202c; margin-bottom: 1rem;">Where to Buy</h2>
            <a href="${frontmatter.affiliateLink}" target="_blank" rel="nofollow sponsored" style="background: #2563eb; color: white; padding: 1rem 2rem; text-decoration: none; border-radius: 8px; display: inline-block; margin: 1rem 0; font-weight: 600; transition: all 0.3s ease;">
                Check Current Price on Amazon
            </a>
            <p style="margin-top: 1rem; color: #666; font-size: 0.9rem;"><small>Note: This is an affiliate link. We may earn a commission at no extra cost to you.</small></p>
        </aside>
        ` : ''}
        
        <nav aria-label="Breadcrumb navigation" style="text-align: center;">
            <a href="/" class="back-link">← Back to All Reviews</a>
        </nav>
    </div>
    
    <script>
        // Lazy loading for images and better performance
        document.addEventListener('DOMContentLoaded', function() {
            // Add smooth scrolling for anchor links
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function (e) {
                    e.preventDefault();
                    const target = document.querySelector(this.getAttribute('href'));
                    if (target) {
                        target.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }
                });
            });
            
            // Add loading state for external links
            document.querySelectorAll('a[target="_blank"]').forEach(link => {
                link.addEventListener('click', function() {
                    this.style.opacity = '0.7';
                });
            });
        });
    </script>
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
                    } else if (value.startsWith('[') && value.endsWith(']')) {
                        // Handle array values like categories
                        value = value.substring(1, value.length - 1).split(',').map(item => item.trim().replace(/"/g, ''));
                    }
                    
                    frontmatter[key] = value;
                }
            });
        }
    }
    
    return { frontmatter, content: markdownContent };
}

function convertMarkdownToHTML(markdown) {
    // Step 1: Convert markdown to basic HTML
    let html = markdown
        // Convert headings first (H1 is used for title, so start with H2)
        .replace(/^# (.*)$/gm, '<h2>$1</h2>')
        .replace(/^## (.*)$/gm, '<h3>$1</h3>')
        .replace(/^### (.*)$/gm, '<h4>$1</h4>')
        
        // Handle bold and italic
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        
        // Handle code blocks
        .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        
        // Handle blockquotes
        .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
        
        // Handle images
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" loading="lazy">')
        
        // Handle links
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Step 2: Process line by line to handle lists and paragraphs properly
    const lines = html.split('\n');
    let inList = false;
    let listItems = [];
    let processedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (!line) {
            // Empty line - close current list if we're in one
            if (inList && listItems.length > 0) {
                processedLines.push(`<ul>${listItems.join('')}</ul>`);
                listItems = [];
                inList = false;
            }
            continue;
        }

        // Check if this line is a list item
        if (line.startsWith('- ') || line.startsWith('* ') || /^\d+\./.test(line)) {
            if (!inList) {
                inList = true;
            }
            const listItemContent = line.replace(/^(- |\* |\d+\.)/, '').trim();
            listItems.push(`<li>${listItemContent}</li>`);
        } else {
            // Not a list item - close current list if we're in one
            if (inList && listItems.length > 0) {
                processedLines.push(`<ul>${listItems.join('')}</ul>`);
                listItems = [];
                inList = false;
            }
            
            // Handle regular content
            if (line.startsWith('<h') || line.startsWith('<img') || line.startsWith('<a') || 
                line.startsWith('<blockquote') || line.startsWith('<pre') || line.startsWith('<ul') || 
                line.startsWith('<ol')) {
                // Already HTML tags, leave as is
                processedLines.push(line);
            } else {
                // Wrap in paragraph
                processedLines.push(`<p>${line}</p>`);
            }
        }
    }

    // Close any remaining list
    if (inList && listItems.length > 0) {
        processedLines.push(`<ul>${listItems.join('')}</ul>`);
    }

    html = processedLines.join('\n');

    // Step 3: Clean up empty paragraphs and fix spacing
    html = html
        .replace(/<p><\/p>/g, '')
        .replace(/(<\/h[2-4]>)\s*<p>/g, '$1')
        .replace(/<\/p>\s*(<h[2-4]>)/g, '$1')
        .replace(/<p>(<ul>.*?<\/ul>)<\/p>/g, '$1')
        .replace(/<p>(<blockquote>.*?<\/blockquote>)<\/p>/g, '$1')
        .replace(/<p>(<pre>.*?<\/pre>)<\/p>/gs, '$1');

    return html;
}

function generateYouTubeEmbed(youtubeUrl, title) {
    // Extract YouTube video ID from various URL formats
    function getYouTubeId(url) {
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[7].length === 11) ? match[7] : null;
    }
    
    const videoId = getYouTubeId(youtubeUrl);
    
    if (!videoId) return '';
    
    return `
    <section class="youtube-embed" aria-labelledby="video-title">
        <h3 id="video-title">📺 Video Review</h3>
        <div class="video-wrapper">
            <iframe 
                src="https://www.youtube.com/embed/${videoId}" 
                title="Video review of ${escapeHtml(title)}"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen
                loading="lazy">
            </iframe>
        </div>
        <p class="video-caption">Watch our detailed video review for a comprehensive overview</p>
    </section>`;
}

function generateSchemaMarkup(frontmatter, slug, url) {
    const rating = parseInt(frontmatter.rating) || 4;
    // Clean up the product name by removing "Best" and "Honest Review"
    const productName = (frontmatter.title || formatSlug(slug))
        .replace(/^Best /, '')
        .replace(/ – Honest Review.*$/, '')
        .trim();

    return JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        "name": productName,
        "description": frontmatter.description || 'Comprehensive product review and analysis',
        "image": frontmatter.image || '',
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
        body { 
            font-family: system-ui, sans-serif; 
            text-align: center; 
            padding: 2rem; 
            background: #f5f5f5;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
        }
        .error-container { 
            background: white; 
            padding: 3rem; 
            border-radius: 12px; 
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
            max-width: 500px;
            width: 100%;
        }
        h1 { 
            color: #dc2626; 
            margin-bottom: 1rem;
            font-size: 2rem;
        }
        p {
            color: #666;
            margin-bottom: 2rem;
            line-height: 1.6;
        }
        a { 
            color: #2563eb; 
            text-decoration: none;
            font-weight: 600;
            padding: 0.75rem 1.5rem;
            border: 2px solid #2563eb;
            border-radius: 6px;
            transition: all 0.3s ease;
        }
        a:hover {
            background: #2563eb;
            color: white;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>⚠️ ${title}</h1>
        <p>${message}</p>
        <a href="/">← Return to Homepage</a>
    </div>
</body>
</html>`;
    
    return new Response(html, { 
        status: 404,
        headers: { 'Content-Type': 'text/html' }
    });
                }
