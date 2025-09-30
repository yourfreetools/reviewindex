export async function onRequestGet(context) {
  const baseUrl = context.env.SITE_URL || "https://reviewindex.pages.dev";
  const currentDate = new Date().toISOString().split("T")[0];

  const robots = `# Robots.txt for ReviewIndex
# Generated: ${currentDate}

User-agent: *
Allow: /
Disallow: /IndexNow.html
Disallow: /AddC.html
Disallow: /AddR.html

# Sitemap
Sitemap: ${baseUrl}/sitemap.xml

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
