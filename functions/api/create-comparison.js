// functions/api/create-comparison.js
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
        const {
            title,
            description,
            filename,
            categories,
            products,  // Array of objects [{ name, image, releaseDate, specs, pros, cons, bestFor, rating, affiliateLink, youtubeId, price }]
            comparisonYoutubeId,  // optional YouTube video comparing all products
            overallWinner,
            budgetWinner,
            performanceWinner
        } = formData;

        if (!title?.trim() || !filename?.trim() || !products?.length) {
            return errorResponse('Title, Filename, and at least one product are required', 400, corsHeaders);
        }

        if (!filename.match(/^[a-z0-9-]+$/i)) {
            return errorResponse('Filename can only contain letters, numbers, and hyphens', 400, corsHeaders);
        }

        const markdownContent = generateComparisonMarkdown({
            title: title.trim(),
            description: description?.trim(),
            filename: filename.trim(),
            categories: categories?.trim(),
            products,
            comparisonYoutubeId,
            overallWinner,
            budgetWinner,
            performanceWinner
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
    return new Response(JSON.stringify({ success: true, message: '🎉 Comparison page published successfully!', data }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// Generate Enhanced Markdown
function generateComparisonMarkdown(data) {
    const currentDate = new Date().toISOString();
    const formattedDate = currentDate.split('T')[0];
    const slug = generateSlug(data.title);

    const categoryList = data.categories ? data.categories.split(',').map(c => `"${c.trim()}"`) : ["comparisons"];

    // Generate comparison table with key specs
    const tableHeaders = ['Feature', ...data.products.map(p => p.name)];
    const tableRows = generateComparisonTableRows(data.products);

    // Detailed sections per product
    const productSections = data.products.map(p => `
### ${p.name}

${p.image ? `![${p.name}](${p.image})` : ''}

**Price:** ${p.price || 'Check current price'}  
**Release Date:** ${p.releaseDate || 'N/A'}  
**Best For:** ${p.bestFor || 'General use'}  
**Overall Rating:** ${p.rating ? '⭐'.repeat(Math.round(p.rating)) + ` (${p.rating}/5)` : 'Not rated'}

${p.affiliateLink ? `[**Check Current Price & Offers**](${p.affiliateLink}){: .btn .btn-primary}` : ''}

#### Key Features & Specifications
${Object.entries(p.specs || {}).map(([key, value]) => `- **${key}:** ${value}`).join('\n')}

#### Pros
${(p.pros || []).map(item => `✅ ${item}`).join('\n') || '- No major pros listed'}

#### Cons
${(p.cons || []).map(item => `❌ ${item}`).join('\n') || '- No major cons listed'}

${p.youtubeId ? `
#### Video Review
<iframe width="100%" height="400" src="https://www.youtube.com/embed/${p.youtubeId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
` : ''}

---`).join('\n');

    // Comparison video embed
    const comparisonVideoEmbed = data.comparisonYoutubeId ? `
## 📺 Side-by-Side Comparison Video

<iframe width="100%" height="500" src="https://www.youtube.com/embed/${data.comparisonYoutubeId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

*Watch our detailed side-by-side comparison of all products*
` : '';

    // Enhanced final verdict with winners
    const finalVerdict = generateFinalVerdict(data);

    return `---
title: "${data.title.replace(/"/g, '\\"')}"
description: "${(data.description || `Detailed comparison of ${data.products.map(p => p.name).join(' vs ')} - Find which product is best for your needs`).replace(/"/g, '\\"').substring(0, 160)}"
categories: [${categoryList.join(', ')}]
date: "${currentDate}"
slug: "${slug}"
draft: false
featured_image: "${data.products[0]?.image || ''}"
comparison_products: [${data.products.map(p => `"${p.name}"`).join(', ')}]
---

# ${data.title}

${data.description || `Comprehensive comparison between ${data.products.map(p => p.name).join(', ')}. We break down specs, features, performance, and value to help you choose the right product.`}

## ⚡ Quick Comparison Table

| ${tableHeaders.join(' | ')} |
|${tableHeaders.map(() => '---').join('|')}|
${tableRows}

## 🔍 Detailed Product Analysis

${productSections}

${comparisonVideoEmbed}

${finalVerdict}

## 💡 How to Choose

Consider these factors when making your decision:

### Budget & Value
- **Under $${Math.min(...data.products.map(p => extractPrice(p.price) || 9999))}:** ${data.budgetWinner ? data.products.find(p => p.name === data.budgetWinner)?.name : 'Consider budget options'}
- **Mid-range ($${Math.min(...data.products.map(p => extractPrice(p.price) || 9999))}-${Math.max(...data.products.map(p => extractPrice(p.price) || 0))}):** Balanced features and price
- **Premium ($${Math.max(...data.products.map(p => extractPrice(p.price) || 0))}+):** Top performance and features

### Key Decision Factors
${generateDecisionFactors(data.products)}

---

*Last updated: ${formattedDate}*  
*Prices and availability may change. Check affiliate links for current offers.*
`;
}

function generateComparisonTableRows(products) {
    const commonRows = [];
    
    // Price row
    const prices = products.map(p => p.price || 'Check price');
    commonRows.push(`| **Price** | ${prices.join(' | ')} |`);
    
    // Overall Rating row
    const ratings = products.map(p => p.rating ? '⭐'.repeat(Math.round(p.rating)) + ` ${p.rating}/5` : 'N/A');
    commonRows.push(`| **Overall Rating** | ${ratings.join(' | ')} |`);
    
    // Key specs - pick 3-5 most important ones
    const keySpecs = ['Battery Life', 'Weight', 'Screen Size', 'Storage', 'Processor'];
    
    keySpecs.forEach(spec => {
        const values = products.map(p => {
            const specValue = Object.entries(p.specs || {}).find(([key]) => 
                key.toLowerCase().includes(spec.toLowerCase().replace(' ', ''))
            );
            return specValue ? specValue[1] : '–';
        });
        if (values.some(v => v !== '–')) {
            commonRows.push(`| **${spec}** | ${values.join(' | ')} |`);
        }
    });
    
    // Best For row
    const bestFor = products.map(p => p.bestFor || 'General use');
    commonRows.push(`| **Best For** | ${bestFor.join(' | ')} |`);
    
    // Quick Action row
    const actions = products.map(p => 
        p.affiliateLink ? `[Check Price](${p.affiliateLink}){: .btn .btn-sm}` : '–'
    );
    commonRows.push(`| **Quick Action** | ${actions.join(' | ')} |`);
    
    return commonRows.join('\n');
}

function generateFinalVerdict(data) {
    const winners = [];
    
    if (data.overallWinner) {
        const winner = data.products.find(p => p.name === data.overallWinner);
        if (winner) {
            winners.push(`🏆 **Overall Winner: ${winner.name}**  \n*${winner.bestFor || 'Best all-around choice for most users'}*`);
        }
    }
    
    if (data.budgetWinner) {
        const winner = data.products.find(p => p.name === data.budgetWinner);
        if (winner) {
            winners.push(`💰 **Best Value: ${winner.name}**  \n*${winner.bestFor || 'Great performance at an affordable price'}*`);
        }
    }
    
    if (data.performanceWinner) {
        const winner = data.products.find(p => p.name === data.performanceWinner);
        if (winner) {
            winners.push(`⚡ **Performance King: ${winner.name}**  \n*${winner.bestFor || 'Top-tier performance for power users'}*`);
        }
    }

    return `## 🏆 Final Verdict & Recommendations

${winners.join('\n\n')}

### Choose Based On Your Needs:

${data.products.map(p => `**${p.name}**  \nChoose this if: ${p.bestFor || 'You want a solid all-around performer'}. ${p.pros ? p.pros.slice(0, 2).map(pro => pro).join(', ') : ''}`).join('\n\n')}

### Key Trade-offs to Consider:

${generateTradeoffs(data.products)}
`;
}

function generateTradeoffs(products) {
    const tradeoffs = [];
    
    // Price vs Performance
    const pricePerformance = products.map(p => ({
        name: p.name,
        price: extractPrice(p.price) || 0,
        rating: p.rating || 0
    })).sort((a, b) => a.price - b.price);
    
    if (pricePerformance.length >= 2) {
        const cheapest = pricePerformance[0];
        const mostExpensive = pricePerformance[pricePerformance.length - 1];
        tradeoffs.push(`- **Price vs Performance:** ${cheapest.name} offers the best value, while ${mostExpensive.name} provides premium features at a higher cost`);
    }
    
    // Feature comparisons
    const features = ['Battery', 'Screen', 'Performance', 'Portability'];
    features.forEach(feature => {
        const featureData = products.map(p => {
            const spec = Object.entries(p.specs || {}).find(([key]) => 
                key.toLowerCase().includes(feature.toLowerCase())
            );
            return { name: p.name, value: spec ? spec[1] : null };
        }).filter(p => p.value);
        
        if (featureData.length >= 2) {
            featureData.sort((a, b) => compareSpecValues(a.value, b.value));
            tradeoffs.push(`- **${feature}:** ${featureData[featureData.length - 1].name} leads with ${featureData[featureData.length - 1].value}`);
        }
    });
    
    return tradeoffs.join('\n');
}

function generateDecisionFactors(products) {
    const factors = [
        "**Budget:** How much are you willing to spend?",
        "**Primary Use:** What will you use it for most often?",
        "**Portability:** How important is weight and size?",
        "**Battery Life:** Do you need all-day usage?",
        "**Performance:** Are you a power user or casual user?",
        "**Ecosystem:** Do you have other devices from the same brand?"
    ];
    
    return factors.map(f => `- ${f}`).join('\n');
}

function extractPrice(priceStr) {
    if (!priceStr) return null;
    const match = priceStr.match(/\$?(\d+[,.]?\d*)/);
    return match ? parseFloat(match[1].replace(',', '')) : null;
}

function compareSpecValues(a, b) {
    // Simple comparison for common spec formats
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
}

function generateSlug(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(, 60);
}

async function publishToGitHub({ token, content, title, filename }) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    const finalFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
    const filePath = `content/comparisons/${finalFilename}`;
    const encodedContent = btoa(unescape(encodeURIComponent(content)));

    const response = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`, 
        {
            method: 'PUT',
            headers: { 
                'Authorization': `token ${token}`, 
                'Content-Type': 'application/json', 
                'User-Agent': 'Comparison-App',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({ 
                message: `Add comparison: ${title}`, 
                content: encodedContent, 
                branch: 'main' 
            })
        }
    );

    const data = await response.json();
    if (!response.ok) {
        console.error('GitHub API Error:', data);
        throw new Error(data.message || `GitHub API error: ${response.status}`);
    }

    return { 
        sha: data.content.sha, 
        url: data.content.html_url, 
        path: filePath, 
        siteUrl: `https://reviewindex.pages.dev/comparisons/${filename.replace('.md','')}/`
    };
}
