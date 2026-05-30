export const siteConfig = {
  name: "Loucel Labs",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://loucellabs.com",
  contactEmail:
    process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@loucellabs.com",
  calUrl:
    process.env.NEXT_PUBLIC_CAL_URL ?? "https://cal.com/loucellabs/30min",
  ogImage: "/opengraph-image",
  twitter: "@loucellabs",
} as const;
