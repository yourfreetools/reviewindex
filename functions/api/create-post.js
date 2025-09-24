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
        console.log('🚀 Starting SEO review publication process...');

        const { GITHUB_TOKEN } = context.env;
        
        if (!GITHUB_TOKEN) {
            return errorResponse('GITHUB_TOKEN not configured', 500, corsHeaders);
        }

        const formData = await context.request.json();
        
        // Enhanced validation
        const { 
            title, 
            description, 
            content, 
            image, 
            filename, 
            rating = '4',
            affiliateLink, 
            youtubeLink, 
            keyFeatures, // NEW FIELD
            finalVerdict, // NEW FIELD
            pros, 
            cons, 
            categories 
        } = formData;

        // Validate required fields
        if (!title?.trim() || !filename?.trim()) {
            return errorResponse('Title and Filename are required', 400, corsHeaders);
        }

        // Validate filename format
        if (!filename.match(/^[a-z0-9-]+$/i)) {
            return errorResponse('Filename can only contain letters, numbers, and hyphens', 400, corsHeaders);
        }

        // Generate SEO content
        const markdownContent = generateSEOMarkdown({
            title: title.trim(),
            description: description?.trim(),
            content: content?.trim(),
            image: image?.trim(),
            filename: filename.trim(),
            rating,
            affiliateLink: affiliateLink?.trim(),
            youtubeLink: youtubeLink?.trim(),
            keyFeatures: keyFeatures?.trim(), // NEW FIELD
            finalVerdict: finalVerdict?.trim(), // NEW FIELD
            pros: pros?.trim(),
            cons: cons?.trim(),
            categories: categories?.trim()
        });

        // Publish to GitHub
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

// Helper functions
function errorResponse(message, status = 500, headers) {
    return new Response(JSON.stringify({ 
        success: false, 
        message 
    }), {
        status,
        headers: { 
            ...headers, 
            'Content-Type': 'application/json' 
        },
    });
}

function successResponse(data, headers) {
    return new Response(JSON.stringify({ 
        success: true, 
        message: '🎉 SEO-optimized review published successfully!',
        data 
    }), {
        status: 200,
        headers: { 
            ...headers, 
            'Content-Type': 'application/json' 
        },
    });
}

function generateSEOMarkdown(data) {
    const currentDate = new Date().toISOString();
    const formattedDate = currentDate.split('T')[0];
    const seoSlug = generateSlug(data.title);

    // Generate lists
    const keyFeaturesList = data.keyFeatures?.split('\n').filter(f => f.trim()).map(f => `- ${f.trim()}`).join('\n');
    const prosList = data.pros?.split('\n').filter(p => p.trim()).map(p => `- ${p.trim()}`).join('\n');
    const consList = data.cons?.split('\n').filter(c => c.trim()).map(c => `- ${c.trim()}`).join('\n');
    const categoryList = data.categories ? 
        data.categories.split(',').map(c => c.trim()).filter(c => c) : 
        ['reviews'];

    return `---
title: "${data.title.replace(/"/g, '\\"')}"
description: "${(data.description || `Comprehensive review of ${data.title}`).replace(/"/g, '\\"').substring(0, 160)}"
image: "${data.image || ''}"
rating: ${data.rating || 5}
affiliateLink: "${data.affiliateLink || ''}"
youtubeId: "${data.youtubeLink || ''}"
categories: [${categoryList.map(c => `"${c}"`).join(', ')}]
date: "${currentDate}"
slug: "${seoSlug}"
draft: false
---

# ${data.title}

${data.image ? `![${data.title}](${data.image})` : ''}

${data.description ? `> ${data.description}` : ''}

${data.content || '## Introduction\n\nStart your comprehensive review here...'}

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

${data.affiliateLink ? `
## Where to Buy

[Check Price on Amazon](${data.affiliateLink})
` : ''}

---

*Published on ${formattedDate}*
`;
}

function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 60);
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
                'Authorization': `token ${token}`,
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

    if (!response.ok) {
        throw new Error(data.message || `GitHub API error: ${response.status}`);
    }

    return {
        sha: data.content.sha,
        url: data.content.html_url,
        path: filePath,
        siteUrl: `https://reviewindex.pages.dev/review/${filename.replace('.md', '')}`
    };
                                                                                                             }
