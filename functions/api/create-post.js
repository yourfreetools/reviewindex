// functions/api/create-post.js
export async function onRequestPost(context) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (context.request.method === 'OPTIONS') {
        return new Response(null, { 
            status: 200,
            headers: corsHeaders 
        });
    }

    try {
        const { GITHUB_TOKEN } = context.env;
        if (!GITHUB_TOKEN) {
            return errorResponse('GITHUB_TOKEN not configured', 500, corsHeaders);
        }

        const formData = await context.request.json();
        const { 
            title, 
            description, 
            content, 
            image, 
            filename, 
            rating, 
            affiliateLink, 
            youtubeLink, 
            categories, 
            keyFeatures, 
            finalVerdict, 
            pros, 
            cons,
            relatedContent
        } = formData;

        if (!title?.trim() || !filename?.trim()) {
            return errorResponse('Title and Filename are required', 400, corsHeaders);
        }

        if (!filename.match(/^[a-z0-9-]+$/i)) {
            return errorResponse('Filename can only contain letters, numbers, and hyphens', 400, corsHeaders);
        }

        const markdownContent = generateSEOMarkdown({
            title: title.trim(),
            description: description?.trim(),
            content: content?.trim(),
            image: image?.trim(),
            filename: filename.trim(),
            rating: rating || 5,
            affiliateLink: affiliateLink?.trim(),
            youtubeLink: youtubeLink?.trim(),
            categories: categories?.trim(),
            keyFeatures: keyFeatures?.trim(),
            finalVerdict: finalVerdict?.trim(),
            pros: pros?.trim(),
            cons: cons?.trim(),
            relatedContent: relatedContent?.trim()
        });

        const result = await publishToGitHub({
            token: GITHUB_TOKEN,
            content: markdownContent,
            title: title.trim(),
            filename: filename.trim()
        });

        // NEW: Update posts index after successful post creation
        await updatePostsIndex({
            token: GITHUB_TOKEN,
            title: title.trim(),
            filename: filename.trim(),
            slug: generateSlug(title.trim())
        });

        return successResponse(result, corsHeaders);

    } catch (error) {
        console.error('💥 Function Error:', error);
        return errorResponse(error.message, 500, corsHeaders);
    }
}

// NEW: Improved function to update posts-index.json
async function updatePostsIndex({ token, title, filename, slug }) {
    try {
        const REPO_OWNER = 'yourfreetools';
        const REPO_NAME = 'reviewindex';
        const postsIndexPath = 'content/posts-index.json';
        const currentDate = new Date().toISOString();
        
        console.log('🔄 Starting posts index update...');
        
        // Initialize with empty posts array
        let existingIndex = { posts: [] };
        let existingSha = null;

        // Try to get existing posts index file
        try {
            console.log('📖 Fetching existing posts index...');
            const getResponse = await fetch(
                `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${postsIndexPath}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'Review-Index-App'
                    }
                }
            );

            if (getResponse.status === 200) {
                const data = await getResponse.json();
                console.log('✅ Found existing posts index');
                existingSha = data.sha;
                
                // FIXED: Proper base64 decoding
                const content = atob(data.content);
                existingIndex = JSON.parse(content);
                console.log(`📊 Existing index has ${existingIndex.posts?.length || 0} posts`);
            } else if (getResponse.status === 404) {
                console.log('📝 No existing posts index found, will create new one');
            } else {
                console.warn(`⚠️ Unexpected status when fetching index: ${getResponse.status}`);
                // Don't throw, just continue with empty index
            }
        } catch (error) {
            console.log('📝 No existing posts index file or error reading, creating new one...', error.message);
        }

        // Ensure posts array exists
        if (!existingIndex.posts) {
            existingIndex.posts = [];
        }

        // Create new post entry
        const finalFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
        const newPost = {
            title: title,
            slug: slug,
            filename: finalFilename,
            date: currentDate,
            lastmod: currentDate,
            url: `https://reviewindex.pages.dev/review/${filename.replace('.md', '')}`
        };

        console.log(`📝 Processing post: ${title}`);

        // Check if post already exists
        const existingPostIndex = existingIndex.posts.findIndex(post => 
            post.filename === finalFilename || post.slug === slug
        );
        
        if (existingPostIndex !== -1) {
            // Update existing post
            console.log('🔄 Updating existing post in index');
            existingIndex.posts[existingPostIndex] = newPost;
        } else {
            // Add new post to the beginning of the array (newest first)
            console.log('➕ Adding new post to index');
            existingIndex.posts.unshift(newPost);
        }

        // Keep only the latest 1000 posts to prevent file from getting too large
        if (existingIndex.posts.length > 1000) {
            console.log('✂️ Trimming posts array to 1000 entries');
            existingIndex.posts = existingIndex.posts.slice(0, 1000);
        }

        // Convert to JSON and encode for GitHub
        const updatedContent = JSON.stringify(existingIndex, null, 2);
        // FIXED: Proper base64 encoding
        const encodedContent = btoa(updatedContent);

        console.log('📤 Uploading updated posts index to GitHub...');

        // Prepare the request body
        const requestBody = {
            message: `Update posts index: ${title}`,
            content: encodedContent,
            branch: 'main'
        };

        // Add SHA if we're updating an existing file
        if (existingSha) {
            requestBody.sha = existingSha;
        }

        // Update the posts index file
        const updateResponse = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${postsIndexPath}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Review-Index-App'
                },
                body: JSON.stringify(requestBody)
            }
        );

        if (!updateResponse.ok) {
            const responseData = await updateResponse.json();
            console.error('❌ GitHub API error:', responseData);
            throw new Error(`GitHub API error: ${responseData.message || updateResponse.status}`);
        }

        console.log('✅ Posts index updated successfully');
        return true;

    } catch (error) {
        console.error('❌ Error updating posts index:', error);
        // Don't throw the error - we don't want to fail the main post creation
        // if the index update fails
        return false;
    }
}

// Helpers
function errorResponse(message, status = 500, headers) {
    return new Response(JSON.stringify({ success: false, message }), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function successResponse(data, headers) {
    return new Response(JSON.stringify({ 
        success: true, 
        message: '🎉 SEO-optimized review published successfully!', 
        data 
    }), { 
        status: 200, 
        headers: { ...headers, 'Content-Type': 'application/json' } 
    });
}

// Markdown generator (Neutrogena style, affiliateLink only in frontmatter)
function generateSEOMarkdown(data) {
    const currentDate = new Date().toISOString();
    const formattedDate = currentDate.split('T')[0];
    const slug = generateSlug(data.title);

    const categoryList = data.categories ? data.categories.split(',').map(c => `"${c.trim()}"`) : ["reviews"];

    const keyFeaturesList = data.keyFeatures?.split('\n').filter(f => f.trim()).map(f => `- ${f.trim()}`).join('\n');
    const prosList = data.pros?.split('\n').filter(p => p.trim()).map(p => `- ${p.trim()}`).join('\n');
    const consList = data.cons?.split('\n').filter(c => c.trim()).map(c => `- ${c.trim()}`).join('\n');
    
    const relatedContentList = data.relatedContent?.split('\n')
        .filter(url => url.trim())
        .map(url => {
            const cleanUrl = url.trim();
            const title = cleanUrl.replace(/^https?:\/\//, '')
                                .replace(/\/$/, '')
                                .split('/')
                                .pop()
                                .replace(/-/g, ' ')
                                .replace(/\.[^/.]+$/, '')
                                .replace(/\b\w/g, l => l.toUpperCase());
            return `- [${title}](${cleanUrl})`;
        })
        .join('\n');

    return `---
title: "${data.title.replace(/"/g, '\\"')}"
description: "${(data.description || `Comprehensive review of ${data.title}`).replace(/"/g, '\\"').substring(0, 160)}"
image: "${data.image || ''}"
rating: ${data.rating || 5}
affiliateLink: "${data.affiliateLink || ''}"
youtubeId: "${data.youtubeLink || ''}"
categories: [${categoryList.join(', ')}]
date: "${currentDate}"
slug: "${slug}"
draft: false
---

# ${data.title}

${data.image ? `![${data.title}](${data.image})` : ''}

${data.description || ''}

${data.content || 'Start your comprehensive review here...'}

${keyFeaturesList ? `
## Key Features

${keyFeaturesList}
` : ''}

${prosList ? `
## Pros 👍

${prosList}
` : ''}

${consList ? `
## Cons 👎

${consList}
` : ''}

## Final Rating: ${data.rating || 5}/5 ⭐

${data.finalVerdict || '*Your final verdict and recommendation*'}

${relatedContentList ? `
## 📚 Related Content

Check out these related articles and reviews:

${relatedContentList}
` : ''}

---

*Published on ${formattedDate}*
`;
}

function generateSlug(title) {
    return title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 60);
}

async function publishToGitHub({ token, content, title, filename }) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    const finalFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
    const filePath = `content/reviews/${finalFilename}`;
    const encodedContent = btoa(unescape(encodeURIComponent(content)));

    const response = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`, 
        {
            method: 'PUT',
            headers: { 
                'Authorization': `Bearer ${token}`, 
                'Content-Type': 'application/json', 
                'User-Agent': 'Review-Index-App' 
            },
            body: JSON.stringify({ 
                message: `Add review: ${title}`, 
                content: encodedContent, 
                branch: 'main' 
            })
        }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `GitHub API error: ${response.status}`);

    return { 
        sha: data.content.sha, 
        url: data.content.html_url, 
        path: filePath, 
        siteUrl: `https://reviewindex.pages.dev/review/${filename.replace('.md','')}` 
    };
            }
