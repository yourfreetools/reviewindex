// functions/review/[...slug].js
export async function onRequest(context) {
    const { request, params, env } = context;
    const slug = params.slug;
    
    try {
        if (slug.endsWith('.md')) {
            const cleanSlug = slug.replace('.md', '');
            return Response.redirect(`${new URL(request.url).origin}/review/${cleanSlug}`, 301);
        }

        const postContent = await fetchPostContent(slug, env.GITHUB_TOKEN);
        if (!postContent) {
            return renderErrorPage('Review not found', 'The requested review could not be found.');
        }

        const { frontmatter, content } = parseMarkdown(postContent);
        const htmlContent = convertMarkdownToHTML(content);
        
        // Get related posts with PROPER file editing
        const relatedPosts = await getRelatedPostsWithForcedEdit(
            frontmatter, 
            slug, 
            content,
            env.GITHUB_TOKEN
        );

        const fullHtml = await renderPostPage(
            frontmatter,
            htmlContent, 
            slug, 
            request.url, 
            relatedPosts
        );
        
        return new Response(fullHtml, {
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

// ==================== FORCED FILE EDITING STRATEGY ====================

async function getRelatedPostsWithForcedEdit(currentFrontmatter, currentSlug, currentContent, githubToken) {
    try {
        // Check if related posts already exist in frontmatter
        if (currentFrontmatter.related_posts && Array.isArray(currentFrontmatter.related_posts)) {
            console.log('✅ Using existing related posts from frontmatter for:', currentSlug);
            
            const relatedPosts = [];
            for (const slug of currentFrontmatter.related_posts) {
                const postData = await getPostData(slug, githubToken);
                if (postData) {
                    relatedPosts.push(postData);
                }
            }
            return relatedPosts;
        }
        
        // First time visit - find and FORCE SAVE related posts
        console.log('🔄 First time visit! Finding and SAVING related posts for:', currentSlug);
        const relatedPosts = await findAndForceSaveRelatedPosts(
            currentFrontmatter, 
            currentSlug, 
            currentContent, 
            githubToken
        );
        
        return relatedPosts;
        
    } catch (error) {
        console.error('Error in getRelatedPostsWithForcedEdit:', error);
        return [];
    }
}

async function findAndForceSaveRelatedPosts(currentFrontmatter, currentSlug, currentContent, githubToken) {
    try {
        // Get recent posts (10 posts before this one)
        const recentPosts = await getRecentPostsBefore(currentSlug, 10, githubToken);
        if (!recentPosts || recentPosts.length === 0) {
            console.log('📭 No recent posts found for:', currentSlug);
            return [];
        }

        const currentPostCategories = normalizeCategories(currentFrontmatter.categories);
        const related = [];

        // Check each recent post for category matches
        for (const post of recentPosts) {
            if (post.slug === currentSlug) continue;
            
            const postCategories = normalizeCategories(post.categories);
            const matchingCategories = findMatchingCategories(currentPostCategories, postCategories);
            
            if (matchingCategories.length > 0) {
                related.push({
                    title: post.title || formatSlug(post.slug),
                    slug: post.slug,
                    description: post.description || '',
                    image: post.image || '/default-thumbnail.jpg',
                    categories: matchingCategories
                });
                
                if (related.length >= 3) break;
            }
        }

        console.log('📊 Found', related.length, 'related posts for:', currentSlug);
        
        // FORCE SAVE regardless of whether we found matches
        const saved = await forceSaveRelatedPostsToFile(currentSlug, currentContent, related, githubToken);
        if (saved) {
            console.log('💾 SUCCESS: Saved related posts to MD file for:', currentSlug);
        } else {
            console.log('❌ FAILED: Could not save related posts for:', currentSlug);
        }
        
        return related;
        
    } catch (error) {
        console.error('Error finding related posts:', error);
        return [];
    }
}

async function forceSaveRelatedPostsToFile(slug, currentContent, relatedPosts, githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    const filePath = `content/reviews/${slug}.md`;
    
    try {
        console.log('🛠️ Attempting to save related posts to:', slug);
        
        // 1. Get the current file details (SHA is required for updates)
        const fileInfoResponse = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'Review-Index-App',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );
        
        if (!fileInfoResponse.ok) {
            console.error('❌ Failed to get file info. Status:', fileInfoResponse.status);
            const errorText = await fileInfoResponse.text();
            console.error('Error details:', errorText);
            return false;
        }
        
        const fileInfo = await fileInfoResponse.json();
        console.log('✅ Got file info. SHA:', fileInfo.sha ? 'Present' : 'Missing');
        
        // 2. Parse and update the frontmatter
        const { frontmatter, content: markdownContent } = parseMarkdown(currentContent);
        
        // Add related_posts to frontmatter (even if empty array)
        const relatedSlugs = relatedPosts.map(post => post.slug);
        frontmatter.related_posts = relatedSlugs;
        
        console.log('📝 Updated frontmatter with related_posts:', relatedSlugs);
        
        // 3. Reconstruct the markdown with updated frontmatter
        const updatedMarkdown = generateMarkdownWithFrontmatter(frontmatter, markdownContent);
        
        // 4. Encode content to base64
        const contentBase64 = btoa(unescape(encodeURIComponent(updatedMarkdown)));
        console.log('🔢 Content encoded to base64. Length:', contentBase64.length);
        
        // 5. Update the file on GitHub
        const updatePayload = {
            message: `🔗 Auto-add related posts to ${slug}`,
            content: contentBase64,
            sha: fileInfo.sha
        };
        
        console.log('📤 Sending update to GitHub...');
        const updateResponse = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'Review-Index-App',
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatePayload)
            }
        );
        
        console.log('📥 GitHub response status:', updateResponse.status);
        
        if (updateResponse.ok) {
            const result = await updateResponse.json();
            console.log('✅ SUCCESS: File updated! Commit SHA:', result.commit.sha);
            return true;
        } else {
            const errorText = await updateResponse.text();
            console.error('❌ GitHub API error. Status:', updateResponse.status);
            console.error('Error details:', errorText);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Error updating markdown file:', error);
        console.error('Error stack:', error.stack);
        return false;
    }
}

async function getRecentPostsBefore(currentSlug, limit, githubToken) {
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
            const markdownFiles = files
                .filter(file => file.name.endsWith('.md'))
                .sort((a, b) => b.name.localeCompare(a.name));
            
            // Find current post index and get posts before it
            const currentIndex = markdownFiles.findIndex(file => 
                file.name.replace('.md', '') === currentSlug
            );
            
            if (currentIndex === -1) {
                console.log('❌ Current post not found in file list:', currentSlug);
                return [];
            }
            
            // Get posts AFTER current post (newer posts)
            const startIndex = Math.max(0, currentIndex + 1);
            const endIndex = Math.min(markdownFiles.length, currentIndex + 1 + limit);
            const recentFiles = markdownFiles.slice(startIndex, endIndex);
            
            console.log(`🔍 Checking ${recentFiles.length} posts after:`, currentSlug);
            
            const postsMetadata = [];
            for (const file of recentFiles) {
                const slug = file.name.replace('.md', '');
                const postData = await getPostData(slug, githubToken);
                if (postData) {
                    postsMetadata.push(postData);
                }
            }
            
            return postsMetadata;
        } else {
            console.error('GitHub API error:', response.status);
            return [];
        }
    } catch (error) {
        console.error('Error fetching posts list:', error);
        return [];
    }
}

async function getPostData(slug, githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/reviews/${slug}.md`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/vnd.github.v3.raw'
                }
            }
        );
        
        if (response.status === 200) {
            const content = await response.text();
            const firstLines = content.split('\n').slice(0, 15).join('\n');
            const { frontmatter } = parseMarkdown(firstLines + '\n---\n');
            
            return {
                slug: slug,
                title: frontmatter.title,
                description: frontmatter.description,
                image: frontmatter.image,
                categories: frontmatter.categories
            };
        }
        return null;
    } catch (error) {
        console.error('Error fetching post data for:', slug, error);
        return null;
    }
}

function generateMarkdownWithFrontmatter(frontmatter, content) {
    let frontmatterText = '---\n';
    
    for (const [key, value] of Object.entries(frontmatter)) {
        if (Array.isArray(value)) {
            if (value.length > 0) {
                frontmatterText += `${key}: [${value.map(v => `"${v}"`).join(', ')}]\n`;
            } else {
                frontmatterText += `${key}: []\n`;
            }
        } else if (value !== null && value !== undefined) {
            const escapedValue = value.toString().replace(/"/g, '\\"');
            frontmatterText += `${key}: "${escapedValue}"\n`;
        }
    }
    
    frontmatterText += '---\n\n';
    return frontmatterText + content.trim();
}

// ==================== CORE HELPER FUNCTIONS ====================

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
        } else {
            console.error('GitHub API error:', response.status);
            return null;
        }
    } catch (error) {
        console.error('Error fetching post:', error);
        return null;
    }
}

function parseMarkdown(content) {
    const frontmatter = {};
    let markdownContent = content;
    
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
                    
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    } else if (value.startsWith("'") && value.endsWith("'")) {
                        value = value.substring(1, value.length - 1);
                    } else if (value.startsWith('[') && value.endsWith(']')) {
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
    let html = markdown
        .replace(/^# (.*)$/gm, '<h2>$1</h2>')
        .replace(/^## (.*)$/gm, '<h3>$1</h3>')
        .replace(/^### (.*)$/gm, '<h4>$1</h4>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" loading="lazy" class="content-image">')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    const lines = html.split('\n');
    let inList = false;
    let listItems = [];
    let processedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (!line) {
            if (inList && listItems.length > 0) {
                processedLines.push(`<ul>${listItems.join('')}</ul>`);
                listItems = [];
                inList = false;
            }
            continue;
        }

        if (line.startsWith('- ') || line.startsWith('* ') || /^\d+\./.test(line)) {
            if (!inList) inList = true;
            const listItemContent = line.replace(/^(- |\* |\d+\.)/, '').trim();
            listItems.push(`<li>${listItemContent}</li>`);
        } else {
            if (inList && listItems.length > 0) {
                processedLines.push(`<ul>${listItems.join('')}</ul>`);
                listItems = [];
                inList = false;
            }
            
            if (line.startsWith('<h') || line.startsWith('<img') || line.startsWith('<a') || 
                line.startsWith('<blockquote') || line.startsWith('<pre') || line.startsWith('<ul') || 
                line.startsWith('<ol')) {
                processedLines.push(line);
            } else {
                processedLines.push(`<p>${line}</p>`);
            }
        }
    }

    if (inList && listItems.length > 0) {
        processedLines.push(`<ul>${listItems.join('')}</ul>`);
    }

    html = processedLines.join('\n');

    return html
        .replace(/<p><\/p>/g, '')
        .replace(/(<\/h[2-4]>)\s*<p>/g, '$1')
        .replace(/<\/p>\s*(<h[2-4]>)/g, '$1')
        .replace(/<p>(<ul>.*?<\/ul>)<\/p>/g, '$1')
        .replace(/<p>(<blockquote>.*?<\/blockquote>)<\/p>/g, '$1')
        .replace(/<p>(<pre>.*?<\/pre>)<\/p>/gs, '$1');
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

function generateYouTubeEmbed(youtubeUrl, title) {
    if (!youtubeUrl) return '';
    
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

// ==================== RENDER FUNCTION ====================

async function renderPostPage(frontmatter, htmlContent, slug, requestUrl, relatedPosts = []) {
    const canonicalUrl = `https://reviewindex.pages.dev/review/${slug}`;
    const schemaMarkup = generateSchemaMarkup(frontmatter, slug, canonicalUrl);
    const socialImage = frontmatter.image || 'https://reviewindex.pages.dev/default-social-image.jpg';
    const youtubeEmbed = frontmatter.youtubeId ? generateYouTubeEmbed(frontmatter.youtubeId, frontmatter.title || formatSlug(slug)) : '';

    const relatedPostsHTML = relatedPosts.length > 0 ? generateRelatedPostsHTML(relatedPosts, frontmatter.categories) : '';

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
        /* ... (keep all your existing CSS styles) ... */
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
        
        ${youtubeEmbed}
        
        <main class="content" role="main">
            ${htmlContent}
        </main>
        
        ${relatedPostsHTML}
        
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

function generateRelatedPostsHTML(relatedPosts, currentCategories) {
    if (relatedPosts.length === 0) return '';
    
    return `
<section class="related-posts" aria-labelledby="related-posts-title">
    <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); padding: 2.5rem; border-radius: 12px; margin: 3rem 0; border-left: 4px solid #0369a1;">
        <h2 id="related-posts-title" style="color: #0c4a6e; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
            🔗 Related Reviews
        </h2>
        <p style="color: #475569; margin-bottom: 1.5rem;">You might also be interested in:</p>
        
        <div class="related-grid">
            ${relatedPosts.map(post => `
            <a href="/review/${post.slug}" class="related-item">
                <div class="related-thumbnail">
                    <img 
                        src="${post.image}" 
                        alt="${escapeHtml(post.title)}"
                        loading="lazy"
                        onerror="this.src='/default-thumbnail.jpg'"
                    >
                </div>
                <div class="related-content">
                    <h3>${escapeHtml(post.title)}</h3>
                    ${post.description ? `<p>${escapeHtml(post.description)}</p>` : ''}
                    <div class="related-categories">
                        ${post.categories.map(cat => `
                            <span class="related-category">${cat}</span>
                        `).join('')}
                    </div>
                </div>
            </a>
            `).join('')}
        </div>
    </div>
</section>`;
}
