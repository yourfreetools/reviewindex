export async function onRequestGet(context) {
  const baseUrl = context.env.SITE_URL || "https://reviewindex.pages.dev";
  const currentDate = new Date().toISOString().split("T")[0];

  const robots = `# Robots.txt for ReviewIndex
# Generated: ${currentDate}

User-agent: *
Allow: /
Disallow: /adminpage.html

# Sitemaps
Sitemap: ${baseUrl}/sitemap.xml
Sitemap: ${baseUrl}/sitemap.xml?type=posts
Sitemap: ${baseUrl}/sitemap.xml?type=categories

# Crawl delay (optional)
# Crawl-delay: 10

# Allow search engines to index images
User-agent: Googlebot-Image
Allow: /

# Social media bots
User-agent: Twitterbot
Allow: /

User-agent: LinkedInBot
Allow: /

User-agent: FacebookExternalHit
Allow: /`;

  return new Response(robots, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400", // 24 hours
      "X-Sitemap-LastGenerated": currentDate,
    },
  });
}
