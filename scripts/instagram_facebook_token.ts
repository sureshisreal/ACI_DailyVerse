// One-time setup for Instagram posting - run `npx tsx scripts/instagram_facebook_token.ts <short-lived-token>`
// to turn a short-lived Facebook Login user token (EAA..., from Graph API Explorer) into the two
// values server/services/instagram.service.ts needs: a Page access token that does not expire, and
// the Instagram professional account id linked to that Page.
//
// Why Facebook Login and not an Instagram Login token (IGAA...): Instagram only offers resumable
// uploads (sending the video straight from this machine) to Facebook Login apps; with an Instagram
// Login token every Reel would need a publicly hosted video_url instead.
//
// Needs META_APP_ID and META_APP_SECRET in .env (Meta app dashboard > App settings > Basic). The
// short-lived token needs: instagram_basic, instagram_content_publish, pages_show_list,
// pages_read_engagement (and business_management if the Page is owned by a Business portfolio).
// For Facebook Page drafts/scheduled posts (server/services/facebook.service.ts) also include
// pages_manage_posts and publish_video - the same Page token is printed as FACEBOOK_PAGE_ACCESS_TOKEN.
import '../envLoader';

const GRAPH = `https://graph.facebook.com/${process.env.INSTAGRAM_GRAPH_VERSION || 'v23.0'}`;

async function get(pathAndQuery: string): Promise<any> {
  const res = await fetch(`${GRAPH}/${pathAndQuery}`);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data;
}

async function main() {
  const shortToken = process.argv[2];
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!shortToken || !appId || !appSecret) {
    console.error('Usage: npx tsx scripts/instagram_facebook_token.ts <short-lived EAA... user token>');
    console.error('Also set META_APP_ID and META_APP_SECRET in .env first.');
    process.exit(1);
  }

  // A long-lived user token is what makes the Page token below non-expiring.
  const exchanged = await get(`oauth/access_token?${new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  })}`);
  const longToken: string = exchanged.access_token;

  // Instagram and Facebook can be different Pages: Instagram posts through the Page its professional
  // account is linked to, while Facebook posts go to whichever Page you pick below.
  const pages = await get(`me/accounts?fields=id,name,username,link,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(longToken)}`);
  const all: any[] = pages.data || [];
  if (!all.length) {
    console.error('The token sees no Facebook Pages - in the login dialog, choose "Edit access" and select your Pages.');
    process.exit(1);
  }

  const linked = all.filter((p) => p.instagram_business_account?.id);
  console.log('\n=== Instagram ===');
  if (!linked.length) console.log('None of these Pages has an Instagram professional account linked.');
  for (const page of linked) {
    console.log(`\nPage "${page.name}" -> Instagram @${page.instagram_business_account.username}`);
    console.log(`INSTAGRAM_USER_ID=${page.instagram_business_account.id}`);
    console.log(`INSTAGRAM_ACCESS_TOKEN=${page.access_token}`);
  }

  console.log('\n=== Facebook - use the lines for the Page you want videos posted to ===');
  for (const page of all) {
    console.log(`\nPage "${page.name}"${page.username ? ` (facebook.com/${page.username})` : ''} id ${page.id}`);
    console.log(`FACEBOOK_PAGE_ID=${page.id}`);
    console.log(`FACEBOOK_PAGE_ACCESS_TOKEN=${page.access_token}`);
  }
  console.log('\nPut the chosen lines in .env (replacing the existing values), then restart the server.');
}

main().catch((err) => {
  console.error('Failed:', err?.message || err);
  process.exit(1);
});
