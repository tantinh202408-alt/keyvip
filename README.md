# Tool Quét & Lấy Dữ Liệu Link Live TikTok (vohoainam.net)

Hệ thống hỗ trợ 2 chức năng chính:
1. **Lấy dữ liệu & Theo dõi link Live TikTok chính thống** qua Key bản quyền đã kích hoạt (`fetch_links.js`).
2. **Quét tìm Device ID hàng loạt** qua API (`index.js`).

---

## ⚡ 1. Hướng Dẫn Lấy Dữ Liệu Link TikTok (Key Chính Thống)

Dùng khi bạn đã có `device_id` và mã `key` bản quyền (ví dụ: `device_1c7fc1c4-278c-41b5-8a37-ea4196c38b77` và key `CTV1-ZU4E-AKYL-5YM3`).

### Cách chạy:
```bash
# 1. Lấy toàn bộ link hiện có và xuất ra file JSON, CSV (Excel), TXT
npm run get-links
# hoặc: node fetch_links.js

# 2. Bật chế độ THEO DÕI LIÊN TỤC (Tự động cập nhật mỗi 5 giây & bắn link mới về Telegram)
npm run watch-links
# hoặc: node fetch_links.js --watch

# 3. Theo dõi tốc độ cao (mỗi 3 giây)
npm run watch-fast
```

### Dữ liệu xuất ra:
- [tiktok_links.json](file:///c:/Users/nguye/Documents/antigravity/modest-euclid/tiktok_links.json): Cấu trúc JSON đầy đủ, dễ tích hợp code / bot khác.
- [tiktok_links.csv](file:///c:/Users/nguye/Documents/antigravity/modest-euclid/tiktok_links.csv): Mở bằng Microsoft Excel để lọc, tìm kiếm theo số xu, tỉ lệ, thời gian.
- [tiktok_links.txt](file:///c:/Users/nguye/Documents/antigravity/modest-euclid/tiktok_links.txt): Danh sách link rõ ràng kèm deeplink app và web TikTok.

---

## 🛠️ 2. Tool Quét Bản Quyền Device ID Hàng Loạt

## 🛡️ Cơ chế Chống Trùng Lặp (Không bao giờ lặp lại mã)

Tool được trang bị **3 tầng chống trùng lặp tuyệt đối (Deduplication)**:

1. **Thuật toán Native Crypto UUID v4**: Mặc định sử dụng bộ sinh số ngẫu nhiên mật mã học CSPRNG (`crypto.randomUUID()`) chuẩn RFC 4122 với không gian $2^{122} \approx 5.3 \times 10^{36}$ mã khả dĩ, triệt tiêu nguy cơ trùng lặp ngẫu nhiên.
2. **Bộ nhớ RAM Filter (`Set`)**: Mọi mã máy được tạo ra đều phải đối chiếu với bộ nhớ RAM `Set`. Nếu phát hiện mã đã từng quét trong phiên chạy, tool sẽ tự động tạo mã mới ngay lập tức mà không gửi request thừa.
3. **Lưu lịch sử trên đĩa cứng (`checked_history.txt`)**: 
   - Tất cả các mã máy đã từng kiểm tra sẽ được tự động ghi vào file `checked_history.txt`.
   - **Khi tắt tool và mở lại vào hôm sau**: Tool sẽ tự động nạp lại toàn bộ danh sách mã cũ từ file này vào RAM.
   - **Cam kết 100% không bao giờ quét trùng** bất kỳ mã máy nào giữa các luồng, giữa các lần chạy khác nhau!

---

## 🚀 Tính năng nổi bật

- **Tự động gửi thông báo Telegram**: Khi phát hiện mã máy hợp lệ (`authorized: true` hoặc có ngày hết hạn), tool lập tức gửi thông báo chi tiết qua Telegram Bot:
  - **Bot Token:** `8814714783:AAEK9ZQ-QVp9ALZnkhfYD2yoS_ZE8b2SgWE`
  - **Chat ID nhận tin:** `8855411031`
- **Báo log chi tiết từng dòng**: Hiển thị rõ ràng cho từng request:
  - Thời gian (`time`, ví dụ: `[19:05:04]`)
  - Luồng đang chạy (`[Luồng #01]`, `[Luồng #02]`,...)
  - Tốc độ xử lý (`[32 req/s]` hoặc ms phản hồi)
  - Mã máy đã test (`Mã máy đã test là device_...`)
  - Kết quả kiểm tra thật từ API: `[ ĐÚNG ]` hoặc `[ SAI ]`
- **Kiểm tra thực tế (Check thật 100%)**: Gửi request thật tới API `https://vohoainam.net/api/check-auth?device_id=...`, đọc và parse JSON response chuẩn xác.
- **Tốc độ cao & Chạy song song (Multi-threading / Concurrency)**: Kiểm tra từ hàng chục đến hàng trăm request/giây tùy số luồng chỉ định.
- **Không phụ thuộc thư viện thứ 3 (Zero Dependencies)**: Chạy trực tiếp bằng Node.js (phiên bản 18+).
- **Tự động lưu kết quả ra file**: Khi tìm thấy thiết bị hợp lệ, lưu đồng thời vào:
  - `authorized_devices.txt` (dạng text ngắn gọn)
  - `authorized_devices.json` (dạng JSON chi tiết cấu trúc)

---

## 📋 Yêu cầu môi trường

- **Node.js**: Phiên bản 18 trở lên (khuyên dùng Node.js 18, 20 hoặc 22+).

---

## 🛠️ Hướng dẫn sử dụng

### 1. Chạy mặc định (Chống lặp 100%, 30 luồng, log từng dòng, báo Telegram)
```bash
node index.js
```

### 2. Test gửi thông báo về Telegram xem bot hoạt động không
```bash
node index.js --test-tg --limit 1
# Hoặc:
npm run test-tg
```

### 3. Xóa lịch sử cũ và bắt đầu quét lại từ đầu
```bash
node index.js --clear-history
```

### 4. Chạy với số luồng tùy chọn (ví dụ 10 luồng, test 50 mã)
```bash
node index.js -c 10 -n 50
```

### 5. Chạy tốc độ cao (50 luồng)
```bash
npm run fast
# hoặc: node index.js -c 50
```

### 6. Dùng chế độ Dashboard thu gọn 1 dòng (nếu không muốn cuộn màn hình)
```bash
node index.js -c 30 --compact
```

---

## 🖥️ Mẫu Log hiển thị trên Terminal

```text
==================================================================
   TOOL QUÉT BẢN QUYỀN DEVICE ID - VOHOAINAM.NET API   
==================================================================
- Số luồng (Concurrency):  30
- Giới hạn quét:           Không giới hạn (Ctrl+C để dừng)
- Delay mỗi luồng:         0ms
- Chống trùng lặp (RAM):   BẬT (Cam kết 100% không trùng giữa các luồng)
- Lịch sử đã quét (Disk):  Lưu tại checked_history.txt (Đã nạp 2,500 mã cũ)
- Báo Telegram Bot:        BẬT (Chat ID: 8855411031)
- File kết quả:            authorized_devices.txt
- Chế độ log:              Log từng dòng chi tiết (Mã máy, đúng/sai, time, tốc độ luồng)
- API Endpoint:            https://vohoainam.net/api/check-auth?device_id=<device_id>
------------------------------------------------------------------

[19:05:04] [Luồng #01] [1.2 req/s] Mã máy đã test là device_d629e3a9-406c-4de3-9f82-662c088c637f -> [ SAI ] (4438ms)
[19:05:04] [Luồng #02] [1.2 req/s] Mã máy đã test là device_46664e0b-eede-4355-bb2a-ceb8670edabb -> [ SAI ] (4685ms)
[19:05:10] [Luồng #03] [1.5 req/s] Mã máy đã test là device_8f21b712-45e3-4f11-9a22-38d5e16790ab -> [ ĐÚNG ] (120ms)

======================================================================
 [🎉 TÌM THẤY THIẾT BỊ CÓ BẢN QUYỀN HỢP LỆ!] 
- Device ID:     device_8f21b712-45e3-4f11-9a22-38d5e16790ab
- Hết hạn vào:   2026-12-31T23:59:59.000Z
- Key Code:      VIP_PRO
- Thời hạn:      365 ngày
- Đã lưu vào:    authorized_devices.txt & authorized_devices.json
======================================================================
✔ [TELEGRAM] Đã gửi thông báo thành công về Chat ID: 8855411031
```

---

## ⚙️ Bảng tham số dòng lệnh (CLI Options)

| Tham số | Ý nghĩa | Mặc định | Ví dụ |
| :--- | :--- | :--- | :--- |
| `-c`, `--concurrency` | Số luồng chạy song song | `30` | `node index.js -c 20` |
| `-n`, `--limit` | Tổng số thiết bị cần check (0 là chạy liên tục) | `0` | `node index.js -n 1000` |
| `-d`, `--delay` | Thời gian nghỉ giữa các lượt mỗi luồng (ms) | `0` | `node index.js -d 100` |
| `-t`, `--timeout` | Thời gian chờ tối đa cho 1 request (ms) | `20000` | `node index.js -t 15000` |
| `-o`, `--output` | Đường dẫn file txt lưu kết quả hợp lệ | `authorized_devices.txt` | `node index.js -o valid.txt` |
| `--history-file` | Đường dẫn file lưu lịch sử chống trùng lặp | `checked_history.txt` | `node index.js --history-file my_history.txt` |
| `--no-history` | Không lưu lịch sử ra file (chỉ chống trùng trong RAM) | Tắt | `node index.js --no-history` |
| `--clear-history` | Xóa lịch sử cũ và bắt đầu quét lại từ đầu | Tắt | `node index.js --clear-history` |
| `--tg-token` | Token bot Telegram | `8814714783:AAEK...` | `node index.js --tg-token <token>` |
| `--tg-chat` | Chat ID Telegram nhận tin | `8855411031` | `node index.js --tg-chat 8855411031` |
| `--test-tg` | Gửi tin nhắn test Telegram ngay khi bật | Tắt | `node index.js --test-tg` |
| `--no-tg` | Tắt gửi thông báo về Telegram | Gửi bật | `node index.js --no-tg` |
| `--compact` | Chuyển sang dạng dashboard 1 dòng | Tắt (in từng dòng) | `node index.js --compact` |
| `--algo` | Thuật toán tạo UUID (`fast` hoặc `regex`) | `fast` | `node index.js --algo regex` |
| `-h`, `--help` | Hiển thị bảng trợ giúp | - | `node index.js -h` |

---

## 🛑 Dừng chương trình an toàn

Bạn có thể bấm **`Ctrl + C`** bất cứ lúc nào. Tool sẽ hoàn tất các request đang gửi dở, lưu đồng bộ lại file lịch sử và in ra bảng báo cáo tổng kết chi tiết (thời gian chạy, tổng số mã đã test, tổng số mã duy nhất trong Set, tốc độ req/s trung bình, số thiết bị tìm được).
