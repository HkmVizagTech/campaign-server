# ISKCON Vizag Server

Backend API for the ISKCON Vizag campaign and donation platform. This service powers the public campaign experience, the admin dashboard, campaigner onboarding, donation tracking, receipt generation, and payment lifecycle handling used by the client app in `iskcon-vizag-client/iskcon-vizag`.

## What This Server Does

- Manages fundraising campaigns and campaigners
- Supports admin and devotee authentication with JWT
- Creates donation orders through Razorpay
- Verifies successful payments through both direct verification and Razorpay webhooks
- Stores donor, payment, seva, media, and devotee data in MongoDB
- Uploads campaigner images to Google Cloud Storage
- Generates downloadable PDF receipts from a template
- Sends WhatsApp notifications for onboarding, donation alerts, and receipts
- Pushes donation data to the external DCC API after successful payment capture

## Tech Stack

- Node.js
- Express 5
- MongoDB with Mongoose
- Razorpay
- Google Cloud Storage
- JWT authentication
- Multer + Sharp for image uploads
- `pdf-lib` for receipt generation
- Axios/FormData for external integrations

## Repository Context

This repository has two main apps:

- `iskcon-vizag-server`: this backend API
- `iskcon-vizag-client/iskcon-vizag`: the Vite/React frontend

The frontend `.env.example` points to:

```env
VITE_APP_BASE_URL=http://localhost:2345/api
```

So during local development, the server is expected to run on port `2345` by default.

## Project Structure

```text
iskcon-vizag-server/
├── app.js                  # Express app setup, CORS, routes, health check
├── server.js               # Loads env, connects DB, starts server
├── config/                 # MongoDB, Razorpay, GCS config
├── controllers/            # Thin HTTP controllers
├── services/               # Main business logic
├── models/                 # Mongoose schemas
├── middlewares/            # Auth, role checks, upload validation
├── routes/                 # API route definitions
├── scripts/                # Manual maintenance and recovery scripts
├── utils/                  # Response helpers, GCS upload, DCC integration
├── assets/receipt/         # Logo and seal drawn on generated receipts
├── Dockerfile
└── cloudbuild.yaml
```

## Core Domain Models

- `Campaign`: fundraiser metadata, target amount, raised amount, active/upcoming/closed status
- `Campaigner`: fundraiser participant tied to a campaign and a temple devotee
- `Donation`: donor details, amount, payment state, PAN, address, seva, receipt info
- `Payment`: Razorpay order/payment mapping and raw gateway payloads
- `TempleDevote`: devotee/preacher record mapped to a login account
- `Register`: login identity for `admin` and `devotee`
- `Seva`: donation-related seva categories, codes, amounts, and points
- `Media`: reusable uploaded image metadata

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values.

```env
DB_URL="mongodb://localhost:27017/data"
PORT=2345

GCS_PROJECT_ID=""
GCS_BUCKET_NAME=""
GCS_CREDENTIALS=''

RAZORPAY_API_KEY=""
RAZORPAY_KEY_SECRET=""
RAZORPAY_WEBHOOK_SECRET=""

JWT_SECRET=""

FLAXXA_TOKEN=""

DCC_API_KEY=""
DCC_API=""
```

### Variable Notes

- `DB_URL`: MongoDB connection string
- `PORT`: API port; frontend expects `2345` locally
- `GCS_PROJECT_ID`: Google Cloud project id
- `GCS_BUCKET_NAME`: bucket used for campaigner image storage
- `GCS_CREDENTIALS`: stringified service account JSON; the code parses this value and restores newlines in `private_key`
- `RAZORPAY_API_KEY`: public Razorpay key returned to the client when creating donation orders
- `RAZORPAY_KEY_SECRET`: server-side Razorpay secret for signature verification
- `RAZORPAY_WEBHOOK_SECRET`: used to validate `/api/webhooks/razorpay`
- `JWT_SECRET`: signs and verifies auth tokens
- `FLAXXA_TOKEN`: token for WhatsApp template message delivery
- `DCC_API_KEY`: auth key for the downstream DCC API
- `DCC_API`: endpoint that receives donation payloads after successful payment capture

## Installation

```bash
cd iskcon-vizag-server
npm install
cp .env.example .env
```

Update `.env`, then start the server:

```bash
npm run dev
```

For production-style startup:

```bash
npm start
```

## Running Locally

1. Start MongoDB and make sure `DB_URL` is reachable.
2. Create `iskcon-vizag-server/.env` from `.env.example`.
3. Fill in Razorpay, JWT, GCS, WhatsApp, and DCC values.
4. Start the backend with `npm run dev`.
5. Start the frontend separately from `iskcon-vizag-client/iskcon-vizag`.

Once running:

- API base URL: `http://localhost:2345/api`
- Health endpoint: `http://localhost:2345/health`

## Maintenance Scripts

The `scripts/` folder is for manual operational utilities that help recover or repair payment-related flows without changing the main API code path.

### Verify All Pending Donations with Razorpay

Checks every pending online donation (older than 30 minutes) against every
Razorpay order made for it, including orders found by the donation id as the
order receipt. Also available as **Admin → Reconcile Donations → Verify
pending payments with Razorpay**.

```bash
npm run reconcile:pending                       # report only, changes nothing
npm run reconcile:pending -- --apply            # settle the clear cases
npm run reconcile:pending -- --apply --include-failed
```

| Razorpay shows | Result |
| --- | --- |
| exactly one captured payment for the full amount, not refunded | success via the normal capture flow (live re-check, totals credited once, DCC + receipt + WhatsApp) |
| every attempt failed | marked failed; no receipt, WhatsApp or DCC |
| no attempt, authorized only, amount mismatch, refund, two captures, API error | left unchanged and listed for manual review |

`--include-failed` also re-checks failed donations; one is only ever moved to
success, when Razorpay shows it was paid. Applying runs one donation at a
time and is safe to re-run. Each run writes a CSV report to `tmp/` (contains
donor details; not committed). Options: `--limit`, `--min-age <minutes>`,
`--once`. Needs `DB_URL`, `RAZORPAY_API_KEY`, `RAZORPAY_KEY_SECRET` and the
usual DCC/WhatsApp variables.

### Reconcile a Captured Donation

Use this when Razorpay shows a payment as captured, but the server did not fully finish the post-payment flow. For example:

- the donation is still `pending` in MongoDB
- the payment was captured but DCC sync did not complete
- the receipt number was not saved
- the WhatsApp/receipt flow did not run because capture processing was interrupted

Run from the server folder:

```bash
cd iskcon-vizag-server
npm run reconcile:donation -- <donationId> [razorpayPaymentId]
```

Examples:

```bash
npm run reconcile:donation -- 680d0f6b2b1c123456789abc
npm run reconcile:donation -- 680d0f6b2b1c123456789abc pay_Qwerty123456
```

What this script does:

- loads `.env`
- connects to MongoDB
- finds the donation and linked payment record
- fetches payments for the Razorpay order
- picks the latest captured payment, or uses the optional payment id you pass
- re-runs the normal capture flow used by the app
- updates donation/payment status and retries DCC sync and receipt/notification work

Required environment variables:

- `DB_URL`
- `RAZORPAY_API_KEY`
- `RAZORPAY_KEY_SECRET`

Notes:

- `donationId` is required and must be a valid MongoDB ObjectId
- `razorpayPaymentId` is optional, and is useful if the order has multiple payment attempts
- the script prints a JSON summary with the updated donation and payment state

## Authentication and Roles

The server uses Bearer tokens in the `Authorization` header.

- `admin`: full access across campaigns, sevas, devotees, campaigners, dashboard, and donor management
- `devotee`: limited operational access focused on their assigned campaigners and dashboard data

Relevant middleware:

- `verifyToken`: requires a valid JWT
- `optionalAuth`: attaches user info when a token is present but does not block anonymous access
- `onlyAdmin`: admin-only routes
- `authorizeRole("admin", "devotee")`: shared protected routes

## API Overview

All routes below are mounted from `app.js`.

### Health

- `GET /health` - simple service health check

### Auth

- `POST /api/register` - create a user;
- `POST /api/login` - authenticate and receive JWT
- `GET /api` - fetch current logged-in admin/devotee details
- `POST /api/reset-password` - change password for the authenticated user

### Campaigns

- `POST /api/campaign` - create a campaign
- `GET /api/campaign?status=active` - get current campaign by status
- `GET /api/campaign/all-campagins` - paginated campaign list for authenticated admin/devotee users
- `GET /api/campaign/:id` - single campaign details
- `PATCH /api/campaign/:id` - update campaign
- `DELETE /api/campaign/:id` - delete campaign if no funds have been raised

### Campaigners

- `POST /api/campaigner` - create/register a campaigner, optionally with image upload
- `GET /api/campaigner/topdonors/:campaignId` - top donors for a campaign
- `GET /api/campaigner/latestDonors/:campaignId/:slug` - latest donors for a campaigner
- `GET /api/campaigner/details/:slugId` - public campaigner detail page data
- `POST /api/campaigner/resend-links` - admin: WhatsApp every approved campaigner their page link again (approval template); body `{ campaignId?, dryRun? }`
- `GET /api/campaigner/:campaignId` - public campaigner list by campaign
- `GET /api/campaigner/admin/:campaignId` - admin/devotee campaigner list with optional auth context
- `PATCH /api/campaigner/:id` - update campaigner
- `DELETE /api/campaigner/:id` - delete campaigner

Notes:

- Campaigner image upload uses `multipart/form-data` with `image`
- Allowed image types: JPG, PNG, WEBP
- Max upload size: 5 MB
- Anonymous/public campaigner creation is possible, but status defaults to `pending`
- Admin/devotee-created campaigners are auto-marked `active`

### Donations

- `POST /api/donations/create-order` - create a pending donation and Razorpay order
- `GET /api/donations` - donor list for admin/devotee users
- `GET /api/donations/:donationId` - donor detail by donation id

Important donation fields supported in the code:

- `donorName`
- `donorPhone`
- `amount`
- `campaignId`
- `slug`
- `email`
- `isAnonymous`
- `pan`
- `sevaId`
- `address`
- `prasadam`

### Payments

- `POST /api/payment/verify` - verifies Razorpay payment signature after client checkout flow

### Webhooks

- `POST /api/webhooks/razorpay` - consumes Razorpay webhook events using raw body signature validation

Handled events:

- `payment.captured`
- `payment.failed`

### Receipts

- `GET /api/receipt/:id` - download PDF receipt for a donation

### Seva

- `POST /api/seva/add` - create seva entry
- `GET /api/seva` - list sevas
- `GET /api/seva/:sevaId` - get a single seva
- `PUT /api/seva/:sevaId` - update seva
- `DELETE /api/seva/:sevaId` - delete seva

### Temple Devotees

- `POST /api/devote` - create devotee and linked `devotee` login
- `GET /api/devote` - list devotees
- `GET /api/devote/:id` - single devotee details
- `PATCH /api/devote/:id` - update devotee
- `DELETE /api/devote/:id` - delete devotee if no campaigners are assigned

### Dashboard

- `GET /api/dashboard/summary` - dashboard cards for admin/devotee
- `GET /api/dashboard/donation-trend` - 7-day donation trend for admin/devotee

### Media

- `GET /api/media` - list stored media records

## Payment Flow

The donation/payment lifecycle in the current code is:

1. Client calls `POST /api/donations/create-order`
2. Server creates a pending `Donation`
3. Server creates a Razorpay order and stores a `Payment` document
4. Client completes Razorpay checkout
5. Server confirms payment either through:
   - `POST /api/payment/verify`, or
   - `POST /api/webhooks/razorpay`
6. On successful capture the server:
   - marks donation as `success`
   - stores gateway ids and raw payment data
   - increments campaign and campaigner raised totals
   - sends donation data to the DCC API
   - triggers WhatsApp notifications
   - enables receipt download

## File Upload and Media Handling

- Uploads are stored in memory using Multer
- Images are compressed and resized with Sharp before upload
- Files are uploaded to Google Cloud Storage
- Public image URLs are saved in the `Media` and `Campaigner` records

## Receipt Generation

Receipts are drawn with `pdf-lib` (`services/receipt.service.js`) in the same
layout DCC uses for its receipts: A4, Helvetica, with the logo and seal from
`assets/receipt/`. Names in other scripts fall back to the Unicode font in
`assets/fonts/` (subset, so only the glyphs used are embedded).

The receipt shows:

- DR number (DCC receipt number), date and patronship number
- donor name, address, mobile, email (`DEFAULT_DONOR_EMAIL` when blank) and PAN / 80G flag
- Sevak Name: the person the donation is made in honour of, if any
- amount and amount in words (Indian numbering)
- payment mode, gateway payment id / UPI reference and transaction date
- enrolled-by / CDC short form and the seva it goes towards

## External Integrations

### Razorpay

Used for:

- order creation
- payment signature verification
- webhook processing

### Google Cloud Storage

Used for:

- campaigner image storage

### Flaxxa WhatsApp API

Used for:

- campaigner onboarding messages
- donation notifications
- receipt delivery

### DCC API

Used for:

- forwarding successful donation data and storing returned receipt metadata

## Deployment Files

The repo already includes:

- `Dockerfile`
- `cloudbuild.yaml`

These indicate the service is intended to be containerized and deployable through Google Cloud Build or a similar container workflow.

## Response Shape

Most JSON responses follow a common helper format:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Some message",
  "data": {}
}
```

## CORS Configuration

The server currently allows requests from:

- `http://localhost:5173`
- `https://iskcon-campaginer-vizag-client.vercel.app`
- `https://campaigns.harekrishnavizag.org`

If you add a new frontend domain, update the `allowedOrigin` array in `app.js`.

## Known Implementation Notes

- There is no automated test suite configured yet; `npm test` currently exits with a placeholder error.
- `POST /api/campaign` is currently not protected in `routes/campaign.route.js`, so access control for campaign creation may need review.
- `POST /api/register` accepts `role` from the request header, which is flexible for setup but should be protected carefully in production environments.
- The GCS credentials are expected as a JSON string in a single environment variable, not as a file path.

## Useful Local Checks

```bash
curl http://localhost:2345/health
```

```bash
curl -X POST http://localhost:2345/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}'
```

## Scripts

```bash
npm run dev     # start with nodemon
npm start       # start with node
```
