// One-time interactive setup for YouTube uploads - run once (`npx tsx scripts/youtube_authorize.ts`)
// to turn a Google Cloud OAuth client into a long-lived refresh token this app can use for
// unattended uploads. Needs YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET in .env first (from a Google
// Cloud project with the YouTube Data API v3 enabled and an OAuth 2.0 Client ID of type "Desktop app"
// or "Web application" with http://localhost:8901/oauth2callback added as an authorized redirect URI).
//
// Scope is the full `youtube` scope (not just `youtube.upload`) because server/services/youtube.
// service.ts also manages playlists (find-or-create by series, add uploaded videos) - upload-only
// scope can't do that.
import '../envLoader';
import http from 'http';
import { google } from 'googleapis';

const REDIRECT_URI = 'http://localhost:8901/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/youtube'];

async function main() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first (from your Google Cloud OAuth 2.0 Client ID), then re-run this script.');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token back, not just a short-lived access token
    prompt: 'consent', // forces Google to re-issue a refresh_token even if this app was authorized before
    scope: SCOPES,
  });

  console.log('\nOpen this URL in a browser (sign in with the Google account that owns/manages the YouTube channel), then approve access:\n');
  console.log(authUrl);
  console.log('\nWaiting for the redirect back to', REDIRECT_URI, '...\n');

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', REDIRECT_URI);
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (error) {
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(error));
        return;
      }
      if (authCode) {
        res.end('Authorization received - you can close this tab and return to the terminal.');
        server.close();
        resolve(authCode);
      }
    });
    server.listen(8901);
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error('\nNo refresh_token returned - this Google account may have already authorized this app before without `prompt: consent` revoking it. Go to https://myaccount.google.com/permissions, remove this app\'s access, and re-run this script.');
    process.exit(1);
  }

  console.log('\nSuccess. Add this to your .env file:\n');
  console.log(`YOUTUBE_CLIENT_ID=${clientId}`);
  console.log(`YOUTUBE_CLIENT_SECRET=${clientSecret}`);
  console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error('Authorization failed:', err?.message || err);
  process.exit(1);
});
