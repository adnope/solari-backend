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

export const webRouter = new Elysia().get(
  "/u/:username",
  async ({ params }) => {
    try {
      const profile = await getPublicWebProfile(params.username);

      const displayNameRaw = profile.displayName || profile.username;
      const displayName = escapeHtml(displayNameRaw);
      const username = encodeURIComponent(profile.username);
      const initial = escapeHtml(displayNameRaw.charAt(0).toUpperCase());

      const imageUrl = profile.avatarUrl;

      const appUrl = `https://solari.adnope.io.vn/u/${username}`;
      const solariLogoUrl = `https://solari.adnope.io.vn${solariLogoPath}`;
      const ogImageUrl = imageUrl || solariLogoUrl;
      const androidPackage = "com.solari.app";
      const intentUrl = `intent://solari.adnope.io.vn/u/${username}#Intent;scheme=https;package=${androidPackage};end`;

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
                overflow: hidden;
                position: relative;
                touch-action: manipulation;
                transition: transform 0.2s ease;
                user-select: none;
                -webkit-tap-highlight-color: transparent;
              }
              .btn:active {
                transform: scale(0.96);
              }
              .modal-backdrop {
                position: fixed;
                inset: 0;
                z-index: 10;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                background: rgba(0, 0, 0, 0.58);
              }
              .modal-backdrop[hidden] {
                display: none;
              }
              .modal {
                width: min(320px, 100%);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 16px;
                background: #1D1A15;
                padding: 24px;
                box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4);
              }
              .modal h2 {
                margin: 0 0 10px 0;
                font-size: 22px;
                font-weight: 800;
              }
              .modal p {
                margin: 0 0 20px 0;
                max-width: none;
              }
              .modal button {
                width: 100%;
                border: 0;
                border-radius: 12px;
                background: var(--solari-orange);
                color: #000000;
                font: inherit;
                font-weight: 800;
                padding: 12px 16px;
                -webkit-tap-highlight-color: transparent;
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
            <p>See photos of your best friends on<br>your Home Screen</p>

            <a class="btn" id="open-solari" href="${intentUrl}">
              Open Solari
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </a>

            <div class="modal-backdrop" id="install-modal" hidden>
              <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="install-modal-title">
                <h2 id="install-modal-title">Solari is not installed</h2>
                <p>Install Solari to add ${displayName} as a friend.</p>
                <button type="button" id="close-install-modal">OK</button>
              </div>
            </div>

            <script>
              const openButton = document.getElementById("open-solari");
              const installModal = document.getElementById("install-modal");
              const closeInstallModalButton = document.getElementById("close-install-modal");
              let installFallbackTimer = null;

              function clearInstallFallbackTimer() {
                if (installFallbackTimer !== null) {
                  window.clearTimeout(installFallbackTimer);
                  installFallbackTimer = null;
                }
              }

              openButton?.addEventListener("click", () => {
                clearInstallFallbackTimer();
                installFallbackTimer = window.setTimeout(() => {
                  installModal.hidden = false;
                }, 1200);
              });

              closeInstallModalButton?.addEventListener("click", () => {
                installModal.hidden = true;
              });

              window.addEventListener("pagehide", clearInstallFallbackTimer);
              document.addEventListener("visibilitychange", () => {
                if (document.hidden) {
                  clearInstallFallbackTimer();
                }
              });
            </script>
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
  },
);
