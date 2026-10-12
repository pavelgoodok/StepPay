const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const prod = process.env.NODE_ENV === "production";

// Заголовки безопасности: запрет встраивания, запрет угадывания типов, ограничение источников.
// 'unsafe-inline' для скриптов нужен самому Next.js для запуска страниц; запросы и картинки разрешены только своему API.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${prod ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${api}`,
  "font-src 'self' data:",
  `connect-src 'self' ${api}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@steppay/engine"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...(prod ? [{ key: "Content-Security-Policy", value: csp }] : []),
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }] : []),
        ],
      },
    ];
  },
};
