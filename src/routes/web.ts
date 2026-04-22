import { Elysia, t } from "elysia";
import {
  getPublicWebProfile,
  GetPublicWebProfileError,
} from "../usecases/users/get_public_web_profile.ts";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const htmlResponse = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });

const solariLogoPath = "/assets/favicon.ico";
const solariLogoFile = Bun.file(new URL("./assets/favicon.ico", import.meta.url));

export const webRouter = new Elysia()
  .get(solariLogoPath, () => {
    return new Response(solariLogoFile, {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-type": "image/webp",
      },
    });
  })
  .get(
    "/u/:username",
    async ({ params, query }) => {
      try {
        const profile = await getPublicWebProfile(params.username);

        const displayNameRaw = profile.displayName || profile.username;
        const displayName = escapeHtml(displayNameRaw);
        const username = encodeURIComponent(profile.username);
        const initial = escapeHtml(displayNameRaw.charAt(0).toUpperCase());
        const isAppNotInstalledFallback = query.app_not_installed === "1";

        const imageUrl = profile.avatarUrl;

        const appUrl = `https://solari.com/u/${username}`;
        const solariLogoUrl = `https://solari.com${solariLogoPath}`;
        const ogImageUrl = imageUrl || solariLogoUrl;
        const androidPackage = "com.solari.app";
        const fallbackUrl = encodeURIComponent(`${appUrl}?app_not_installed=1`);
        const intentUrl = `intent://solari.com/u/${username}#Intent;scheme=https;package=${androidPackage};S.browser_fallback_url=${fallbackUrl};end`;

        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Add ${displayName} on Solari</title>
            <link rel="icon" type="image/webp" href="${solariLogoPath}">

            <meta name="description" content="See photos of your best friends on your Home Screen">

            <meta property="og:type" content="website">
            <meta property="og:url" content="${appUrl}">
            <meta property="og:title" content="Add ${displayName} on Solari">
            <meta property="og:description" content="See photos of your best friends on your Home Screen">
            <meta property="og:image" content="${ogImageUrl}">
            <meta property="og:site_name" content="Solari">

            <meta property="twitter:card" content="summary_large_image">
            <meta property="twitter:url" content="${appUrl}">
            <meta property="twitter:title" content="Add ${displayName} on Solari">
            <meta property="twitter:description" content="See photos of your best friends on your Home Screen">
            <meta property="twitter:image" content="${ogImageUrl}">

            <style>
              :root {
                --solari-orange: #FA8128;
                --bg-dark: #12100B;
                --bg-letter: #2A2824;
                --text-main: #FFFFFF;
                --text-sub: #A09E99;
              }
              * {
                box-sizing: border-box;
              }
              html {
                width: 100%;
                height: 100%;
                overflow: hidden;
              }
              body {
                margin: 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                width: 100vw;
                height: 100dvh;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background-color: var(--bg-dark);
                color: var(--text-main);
                text-align: center;
                padding: 20px;
              }
              .avatar-container {
                width: 140px;
                height: 140px;
                border-radius: 50%;
                border: 4px solid var(--solari-orange);
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 24px;
                overflow: hidden;
                background-color: var(--bg-letter);
              }
              .avatar {
                width: 100%;
                height: 100%;
                object-fit: cover;
              }
              .avatar-letter {
                font-size: 72px;
                font-weight: 800;
                color: #c2c2c2;
              }
              h1 {
                font-size: 28px;
                font-weight: 800;
                margin: 0 0 12px 0;
                letter-spacing: -0.5px;
              }
              p {
                font-size: 16px;
                font-weight: 600;
                color: var(--text-sub);
                margin: 0 0 20px 0;
                line-height: 1.4;
                max-width: 280px;
              }
              .btn {
                background-color: var(--solari-orange);
                color: #000000;
                padding: 16px 32px;
                text-decoration: none;
                border-radius: 30px;
                font-weight: 700;
                font-size: 18px;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                transition: transform 0.2s ease;
              }
              .btn:active {
                transform: scale(0.96);
              }
            </style>
        </head>
        <body>
            <div class="avatar-container">
              ${
                imageUrl
                  ? `<img class="avatar" src="${imageUrl}" alt="${displayName}'s Avatar">`
                  : `<div class="avatar-letter">${initial}</div>`
              }
            </div>

            ${
              isAppNotInstalledFallback
                ? `
                  <h1>Solari is not installed!</h1>
                  <p>Install Solari to add ${displayName} as a friend.</p>
                `
                : `
                  <h1>Add ${displayName} on Solari</h1>
                  <p>See photos of your best friends on<br>your Home Screen</p>

                  <a class="btn" href="${intentUrl}">
                    Open Solari
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                  </a>
                `
            }
        </body>
        </html>
      `;

        return htmlResponse(html, 200);
      } catch (error) {
        const errorBg = "background-color: #12100B; margin: 0;";

        if (error instanceof GetPublicWebProfileError && error.statusCode === 404) {
          return htmlResponse(
            `<body style="${errorBg}"><h1 style="color:white;font-family:sans-serif;text-align:center;margin-top:20vh;">User not found</h1></body>`,
            404,
          );
        }

        return htmlResponse(
          `<body style="${errorBg}"><h1 style="color:white;font-family:sans-serif;text-align:center;margin-top:20vh;">Internal Server Error</h1></body>`,
          500,
        );
      }
    },
    {
      params: t.Object({
        username: t.String(),
      }),
      query: t.Object({
        app_not_installed: t.Optional(t.String()),
      }),
    },
  );
