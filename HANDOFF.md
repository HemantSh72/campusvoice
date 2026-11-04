# CampusVoice — Deployment Handoff

## 1. Environment variables to configure

Set local values in an untracked `.env.local`. Set production values in **Vercel → Project → Settings → Environment Variables**. Never commit the actual secrets.

| Variable | Required for | Where to get/set it |
|---|---|---|
| `GEMINI_API_KEY` | Gemini parsing | Create at [Google AI Studio](https://aistudio.google.com/app/apikey). |
| `GEMINI_MODEL_CHAIN` | Select ordered Gemini models | Comma-separated model IDs. Default: `gemini-3.1-flash-lite,gemini-3.5-flash-lite`. Confirm availability with `npm run smoke`. |
| `GEMMA_MODEL` | Optional Gemma fallback | Exact API model ID from the smoke check's models.list output. Leave empty to skip Gemma. |
| `LLM_DAILY_CAP_PER_MODEL` | Gemini quota guard | Default 450 requests/model/UTC day. |
| `GEMMA_DAILY_CAP_PER_MODEL` | Gemma quota guard | Default 5000 requests/model/UTC day. |
| `MONGODB_URI` | Production ticket storage | MongoDB Atlas → Cluster → Connect → Drivers → Node.js connection string. Create a database user and configure network access. |
| `MONGODB_DB` | Database name | Use `campusvoice` unless you choose another name. |
| `TELEGRAM_BOT_TOKEN` | Real alert delivery | Create a bot with [@BotFather](https://t.me/BotFather); copy its token privately. |
| `TELEGRAM_CHAT_ID` | Alert destination | Add the bot as an administrator with post permission in the channel; use `@channelname` or numeric chat ID. |
| `ADMIN_PIN` | Resolve tickets | Choose a private PIN. This is a shared demo admin credential. |
| `RATE_LIMIT_PER_MIN` | Abuse control | Default 40 requests/IP/fixed minute. |
| `RATE_LIMIT_PER_DAY` | Abuse control | Default 1000 requests/IP/fixed UTC day. |
| `VITE_TELEGRAM_CHANNEL_URL` | Public UI link | Public Telegram channel URL only; never place a bot token here. |

For local setup, copy `.env.example` to `.env.local`. Keep `.env.local` out of Git.

## 2. Commands

```bash
npm install
npm test
npm run build
npm run dev
```

Open `http://localhost:3000`.

Optional checks:

```bash
npm run seed
npm run smoke
BASE_URL=https://your-project.vercel.app npm run test:remote
```

Windows PowerShell remote check:

```powershell
$env:BASE_URL = "https://your-project.vercel.app"
npm run test:remote
```

## 3. Manual test checklist

- [ ] Open the deployed HTTPS URL in Chrome on a phone and a laptop.
- [ ] Confirm the status strip shows the expected Gemini, MongoDB and Telegram states.
- [ ] Deny microphone permission; confirm the UI explains the issue and typed input remains usable.
- [ ] Allow microphone permission; say “WiFi is not working in hostel block B”.
- [ ] Confirm a ticket number, department, priority and SLA are returned.
- [ ] Confirm the ticket appears in the dashboard after refresh.
- [ ] Confirm Telegram receives one alert and the ticket shows `sent`.
- [ ] Report “WiFi is not working” without a location; confirm the app asks where and starts listening again after speaking the question.
- [ ] Answer “Hostel block B”; confirm the ticket is created with that location and the parsedBy field is rules-followup in the API response.
- [ ] Ask “What is the status of ticket N?” using a real ticket number.
- [ ] Ask for a nonexistent ticket number; confirm a friendly not-found response.
- [ ] Tap an example chip; confirm it submits as text.
- [ ] Resolve an open ticket with the correct admin PIN; confirm it changes to resolved.
- [ ] Try an incorrect PIN; confirm the ticket is not resolved.
- [ ] Reload the page and confirm MongoDB-backed tickets remain visible.
- [ ] Open the page in a browser without Web Speech support; confirm typed submission still works.
- [ ] Use a narrow mobile viewport; confirm the mic, typed input, status strip and dashboard fit.
- [ ] Temporarily remove the Telegram configuration in a test environment; confirm ticket creation still succeeds and alert status is `not_configured`.
- [ ] In a staging environment only, test missing/unreachable MongoDB in production mode; health must report `db: "down"` and ticket submission must return 503, never memory-backed success.

## 4. Operational notes and known risks

- Web Speech recognition and SpeechSynthesis are browser capabilities, not server integrations. Browser/device support and microphone permissions vary.
- Gemini model availability and free quotas are account-specific and may change. Run `npm run smoke` after adding the key; choose only model IDs actually returned by models.list.
- The Gemini model chain uses per-model UTC daily caps. Quota responses trip a 60-second breaker; three quota failures in ten minutes trip the model for the rest of the UTC day.
- MongoDB is mandatory in production. Local in-memory storage is intentionally not a production fallback.
- The smoke test increments the `ticketNumber` counter and therefore consumes one sequence number in the target database.
- Telegram alerts are awaited before the voice API responds. A Telegram failure is recorded but does not undo a ticket.
- Public dashboard data includes issue summaries and locations. Ask students not to submit sensitive personal details.
- Admin PIN is a shared secret suitable only for the hackathon demo. It is not a user-account system.
- No live Gemini, Atlas, Telegram or browser microphone test is considered verified until you run the relevant smoke/manual checks with your own credentials and devices.
- Do not use this demo for emergencies.

## 5. Requirement-to-file checklist (brief sections 1–12)

| Section | Implementation files | Status |
|---|---|---|
| 1. Product and hackathon rules | `src/App.jsx`, `src/hooks/useSpeechRecognition.js`, `src/hooks/useTTS.js`, `server/routes/voice.js`, `server/services/tickets.js`, `server/services/telegram.js` | Implemented; live integrations require credentials and browser support. |
| 2. Fixed tech stack | `package.json`, `vite.config.js`, `server/app.js`, `api/index.js`, `vercel.json` | Implemented. |
| 3. Repository structure | `src/`, `server/`, `api/index.js`, `tests/`, `scripts/seed.js`, `README.md`, `HANDOFF.md`, `.env.example` | Implemented. |
| 4. Environment variables | `server/config.js`, `.env.example`, `README.md`, `HANDOFF.md` | Implemented; create your private `.env.local` and Vercel variables. |
| 5. API contracts | `server/routes/voice.js`, `server/routes/tickets.js`, `server/routes/health.js`, `server/validate.js`, `server/services/tickets.js` | Implemented; verify remote behavior with `npm run test:remote`. |
| 6. Domain rules | `server/validate.js`, `server/services/fallbackParser.js`, `server/services/llm.js`, `server/services/tickets.js` | Implemented. |
| 7. LLM layer | `server/services/llm.js`, `server/services/llmState.js`, `server/services/budget.js`, `server/services/fallbackParser.js`, `tests/llm.test.js`, `tests/llmState.test.js` | Implemented; model IDs/quotas must be confirmed with your API key. |
| 8. Data model and persistence | `server/db.js`, `server/services/tickets.js` | Implemented; production Atlas connection must be configured. |
| 9. Abuse and security | `server/app.js`, `server/services/rateLimit.js`, `server/routes/tickets.js`, `server/validate.js`, `server/services/telegram.js` | Implemented for hackathon scope; admin PIN is not a full authentication system. |
| 10. Frontend | `src/App.jsx`, `src/hooks/useSpeechRecognition.js`, `src/hooks/useTTS.js`, `src/index.css` | Implemented; test actual browsers/devices. |
| 11. Tests | `tests/fallbackParser.test.js`, `tests/validators.test.js`, `tests/llm.test.js`, `tests/llmState.test.js`, `tests/api.integration.test.js`, `tests/api.remote.test.js` | Implemented in repository; execution status must be established by running the commands. |
| 12. Phases and delivery | `README.md`, `HANDOFF.md`, `scripts/seed.js`, `scripts/smoke.js`, `package.json` | Deliverables present; live credentialed smoke and deployment are not performed here. |

### Explicitly not verified in this handoff

- Actual Gemini API access, exact model availability, per-account free-tier quota, and response quality.
- MongoDB Atlas network access, credentials, index creation on your target cluster, and persistence after deployment.
- Telegram bot permissions, target channel ID, and successful message delivery.
- Microphone permission and speech behavior on the judges' phones/laptops.
- Vercel deployment and public URL behavior.
