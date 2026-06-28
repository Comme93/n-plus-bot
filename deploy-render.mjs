import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BOT_TOKEN = readFileSync('.env', 'utf8').match(/^BOT_TOKEN=(.+)$/m)?.[1]?.trim();
const REPO = 'https://github.com/Comme93/n-plus-bot';
const DEPLOY_URL = `https://dashboard.render.com/blueprint/new?repo=${encodeURIComponent(REPO)}`;

const edgeProfile = `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data`;

async function main() {
  if (!BOT_TOKEN) throw new Error('No BOT_TOKEN in .env');

  console.log('Opening Render with Edge profile...');
  let context;
  try {
    context = await chromium.launchPersistentContext(edgeProfile, {
      channel: 'msedge',
      headless: false,
      viewport: { width: 1400, height: 900 },
    });
  } catch {
    console.log('Edge profile busy, using fresh browser...');
    context = await chromium.launchPersistentContext('./.render-session', {
      headless: false,
      viewport: { width: 1400, height: 900 },
    });
  }

  const page = context.pages()[0] || (await context.newPage());

  await page.goto(DEPLOY_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(3000);

  // Already on blueprint form?
  const url = page.url();
  console.log('URL:', url);

  if (url.includes('login') || url.includes('signin')) {
    console.log('Need login — waiting 120s for manual login...');
    await page.waitForURL(/dashboard\.render\.com/, { timeout: 120_000 });
    await page.goto(DEPLOY_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  }

  // Connect GitHub if needed
  const connectGithub = page.getByRole('button', { name: /connect.*github|github/i }).first();
  if (await connectGithub.isVisible({ timeout: 5000 }).catch(() => false)) {
    await connectGithub.click();
    await page.waitForTimeout(5000);
  }

  // Select repo
  const repoLink = page.getByText(/n-plus-bot/i).first();
  if (await repoLink.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await repoLink.click();
    const connectBtn = page.getByRole('button', { name: /^connect$/i }).first();
    if (await connectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await connectBtn.click();
    }
  }

  await page.waitForTimeout(2000);

  // BOT_TOKEN env var
  const tokenInput = page.locator('input[type="password"], input[name*="BOT"], input[placeholder*="value" i]').first();
  if (await tokenInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await tokenInput.fill(BOT_TOKEN);
  } else {
    const inputs = page.locator('input[type="text"], input[type="password"]');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const inp = inputs.nth(i);
      const label = await inp.evaluate((el) => {
        const row = el.closest('div');
        return row?.textContent || '';
      });
      if (/BOT_TOKEN/i.test(label)) {
        await inp.fill(BOT_TOKEN);
        break;
      }
    }
  }

  // Deploy button
  const deployBtn = page.getByRole('button', { name: /deploy blueprint|apply|create/i }).first();
  if (await deployBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await deployBtn.click();
    console.log('Clicked Deploy!');
  }

  console.log('Waiting for deploy to start (3 min)...');
  await page.waitForTimeout(180_000);

  await page.screenshot({ path: 'render-deploy.png', fullPage: true });
  console.log('Screenshot: render-deploy.png');
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
