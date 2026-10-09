# Hotel PMS Backend
Node + Express + MongoDB. Setup/run steps ke liye ../README.md dekho.

Structure (naya part)
- `src/services/storeService.js` – tenant-wise key/value store + booking merge logic
- `src/services/accountService.js` – Setup > Users ki list se login accounts sync
- `src/routes/{session,store,public,ai,ocr,superAdmin}Routes.js`
- `src/models/{Tenant,StoreEntry,Account}.js`
