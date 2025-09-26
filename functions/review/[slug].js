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

        // Fetch the current post content
        const postContent = await fetchPostContent(slug, context.env.GITHUB_TOKEN);
        
        if (!postContent) {
            return renderErrorPage('Review not found', 'The requested review could not be found.');
        }

        // Parse current post frontmatter
        const { frontmatter: currentFrontmatter } = parseMarkdown(postContent);
        
        // Fetch and find related posts
        const relatedPosts = await findRelatedPosts(
            currentFrontmatter, 
            slug, 
            context.env.GITHUB_TOKEN
        );

        // Convert markdown to HTML and render the post with related posts
        const htmlContent = await renderPostPage(
            postContent, 
            slug, 
            request.url, 
            relatedPosts
        );
        
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

// FETCH INDIVIDUAL POST CONTENT (MISSING)
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

// PARSE MARKDOWN (MISSING)
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

// CONVERT MARKDOWN TO HTML (MISSING)
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

// GENERATE YOUTUBE EMBED (MISSING)
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

// GENERATE SCHEMA MARKUP (MISSING)
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

// FORMAT SLUG (MISSING)
function formatSlug(slug) {
    return slug.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

// ESCAPE HTML (MISSING)
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// RENDER ERROR PAGE (MISSING)
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

// === RELATED POSTS FUNCTIONS (the ones you already have) ===

async function findRelatedPosts(currentFrontmatter, currentSlug, githubToken) {
    try {
        // Get list of all markdown files in the reviews directory
        const allPosts = await fetchPostsList(githubToken);
        if (!allPosts || allPosts.length === 0) return [];

        const currentPostCategories = normalizeCategories(currentFrontmatter.categories);
        const related = [];

        // Check each post for category matches
        for (const post of allPosts) {
            if (post.name.replace('.md', '') === currentSlug) continue; // Skip current post
            
            const postContent = await fetchPostContent(post.name.replace('.md', ''), githubToken);
            if (!postContent) continue;
            
            const { frontmatter } = parseMarkdown(postContent);
            const postCategories = normalizeCategories(frontmatter.categories);
            
            // Find category matches (excluding "reviews" category)
            const matchingCategories = findMatchingCategories(
                currentPostCategories, 
                postCategories
            );
            
            if (matchingCategories.length > 0) {
                related.push({
                    title: frontmatter.title || formatSlug(post.name.replace('.md', '')),
                    slug: post.name.replace('.md', ''),
                    description: frontmatter.description || '',
                    categories: matchingCategories,
                    matchCount: matchingCategories.length
                });
            }
        }

        // Sort by number of matching categories and return top 3-4
        return related
            .sort((a, b) => b.matchCount - a.matchCount)
            .slice(0, 4);

    } catch (error) {
        console.error('Error finding related posts:', error);
        return [];
    }
}

async function fetchPostsList(githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/reviews`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'Review-Index-App',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        if (response.status === 200) {
            const files = await response.json();
            return files.filter(file => file.name.endsWith('.md'));
        }
        return [];
    } catch (error) {
        console.error('Error fetching posts list:', error);
        return [];
    }
}

function normalizeCategories(categories) {
    if (!categories) return [];
    
    let catsArray = Array.isArray(categories) ? categories : [categories];
    
    return catsArray
        .map(cat => cat.trim().toLowerCase())
        .filter(cat => cat !== 'reviews' && cat !== 'review');
}

function findMatchingCategories(currentCats, otherCats) {
    return currentCats.filter(cat => 
        otherCats.includes(cat)
    );
}

function generateRelatedPostsHTML(relatedPosts, currentCategories) {
    if (relatedPosts.length === 0) return '';
    
    const normalizedCats = normalizeCategories(currentCategories);
    const displayCategory = normalizedCats.length > 0 ? normalizedCats[0] : 'related';
    
    return `
<section class="related-posts" aria-labelledby="related-posts-title">
    <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); padding: 2.5rem; border-radius: 12px; margin: 3rem 0; border-left: 4px solid #0369a1;">
        <h2 id="related-posts-title" style="color: #0c4a6e; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
            🔗 More ${displayCategory.charAt(0).toUpperCase() + displayCategory.slice(1)} Reviews
        </h2>
        <p style="color: #475569; margin-bottom: 1.5rem;">If you liked this review, you might also be interested in:</p>
        
        <div class="related-grid" style="display: grid; gap: 1rem;">
            ${relatedPosts.map(post => `
            <div class="related-item" style="background: white; padding: 1.5rem; border-radius: 8px; border: 1px solid #e2e8f0; transition: all 0.3s ease;">
                <a href="/review/${post.slug}" style="text-decoration: none; color: inherit; display: block;">
                    <h3 style="color: #1e40af; margin-bottom: 0.5rem; font-size: 1.1rem;">${escapeHtml(post.title)}</h3>
                    ${post.description ? `<p style="color: #64748b; font-size: 0.9rem; margin-bottom: 0.5rem;">${escapeHtml(post.description)}</p>` : ''}
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        ${post.categories.map(cat => `
                            <span style="background: #dbeafe; color: #1e40af; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 500;">
                                ${cat}
                            </span>
                        `).join('')}
                    </div>
                </a>
            </div>
            `).join('')}
        </div>
    </div>
</section>

<style>
.related-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    border-color: #3b82f6 !important;
}

@media (min-width: 768px) {
    .related-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (min-width: 1024px) {
    .related-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}
</style>`;
            }
