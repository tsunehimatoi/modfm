import { getRequestURL } from "h3";

export default defineEventHandler((event) => {
  const requestUrl = getRequestURL(event);
  const siteUrl = requestUrl.origin;

  const robots = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/admin/",
    "Disallow: /api/auth/",
    `Sitemap: ${siteUrl}/sitemap.xml`,
  ].join("\n");

  setHeader(event, "Content-Type", "text/plain; charset=utf-8");
  return robots;
});
