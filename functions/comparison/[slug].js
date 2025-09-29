// functions/comparison/[...slug].js
export async function onRequest(context) {
    const { request, params, env } = context;
    const slug = params.slug;
    
    try {
        // Handle .md file requests - redirect to clean URL
        if (slug.endsWith('.md')) {
            const cleanSlug = slug.replace('.md', '');
            return Response.redirect(`${new URL(request.url).origin}/comparison/${cleanSlug}`, 301);
        }

        // Fetch comparison content
        const comparisonContent = await fetchComparisonContent(slug, env.GITHUB_TOKEN);
        
        if (!comparisonContent) {
            return renderErrorPage('Comparison Not Found', 'The requested product comparison could not be found.');
        }

        // Parse frontmatter and get categories
        const { frontmatter } = parseComparisonMarkdown(comparisonContent);
        
        // Get related comparisons (matching at least 1 category, excluding current and generic categories)
        const relatedComparisons = await fetchRelatedComparisons(
            slug, 
            frontmatter.categories, 
            env.GITHUB_TOKEN
        );

        // Convert to HTML and render page
        const htmlContent = await renderComparisonPage(
            comparisonContent, 
            slug, 
            request.url, 
            relatedComparisons
        );
        
        // Return with 6-month cache
        return new Response(htmlContent, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=15552000, immutable', // 6 months
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
            }
        });

    } catch (error) {
        console.error('Error rendering comparison:', error);
        return renderErrorPage('Server Error', 'An error occurred while loading the comparison.');
    }
}

async function fetchComparisonContent(slug, githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    const filePath = `content/comparisons/${slug}.md`;

    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'ReviewIndex-App',
                    'Accept': 'application/vnd.github.v3.raw'
                }
            }
        );

        return response.status === 200 ? await response.text() : null;
    } catch (error) {
        console.error('Error fetching comparison:', error);
        return null;
    }
}

async function fetchRelatedComparisons(currentSlug, currentCategories, githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/comparisons`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'ReviewIndex-App'
                }
            }
        );

        if (response.status !== 200) return [];

        const files = await response.json();
        const comparisons = [];
        
        // Normalize categories and exclude generic ones
        const categoryArray = Array.isArray(currentCategories) ? currentCategories : 
                            (currentCategories ? [currentCategories] : []);
        
        const excludedCategories = ['review', 'reviews', 'comparison', 'comparisons'];
        const filteredCategories = categoryArray.filter(cat => 
            !excludedCategories.includes(cat.toLowerCase())
        );

        for (const file of files) {
            if (file.name.endsWith('.md') && file.name !== `${currentSlug}.md`) {
                try {
                    const fileResponse = await fetch(file.download_url);
                    if (fileResponse.status === 200) {
                        const content = await fileResponse.text();
                        const { frontmatter } = parseComparisonMarkdown(content);
                        
                        const fileCategories = Array.isArray(frontmatter.categories) ? frontmatter.categories : 
                                             (frontmatter.categories ? [frontmatter.categories] : []);
                        
                        // Check for category matches (excluding generic categories)
                        const matchingCategories = fileCategories.filter(fileCat => 
                            filteredCategories.some(currentCat => 
                                fileCat.toLowerCase() === currentCat.toLowerCase()
                            )
                        );

                        if (matchingCategories.length > 0) {
                            comparisons.push({
                                slug: file.name.replace('.md', ''),
                                title: frontmatter.title,
                                description: frontmatter.description,
                                products: frontmatter.comparison_products || [],
                                categories: fileCategories,
                                matchCount: matchingCategories.length
                            });
                            
                            // Limit to 3 related comparisons
                            if (comparisons.length >= 3) break;
                        }
                    }
                } catch (error) {
                    console.error(`Error processing related comparison ${file.name}:`, error);
                }
            }
        }
        
        // Sort by number of matching categories (highest first)
        return comparisons.sort((a, b) => b.matchCount - a.matchCount);
        
    } catch (error) {
        console.error('Error fetching related comparisons:', error);
        return [];
    }
}

async function renderComparisonPage(markdownContent, slug, requestUrl, relatedComparisons) {
    const { frontmatter, content } = parseComparisonMarkdown(markdownContent);
    const htmlContent = convertComparisonMarkdownToHTML(content, frontmatter);
    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    const products = frontmatter.comparison_products || [];
    const winners = extractWinnersFromContent(content);
    
    const schemaMarkup = generateEnhancedComparisonSchema(frontmatter, slug, canonicalUrl, products, winners);
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(frontmatter.title || formatComparisonSlug(slug))} - ReviewIndex</title>
    <meta name="description" content="${escapeHtml(frontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis and buying guide`)}">
    <link rel="canonical" href="${canonicalUrl}">
    
    <!-- SEO Meta Tags -->
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
    <meta name="keywords" content="${products.join(', ')}, comparison, review, buy, price, features">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}">
    <meta property="og:description" content="${escapeHtml(frontmatter.description || `Compare ${products.join(' vs ')}`)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${escapeHtml(frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-image.jpg')}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="ReviewIndex">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}">
    <meta name="twitter:description" content="${escapeHtml(frontmatter.description || `Compare ${products.join(' vs ')}`)}">
    <meta name="twitter:image" content="${escapeHtml(frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-image.jpg')}">
    
    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    ${schemaMarkup}
    </script>
    
    <style>
        :root {
            --primary: #2563eb;
            --primary-dark: #1d4ed8;
            --primary-light: #dbeafe;
            --success: #059669;
            --success-light: #d1fae5;
            --warning: #d97706;
            --warning-light: #fef3c7;
            --gray-100: #f3f4f6;
            --gray-200: #e5e7eb;
            --gray-500: #6b7280;
            --gray-700: #374151;
            --gray-900: #111827;
        }
        
        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
        }
        
        body { 
            font-family: 'Inter', system-ui, -apple-system, sans-serif; 
            line-height: 1.6; 
            color: var(--gray-700);
            background: var(--gray-100);
            min-height: 100vh;
        }
        
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 0 20px;
        }
        
        .header { 
            background: white;
            padding: 3rem 2rem;
            text-align: center;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin: 2rem 0;
            border: 1px solid var(--gray-200);
        }
        
        .header h1 {
            font-size: clamp(1.8rem, 4vw, 2.5rem);
            margin-bottom: 1rem;
            color: var(--gray-900);
            line-height: 1.2;
        }
        
        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
            margin: 2rem 0;
        }
        
        .summary-card {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            text-align: center;
            border: 1px solid var(--gray-200);
        }
        
        .summary-card.winner {
            border-left: 4px solid var(--success);
            background: var(--success-light);
        }
        
        .products-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin: 2rem 0;
        }
        
        .product-card {
            background: white;
            border-radius: 8px;
            padding: 0;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid var(--gray-200);
        }
        
        .product-header {
            background: linear-gradient(135deg, var(--primary-light), white);
            padding: 1.5rem;
            text-align: center;
            border-bottom: 1px solid var(--gray-200);
        }
        
        .product-image {
            width: 150px;
            height: 150px;
            object-fit: contain;
            margin: 1rem auto;
        }
        
        .affiliate-btn {
            display: inline-block;
            background: var(--primary);
            color: white;
            padding: 0.75rem 1.5rem;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 1rem 0;
        }
        
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .comparison-table th {
            background: var(--primary);
            color: white;
            padding: 1rem;
            text-align: left;
        }
        
        .comparison-table td {
            padding: 1rem;
            border-bottom: 1px solid var(--gray-200);
        }
        
        .related-section {
            background: white;
            border-radius: 8px;
            padding: 2rem;
            margin: 2rem 0;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .related-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-top: 1.5rem;
        }
        
        .related-card {
            background: var(--gray-100);
            border-radius: 6px;
            padding: 1.5rem;
            text-decoration: none;
            color: inherit;
            display: block;
            border: 1px solid var(--gray-200);
        }
        
        .footer {
            text-align: center;
            padding: 2rem;
            color: var(--gray-500);
            margin-top: 3rem;
            border-top: 1px solid var(--gray-200);
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 0 15px;
            }
            
            .products-grid {
                grid-template-columns: 1fr;
            }
            
            .related-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}</h1>
            ${frontmatter.description ? `<p>${escapeHtml(frontmatter.description)}</p>` : ''}
        </header>
        
        <main>
            <div class="summary-cards">
                <div class="summary-card ${winners.overall === products[0] ? 'winner' : ''}">
                    <h3>🏆 Overall Winner</h3>
                    <p>${winners.overall || products[0] || 'Check Comparison'}</p>
                </div>
                
                <div class="summary-card ${winners.budget === products[1] ? 'winner' : ''}">
                    <h3>💰 Best Value</h3>
                    <p>${winners.budget || products[1] || products[0] || 'Check Comparison'}</p>
                </div>
            </div>
            
            <div class="content">
                ${htmlContent}
            </div>
            
            ${relatedComparisons.length > 0 ? `
            <section class="related-section">
                <h2>Related Comparisons</h2>
                <div class="related-grid">
                    ${relatedComparisons.map(comp => `
                        <a href="/comparison/${comp.slug}" class="related-card">
                            <h3>${escapeHtml(comp.title)}</h3>
                            <p>${escapeHtml(comp.description || 'Detailed comparison')}</p>
                            ${comp.products.length > 0 ? `
                            <div>
                                ${comp.products.join(' vs ')}
                            </div>
                            ` : ''}
                        </a>
                    `).join('')}
                </div>
            </section>
            ` : ''}
        </main>
        
        <footer class="footer">
            <p>© ${new Date().getFullYear()} ReviewIndex</p>
        </footer>
    </div>
</body>
</html>`;
}

function parseComparisonMarkdown(content) {
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

function convertComparisonMarkdownToHTML(markdown, frontmatter) {
    // Basic markdown to HTML conversion
    let html = markdown
        .replace(/### (.*?)\n/g, '<h3>$1</h3>')
        .replace(/## (.*?)\n/g, '<h2>$1</h2>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" class="product-image">')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="affiliate-btn" target="_blank">$1</a>')
        .replace(/\n/g, '<br>');
    
    return html;
}

function extractWinnersFromContent(content) {
    const winners = {};
    
    const overallMatch = content.match(/🏆 Overall Winner: ([^\n*]+)/);
    if (overallMatch) winners.overall = overallMatch[1].trim();
    
    const budgetMatch = content.match(/💰 Best Value: ([^\n*]+)/);
    if (budgetMatch) winners.budget = budgetMatch[1].trim();
    
    return winners;
}

function generateEnhancedComparisonSchema(frontmatter, slug, canonicalUrl, products, winners) {
    const schema = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": frontmatter.title || formatComparisonSlug(slug),
        "description": frontmatter.description,
        "image": frontmatter.featured_image,
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": canonicalUrl
        }
    };

    return JSON.stringify(schema);
}

function formatComparisonSlug(slug) {
    return slug.split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
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
<html>
<head>
    <title>${title} - ReviewIndex</title>
    <meta name="robots" content="noindex">
    <style>
        body { font-family: system-ui, sans-serif; text-align: center; padding: 2rem; }
        .error-container { max-width: 500px; margin: 0 auto; }
        h1 { color: #dc2626; margin-bottom: 1rem; }
        a { color: #2563eb; text-decoration: none; }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>${title}</h1>
        <p>${message}</p>
        <a href="/comparisons">← Return to Comparisons</a>
    </div>
</body>
</html>`;
    
    return new Response(html, { 
        status: 404,
        headers: { 'Content-Type': 'text/html' }
    });
            }
