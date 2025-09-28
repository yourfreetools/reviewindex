// functions/api/create-post.js

// ----------------------
// Constants
const POSTS_INDEX_PATH = 'content/posts-index.json';

// ----------------------
// POST handler
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

        // Generate Markdown
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

        // Publish to GitHub
        const result = await publishToGitHub({
            token: GITHUB_TOKEN,
            content: markdownContent,
            title: title.trim(),
            filename: filename.trim()
        });

        // Update posts-index.json
        await updatePostsIndex({
            token: GITHUB_TOKEN,
            title: title.trim(),
            slug: generateSlug(title.trim()),
            date: new Date().toISOString()
        });

        return successResponse(result, corsHeaders);

    } catch (error) {
        console.error('💥 Function Error:', error);
        return errorResponse(error.message, 500, corsHeaders);
    }
}

// ----------------------
// Helper responses
function errorResponse(message, status = 500, headers) {
    return new Response(JSON.stringify({ success: false, message }), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function successResponse(data, headers) {
    return new Response(JSON.stringify({ success: true, message: '🎉 SEO-optimized review published successfully!', data }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// ----------------------
// Markdown generator
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
            const title = cleanUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/').pop()
                .replace(/-/g, ' ').replace(/\.[^/.]+$/, '').replace(/\b\w/g, l => l.toUpperCase());
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

// ----------------------
// Slug generator
function generateSlug(title) {
    return title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 60);
}

// ----------------------
// GitHub publish helper
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
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'Review-Index-App' },
            body: JSON.stringify({ message: `Add review: ${title}`, content: encodedContent, branch: 'main' })
        }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `GitHub API error: ${response.status}`);

    return { sha: data.content.sha, url: data.content.html_url, path: filePath, siteUrl: `https://reviewindex.pages.dev/review/${filename.replace('.md','')}` };
}

// ----------------------
// Update posts-index.json helper
async function updatePostsIndex({ token, title, slug, date }) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';

    let existing = [];
    let sha = null;

    // 1️⃣ Fetch current JSON
    const getResponse = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${POSTS_INDEX_PATH}`, {
        headers: {
            'Authorization': `token ${token}`,
            'User-Agent': 'ReviewIndex-App',
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (getResponse.ok) {
        const data = await getResponse.json();
        sha = data.sha;
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        existing = JSON.parse(content);
    }

    // 2️⃣ Add new post
    existing.push({ title, slug, date });

    // 3️⃣ Sort descending
    existing.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 4️⃣ Upload updated JSON
    const updatedContent = btoa(unescape(encodeURIComponent(JSON.stringify(existing, null, 2))));
    const body = { message: `Update posts-index.json with: ${title}`, content: updatedContent, branch: 'main' };
    if (sha) body.sha = sha;

    const putResponse = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${POSTS_INDEX_PATH}`, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'ReviewIndex-App'
        },
        body: JSON.stringify(body)
    });

    if (!putResponse.ok) {
        const errorData = await putResponse.json();
        console.warn('Failed to update posts-index.json:', errorData.message || errorData);
    }
}
