async function renderPostPage(markdownContent, slug, requestUrl) {
    // Parse frontmatter and content
    const { frontmatter, content } = parseMarkdown(markdownContent);

    // Convert markdown to HTML
    const htmlContent = convertMarkdownToHTML(content);

    // Turn pros/cons into lists
    const prosList = frontmatter.pros
        ? frontmatter.pros.split(';').map(item => `<li>${item.trim()}</li>`).join('')
        : '';
    const consList = frontmatter.cons
        ? frontmatter.cons.split(';').map(item => `<li>${item.trim()}</li>`).join('')
        : '';

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
        .description {
            font-size: 1.1rem;
            margin: 1rem 0;
            color: #555;
        }
        .frontmatter-image {
            display: block;
            max-width: 600px;
            height: auto;
            margin: 2rem auto;
            border-radius: 10px;
        }
        .meta-info {
            background: #f8fafc;
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0 2rem 0;
            font-size: 0.95rem;
            color: #444;
        }
        .pros-cons {
            display: flex;
            gap: 2rem;
            margin: 2rem 0;
        }
        .pros, .cons {
            flex: 1;
            padding: 1rem;
            border-radius: 8px;
        }
        .pros {
            background: #ecfdf5;
            border: 1px solid #10b981;
        }
        .cons {
            background: #fef2f2;
            border: 1px solid #ef4444;
        }
        .pros h3, .cons h3 {
            margin-bottom: 0.5rem;
        }
        .pros ul, .cons ul {
            padding-left: 1.2rem;
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
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${frontmatter.title || formatSlug(slug)}</h1>
            ${frontmatter.rating ? `<div class="rating">${'⭐'.repeat(parseInt(frontmatter.rating))} ${frontmatter.rating}/5</div>` : ''}
            ${frontmatter.description ? `<p class="description">${frontmatter.description}</p>` : ''}
        </div>
        
        ${frontmatter.image ? `<img src="${frontmatter.image}" alt="${frontmatter.title || 'Product image'}" class="frontmatter-image">` : ''}
        
        <div class="meta-info">
            <strong>Published:</strong> ${frontmatter.date || 'Recently'} | 
            <strong>Categories:</strong> ${frontmatter.categories || 'Review'}
        </div>

        ${(prosList || consList) ? `
        <div class="pros-cons">
            ${prosList ? `<div class="pros"><h3>Pros</h3><ul>${prosList}</ul></div>` : ''}
            ${consList ? `<div class="cons"><h3>Cons</h3><ul>${consList}</ul></div>` : ''}
        </div>
        ` : ''}

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
