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
            relatedContent  // NEW: Added relatedContent field
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
            relatedContent: relatedContent?.trim()  // NEW: Added relatedContent
        });

        const result = await publishToGitHub({
            token: GITHUB_TOKEN,
            content: markdownContent,
            title: title.trim(),
            filename: filename.trim()
        });

        return successResponse(result, corsHeaders);

    } catch (error) {
        console.error('💥 Function Error:', error);
        return errorResponse(error.message, 500, corsHeaders);
    }
}

// Helpers
function errorResponse(message, status = 500, headers) {
    return new Response(JSON.stringify({ success: false, message }), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function successResponse(data, headers) {
    return new Response(JSON.stringify({ success: true, message: '🎉 SEO-optimized review published successfully!', data }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
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
    
    // NEW: Generate related content section
    const relatedContentList = data.relatedContent?.split('\n')
        .filter(url => url.trim())
        .map(url => {
            const cleanUrl = url.trim();
            // Extract a readable title from the URL or use the URL itself
            const title = cleanUrl.replace(/^https?:\/\//, '')
                                .replace(/\/$/, '')
                                .split('/')
                                .pop()
                                .replace(/-/g, ' ')
                                .replace(/\.[^/.]+$/, '') // Remove file extension
                                .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize words
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
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'Review-Index-App' },
            body: JSON.stringify({ message: `Add review: ${title}`, content: encodedContent, branch: 'main' })
        }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `GitHub API error: ${response.status}`);

    return { sha: data.content.sha, url: data.content.html_url, path: filePath, siteUrl: `https://reviewindex.pages.dev/review/${filename.replace('.md','')}` };
}
