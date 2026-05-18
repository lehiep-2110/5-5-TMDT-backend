# Agent A E2E Report

Run started: 2026-04-25T05:40:46.936Z
Run finished: 2026-04-25T05:40:50.903Z
Duration: 3967 ms
Result: 29 passed / 0 failed

| Test | Status | Duration (ms) |
| --- | --- | --- |
| agentA-auth (UC-01, UC-02) :: UC-01 register-happy: register -> verify-email via /tmp/be.log token | pass | 226 |
| agentA-auth (UC-01, UC-02) :: UC-01 register-duplicate: 2nd registration with same email -> 409 | pass | 74 |
| agentA-auth (UC-01, UC-02) :: UC-01 register-weak-password: weak password -> 400 with field error | pass | 2 |
| agentA-auth (UC-01, UC-02) :: UC-02 login-happy: returns access token + role=CUSTOMER | pass | 151 |
| agentA-auth (UC-01, UC-02) :: UC-02 login-wrong-password: 401 generic message | pass | 220 |
| agentA-auth (UC-01, UC-02) :: UC-02 login-lockout: 5 wrong attempts trigger lock; admin unlocks | pass | 590 |
| agentA-auth (UC-01, UC-02) :: UC-02 logout-revokes-refresh: refresh works once, fails after logout | pass | 164 |
| agentA-users (UC-08, UC-11, UC-15) :: UC-08 get-me: returns id, email, role for current user | pass | 152 |
| agentA-users (UC-08, UC-11, UC-15) :: UC-08 patch-me: change phone reflects on next GET | pass | 156 |
| agentA-users (UC-08, UC-11, UC-15) :: UC-08 address-crud: create 2, default toggles, delete migrates default | pass | 174 |
| agentA-users (UC-08, UC-11, UC-15) :: UC-08 address-max-5: 6th address rejected with 400 | pass | 204 |
| agentA-users (UC-08, UC-11, UC-15) :: UC-08 change-password: old fails after change, new works | pass | 441 |
| agentA-users (UC-08, UC-11, UC-15) :: UC-11 admin-login: role=ADMIN; can list /admin/users; customer cannot | pass | 145 |
| agentA-users (UC-08, UC-11, UC-15) :: UC-11 staff-login: role=WAREHOUSE_STAFF | pass | 73 |
| agentA-users (UC-08, UC-11, UC-15) :: UC-15 lock-customer: PATCH status=LOCKED revokes refresh tokens | pass | 234 |
| agentA-catalog (UC-03, UC-12, UC-13) :: UC-03 public-search-keyword: keyword=Kim returns matching books | pass | 19 |
| agentA-catalog (UC-03, UC-12, UC-13) :: UC-03 public-search-category: items respect category subtree | pass | 7 |
| agentA-catalog (UC-03, UC-12, UC-13) :: UC-03 public-pagination: page1 vs page2, total stable | pass | 8 |
| agentA-catalog (UC-03, UC-12, UC-13) :: UC-03 book-detail-by-slug: detail has authors[], breadcrumb, images[] | pass | 6 |
| agentA-catalog (UC-03, UC-12, UC-13) :: UC-12 admin-create-book + slug uniqueness (suffix on duplicate title) | pass | 101 |
| agentA-catalog (UC-03, UC-12, UC-13) :: UC-12 admin-create-book-isbn-validation: short ISBN -> 400 | pass | 78 |
| agentA-catalog (UC-03, UC-12, UC-13) :: UC-12 admin-update-price -> price_history and new price reflected | pass | 94 |
| agentA-catalog (UC-03, UC-12, UC-13) :: UC-13 admin-categories-tree: GET /categories returns a tree | pass | 1 |
| agentA-catalog (UC-03, UC-12, UC-13) :: UC-13 admin-cannot-delete-cat-with-books: 409 with VN message | pass | 78 |
| agentA-inventory (UC-19) :: UC-19 inventory-list: paginated list with stockQuantity field | pass | 75 |
| agentA-inventory (UC-19) :: UC-19 inventory-low-stock-filter: lowStockOnly=true returns books below threshold | pass | 101 |
| agentA-inventory (UC-19) :: UC-19 restock: admin POST /inventory/:id/restock writes stock_logs (PURCHASE) | pass | 89 |
| agentA-inventory (UC-19) :: UC-19 restock-customer-403: customers cannot restock | pass | 148 |
| agentA-inventory (UC-19) :: UC-19 restock-staff-201: staff token can restock | pass | 154 |