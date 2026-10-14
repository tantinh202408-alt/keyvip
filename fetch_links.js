#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1. CẤU HÌNH HỆ THỐNG & TÀI KHOẢN CHÍNH THỨC
// ============================================================
const args = process.argv.slice(2);

function getArgValue(flag, defaultVal) {
  const index = args.findIndex(arg => arg === flag || arg.startsWith(`${flag}=`));
  if (index === -1) return defaultVal;
  if (args[index].includes('=')) {
    return args[index].split('=')[1];
  }
  return args[index + 1] !== undefined ? args[index + 1] : defaultVal;
}

const hasFlag = (flag) => args.includes(flag);

const CONFIG = {
  deviceId: getArgValue('--device', 'device_1c7fc1c4-278c-41b5-8a37-ea4196c38b77'),
  key: getArgValue('--key', 'CTV1-ZU4E-AKYL-5YM3'),
  apiBase: 'https://vohoainam.net',
  isWatchMode: hasFlag('-w') || hasFlag('--watch'),
  intervalSec: parseInt(getArgValue('--interval', '5'), 10),
  telegramToken: getArgValue('--tg-token', '8814714783:AAEK9ZQ-QVp9ALZnkhfYD2yoS_ZE8b2SgWE'),
  telegramChatId: getArgValue('--tg-chat', '8855411031'),
  telegramEnabled: !hasFlag('--no-tg'),
  outputJson: getArgValue('--json', 'tiktok_links.json'),
  outputCsv: getArgValue('--csv', 'tiktok_links.csv'),
  outputTxt: getArgValue('--txt', 'tiktok_links.txt'),
  categoryFilter: getArgValue('--cat', 'all') // 'ruong_treo', 'ruong_lon', 'tui', etc.
};

const CHAT_ID_TO_TAB = {
  '-1002889993912': { code: 'ruong_lon', name: 'Rương Lớn' },
  '-1003606511380': { code: 'ruong_nho', name: 'Rương Nhỏ' },
  '-1003874158853': { code: 'ruong_treo', name: 'Rương Treo' },
  '-1002914600740': { code: 'ruong_treo', name: 'Rương Treo' },
  '-1003393920142': { code: 'ruong_test', name: 'Rương Test' },
  '-1002601067327': { code: 'tui', name: 'Túi' },
  '-1003337128065': { code: 'tui_0xu', name: 'Túi 0xu' },
  '-1000': { code: 'other', name: 'Khác' }
};

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bgBlue: '\x1b[44m\x1b[37m'
};

// ============================================================
// 2. THUẬT TOÁN GIẢI MÃ LINK (DEOBFUSCATION)
// ============================================================
function deobfuscateLink(hexStr, devId) {
  if (!hexStr) return '';
  const devKey = String(devId || '').trim();
  if (!devKey) return '';
  const seed = (devKey.length * 37 + 109) % 256;
  const bytes = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < hexStr.length; i += 2) {
    const byteVal = parseInt(hexStr.substr(i, 2), 16);
    const idx = i / 2;
    const k = (devKey.charCodeAt(idx % devKey.length) ^ seed ^ ((idx * 13) % 256)) & 0xff;
    bytes[idx] = byteVal ^ k;
  }
  return new TextDecoder().decode(bytes);
}

function extractRoomId(deeplink) {
  if (!deeplink) return '';
  const match = deeplink.match(/room_id=([0-9]+)/);
  return match ? match[1] : '';
}

// ============================================================
// 2.1 HELPER FETCH CÓ TỰ ĐỘNG THỬ LẠI & CHỐNG TIMEOUT
// ============================================================
async function fetchWithRetry(url, options = {}, retries = 4, timeoutMs = 15000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = Math.min(1000 * Math.pow(1.5, attempt), 5000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ============================================================
// 3. XÁC THỰC BẢN QUYỀN & KÍCH HOẠT
// ============================================================
async function ensureAuth() {
  const checkUrl = `${CONFIG.apiBase}/api/check-auth?device_id=${CONFIG.deviceId}`;
  try {
    const res = await fetchWithRetry(checkUrl);
    const data = await res.json();

    if (data.authorized) {
      return data;
    }

    console.log(`${colors.yellow}⚠️ Thiết bị chưa kích hoạt, đang tiến hành kích hoạt với mã Key: ${CONFIG.key}...${colors.reset}`);
    const actRes = await fetchWithRetry(`${CONFIG.apiBase}/api/activate-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: CONFIG.key,
        device_id: CONFIG.deviceId
      })
    });
    const actData = await actRes.json();
    if (actRes.ok && actData.success) {
      console.log(`${colors.green}✔ Kích hoạt thành công: ${actData.message || 'Hợp lệ'}${colors.reset}`);
      const recheck = await fetchWithRetry(checkUrl);
      return await recheck.json();
    } else {
      throw new Error(actData.error || 'Kích hoạt không thành công');
    }
  } catch (err) {
    console.error(`${colors.red}✖ Lỗi xác thực bản quyền: ${err.message}${colors.reset}`);
    throw err;
  }
}

// ============================================================
// 4. LẤY & GIẢI MÃ TẤT CẢ LINK LIVE TIKTOK
// ============================================================
async function fetchAndParseLinks() {
  const url = `${CONFIG.apiBase}/api/client/links?device_id=${CONFIG.deviceId}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!data || !data.success) {
    throw new Error('Dữ liệu trả về không hợp lệ');
  }

  const linksObj = data.links || {};
  const processedList = [];

  for (const [key, item] of Object.entries(linksObj)) {
    const deeplink = item.enc_url ? deobfuscateLink(item.enc_url, CONFIG.deviceId) : (item.url || '');
    const roomId = extractRoomId(deeplink);
    const groupConf = CHAT_ID_TO_TAB[String(item.group)] || { code: 'other', name: 'Khác' };

    // Tạo link web TikTok trực tiếp
    const webUrl = roomId 
      ? `https://www.tiktok.com/@${item.tt_id || 'live'}/live`
      : `${CONFIG.apiBase}/${key}`;

    const parsedItem = {
      key,
      category_code: groupConf.code,
      category_name: groupConf.name,
      group_id: item.group,
      tt_id: item.tt_id || '',
      box_bag: item.box_bag || '',
      ratio: item.ratio || '',
      live_viewers: item.live || '',
      time_remaining: item.time || '',
      created_at: item.created_at || '',
      room_id: roomId,
      deeplink,
      web_url: webUrl,
      gateway_url: `${CONFIG.apiBase}/${key}`
    };

    processedList.push(parsedItem);
  }

  // Sắp xếp link mới nhất lên đầu
  processedList.sort((a, b) => {
    const parseDate = (str) => {
      if (!str) return 0;
      const parts = str.split(' ');
      const [h, m, s] = (parts[0] || '').split(':').map(Number);
      const [dd, mm, yy] = (parts[1] || '').split('/').map(Number);
      return new Date(2000 + (yy || 0), (mm || 1) - 1, dd || 1, h || 0, m || 0, s || 0).getTime();
    };
    return parseDate(b.created_at) - parseDate(a.created_at);
  });

  return {
    groupCounts: data.groupCounts || {},
    channels: data.channels || {},
    links: processedList
  };
}

// ============================================================
// 5. XUẤT RA CÁC ĐỊNH DẠNG FILE (JSON, CSV, TXT)
// ============================================================
function exportData(links, auth) {
  // 1. JSON
  const jsonContent = JSON.stringify({
    fetched_at: new Date().toISOString(),
    auth_info: {
      device_id: auth.device_id,
      key_code: auth.key_code,
      expires_at: auth.expires_at,
      duration: auth.duration
    },
    total_links: links.length,
    links
  }, null, 2);
  fs.writeFileSync(CONFIG.outputJson, jsonContent, 'utf8');

  // 2. CSV
  const csvHeaders = ['Key', 'Danh mục', 'ID TikTok', 'Số Rương/Túi (Box/Bag)', 'Tỉ lệ (Ratio)', 'Người xem (Live)', 'Thời gian (Time)', 'Tạo lúc', 'Room ID', 'Deeplink TikTok App', 'Web Link TikTok', 'Gateway URL'];
  const csvRows = links.map(l => [
    `"${l.key}"`,
    `"${l.category_name}"`,
    `"${l.tt_id}"`,
    `"${l.box_bag}"`,
    `"${l.ratio}"`,
    `"${l.live_viewers}"`,
    `"${l.time_remaining}"`,
    `"${l.created_at}"`,
    `"${l.room_id}"`,
    `"${l.deeplink}"`,
    `"${l.web_url}"`,
    `"${l.gateway_url}"`
  ].join(','));
  const csvContent = '\uFEFF' + [csvHeaders.join(','), ...csvRows].join('\r\n');
  fs.writeFileSync(CONFIG.outputCsv, csvContent, 'utf8');

  // 3. TXT (Định dạng danh sách link rõ ràng)
  const txtLines = [
    `========================================================================`,
    `   DANH SÁCH LINK LIVE TIKTOK RƯƠNG - TÚI TỪ VOHOAINAM.NET`,
    `   Thiết bị: ${auth.device_id} | Key: ${auth.key_code} | Hết hạn: ${auth.expires_at}`,
    `   Tổng số link: ${links.length} | Thời gian lấy: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    `========================================================================\n`
  ];

  for (const l of links) {
    txtLines.push(
      `[${l.created_at}] [${l.category_name}] ${l.tt_id ? `@${l.tt_id}` : ''} | Box: ${l.box_bag || 'N/A'} | Ratio: ${l.ratio || 'N/A'} | Live: ${l.live_viewers || 'N/A'} | Time: ${l.time_remaining || 'N/A'}\n` +
      `  • Deeplink App : ${l.deeplink}\n` +
      `  • Web TikTok   : ${l.web_url}\n` +
      `  • Gateway      : ${l.gateway_url}\n`
    );
  }
  fs.writeFileSync(CONFIG.outputTxt, txtLines.join('\n'), 'utf8');

  // 4. Cập nhật nhúng trực tiếp vào index.html
  try {
    if (fs.existsSync('index.html')) {
      let html = fs.readFileSync('index.html', 'utf8');
      html = html.replace(/const INITIAL_LINKS = \[.*?\];/s, `const INITIAL_LINKS = ${JSON.stringify(links)};`);
      fs.writeFileSync('index.html', html, 'utf8');
    }
  } catch (e) {}
}

// ============================================================
// 6. GỬI THÔNG BÁO TELEGRAM KHI CÓ LINK MỚI (NẾU CHẠY WATCH)
// ============================================================
async function sendNewLinkToTelegram(link) {
  if (!CONFIG.telegramEnabled || !CONFIG.telegramToken || !CONFIG.telegramChatId) return;

  const msg = [
    `🎁 <b>LINK TIKTOK MỚI PHÁT HIỆN! [${link.category_name}]</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Kênh:</b> <code>${link.tt_id || 'N/A'}</code>`,
    `📦 <b>Rương/Túi:</b> <code>${link.box_bag || 'N/A'}</code> | <b>Ratio:</b> <code>${link.ratio || 'N/A'}</code>`,
    `👥 <b>Người xem:</b> <code>${link.live_viewers || 'N/A'}</code> | <b>Thời gian:</b> <code>${link.time_remaining || 'N/A'}</code>`,
    `⏰ <b>Thời gian tạo:</b> <code>${link.created_at}</code>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🚀 <a href="${link.gateway_url}">Mở Link Ngay (Gateway)</a> | <a href="${link.web_url}">Xem TikTok Web</a>`,
    `📱 <code>${link.deeplink}</code>`
  ].join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (e) {}
}

// ============================================================
// 7. HÀM CHÍNH (MAIN)
// ============================================================
async function run() {
  console.log(`
${colors.cyan}==================================================================${colors.reset}
${colors.bright}   HỆ THỐNG QUÉT & LẤY DỮ LIỆU LINK LIVE TIKTOK (VOHOAINAM.NET)   ${colors.reset}
${colors.cyan}==================================================================${colors.reset}
- Device ID:     ${colors.green}${CONFIG.deviceId}${colors.reset}
- Key kích hoạt: ${colors.yellow}${CONFIG.key}${colors.reset}
- Chế độ chạy:   ${CONFIG.isWatchMode ? `${colors.magenta}Theo dõi thời gian thực (Mỗi ${CONFIG.intervalSec}s)${colors.reset}` : `${colors.cyan}Lấy dữ liệu 1 lần & Lưu file${colors.reset}`}
- Xuất file:     ${CONFIG.outputJson}, ${CONFIG.outputCsv}, ${CONFIG.outputTxt}
------------------------------------------------------------------
  `);

  console.log(`${colors.cyan}1. Đang kiểm tra bản quyền thiết bị...${colors.reset}`);
  const auth = await ensureAuth();
  console.log(`${colors.green}✔ Bản quyền HỢP LỆ!${colors.reset}`);
  console.log(`  • Loại key:   ${colors.bright}${auth.key_code}${colors.reset} (Đuôi: ${auth.key_tail})`);
  console.log(`  • Thời hạn:   ${auth.duration || 'N/A'}`);
  console.log(`  • Hết hạn lúc:${colors.yellow} ${auth.expires_at}${colors.reset}`);

  console.log(`\n${colors.cyan}2. Đang kết nối API lấy toàn bộ link TikTok...${colors.reset}`);
  let result = null;
  let retryCount = 0;
  while (!result) {
    try {
      result = await fetchAndParseLinks();
    } catch (e) {
      retryCount++;
      console.log(`${colors.yellow}⚠️ Kết nối server đang chậm, thử lại lần #${retryCount} (${e.message})...${colors.reset}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  const allLinks = result.links;

  console.log(`${colors.green}✔ Tải thành công ${colors.bright}${allLinks.length}${colors.reset}${colors.green} link đang có trong hàng đợi!${colors.reset}`);

  // Phân loại thống kê
  const statsByCat = {};
  for (const l of allLinks) {
    statsByCat[l.category_name] = (statsByCat[l.category_name] || 0) + 1;
  }
  console.log(`\n${colors.bright}📊 Thống kê số lượng theo nhóm hiện có:${colors.reset}`);
  for (const [name, count] of Object.entries(statsByCat)) {
    console.log(`  • ${name.padEnd(15)}: ${colors.yellow}${count}${colors.reset} link`);
  }

  // Xuất file
  exportData(allLinks, auth);
  console.log(`\n${colors.green}✔ Đã xuất kết quả ra các file:${colors.reset}`);
  console.log(`  • ${CONFIG.outputJson} (Cấu trúc đầy đủ JSON)`);
  console.log(`  • ${CONFIG.outputCsv} (Mở trực tiếp bằng Excel)`);
  console.log(`  • ${CONFIG.outputTxt} (Danh sách link dễ đọc)`);

  // Hiển thị 10 link mới nhất lên màn hình
  console.log(`\n${colors.bright}🔥 10 LINK MỚI NHẤT VỪA CẬP NHẬT:${colors.reset}`);
  console.log(`${colors.gray}------------------------------------------------------------------${colors.reset}`);
  const previewList = allLinks.slice(0, 10);
  previewList.forEach((l, idx) => {
    console.log(
      `${colors.bright}[#${String(idx + 1).padStart(2, '0')}]${colors.reset} ` +
      `${colors.magenta}[${l.category_name}]${colors.reset} ` +
      `${colors.cyan}${l.created_at}${colors.reset} | ` +
      `User: ${colors.green}${l.tt_id || 'N/A'}${colors.reset} | ` +
      `Box: ${colors.yellow}${l.box_bag || 'N/A'}${colors.reset} | ` +
      `Ratio: ${l.ratio || 'N/A'}`
    );
    console.log(`     Link: ${colors.gray}${l.deeplink || l.web_url}${colors.reset}`);
  });
  console.log(`${colors.gray}------------------------------------------------------------------${colors.reset}`);

  // Nếu là chế độ theo dõi liên tục
  if (CONFIG.isWatchMode) {
    console.log(`\n${colors.magenta}🔄 Đang chạy ở chế độ THEO DÕI LIÊN TỤC (Mỗi ${CONFIG.intervalSec}s quét 1 lần)...${colors.reset}`);
    console.log(`${colors.gray}Nhấn Ctrl+C để dừng.${colors.reset}\n`);

    const seenKeys = new Set(allLinks.map(l => l.key));

    setInterval(async () => {
      try {
        const updateResult = await fetchAndParseLinks();
        const freshLinks = updateResult.links;
        let newCount = 0;

        for (const l of freshLinks) {
          if (!seenKeys.has(l.key)) {
            seenKeys.add(l.key);
            newCount++;
            console.log(
              `${colors.green}[MỚI]${colors.reset} [${l.category_name}] ${colors.yellow}${l.created_at}${colors.reset} ` +
              `User: ${colors.cyan}@${l.tt_id}${colors.reset} | Box: ${l.box_bag} | Ratio: ${l.ratio} | Live: ${l.live_viewers}`
            );
            console.log(`      Deeplink: ${l.deeplink}`);

            // Gửi Telegram
            if (CONFIG.telegramEnabled) {
              await sendNewLinkToTelegram(l);
            }
          }
        }

        if (newCount > 0) {
          exportData(freshLinks, auth);
        }
      } catch (err) {
        console.error(`${colors.red}[Lỗi quét cập nhật]: ${err.message}${colors.reset}`);
      }
    }, CONFIG.intervalSec * 1000);
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
