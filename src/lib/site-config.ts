export const siteConfig = {
  name: "Loucels",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://loucels.com",
  contactEmail:
    process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@loucels.com",
  calUrl:
    process.env.NEXT_PUBLIC_CAL_URL ?? "https://cal.com/loucels/30min",
  ogImage: "/opengraph-image",
  twitter: "@loucels",
} as const;
