// One-time helper to mint a Google Drive refresh token for file uploads.
// Uses the loopback-redirect flow (http://localhost) — the OOB/copy-paste flow
// this used before was shut off by Google in 2023 and no longer works.
//
// Prereqs: in your .env set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from a
// Google Cloud OAuth client of type "Desktop app" (loopback redirects are
// auto-allowed for that type, so you don't need to register a redirect URI).
//
// Run:  node auth_setup.js   then open the printed URL and authorize.
const { google } = require('googleapis');
const http = require('http');
require('dotenv').config();

const PORT = 42813;
const REDIRECT = `http://localhost:${PORT}`;

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env first.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a fresh refresh_token even on re-auth
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.writeHead(400); res.end('No authorization code received.'); return; }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>✅ Success — you can close this tab and return to the terminal.</h2>');
    console.log('\nSUCCESS! Your Google Drive refresh token:\n');
    console.log('  ' + (tokens.refresh_token ||
      '(none — revoke access at https://myaccount.google.com/permissions and run again)'));
    console.log('\nPaste it into the app under Settings → Refresh Token (or .env GOOGLE_REFRESH_TOKEN).');
  } catch (e) {
    res.writeHead(500); res.end('Token exchange failed: ' + e.message);
    console.error('Token exchange failed:', e.message);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log('Your OAuth client must be type "Desktop app" (loopback redirect is auto-allowed).');
  console.log('\n1. Open this URL in your browser and authorize:\n');
  console.log('   ' + authUrl);
  console.log(`\n2. Waiting for Google to redirect back to ${REDIRECT} ...`);
});
