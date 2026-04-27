// api/refresh.js — daily cron target. Triggers a Vercel redeploy via Deploy Hook
// so the build script pulls the latest American Warrior posts from swampfoxoptics.com.
module.exports = async function handler(req, res) {
  // Vercel cron auto-attaches `Authorization: Bearer <CRON_SECRET>`.
  // Reject anything else so the endpoint can't be triggered by random traffic.
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || req.headers.authorization !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const hookUrl = process.env.DEPLOY_HOOK_URL;
  if (!hookUrl) {
    return res.status(500).json({ error: 'DEPLOY_HOOK_URL not configured' });
  }

  try {
    const r = await fetch(hookUrl, { method: 'POST' });
    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: 'deploy hook failed', status: r.status, body: text.slice(0, 500) });
    }
    return res.status(200).json({ ok: true, triggered: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: 'fetch failed', message: String(err && err.message || err) });
  }
};
