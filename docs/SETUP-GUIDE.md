# Event Drafter: setup guide for a brand-new user

This guide assumes you have never touched this project and you are not a developer.
It takes you from a blank Mac to a working install, including every account you need
to sign up for. Read it top to bottom the first time. Plan for about 60 to 90 minutes,
most of which is waiting on installs and clicking through Google's consent screens.

If you only want the short version, jump to [The 12-step quick run](#the-12-step-quick-run)
at the bottom. But read Part A first so the accounts are ready.

---

## What this thing is

Event Drafter is a personal tool that helps one person send polished, personalized
WhatsApp invitations to a list of VIP contacts, then track who replied and what they said.

It does **not** blast messages automatically. You stay in control:

- It writes a draft for each contact using an AI model.
- You read and approve every draft.
- It types the message into WhatsApp Web for you, but **you click send yourself**.
- It checks for replies twice a day, sorts them, and drafts responses for you to approve.

It runs entirely on your own machine. Nothing is hosted on the internet. Your data lives
in a single local file on your computer.

It has three moving parts (you do not need to understand these, but the names show up later):

- **core**: the local database.
- **web**: the dashboard you open in your browser at `localhost:3000`.
- **worker**: a background program that talks to WhatsApp Web and the AI model.

---

## Part A: Accounts and resources you need

Set these up first. You cannot finish the install without the Google one.

### 1. A computer running macOS

This guide is written for Mac. The optional auto-start step is Mac-only. Everything else
would work on Linux or Windows too, but the commands may differ slightly.

### 2. A GitHub account (free) and the code

The code lives at `https://github.com/C-lb/event-drafter`. To download it you need
the **git** tool (covered in Part B) and, if the repository is private, read access to it.
If you cannot open that link in your browser, ask the project owner (Caleb) to add you
as a collaborator, or to send you a zip of the code.

- Sign up: https://github.com/signup (free)

### 3. A Google account (free) plus a Google Cloud project

This is **required**. The tool reads your contact list from a Google Sheet and reads your
Gmail inbox to help match replies. To let it do that safely, you create a small "OAuth app"
inside Google Cloud. This sounds scary but it is just clicking through a few screens. It is
free. Detailed steps are in Part D.

- You need: a regular Gmail account.
- You will create: a Google Cloud project and an OAuth client. Free.
- Time: about 15 minutes.

### 4. An AI model: pick ONE of these

The tool needs an AI model to write the message drafts. You have two choices.

**Option A: Ollama (free, runs on your Mac, no signup, recommended to start)**

Ollama is a free app that runs an AI model locally on your computer. No account, no API key,
no per-message cost. The trade-off is it uses your Mac's memory and is a little slower and
a little less polished than a paid cloud model. Good enough to start.

- Download: https://ollama.com (free)

**Option B: Anthropic Claude (paid, cloud, higher quality)**

Anthropic runs Claude, a high-quality AI model in the cloud. You sign up, get an API key,
and pay per use (typically cents per batch of invites, but you are billed for what you use).
Better writing quality, nothing to run locally.

- Sign up and get a key: https://console.anthropic.com/settings/keys (paid, billed per use)

You can switch between these later by editing one line in a settings file. Start with Ollama
if you want zero cost and zero signup. Switch to Anthropic if you want better drafts.

### 5. Your own WhatsApp account

The tool sends through **WhatsApp Web**, the same thing you get at web.whatsapp.com.
You link it once by scanning a QR code with your phone, exactly like linking WhatsApp Web
to a laptop. Your normal WhatsApp keeps working as usual. The tool uses its own separate
browser window so it never touches your real Chrome.

- You need: a phone with WhatsApp installed and signed in.

### 6. A Google Sheet with your contacts

You will make a simple spreadsheet listing the people you want to invite. Columns the tool
understands include: full name, preferred name, phone number in international format
(for example `+6591234567`), email, and any personal notes or interests that help the AI
write a warmer message. You can set this up after install; details are in Part E.

**Accounts checklist before you continue:**

- [ ] GitHub account, and you can access the code
- [ ] Gmail account
- [ ] Decided on Ollama (free) or Anthropic (paid)
- [ ] Phone with WhatsApp ready to scan a QR code

---

## Part B: Install the basic tools on your Mac

You will run a few commands in the **Terminal** app. Open it from
Applications > Utilities > Terminal, or press Cmd+Space and type "Terminal".

Copy and paste each block, press Enter, and wait for it to finish before the next one.

### 1. Install Homebrew (the Mac package installer)

Homebrew is the standard way to install developer tools on a Mac. Paste this and follow
any prompts (it may ask for your Mac password):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

When it finishes it may print two lines starting with `eval`. If it does, copy and run them,
or just close and reopen Terminal.

### 2. Install git and nvm

`git` downloads the code. `nvm` manages the version of Node.js (the runtime this project needs).

```bash
brew install git nvm
```

After that, set up nvm so your terminal can find it:

```bash
mkdir -p ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
```

Close Terminal and open a new window so those settings load.

### 3. Install Node.js version 22

This project needs Node 22 specifically.

```bash
nvm install 22
```

Check it worked:

```bash
node --version
```

You should see something starting with `v22`.

### 4. (Only if you chose Ollama) Install and start the model

Download Ollama from https://ollama.com, open the app once so it starts running, then
pull the model the project uses:

```bash
ollama pull qwen2.5:7b-instruct
```

Leave the Ollama app running whenever you use Event Drafter.

---

## Part C: Get the code and install it

### 1. Download the code

This puts the project in your home folder under `event-drafter`:

```bash
cd ~
git clone https://github.com/C-lb/event-drafter.git
cd event-drafter
```

If the repository is private and this asks for a login, sign in with the GitHub account that
has access (or ask Caleb to grant you access first).

### 2. Select Node 22 for this project

```bash
nvm use
```

This reads the project's `.nvmrc` file and switches to Node 22. Run `nvm use` every time
you come back to work on the project in a new terminal.

### 3. Install all the project's dependencies

```bash
npm install
```

This downloads everything the project needs, including a private copy of the Chromium
browser used to drive WhatsApp Web (about 500 MB, so this step can take a few minutes).

---

## Part D: Set up Google access

This is the one required account integration. Full reference:
[`docs/setup/google-oauth.md`](setup/google-oauth.md). Summary below.

### 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com/projectcreate
2. Name it anything, for example `event-drafter`. Click Create.

### 2. Turn on the two APIs it uses

1. In the left menu: APIs and Services > Library
2. Search for **Google Sheets API** and click Enable.
3. Search for **Gmail API** and click Enable.

### 3. Set up the consent screen

1. APIs and Services > OAuth consent screen
2. User type: **External**. Continue.
3. App name: `event-drafter`. Support email: your Gmail. Fill required fields.
4. On the Scopes step, add these two:
   - `.../auth/spreadsheets.readonly`
   - `.../auth/gmail.readonly`
5. On the Test users step, add your own Gmail address. This matters: while the app is in
   "Testing" mode, only the emails you list here are allowed to use it. Add yourself.
6. Save through the rest.

### 4. Create the OAuth client

1. APIs and Services > Credentials > Create credentials > OAuth client ID
2. Application type: **Web application**
3. Name: `event-drafter local`
4. Under Authorized redirect URIs, add exactly:
   `http://localhost:3000/api/auth/google/callback`
5. Click Create. A box pops up with a **Client ID** and a **Client secret**. Keep this open,
   you need both in the next part.

---

## Part E: Configure the project

### 1. Create your settings file

The project keeps your secrets in a single file named `.env` in the project root.
It is ignored by git, so it never gets uploaded. The web and worker parts read it through
symlinks, so you only ever edit this one file.

Start from the provided template:

```bash
cd ~/event-drafter
cp .env.example .env
```

### 2. Fill it in

Open `.env` in a text editor (TextEdit is fine):

```bash
open -e .env
```

Paste your Google Client ID and secret from Part D. The file should look like this.
Lines starting with `#` are comments and are ignored.

```
# Choose your AI model: ollama (free, local) or anthropic (paid, cloud)
LLM_PROVIDER=ollama

# If you chose anthropic instead, comment the line above, uncomment these,
# and paste your key:
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-...

# Google access from Part D
GOOGLE_CLIENT_ID=paste-your-client-id-here
GOOGLE_CLIENT_SECRET=paste-your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

Save and close the editor.

Keep this file private. It is your password to your own Google data. Never paste its contents
into a chat, email, or commit.

### 3. Create the database

This makes the local file that stores your contacts, events, and replies:

```bash
npm run migrate
```

You only do this once. It creates `data/app.db` inside the project folder.

---

## Part F: First run

### 1. Start the app

```bash
npm run dev
```

This starts two things at once:

- The dashboard (labeled `web`, in blue), at http://localhost:3000
- The background worker (labeled `worker`, in magenta)

Leave this terminal window open. The app runs only while it is open. To stop later,
click the terminal and press Ctrl+C.

### 2. Open the dashboard

In your browser go to http://localhost:3000 and then to the setup wizard at:

http://localhost:3000/setup

Work through the wizard pages in order. They are:

1. **AI model** (`/setup/llm`): confirms whether you are using Ollama or Anthropic.
2. **Google** (`/setup/google`): click "Authorize Google". A Google window opens. Sign in
   with the Gmail you added as a test user, and approve the read-only access. You may see a
   warning that the app is unverified; this is normal for a personal app in Testing mode,
   choose to continue. When done, Google sends you back to the dashboard and the access
   tokens are saved into your local database.
3. **WhatsApp** (`/setup/wa`): see the next step.
4. **Sheet** (`/setup/sheet`) and **Import** (`/setup/import`): point it at your contacts
   Google Sheet and import the people.

### 3. Link WhatsApp Web

On the `/setup/wa` page, follow the prompt to start a WhatsApp Web session. A separate
Chromium window opens showing a QR code. On your phone:

1. Open WhatsApp.
2. Go to Settings > Linked Devices > Link a Device.
3. Scan the QR code in the Chromium window.

Once your chats appear, the session is saved into `data/wa-profile/` and you will not need
to scan again for weeks. Full reference: [`docs/setup/whatsapp.md`](setup/whatsapp.md).

### 4. Set your name and writing style

Go to http://localhost:3000/settings (and `/settings/style-guide`). Enter how you want to
sign your messages and describe the tone you want the AI to use. Warm, brief, and natural
works well. Save.

---

## Part G: Daily use, in short

1. Create an event in the dashboard (name, date, venue).
2. Pick the contacts to invite and ask it to draft invites. The AI writes one per person.
3. Read each draft. Approve the ones you like, edit or reject the rest.
4. For an approved draft, click "Pre-fill". The Chromium window opens that person's chat
   with the message already typed in.
5. **You click send** in the Chromium window. Then click "Mark sent" in the dashboard.
6. Replies are collected automatically around noon and 6 PM, or click "Check now". The tool
   sorts them and drafts responses for you to approve the same way.

The tool deliberately sends slowly and in small batches to behave like a real person and
avoid WhatsApp flagging the account. Roughly 30 seconds between sends, batches of 5 to 8,
then a cooldown. This is intentional. Do not try to rush it.

---

## The 12-step quick run

For when the accounts in Part A are already set up.

```bash
# 1. Install Homebrew (skip if you have it)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Install tools
brew install git nvm

# 3. Set up nvm (then reopen Terminal)
mkdir -p ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc

# 4. Install Node 22
nvm install 22

# 5. (Ollama users) pull the model, keep the Ollama app running
ollama pull qwen2.5:7b-instruct

# 6. Get the code
cd ~ && git clone https://github.com/C-lb/event-drafter.git && cd event-drafter

# 7. Use Node 22
nvm use

# 8. Install dependencies (downloads Chromium, takes a few minutes)
npm install

# 9. Create and edit your settings
cp .env.example .env
open -e .env        # paste Google ID/secret, choose LLM_PROVIDER

# 10. Create the database
npm run migrate

# 11. Start everything
npm run dev

# 12. In the browser, finish setup at:
#     http://localhost:3000/setup
```

---

## Troubleshooting

**"command not found: nvm" or "npm"**
Reopen Terminal so the nvm setup loads, then run `nvm use` inside the project folder.

**The app starts but drafts fail (Ollama)**
Make sure the Ollama app is open and you pulled the model:
`ollama pull qwen2.5:7b-instruct`. Check it responds: `curl http://localhost:11434/api/tags`.

**The app starts but drafts fail (Anthropic)**
Check `.env` has `LLM_PROVIDER=anthropic` and a valid `ANTHROPIC_API_KEY`, and that your
Anthropic account has billing set up.

**Google says the app is unverified**
Expected for a personal app in Testing mode. Continue past the warning. If it blocks you
entirely, confirm your Gmail is listed as a Test user in the OAuth consent screen (Part D).

**WhatsApp asks to re-link after a while**
Sessions expire eventually. The dashboard shows a "WA Web needs re-auth" banner. Redo the
QR scan from `/setup/wa`. You can also run a quick login check from the command line:

```bash
# run from the project root so the session is saved in the same place the app uses
ED_WA_PROFILE_DIR="$PWD/data/wa-profile" npm -w @event-drafter/worker run wa-smoke
```

(The plain `npm run wa-smoke` shortcut can save the session to the wrong folder. The command
above is the safe version.)

**I stopped the app but something is still running**
The background worker can sometimes outlive the terminal. Stop it with:

```bash
pkill -f "packages/worker/src/index.ts"
```

**I want the worker to start automatically on login (optional, advanced)**
See [`docs/setup/launchd.md`](setup/launchd.md).

---

## Where things live

- Your secrets: `~/event-drafter/.env` (never share or commit this)
- Your data (contacts, events, replies): `~/event-drafter/data/app.db`
- Your WhatsApp session: `~/event-drafter/data/wa-profile/`
- The dashboard: http://localhost:3000

Back up the `data/` folder if you want to keep your history safe.
