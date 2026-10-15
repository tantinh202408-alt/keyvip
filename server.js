import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 3000;
const SANGDEV_API_BASE = 'https://sangdev.online/api/key/check?key=';
const VOHOAINAM_API = 'https://vohoainam.net';
const DEVICE_ID = 'device_79e1dc71-5cff-476c-b08b-15b759663c38';

// Phân loại nhóm chat Telegram sang danh mục
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

// Thuật toán giải mã link TikTok chính thống từ vohoainam
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

function parseCreatedAt(str) {
  if (!str) return 0;
  const parts = str.trim().split(' ');
  if (parts.length < 2) return 0;
  const [h, m, s] = (parts[0] || '').split(':').map(Number);
  const [dd, mm, yy] = (parts[1] || '').split('/').map(Number);
  const year = yy < 100 ? 2000 + yy : yy;
  return new Date(year, (mm || 1) - 1, dd || 1, h || 0, m || 0, s || 0).getTime();
}

// Bộ nhớ cache tạm thời cho License Key (tránh spam API sangdev.online khi client poll)
const keyCache = new Map();
const KEY_CACHE_TTL_MS = 180000; // 3 phút

async function verifySangdevKey(key) {
  const cleanKey = String(key || '').trim();
  if (!cleanKey) return { success: false, valid: false, message: 'Vui lòng cung cấp mã Key bản quyền!' };

  const cached = keyCache.get(cleanKey);
  if (cached && (Date.now() - cached.time < KEY_CACHE_TTL_MS)) {
    return cached.data;
  }

  try {
    const res = await fetch(SANGDEV_API_BASE + encodeURIComponent(cleanKey), {
      headers: { 'User-Agent': 'sangdev-server-checker/1.0' }
    });
    const data = await res.json();
    keyCache.set(cleanKey, {
      valid: Boolean(data && data.valid === true),
      data: data,
      time: Date.now()
    });
    return data;
  } catch (err) {
    return { success: false, valid: false, message: 'Không thể kết nối tới máy chủ xác thực sangdev.online.' };
  }
}

// ============================================================
// HỆ THỐNG ON-DEMAND REALTIME LINK FETCHER
// Chỉ quét khi có người dùng đang xem trang & CHỈ LẤY LINK MỚI NHẤT
// ============================================================
let cachedLivePayload = null;
let lastFetchTime = 0;
const REALTIME_CACHE_TTL_MS = 3000; // Cache 3 giây để chống trùng lặp nếu nhiều tab cùng xem
const MAX_LINK_AGE_MINUTES = 8;     // CHỈ LẤY LINK TRONG VÒNG 8 PHÚT GẦN NHẤT

async function fetchRealtimeFreshLinks() {
  const now = Date.now();
  if (cachedLivePayload && (now - lastFetchTime < REALTIME_CACHE_TTL_MS)) {
    return cachedLivePayload;
  }

  const url = `${VOHOAINAM_API}/api/client/links?device_id=${DEVICE_ID}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'sangdev-realtime-fetcher/2.0' } });
  if (!res.ok) {
    if (cachedLivePayload) return cachedLivePayload;
    throw new Error(`Upstream API error: ${res.status}`);
  }
  const data = await res.json();
  if (!data || !data.success) {
    if (cachedLivePayload) return cachedLivePayload;
    throw new Error('Dữ liệu upstream không hợp lệ');
  }

  const rawLinks = Object.entries(data.links || {});
  const freshLinks = [];

  for (const [key, item] of rawLinks) {
    const createdTime = parseCreatedAt(item.created_at);
    const ageMin = (now - createdTime) / 60000;

    // 1. LOẠI BỎ LINK CŨ: Không lưu và không hiển thị link cũ hơn MAX_LINK_AGE_MINUTES
    if (ageMin > MAX_LINK_AGE_MINUTES) {
      continue;
    }

    // 2. LOẠI BỎ LINK ĐÃ HẾT HẠN MỞ: Nếu có mốc giờ mở cụ thể và đã trôi qua hơn 40s
    if (item.time && item.time.includes('-')) {
      const timePart = item.time.split('-')[1]?.trim();
      if (timePart) {
        const [th, tm, ts] = timePart.split(':').map(Number);
        const openDate = new Date(createdTime);
        openDate.setHours(th, tm, ts || 0);
        if (now - openDate.getTime() > 40000) {
          continue; // Đã mở xong, bỏ qua
        }
      }
    }

    const deeplink = item.enc_url ? deobfuscateLink(item.enc_url, DEVICE_ID) : (item.url || '');
    const roomId = extractRoomId(deeplink);
    const groupConf = CHAT_ID_TO_TAB[String(item.group)] || { code: 'other', name: 'Khác' };
    const webUrl = roomId 
      ? `https://www.tiktok.com/@${item.tt_id || 'live'}/live`
      : `${VOHOAINAM_API}/${key}`;

    freshLinks.push({
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
      age_seconds: Math.max(0, Math.round((now - createdTime) / 1000)),
      room_id: roomId,
      deeplink,
      web_url: webUrl,
      gateway_url: `${VOHOAINAM_API}/${key}`
    });
  }

  // Sắp xếp link mới nhất lên đầu tiên
  freshLinks.sort((a, b) => parseCreatedAt(b.created_at) - parseCreatedAt(a.created_at));

  const payload = {
    fetched_at: new Date().toISOString(),
    total_links: freshLinks.length,
    is_realtime: true,
    filter: `Chỉ hiển thị link mới trong vòng ${MAX_LINK_AGE_MINUTES} phút gần nhất`,
    auth_info: {
      device_id: DEVICE_ID,
      server_time: new Date().toLocaleTimeString('vi-VN')
    },
    links: freshLinks
  };

  cachedLivePayload = payload;
  lastFetchTime = now;

  // Tự động đồng bộ ra file tiktok_links.json để lưu trữ link tươi mới nhất
  try {
    fs.writeFileSync('tiktok_links.json', JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {}

  return payload;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = req.url || '/';
  const urlObj = new URL(reqUrl, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // ROUTE 1: Proxy kiểm tra key cho frontend
  if (pathname === '/api/check-key') {
    const key = urlObj.searchParams.get('key');
    const result = await verifySangdevKey(key);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(result));
    return;
  }

  const cleanUrl = pathname;
  let filePath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');

  // ROUTE 2: BẢO VỆ DỮ LIỆU TIKTOK & REALTIME ON-DEMAND
  // Chỉ khi có người dùng truy cập và có KEY hợp lệ -> Mới quét và trả về link mới nhất!
  if (filePath === 'tiktok_links.json' || pathname === '/api/live-links') {
    const key = urlObj.searchParams.get('key') || req.headers['x-license-key'];
    const authResult = await verifySangdevKey(key);

    if (!authResult || authResult.valid !== true) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: false,
        valid: false,
        reason: 'license_required',
        message: authResult?.message || 'BẢO VỆ BẢN QUYỀN: Yêu cầu Key bản quyền hợp lệ từ https://sangdev.online để truy cập dữ liệu!'
      }));
      return;
    }

    try {
      // Có người dùng hợp lệ đang xem trang -> Quét dữ liệu thời gian thực mới nhất!
      const realtimeData = await fetchRealtimeFreshLinks();
      console.log(`[${new Date().toLocaleTimeString('vi-VN')}] 🟢 User đang dùng -> Đã cập nhật ${realtimeData.links.length} link mới nhất (${realtimeData.links[0]?.created_at || 'Mới nhất'})`);
      
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(JSON.stringify(realtimeData));
      return;
    } catch (fetchErr) {
      console.error('Lỗi fetch realtime:', fetchErr.message);
      // Fallback nếu lỗi kết nối
      if (fs.existsSync('tiktok_links.json')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        fs.createReadStream('tiktok_links.json').pipe(res);
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Không thể kết nối lấy dữ liệu link' }));
      return;
    }
  }

  // Fallback về index.html cho bất kỳ đường dẫn trang nào
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = 'index.html';
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream('index.html').pipe(res);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✔ Server sangdev đang hoạt động tại cổng ${PORT} (0.0.0.0:${PORT})`);
  console.log(`⚡ Cơ chế ON-DEMAND REALTIME: Chỉ quét link khi có người dùng truy cập web.`);
  console.log(`⏳ Bộ lọc thời gian: Tự động xóa link cũ, CHỈ GIỮ LINK MỚI TRONG VÒNG 8 PHÚT GẦN NHẤT.`);
  console.log(`🛡️ Khóa cứng bản quyền: https://sangdev.online/api/key/check?key=`);
});
