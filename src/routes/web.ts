import { Elysia, t } from "elysia";
import { getPublicProfile, GetPublicProfileError } from "../usecases/users/get_public_profile.ts";

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

export const webRouter = new Elysia().get(
  "/u/:username",
  async ({ params }) => {
    try {
      const profile = await getPublicProfile(params.username);

      const displayNameRaw = profile.displayName || profile.username;
      const displayName = escapeHtml(displayNameRaw);
      const username = encodeURIComponent(profile.username);
      const initial = escapeHtml(displayNameRaw.charAt(0).toUpperCase());

      const imageUrl = profile.avatarUrl;
      const ogImageUrl = imageUrl || "https://cloudreve.adnope.io.vn/f/Z7I7/solari-icon.png";

      const appUrl = `https://solari.com/u/${username}`;
      const androidPackage = "com.adnope.solari";
      const intentUrl = `intent://solari.com/u/${username}#Intent;scheme=https;package=${androidPackage};end`;

      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Add ${displayName} on Solari</title>
            <link rel="icon" type="image/x-icon" href="https://cloudreve.adnope.io.vn/f/Z7I7/solari-icon.png">

            <meta name="description" content="Pics from your best friends on your Home Screen">

            <meta property="og:type" content="website">
            <meta property="og:url" content="${appUrl}">
            <meta property="og:title" content="Add ${displayName} on Solari">
            <meta property="og:description" content="Pics from your best friends on your Home Screen">
            <meta property="og:image" content="${ogImageUrl}">
            <meta property="og:site_name" content="Solari">

            <meta property="twitter:card" content="summary_large_image">
            <meta property="twitter:url" content="${appUrl}">
            <meta property="twitter:title" content="Add ${displayName} on Solari">
            <meta property="twitter:description" content="Pics from your best friends on your Home Screen">
            <meta property="twitter:image" content="${ogImageUrl}">

            <style>
              :root {
                --solari-blue: #1e81b0;
                --bg-dark: #12100B;
                --bg-letter: #2A2824;
                --text-main: #FFFFFF;
                --text-sub: #A09E99;
              }
              body {
                margin: 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background-color: var(--bg-dark);
                color: var(--text-main);
                text-align: center;
                padding: 20px;
              }
              .avatar-container {
                width: 140px;
                height: 140px;
                border-radius: 50%;
                border: 4px solid var(--solari-blue);
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
                background-color: var(--solari-blue);
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

            <h1>Add ${displayName} on Solari</h1>
            <p>Pics from your best friends on<br>your Home Screen</p>

            <a class="btn" href="${intentUrl}">
              Open Solari
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </a>
        </body>
        </html>
      `;

      return htmlResponse(html, 200);
    } catch (error) {
      const errorBg = "background-color: #12100B; margin: 0;";

      if (error instanceof GetPublicProfileError && error.statusCode === 404) {
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
  },
);
