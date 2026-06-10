# TIN Scan

Mobile-first PWA that:

1. Takes a plate number
2. Looks the TIN up across 4 Google Sheets (auth via service account)
3. Takes the document photo (phone camera)
4. Builds a one-page PDF named `PLATE-TIN-DDMMYYYY-AMOUNT.pdf`
5. Offers Share-to-WhatsApp (Web Share API) or Download

## Configured sheets

| Sheet                                    | Tab           | Plate | TIN |
| ---------------------------------------- | ------------- | ----- | --- |
| NEEMA                                    | `NEEMA`       | B     | I   |
| CUSTOMER TIN AND CARD DATABASE           | `CARD CHANGE` | C     | K   |
| ELEGANSKY TITLE CHANGING TIN             | `Sheet1`      | A     | J   |
| TIN NUMBER CUSTOMER                      | `Sheet1`      | A     | G   |

All 4 are shared with `sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com`.

TIN cleaning: hyphens / spaces / punctuation are stripped; if the result still
contains a letter or isn't exactly 9 digits, the API replies **"TIN is invalid"**.

## Local dev

```bash
npm install
npm run build
node dist/main.js          # opens at http://0.0.0.0:4101
```

Visit `http://<your-pc-lan-ip>:4101` from a phone on the same Wi-Fi.

## Deploy to Render

1. Push this repo to GitHub.
2. In the Render dashboard → New → Blueprint → point at this repo.
3. In the new service's Environment tab, set **`GOOGLE_CREDENTIALS_B64`** to
   the base64 of the service-account JSON:
   ```bash
   base64 -w0 google-service-account.json
   ```
4. Save & deploy.

Once it's up, iPhone users can open the URL in Safari and tap *Share → Add to
Home Screen* to use it like an app.

## Android APK

The PWA can be wrapped into an APK with [PWA Builder](https://www.pwabuilder.com)
once it's deployed: paste the Render URL, click *Package for Stores → Android*,
then share the resulting `.apk` via WhatsApp.
