// functions/api/create-post.js
export async function onRequestPost(context) {
    // CORS headers for cross-origin requests
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight OPTIONS request
    if (context.request.method === 'OPTIONS') {
        return new Response(null, { 
            status: 200,
            headers: corsHeaders 
        });
    }

    try {
        console.log('🚀 Starting SEO review publication process...');

        // Get GitHub token from environment variables
        const { GITHUB_TOKEN } = context.env;
        
        if (!GITHUB_TOKEN) {
            console.error('❌ GITHUB_TOKEN is not set in environment variables');
            return new Response(JSON.stringify({ 
                success: false, 
                message: 'Server configuration error: GITHUB_TOKEN environment variable is not set. Please configure it in Cloudflare Pages settings.' 
            }), {
                status: 500,
                headers: { 
                    ...corsHeaders, 
                    'Content-Type': 'application/json' 
                },
            });
        }

        console.log('✅ GITHUB_TOKEN is available');

        // Parse the incoming form data
        const formData = await context.request.json();
        console.log('📦 Received form data:', Object.keys(formData));

        // Destructure and validate required fields
        const { 
            title, 
            description, 
            content, 
            image, 
            filename, 
            rating = '4',
            affiliateLink, 
            youtubeLink, 
            pros, 
            cons, 
            categories 
        } = formData;

        // Validate required fields
        if (!title || !filename) {
            console.error('❌ Validation failed: Title and Filename are required');
            return new Response(JSON.stringify({ 
                success: false, 
                message: 'Title and Filename are required fields.' 
            }), {
                status: 400,
                headers: { 
                    ...corsHeaders, 
                    'Content-Type': 'application/json' 
                },
            });
        }

        console.log('✅ Form validation passed');

        // Generate SEO-optimized markdown content
        console.log('📝 Generating SEO-optimized markdown content...');
        
        const prosList = pros && pros.split('\n').filter(p => p.trim()).map(p => `- ${p.trim()}`).join('\n');
        const consList = cons && cons.split('\n').filter(c => c.trim()).map(c => `- ${c.trim()}`).join('\n');
        
        const categoryList = categories ? 
            categories.split(',').map(c => c.trim()).filter(c => c) : 
            ['reviews'];

        // Current date for front matter
        const currentDate = new Date().toISOString();
        const formattedDate = currentDate.split('T')[0];

        // SEO-optimized markdown template with proper front matter
        const fullMarkdownContent = `---
title: "${title.replace(/"/g, '\\"')}"
description: "${description ? description.replace(/"/g, '\\"').substring(0, 160) : `Comprehensive review of ${title} covering features, performance, and value.`}"
image: "${image || ''}"
rating: ${rating || 5}
affiliateLink: "${affiliateLink || ''}"
youtubeId: "${youtubeLink || ''}"
categories: [${categoryList.map(c => `"${c}"`).join(', ')}]
date: "${currentDate}"
slug: "${filename}"
draft: false
---

# ${title}

${image ? `![${title}](${image})` : ''}

${description ? `> ${description}` : ''}

${content || '## Introduction\n\nStart your comprehensive review here...'}

## Key Features and Specifications

*Add detailed product specifications here for better SEO and user understanding*

## Performance Review

*Detailed performance analysis with real-world testing results*

${prosList ? `
## 👍 Pros

${prosList}
` : ''}

${consList ? `
## 👎 Cons

${consList}
` : ''}

## Value for Money

*Analysis of price vs performance and alternatives*

## Final Verdict: ${rating || 5}/5 ⭐

*Conclusion and buying recommendation*

${affiliateLink ? `
## Where to Buy

[Check Current Price on Amazon](${affiliateLink})

*Note: This is an affiliate link. We may earn a commission at no extra cost to you.*
` : ''}

${youtubeLink ? `
## Video Review

<iframe width="100%" height="400" src="https://www.youtube.com/embed/${youtubeLink}" title="${title} Video Review" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
` : ''}

---

*Review published on ${formattedDate}*

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Review",
  "itemReviewed": {
    "@type": "Product",
    "name": "${title.replace(/"/g, '\\"')}",
    "description": "${description ? description.replace(/"/g, '\\"').substring(0, 200) : `Comprehensive review of ${title}`}",
    "image": "${image || ''}"
  },
  "reviewRating": {
    "@type": "Rating",
    "ratingValue": "${rating || 5}",
    "bestRating": "5"
  },
  "author": {
    "@type": "Person",
    "name": "Review Index"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Review Index",
    "url": "https://reviewindex.pages.dev"
  },
  "datePublished": "${currentDate}",
  "reviewBody": "${description ? description.replace(/"/g, '\\"') : `Comprehensive review of ${title}`}"
}
</script>
`;

        console.log('✅ Markdown content generated successfully');
        console.log('📊 Content stats:', {
            title_length: title.length,
            description_length: description ? description.length : 0,
            content_length: content ? content.length : 0,
            total_length: fullMarkdownContent.length
        });

        // Prepare content for GitHub API (Base64 encoding)
        const encodedContent = btoa(unescape(encodeURIComponent(fullMarkdownContent)));
        
        // GitHub repository configuration - UPDATED WITH YOUR INFO
        const REPO_OWNER = 'yourfreetools'; // Your GitHub username
        const REPO_NAME = 'reviewindex'; // Your repository name
        const filePath = `content/reviews/${filename}.md`;

        console.log('📤 Preparing to publish to GitHub...');
        console.log('🔧 GitHub Config:', {
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: filePath
        });

        // GitHub API request to create/update file
        const githubResponse = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`, 
            {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Review-Index-App',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify({
                    message: `Add SEO-optimized review: ${title}`,
                    content: encodedContent,
                    branch: 'main'
                })
            }
        );

        console.log('📡 GitHub API Response Status:', githubResponse.status);

        const githubData = await githubResponse.json();

        if (!githubResponse.ok) {
            console.error('❌ GitHub API Error:', githubData);
            
            let errorMessage = githubData.message || `GitHub API error: ${githubResponse.status}`;
            
            // Provide more user-friendly error messages
            if (githubResponse.status === 401) {
                errorMessage = 'GitHub authentication failed. Please check your GITHUB_TOKEN.';
            } else if (githubResponse.status === 403) {
                errorMessage = 'GitHub API rate limit exceeded or permission denied.';
            } else if (githubResponse.status === 404) {
                errorMessage = 'GitHub repository not found. Please check that the repository "reviewindex" exists under your account.';
            }
            
            throw new Error(errorMessage);
        }

        console.log('✅ Successfully published to GitHub:', {
            sha: githubData.content.sha,
            html_url: githubData.content.html_url
        });

        // Success response with your correct website URL
        return new Response(JSON.stringify({ 
            success: true, 
            message: '🎉 SEO-optimized review published successfully!',
            data: {
                sha: githubData.content.sha,
                url: githubData.content.html_url,
                path: filePath,
                siteUrl: `https://reviewindex.pages.dev/review/${filename}`,
                downloadUrl: githubData.content.download_url,
                title: title,
                filename: filename
            }
        }), {
            status: 200,
            headers: { 
                ...corsHeaders, 
                'Content-Type': 'application/json' 
            },
        });

    } catch (error) {
        console.error('💥 Function Error:', error);
        
        return new Response(JSON.stringify({ 
            success: false, 
            message: error.message || 'An internal server error occurred while publishing the review.' 
        }), {
            status: 500,
            headers: { 
                ...corsHeaders, 
                'Content-Type': 'application/json' 
            },
        });
    }
          }
