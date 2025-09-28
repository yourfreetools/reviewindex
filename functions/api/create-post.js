// functions/api/create-post.js

// JSON path in repo
const POSTS_INDEX_PATH = 'content/posts-index.json';

// --------------------
export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { GITHUB_TOKEN } = context.env;
    if (!GITHUB_TOKEN) {
      return errorResponse('GITHUB_TOKEN not configured', 500, corsHeaders);
    }

    const formData = await context.request.json();
    const { title, description, content, image, filename, rating, affiliateLink, youtubeLink, categories, keyFeatures, finalVerdict, pros, cons, relatedContent } = formData;

    if (!title?.trim() || !filename?.trim()) {
      return errorResponse('Title and Filename are required', 400, corsHeaders);
    }

    if (!filename.match(/^[a-z0-9-]+$/i)) {
      return errorResponse('Filename can only contain letters, numbers, and hyphens', 400, corsHeaders);
    }

    const slug = generateSlug(title);

    const markdownContent = generateMarkdown({
      title, description, content, image, filename, rating, affiliateLink, youtubeLink,
      categories, keyFeatures, finalVerdict, pros, cons, relatedContent, slug
    });

    // Publish post Markdown
    const publishResult = await publishToGitHub({ token: GITHUB_TOKEN, content: markdownContent, title, filename });

    // Update posts-index.json
    await updatePostsIndex({ token: GITHUB_TOKEN, title: title.trim(), slug, date: new Date().toISOString() });

    return successResponse(publishResult, corsHeaders);

  } catch (error) {
    console.error('💥 Function Error:', error);
    return errorResponse(error.message, 500, corsHeaders);
  }
}

// --------------------
// Responses
function errorResponse(message, status = 500, headers) {
  return new Response(JSON.stringify({ success: false, message }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

function successResponse(data, headers) {
  return new Response(JSON.stringify({ success: true, message: '🎉 Review published successfully!', data }), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

// --------------------
// Markdown generator
function generateMarkdown(data) {
  const currentDate = new Date().toISOString();
  const formattedDate = currentDate.split('T')[0];
  const categoryList = data.categories ? data.categories.split(',').map(c => `"${c.trim()}"`) : ["reviews"];
  const keyFeaturesList = data.keyFeatures?.split('\n').filter(f => f.trim()).map(f => `- ${f.trim()}`).join('\n');
  const prosList = data.pros?.split('\n').filter(p => p.trim()).map(p => `- ${p.trim()}`).join('\n');
  const consList = data.cons?.split('\n').filter(c => c.trim()).map(c => `- ${c.trim()}`).join('\n');
  const relatedContentList = data.relatedContent?.split('\n').filter(u => u.trim()).map(url => {
    const title = url.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/').pop().replace(/-/g,' ').replace(/\.[^/.]+$/,'').replace(/\b\w/g, l => l.toUpperCase());
    return `- [${title}](${url.trim()})`;
  }).join('\n');

  return `---
title: "${data.title.replace(/"/g, '\\"')}"
description: "${(data.description || `Comprehensive review of ${data.title}`).replace(/"/g, '\\"').substring(0, 160)}"
image: "${data.image || ''}"
rating: ${data.rating || 5}
affiliateLink: "${data.affiliateLink || ''}"
youtubeId: "${data.youtubeLink || ''}"
categories: [${categoryList.join(', ')}]
date: "${currentDate}"
slug: "${data.slug}"
draft: false
---

# ${data.title}

${data.image ? `![${data.title}](${data.image})` : ''}

${data.description || ''}

${data.content || 'Start your comprehensive review here...'}

${keyFeaturesList ? `\n## Key Features\n\n${keyFeaturesList}` : ''}
${prosList ? `\n## Pros 👍\n\n${prosList}` : ''}
${consList ? `\n## Cons 👎\n\n${consList}` : ''}
## Final Rating: ${data.rating || 5}/5 ⭐
${data.finalVerdict || '*Your final verdict and recommendation*'}

${relatedContentList ? `\n## 📚 Related Content\n\nCheck out these related articles:\n\n${relatedContentList}` : ''}

---

*Published on ${formattedDate}*
`;
}

// --------------------
// Slug generator
function generateSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 60);
}

// --------------------
// Publish Markdown to GitHub
async function publishToGitHub({ token, content, title, filename }) {
  const REPO_OWNER = 'yourfreetools';
  const REPO_NAME = 'reviewindex';
  const finalFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
  const filePath = `content/reviews/${finalFilename}`;
  const encodedContent = Buffer.from(content).toString('base64');

  const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ReviewIndex-App'
    },
    body: JSON.stringify({ message: `Add review: ${title}`, content: encodedContent, branch: 'main' })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `GitHub API error: ${response.status}`);

  return { sha: data.content.sha, url: data.content.html_url, path: filePath, siteUrl: `https://reviewindex.pages.dev/review/${filename.replace('.md','')}` };
}

// --------------------
// Update posts-index.json
async function updatePostsIndex({ token, title, slug, date }) {
  const REPO_OWNER = 'yourfreetools';
  const REPO_NAME = 'reviewindex';
  const BRANCH = 'main';

  let existing = [];
  let sha = null;

  const getResponse = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${POSTS_INDEX_PATH}?ref=${BRANCH}`, {
    headers: { 'Authorization': `token ${token}`, 'User-Agent': 'ReviewIndex-App', 'Accept': 'application/vnd.github.v3+json' }
  });

  if (getResponse.ok) {
    const data = await getResponse.json();
    sha = data.sha;
    existing = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  }

  existing.push({ title, slug, date });
  existing.sort((a, b) => new Date(b.date) - new Date(a.date));

  const updatedContent = Buffer.from(JSON.stringify(existing, null, 2)).toString('base64');
  const body = { message: `Update posts-index.json with: ${title}`, content: updatedContent, branch: BRANCH };
  if (sha) body.sha = sha;

  const putResponse = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${POSTS_INDEX_PATH}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'ReviewIndex-App' },
    body: JSON.stringify(body)
  });

  if (!putResponse.ok) {
    const errorData = await putResponse.json();
    console.error('Failed to update posts-index.json:', errorData.message || errorData);
  } else {
    console.log('✅ posts-index.json updated successfully');
  }
}
