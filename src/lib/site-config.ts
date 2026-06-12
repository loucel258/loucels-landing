export const siteConfig = {
  name: "Loucells Core",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://loucellscore.com",
  contactEmail:
    process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@loucellscore.com",
  calUrl:
    process.env.NEXT_PUBLIC_CAL_URL ?? "https://cal.com/loucellscore/30min",
  ogImage: "/opengraph-image",
  twitter: "@loucels",
} as const;
