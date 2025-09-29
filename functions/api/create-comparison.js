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
            performanceWinner,
            overallWinnerDescription,
            budgetWinnerDescription,
            performanceWinnerDescription
        } = formData;

        if (!title?.trim() || !filename?.trim() || !products?.length) {
            return errorResponse('Title, Filename, and at least one product are required', 400, corsHeaders);
        }

        if (!filename.match(/^[a-z0-9-]+$/i)) {
            return errorResponse('Filename can only contain letters, numbers, and hyphens', 400, corsHeaders);
        }

        // Validate at least 2 products for comparison
        if (products.length < 2) {
            return errorResponse('At least 2 products are required for comparison', 400, corsHeaders);
        }

        const markdownContent = generateEnhancedComparisonMarkdown({
            title: title.trim(),
            description: description?.trim(),
            filename: filename.trim(),
            categories: categories?.trim(),
            products,
            comparisonYoutubeId,
            overallWinner,
            budgetWinner,
            performanceWinner,
            overallWinnerDescription,
            budgetWinnerDescription,
            performanceWinnerDescription
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
    return new Response(JSON.stringify({ success: false, message }), { 
        status, 
        headers: { ...headers, 'Content-Type': 'application/json' } 
    });
}

function successResponse(data, headers) {
    return new Response(JSON.stringify({ 
        success: true, 
        message: '🎉 Comparison page published successfully!', 
        data 
    }), { 
        status: 200, 
        headers: { ...headers, 'Content-Type': 'application/json' } 
    });
}

// Generate Enhanced Markdown Compatible with Updated Slug Structure
function generateEnhancedComparisonMarkdown(data) {
    const currentDate = new Date().toISOString();
    const formattedDate = currentDate.split('T')[0];
    const slug = generateSlug(data.title);

    const categoryList = data.categories ? data.categories.split(',').map(c => `"${c.trim()}"`) : ["comparisons"];

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

${generateWinnerSummary(data)}

## 📋 Detailed Comparison Table

${generateEnhancedComparisonTable(data.products)}

## 🔍 Detailed Product Analysis

${data.products.map(p => generateProductSection(p)).join('\n')}

${data.comparisonYoutubeId ? generateComparisonVideo(data.comparisonYoutubeId) : ''}

${generateEnhancedFinalVerdict(data)}

## 💡 How to Choose

Consider these factors when making your decision:

### Budget & Value
${generateBudgetRecommendations(data.products)}

### Key Decision Factors
${generateDecisionFactors(data.products)}

### Use Case Recommendations
${generateUseCaseRecommendations(data.products)}

---

*Last updated: ${formattedDate}*  
*Prices and availability may change. Check affiliate links for current offers.*
`;
}

// Generate winner summary for quick cards
function generateWinnerSummary(data) {
    const winners = [];
    
    if (data.overallWinner) {
        winners.push(`🏆 **Overall Winner: ${data.overallWinner}**  \n*${data.overallWinnerDescription || 'Best all-around choice for most users'}*`);
    }
    
    if (data.budgetWinner) {
        winners.push(`💰 **Best Value: ${data.budgetWinner}**  \n*${data.budgetWinnerDescription || 'Great performance at competitive price'}*`);
    }
    
    if (data.performanceWinner) {
        winners.push(`⚡ **Performance King: ${data.performanceWinner}**  \n*${data.performanceWinnerDescription || 'Top-tier performance for power users'}*`);
    }

    return winners.length > 0 ? `
### 🏆 Quick Verdict

${winners.join('\n\n')}
` : '';
}

// Generate enhanced comparison table
function generateEnhancedComparisonTable(products) {
    const tableHeaders = ['Feature', ...products.map(p => p.name)];
    const separator = tableHeaders.map(() => '---').join('|');
    
    const rows = [
        // Price row
        `| **Price** | ${products.map(p => p.price || 'Check price').join(' | ')} |`,
        
        // Overall Rating row
        `| **Overall Rating** | ${products.map(p => p.rating ? '⭐'.repeat(Math.round(p.rating)) + ` ${p.rating}/5` : 'N/A').join(' | ')} |`,
        
        // Release Date row
        `| **Release Date** | ${products.map(p => p.releaseDate || 'N/A').join(' | ')} |`,
        
        // Best For row
        `| **Best For** | ${products.map(p => p.bestFor || 'General use').join(' | ')} |`
    ];

    // Add key specifications (3-5 most important ones)
    const keySpecs = findCommonSpecs(products);
    keySpecs.forEach(spec => {
        const values = products.map(p => {
            const specValue = getSpecValue(p.specs, spec);
            return specValue || '–';
        });
        rows.push(`| **${spec}** | ${values.join(' | ')} |`);
    });

    // Quick Action row (removed from display but kept in data for processing)
    const actions = products.map(p => 
        p.affiliateLink ? `[Check Price](${p.affiliateLink})` : '–'
    );
    rows.push(`| **Quick Action** | ${actions.join(' | ')} |`);

    return `| ${tableHeaders.join(' | ')} |
|${separator}|
${rows.join('\n')}`;
}

// Generate individual product section with new structure
function generateProductSection(product) {
    return `### ${product.name}

${product.image ? `![${product.name}](${product.image})` : ''}

**Price:** ${product.price || 'Check current price'}  
**Release Date:** ${product.releaseDate || 'N/A'}  
**Best For:** ${product.bestFor || 'General use'}  
**Overall Rating:** ${product.rating ? '⭐'.repeat(Math.round(product.rating)) + ` (${product.rating}/5)` : 'Not rated'}

${product.affiliateLink ? `[**Check Current Price & Offers**](${product.affiliateLink}){: .btn .btn-primary}` : ''}

#### Specifications

${generateSpecificationsTable(product.specs)}

#### Key Features & Specifications

${Object.entries(product.specs || {}).slice(0, 8).map(([key, value]) => `- **${key}:** ${value}`).join('\n')}

#### Pros

${(product.pros || []).map(item => `✅ ${item}`).join('\n') || '- No major pros listed'}

#### Cons

${(product.cons || []).map(item => `❌ ${item}`).join('\n') || '- No major cons listed'}

${product.youtubeId ? `
#### Video Review

<iframe width="100%" height="400" src="https://www.youtube.com/embed/${product.youtubeId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
` : ''}

---`;
}

// Generate specifications table for individual products
function generateSpecificationsTable(specs) {
    if (!specs || Object.keys(specs).length === 0) {
        return '*No specifications available*';
    }

    const specEntries = Object.entries(specs);
    const rows = specEntries.map(([key, value]) => `| **${key}** | ${value} |`).join('\n');

    return `| Specification | Value |
|---------------|-------|
${rows}`;
}

// Generate comparison video section
function generateComparisonVideo(youtubeId) {
    return `
## 📺 Side-by-Side Comparison Video

<iframe width="100%" height="500" src="https://www.youtube.com/embed/${youtubeId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

*Watch our detailed side-by-side comparison of all products*
`;
}

// Generate enhanced final verdict
function generateEnhancedFinalVerdict(data) {
    const winners = [];
    
    if (data.overallWinner) {
        const winner = data.products.find(p => p.name === data.overallWinner);
        winners.push(`🏆 **Overall Winner: ${data.overallWinner}**  \n*${data.overallWinnerDescription || winner?.bestFor || 'Best all-around choice for most users'}*`);
    }
    
    if (data.budgetWinner) {
        const winner = data.products.find(p => p.name === data.budgetWinner);
        winners.push(`💰 **Best Value: ${data.budgetWinner}**  \n*${data.budgetWinnerDescription || winner?.bestFor || 'Great performance at an affordable price'}*`);
    }
    
    if (data.performanceWinner) {
        const winner = data.products.find(p => p.name === data.performanceWinner);
        winners.push(`⚡ **Performance King: ${data.performanceWinner}**  \n*${data.performanceWinnerDescription || winner?.bestFor || 'Top-tier performance for power users'}*`);
    }

    return `## 🏆 Final Verdict & Recommendations

${winners.join('\n\n')}

### Choose Based On Your Needs:

${data.products.map(p => `**${p.name}**  \nChoose this if: ${p.bestFor || 'You want a solid all-around performer'}. ${p.pros ? p.pros.slice(0, 2).join(', ') : 'Good overall performance'}.`).join('\n\n')}

### Key Trade-offs to Consider:

${generateEnhancedTradeoffs(data.products)}
`;
}

// Generate enhanced tradeoffs - GENERIC VERSION
function generateEnhancedTradeoffs(products) {
    const tradeoffs = [];
    
    // Price analysis
    const pricedProducts = products.filter(p => extractPrice(p.price) !== null);
    if (pricedProducts.length >= 2) {
        pricedProducts.sort((a, b) => extractPrice(a.price) - extractPrice(b.price));
        const cheapest = pricedProducts[0];
        const mostExpensive = pricedProducts[pricedProducts.length - 1];
        
        const priceDiff = extractPrice(mostExpensive.price) - extractPrice(cheapest.price);
        const premiumLevel = priceDiff > (extractPrice(cheapest.price) * 0.5) ? 'a significant' : 'a moderate';
        tradeoffs.push(`- **Price vs Value:** ${cheapest.name} ($${extractPrice(cheapest.price)}) offers the best value, while ${mostExpensive.name} ($${extractPrice(mostExpensive.price)}) provides premium features at ${premiumLevel} premium`);
    }
    
    // Performance comparison based on ratings
    const ratedProducts = products.filter(p => p.rating);
    if (ratedProducts.length >= 2) {
        ratedProducts.sort((a, b) => b.rating - a.rating);
        tradeoffs.push(`- **Overall Performance:** ${ratedProducts[0].name} offers the best overall performance based on user ratings`);
    }
    
    // Feature-specific comparisons based on common specs
    const commonSpecs = findCommonSpecs(products);
    commonSpecs.slice(0, 3).forEach(spec => {
        const featureData = products.map(p => ({
            name: p.name,
            value: getSpecValue(p.specs, spec),
            score: rateSpecValue(getSpecValue(p.specs, spec))
        })).filter(p => p.value);
        
        if (featureData.length >= 2) {
            featureData.sort((a, b) => b.score - a.score);
            if (featureData[0].score > featureData[1].score) {
                tradeoffs.push(`- **${spec}:** ${featureData[0].name} leads with ${featureData[0].value}`);
            }
        }
    });
    
    return tradeoffs.join('\n');
}

// Generate budget recommendations
function generateBudgetRecommendations(products) {
    const pricedProducts = products.filter(p => extractPrice(p.price) !== null);
    
    if (pricedProducts.length === 0) {
        return '- Consider your budget range and required features';
    }
    
    pricedProducts.sort((a, b) => extractPrice(a.price) - extractPrice(b.price));
    const minPrice = Math.min(...pricedProducts.map(p => extractPrice(p.price)));
    const maxPrice = Math.max(...pricedProducts.map(p => extractPrice(p.price)));
    
    const recommendations = [
        `- **Under $${minPrice + Math.floor((maxPrice - minPrice) * 0.33)}:** ${pricedProducts[0].name} - Best budget option`,
        `- **$${minPrice + Math.floor((maxPrice - minPrice) * 0.33)}-$${minPrice + Math.floor((maxPrice - minPrice) * 0.66)}:** Balanced mid-range options`,
        `- **Over $${minPrice + Math.floor((maxPrice - minPrice) * 0.66)}:** ${pricedProducts[pricedProducts.length - 1].name} - Premium features`
    ];
    
    return recommendations.join('\n');
}

// Generate use case recommendations - GENERIC VERSION
function generateUseCaseRecommendations(products) {
    const useCases = {
        'Everyday Use': 'Reliable performance for daily needs',
        'Premium Experience': 'Top-quality features and performance', 
        'Budget-Conscious': 'Best value for money',
        'Specific Needs': 'Specialized features for particular requirements',
        'Long-term Investment': 'Durability and lasting quality'
    };
    
    const recommendations = Object.entries(useCases).map(([useCase, description]) => {
        // Simple scoring based on product characteristics
        const scores = products.map(p => {
            let score = p.rating || 3;
            const price = extractPrice(p.price);
            
            // Adjust scoring based on use case
            if (useCase === 'Budget-Conscious' && price && price < 50) score += 2;
            if (useCase === 'Premium Experience' && p.rating > 4) score += 2;
            if (useCase === 'Long-term Investment' && price && price > 100) score += 1;
            
            return { name: p.name, score };
        });
        
        scores.sort((a, b) => b.score - a.score);
        return `- **${useCase}:** ${scores[0].name} - ${description}`;
    });
    
    return recommendations.join('\n');
}

// Generate decision factors - GENERIC VERSION
function generateDecisionFactors(products) {
    const factors = [
        "**Budget:** How much are you willing to spend?",
        "**Primary Use:** What will you use it for most often?",
        "**Key Features:** Which features are most important to you?",
        "**Quality vs Price:** Are you looking for premium quality or best value?",
        "**Brand Preference:** Do you have any brand loyalty or requirements?",
        "**User Experience:** How important is ease of use and convenience?",
        "**Long-term Value:** Are you looking for durability and long-term use?",
        "**Specific Needs:** Do you have any special requirements or preferences?"
    ];
    
    return factors.map(f => `- ${f}`).join('\n');
}

// Helper functions
function findCommonSpecs(products) {
    const allSpecs = {};
    products.forEach(product => {
        Object.keys(product.specs || {}).forEach(spec => {
            allSpecs[spec] = (allSpecs[spec] || 0) + 1;
        });
    });
    
    // Return most common specs (appearing in at least 2 products)
    return Object.entries(allSpecs)
        .filter(([_, count]) => count >= 2)
        .sort(([a], [b]) => getSpecPriority(a) - getSpecPriority(b))
        .slice(0, 5)
        .map(([spec]) => spec);
}

function getSpecPriority(spec) {
    const priorityOrder = {
        'ingredient': 1,
        'material': 2,
        'size': 3,
        'weight': 4,
        'capacity': 5,
        'feature': 6,
        'specification': 7
    };
    
    const lowerSpec = spec.toLowerCase();
    for (const [key, priority] of Object.entries(priorityOrder)) {
        if (lowerSpec.includes(key)) {
            return priority;
        }
    }
    return 99;
}

function getSpecValue(specs, specName) {
    if (!specs) return null;
    const entry = Object.entries(specs).find(([key]) => 
        key.toLowerCase().includes(specName.toLowerCase())
    );
    return entry ? entry[1] : null;
}

function extractPrice(priceStr) {
    if (!priceStr) return null;
    const match = priceStr.match(/\$?(\d+[,.]?\d*)/);
    return match ? parseFloat(match[1].replace(',', '')) : null;
}

function rateSpecValue(value) {
    if (!value) return 0;
    
    // Numeric values
    const numMatch = value.match(/(\d+[,.]?\d*)/);
    if (numMatch) {
        const num = parseFloat(numMatch[1].replace(',', ''));
        if (num > 1000) return 9; // High numbers
        if (num > 100) return 7;  // Medium numbers
        return 5;                 // Low numbers
    }
    
    // Qualitative ratings
    if (value.toLowerCase().includes('excellent') || value.includes('⭐️⭐️⭐️⭐️⭐️')) return 10;
    if (value.toLowerCase().includes('good') || value.includes('⭐️⭐️⭐️⭐️')) return 8;
    if (value.toLowerCase().includes('average') || value.includes('⭐️⭐️⭐️')) return 6;
    
    return 5;
}

function generateSlug(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 60);
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
        siteUrl: `https://reviewindex.pages.dev/comparison/${filename.replace('.md','')}`
    };
                               }
