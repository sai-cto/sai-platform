# Put the HHMC test site online

This puts the platform on the internet **in demo mode** so HHMC's managers can try it. It uses
two free services:

- **Neon**: the database
- **Vercel**: runs the app

You need no credit card. It takes about 20 minutes.

What demo mode does: the whole site sits behind one shared password. Each manager signs in with
their own email and password. All data is fake, payments are pretend, and no email is sent.
A yellow **TEST SITE** bar shows on every page. The fake-user "dev login" used on laptops is
switched off. (Why these choices: `docs/DECISIONS.md`, P5-16 to P5-19.)

## Before you start: make up some passwords

Open a note and write these down. Use your password manager's generator, or just type long
random letters. Every one needs **at least 12 characters**, and longer is better.

| Write down | Example of the format (do not use these) |
|---|---|
| A. Site access password (you'll give it to the managers) | `moving-day-orange-42` |
| B. A password for each manager account | `Pianos-Need-4-Movers!` |
| C. Link secret (40+ random characters, nobody types it) | `k3J9xQ...` (40+ characters) |
| D. Scheduler secret (20+ random characters, nobody types it) | `p8Wm2...` |

Then write the manager accounts as **one line**, separated by `;`, in this shape:

```
email|Full name|role|password;email|Full name|role|password
```

`role` is `gm` (general manager: can do everything, including adding people) or `staff` (can
run every step of a move). Add `tech` for yourself if you want the "Run due emails" button.
Example (made-up people):

```
gm@hhmc.example|Pat Rivera|gm|Pianos-Need-4-Movers!;sam@hhmc.example|Sam Lee|staff|Boxes-Boxes-Boxes-9
```

## The steps

1. **Create the database.** Go to <https://neon.tech> → **Sign up** → **Continue with GitHub**.
   When it asks, create a project named `sai-demo` in the region **AWS US East (N. Virginia)**,
   with the newest Postgres version.

2. **Copy the database address.** On the project page click **Connect**. Turn **Connection
   pooling** **off**. Copy the whole string that starts with `postgresql://`. Paste it into your
   note as **E**.

3. **Create the app host.** Go to <https://vercel.com/signup> → choose **Hobby** →
   **Continue with GitHub**. Allow Vercel to see the `sai-cto/sai-platform` repository when
   GitHub asks. ("Only select repositories" is fine.)

4. **Import the project.** In Vercel click **Add New… → Project**. Next to
   `sai-platform` click **Import**. Leave every build setting as it is: the repository's
   `vercel.json` already says how to build.

5. **Add the settings.** On the same screen open **Environment Variables**. Add each row below:
   type the name, paste the value, click **Add**.

   | Name | Value |
   |---|---|
   | `DEMO_MODE` | `true` |
   | `DATABASE_OWNER_URL` | E (the Neon string) |
   | `DEMO_ACCESS_PASSWORD` | A |
   | `DEMO_ACCOUNTS` | your one-line list of accounts |
   | `LINK_SIGNING_SECRET` | C |
   | `CRON_SECRET` | D |
   | `DATABASE_POOL_MAX` | `3` |

6. **Deploy.** Click **Deploy**. Wait for the confetti (2–4 minutes). The first build also sets
   up the database and the fake data. If it fails, open the build log, copy the last 30 lines,
   and send them to Claude.

7. **Find the address.** Click **Continue to Dashboard**. Under **Domains** you'll see an
   address like `sai-platform-xyz.vercel.app`. That is the test site.

8. **Try it yourself.** Open the address. You should see:
   1. "Test site": type password A.
   2. The sign-in page: use one of your accounts.
   3. The yellow TEST SITE bar on every page.

   Open **Hired Hands Moving Company → App**.

9. **Tell Claude** "deployed" and paste the address. Claude then signs in with the browser,
   runs one move from start to finish, and fixes anything that breaks. To do that, Claude needs
   the access password and one account's email and password. Share them in the chat only if
   you're comfortable doing so; otherwise ask Claude for a checklist to run yourself.

10. **Send the managers the message** in `docs/hhmc-analysis/MANAGER-MESSAGE.md`. It has the
    address, and the guide `docs/hhmc-analysis/MANAGER-TESTING-GUIDE.md`. Give each manager
    their password separately (in person or by text), not in the same message.

## Later

- **Start the demo data again** (for example before a new round of testing):
  1. In Vercel, open **Settings → Environment Variables** and add `DEMO_RESET_ON_DEPLOY` = `yes`.
  2. Go to **Deployments → ⋯ → Redeploy**.
  3. Then change it back to `no`, or the next deploy wipes the data again.
- **Add or remove a manager:** edit `DEMO_ACCOUNTS` and redeploy.
- **Change the shared password:** edit `DEMO_ACCESS_PASSWORD` and redeploy. Everyone has to
  type the new one.
- **Automatic emails:** the hosting runs the scheduler once a day, and it does nothing unless
  an HHMC admin switches on **Settings → "Send due automatic emails on a schedule"**. Even then,
  emails on the test site are only logged, never sent.
- **Uploaded or stored files** (such as the saved estimate document) do not last on this
  hosting. That's fine for a test site.
- **Cost:** both services are free at this size. Neither asks for a card on these plans.
- **New code reaches the site** by itself: every push to `main` deploys again. The data is kept
  unless `DEMO_RESET_ON_DEPLOY` is `yes`.
