# Mô tả chức năng đã làm được trong folder `be`

Backend được xây dựng bằng **NestJS + TypeORM + PostgreSQL + Redis**, cấu hình tại [src/app.module.ts](src/app.module.ts), chạy với prefix `/api` (port mặc định 8001), hỗ trợ CORS, cookie parser, global validation pipe, static serve `/uploads`, interceptor chuẩn hoá response và filter lỗi HTTP.

## 1. Auth — [src/modules/auth](src/modules/auth/)

Controller: [auth.controller.ts](src/modules/auth/auth.controller.ts)

- `POST /api/auth/register` — đăng ký tài khoản, gửi email xác thực (mock).
- `GET  /api/auth/verify-email?token=...` — xác thực email bằng token.
- `POST /api/auth/resend-verification` — gửi lại link xác thực.
- `POST /api/auth/login` — đăng nhập, trả `accessToken` và set `refreshToken` vào httpOnly cookie.
- `POST /api/auth/refresh` — cấp access token mới, xoay refresh token.
- `POST /api/auth/logout` — thu hồi refresh token.
- `GET  /api/auth/me` — lấy thông tin user hiện tại.

Phân quyền qua `JwtAuthGuard` + `RolesGuard`, 3 role: `CUSTOMER`, `ADMIN`, `WAREHOUSE_STAFF` ([user-role.enum.ts](src/common/enums/user-role.enum.ts)).

## 2. Users — [src/modules/users](src/modules/users/)

- **Khách hàng** [users.controller.ts](src/modules/users/users.controller.ts) (`/api/users/me`): xem/cập nhật hồ sơ, đổi mật khẩu, CRUD địa chỉ giao hàng.
- **Admin** [admin-users.controller.ts](src/modules/users/admin-users.controller.ts) (`/api/admin/users`): liệt kê, xem chi tiết, cập nhật trạng thái (khoá/mở) người dùng.

## 3. Catalog — [src/modules/catalog](src/modules/catalog/)

**Public**: [public-books.controller.ts](src/modules/catalog/controllers/public-books.controller.ts), tương tự cho authors/publishers/categories — list + xem chi tiết theo slug, có filter/phân trang ([query-books.dto.ts](src/modules/catalog/dto/query-books.dto.ts)).

**Admin CRUD** sách/tác giả/nhà xuất bản/danh mục với upload ảnh qua Multer ([admin-books.controller.ts](src/modules/catalog/controllers/admin-books.controller.ts), [multer.util.ts](src/modules/catalog/utils/multer.util.ts)): tạo/sửa sách kèm ảnh (tối đa 5), soft-delete chuyển sách sang `INACTIVE`.

**Kho**: [inventory.controller.ts](src/modules/catalog/controllers/inventory.controller.ts) (`/api/inventory`, cho ADMIN + WAREHOUSE_STAFF): xem tồn kho, xem lịch sử `stock_log`, `POST :bookId/restock` để nhập hàng.

## 4. Cart — [src/modules/cart](src/modules/cart/)

[cart.controller.ts](src/modules/cart/cart.controller.ts): lấy giỏ, thêm / cập nhật số lượng / xoá item, xoá toàn bộ giỏ (mọi endpoint đều yêu cầu đăng nhập).

## 5. Orders — [src/modules/orders](src/modules/orders/)

- **Khách hàng** [customer-orders.controller.ts](src/modules/orders/controllers/customer-orders.controller.ts): tạo đơn (checkout COD), liệt kê đơn của mình, xem chi tiết, huỷ đơn khi còn PENDING/CONFIRMED.
- **Nhân viên kho** [staff-orders.controller.ts](src/modules/orders/controllers/staff-orders.controller.ts): xem đơn cần xử lý, xác nhận đóng gói (`CONFIRMED → PROCESSING`).
- **Admin** [admin-orders.controller.ts](src/modules/orders/controllers/admin-orders.controller.ts): tìm kiếm/lọc theo trạng thái/ngày/keyword, chuyển trạng thái đơn, đánh dấu thu tiền COD (`PAID`).

State machine tại [order-state.service.ts](src/modules/orders/services/order-state.service.ts): `PENDING → CONFIRMED → PROCESSING → SHIPPING → DELIVERED → COMPLETED`, với rule quyền theo role.

[orders.service.ts](src/modules/orders/services/orders.service.ts) xử lý checkout trong transaction: khoá `pessimistic_write` trên sách, kiểm tra tồn kho, snapshot giá + tên sách vào `order_items`, trừ kho, ghi `stock_log`, sinh `orderCode` kiểu `ORD2026000001`, xoá giỏ hàng, ghi `order_status_log`, gửi email xác nhận (mock) sau commit. Huỷ đơn sẽ hoàn kho và chuyển `paymentStatus` → `REFUND_PENDING` nếu đã thanh toán.

## 6. Hạ tầng chung

- **Database** [src/database/entities](src/database/entities/): 25 entity (users, books, authors, publishers, categories, cart_items, orders, order_items, order_status_log, payments, refunds, reviews, review_images, stock_log, vouchers, voucher_usages, wishlist, notifications, refresh_tokens, email_verification_tokens, addresses, price_history, …), có folder [migrations](src/database/migrations/) và [seeds](src/database/seeds/).
- **Mocks** [src/modules/mocks](src/modules/mocks/): `EmailService` (gửi email xác thực/đơn hàng) và `ShippingService` (tính phí vận chuyển) được khai báo `@Global` để dùng chung.
- **Redis** [redis.module.ts](src/config/redis.module.ts) — client Redis global sẵn sàng cho cache/token.
- **Common**: decorator `@CurrentUser`, `@Roles`; guard `JwtAuthGuard`, `RolesGuard`; interceptor chuẩn hoá response; filter bắt `HttpException`; các enum (trạng thái đơn, thanh toán, sách, voucher, …).
- **Upload tĩnh**: ảnh sách lưu tại [uploads/](uploads/) và phục vụ qua `/uploads/*`.

## Tổng kết

Hiện backend đã hoàn thiện MVP cho:

- Xác thực và quản lý người dùng (register, verify email, login, refresh, logout, quản trị user).
- Catalog sách / tác giả / nhà xuất bản / danh mục (public + admin CRUD, upload ảnh).
- Quản lý tồn kho (xem, nhập hàng, lịch sử stock_log).
- Giỏ hàng và luồng đặt hàng COD end-to-end với state machine và phân quyền `ADMIN` / `WAREHOUSE_STAFF` / `CUSTOMER`.
