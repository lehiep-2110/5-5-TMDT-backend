# Agent C E2E Report

Run timestamp: 2026-04-25T05:44:43.938Z
Total: 33/33 passed (0 failed) in 3182 ms

| Suite | Test | Status | Duration (ms) |
|---|---|---|---|
| UC-07 Reviews | UC-07 cannot-review-non-delivered | PASS | 236 |
| UC-07 Reviews | UC-07 review-happy-201 | PASS | 215 |
| UC-07 Reviews | UC-07 review-recomputes-book-rating-and-count | PASS | 2 |
| UC-07 Reviews | UC-07 cannot-review-twice | PASS | 2 |
| UC-07 Reviews | UC-07 review-update-within-48h | PASS | 6 |
| UC-07 Reviews | UC-07 admin-hide-review-decrements-public-count | PASS | 83 |
| UC-07 Reviews | UC-07 public-list-reviews-by-slug | PASS | 6 |
| UC-07 Reviews | UC-07 me-reviews-customer-can-list-own | PASS | 77 |
| UC-09 Wishlist | UC-09 toggle-add-returns-wishlisted-true | PASS | 93 |
| UC-09 Wishlist | UC-09 toggle-remove-returns-wishlisted-false | PASS | 95 |
| UC-09 Wishlist | UC-09 list-after-add-two-books | PASS | 101 |
| UC-09 Wishlist | UC-09 ids-endpoint-returns-bookIds | PASS | 74 |
| UC-09 Wishlist | UC-09 delete-explicit-removes-item | PASS | 80 |
| UC-09 Wishlist | UC-09 customer-only-admin-token-forbidden | PASS | 79 |
| UC-09 Wishlist | UC-09 max-100-limit-enforced (skipped if <=100 books seeded) | PASS | 4 |
| UC-10/UC-18 Notifications | UC-10 unread-count-baseline | PASS | 73 |
| UC-10/UC-18 Notifications | UC-18 admin-broadcast-target-all | PASS | 168 |
| UC-10/UC-18 Notifications | UC-18 admin-broadcast-targeted | PASS | 144 |
| UC-10/UC-18 Notifications | UC-10 mark-read-decrements-unread | PASS | 81 |
| UC-10/UC-18 Notifications | UC-10 mark-all-read-zeroes-unread | PASS | 74 |
| UC-10/UC-18 Notifications | UC-10 sse-stream-headers-and-first-chunk | PASS | 74 |
| UC-10/UC-18 Notifications | UC-10 sse-receives-broadcast | PASS | 452 |
| UC-10/UC-18 Notifications | UC-10 sse-bad-token-401 | PASS | 1 |
| UC-17 Reports | UC-17 overview-shape (period=month) | PASS | 87 |
| UC-17 Reports | UC-17 overview-period-week | PASS | 110 |
| UC-17 Reports | UC-17 revenue-series-densified-day | PASS | 116 |
| UC-17 Reports | UC-17 revenue-series-week-granularity | PASS | 111 |
| UC-17 Reports | UC-17 top-products-limit-3 | PASS | 81 |
| UC-17 Reports | UC-17 recent-orders-limit-5 | PASS | 77 |
| UC-17 Reports | UC-17 low-stock-threshold-200 | PASS | 82 |
| UC-17 Reports | UC-17 inventory-summary-shape | PASS | 73 |
| UC-17 Reports | UC-17 export-csv-revenue | PASS | 76 |
| UC-17 Reports | UC-17 non-admin-403 (staff and customer) | PASS | 145 |
