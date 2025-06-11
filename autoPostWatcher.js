require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const express = require('express');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;
const PROFILE_HANDLE = process.env.PROFILE_HANDLE || 'realDonaldTrump';
const PROFILE_URL = `https://truthsocial.com/@${PROFILE_HANDLE}`;
const LAST_POST_PATH = './latest.json';
const CHECK_INTERVAL_MS = 60 * 1000;

// Serve static HTML
app.use(express.static('public'));

// API route
app.get('/last-posts', (req, res) => {
  const history = readPostHistory();
  res.json(history || []);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

async function getLatestPost() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 800 });

  try {
    console.log(`➡️ Navigating to ${PROFILE_URL}...`);

    await page.goto(PROFILE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForTimeout?.(5000); // optional chaining for compatibility

    const postWrapperSelector = '.status__content-wrapper';
    await page.waitForSelector(postWrapperSelector, { timeout: 60000 });

    const result = await page.evaluate((PROFILE_HANDLE) => {
      const wrapper = document.querySelector('.status__content-wrapper');
      if (!wrapper) return null;

      const text = Array.from(wrapper.querySelectorAll('p'))
        .map(p => p.innerText.trim())
        .filter(Boolean)
        .filter((line, index, self) => self.indexOf(line) === index)
        .join('\n');

      const article = wrapper.closest('article');
      const postId = article?.getAttribute('data-id') || null;

      return {
        text,
        postId,
        postUrl: postId ? `https://truthsocial.com/@${PROFILE_HANDLE}/post/${postId}` : null,
      };
    }, PROFILE_HANDLE);

    await browser.close();

    if (!result || !result.text) {
      console.log('⚠️ No valid post content found.');
      return null;
    }

    return result;

  } catch (err) {
    console.error('❌ Error fetching post:', err.stack || err.message);
    await browser.close();
    return null;
  }
}

function readPostHistory() {
  if (!fs.existsSync(LAST_POST_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(LAST_POST_PATH, 'utf-8'));
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}

function savePostHistory(posts) {
  fs.writeFileSync(LAST_POST_PATH, JSON.stringify(posts, null, 2));
}

function normalize(str) {
  return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function watcherLoop() {
  console.log('▶️ Starting watcher...');
  while (true) {
    const latest = await getLatestPost();
    const now = new Date().toLocaleString();

    if (latest) {
      const history = readPostHistory();
      const lastPost = history[history.length - 1];

      const isNewPost =
        !lastPost ||
        latest.postId !== lastPost.postId ||
        normalize(latest.text) !== normalize(lastPost.text);

      if (isNewPost) {
        console.log(`\n[${now}] 🟢 NEW POST DETECTED:\n`, latest.text);
        if (latest.postUrl) console.log('🔗 URL:', latest.postUrl);

        history.push({
          ...latest,
          timestamp: new Date().toISOString(),
        });

        if (history.length > 50) {
          history.splice(0, history.length - 50);
        }

        savePostHistory(history);
      } else {
        console.log(`[${now}] ⏳ No new post yet...`);
      }
    } else {
      console.log(`[${now}] ⚠️ Could not fetch any post.`);
    }

    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
  }
}

watcherLoop();
