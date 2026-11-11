# Put the Hired Hands site online (pilot, Microsoft sign-in)

This puts the platform on the internet as a **pilot**: HHMC's managers use it with real jobs and
sign in with their **SAI Microsoft 365 account**. Nobody else can get in.

What "pilot" means (`docs/DECISIONS.md`, P5-31):

- **Sign-in:** only with an SAI Microsoft account, and only for people who have been given access.
  There is no password of our own and no test login.
- **Your real jobs:** the live side starts **empty**, ready for real jobs. No deploy ever erases
  it.
- **Practice data:** **Test mode** (switch at the top right) has fake practice moves for
  learning the app.
- **Not live yet (on purpose):** no email reaches a customer, and cards can't be charged. Cash
  and check can be recorded. A blue **PILOT** bar on every page says so. The steps to go fully
  live are listed at the end.

It uses three services, all free to start:

- **Neon**: the database
- **Vercel**: runs the app
- **Microsoft Entra**: SAI's Microsoft 365 sign-in

It takes about 30 minutes. You need to be able to sign in to SAI's Microsoft 365 admin
(Entra) to register the app. If you can't, ask whoever manages SAI's Microsoft 365.

> **Free plans, for now.** Vercel's free plan is for non-commercial use, and free databases have
> limited backups. That's acceptable for a short pilot. Upgrade both before the site replaces
> Movegistics (see "Going fully live").

## Before you start: write two things down

1. **Who may sign in.** One line, people separated by `;`, each `email|Full name|role`. The email
   must be the exact address the person signs in to Microsoft with. Roles:
   - `cto`: you; everything.
   - `gm`: HHMC general manager; can add more people later.
   - `staff`: can run every step of a move.
   - `tech`: the tech team.

   ```
   jai@studentagencies.example|Jai|cto;manager@studentagencies.example|Pat Rivera|gm
   ```

2. **Two long random strings** from your password manager's generator. Nobody types them:
   - C. Link secret (40+ characters)
   - D. Scheduler secret (20+ characters)

## The steps

1. **Create the database.** Go to <https://neon.tech>, then **Sign up → Continue with GitHub**.
   Create a project named `sai-hhmc` in **AWS US East (N. Virginia)**, with the newest
   Postgres version.

2. **Copy the database address.** On the project page click **Connect**, turn **Connection
   pooling** off, and copy the string that starts with `postgresql://` (call it **E**).

3. **Create the app host.** Go to <https://vercel.com/signup>, choose **Hobby**, then
   **Continue with GitHub**. Let Vercel see the `sai-cto/sai-platform` repository.

4. **Import the project.** **Add New… → Project**, then **Import** next to `sai-platform`.
   Leave the build settings alone.

5. **Add the settings.** Open **Environment Variables** and add each row (name, value, **Add**):

   | Name | Value |
   |---|---|
   | `PILOT_MODE` | `true` |
   | `DATABASE_OWNER_URL` | E |
   | `PILOT_ACCOUNTS` | your one-line list |
   | `LINK_SIGNING_SECRET` | C |
   | `CRON_SECRET` | D |
   | `DATABASE_POOL_MAX` | `3` |

   Click **Deploy** and wait 2–4 minutes. Then click **Continue to Dashboard** and note the
   address under **Domains**, for example `sai-platform-xyz.vercel.app` (call it **S**). The
   site works now but says no sign-in is configured. That's expected until step 9.

6. **Register the app with Microsoft.** Go to <https://entra.microsoft.com> and sign in with
   your SAI admin account. Open **Applications → App registrations → New registration**:
   - Name: `SAI Platform`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: choose **Web** and enter `https://S/api/auth/microsoft/callback`, with S
     replaced by your address.

   Click **Register**.

7. **Copy two IDs.** On the app's **Overview** page, copy:
   - **Application (client) ID** → **F**
   - **Directory (tenant) ID** → **G**

8. **Create the app's secret.** Open **Certificates & secrets → New client secret**. Use
   description `Vercel`, expiry **24 months**, then **Add**. Copy the **Value** right away
   (call it **H**). Microsoft shows it only once.

9. **Give Vercel the Microsoft settings.** In Vercel: **Settings → Environment Variables**. Add
   `MICROSOFT_CLIENT_ID` = F, `MICROSOFT_TENANT_ID` = G and `MICROSOFT_CLIENT_SECRET` = H. Then
   **Deployments → ⋯ (on the newest) → Redeploy**.

10. **Sign in.** Open S and click **Sign in with Microsoft 365**. Use your SAI account and accept
    the permission prompt (it asks only for your name and email). You land in the console.
    - If Microsoft says an administrator must approve: go back to the app in Entra, then **API
      permissions → Grant admin consent for SAI**.
    - If the site says it can't sign you in: your email in `PILOT_ACCOUNTS` doesn't match the
      one Microsoft uses. Fix it and redeploy.

11. **Add the managers.** Either add them to `PILOT_ACCOUNTS` and redeploy, or as the GM open
    **Hired Hands Moving Company → People and access → Add**, using their SAI Microsoft email.
    They sign in the same way as in step 10.

12. **Tell Claude** "deployed" with the address S. Claude checks the sign-in page, the Microsoft
    redirect and the PILOT bar. Signing in needs a real SAI account, so for the full walk
    through a move you either sign in on a shared screen or run the checklist Claude gives you.

Then send the managers `docs/hhmc-analysis/MANAGER-MESSAGE.md`, with
`docs/hhmc-analysis/MANAGER-TESTING-GUIDE.md` attached.

## Good to know

- **Real data is protected.** The build refuses to touch a database that has other tables in it
  or that holds the fake demo. It never wipes the pilot, and the reset option is refused in
  pilot mode.
- **Removing someone:** in **People and access**, remove them or switch them off. Or turn them
  off in Microsoft 365: then they can't sign in at all.
- **Previews:** if Vercel ever builds a "preview" of other code, it has no database. An error
  page there is expected and harmless.
- **Stored files** (saved estimate documents) don't last on this hosting yet.

## Going fully live (replacing Movegistics): not built yet

The pilot stops short of these on purpose. Each needs a decision, and some need an account:

1. **An email service** so estimates, receipts and reminders actually reach customers.
2. **A card processor** (the code has a Stripe adapter that refuses live keys today, so it needs
   a small change and review).
3. **File storage** that keeps the signed estimate documents.
4. **Paid plans**: Vercel Pro (commercial use) and a database plan with daily backups.
5. **Real terms and email wording** in Settings → Templates (now marked PLACEHOLDER).
6. **The open business questions** in `docs/DECISIONS.md` (H1–H14, P5-15 …), especially what
   the 4% is.
7. Switch off `PILOT_MODE` once 1–4 are in place.

## Alternative: a fake-data test site (no Microsoft)

Set `DEMO_MODE=true` instead of `PILOT_MODE`, and use `DEMO_ACCESS_PASSWORD` and `DEMO_ACCOUNTS`
(`email|Full name|gm or staff|password`, separated by `;`). That site is all fake data behind a
shared password, with a yellow TEST SITE bar. It needs its own empty database; it can never use
the pilot's. To start its data over: set `DEMO_RESET_ON_DEPLOY` = `yes`, redeploy, then set it
back to `no`.
