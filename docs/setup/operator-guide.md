# Event Drafter, plain-language operator guide

For the person who runs Event Drafter day to day. No terminal, no code. If you can open an app and scan a QR code, you can run this.

Event Drafter is a normal desktop app. Everything it needs runs inside it when you open it. You never open a black terminal window, type commands, or start anything by hand.

---

## The one-time setup (do this once per computer)

You only do this the first time on a given laptop.

1. **Install the app.**
   - Mac: open the `.dmg`, drag **Event Drafter** into the Applications folder.
   - Windows: run `Event Drafter Setup ....exe` and click through.

2. **Get past the "unknown developer" warning.** The app is not code-signed, so the computer will warn you the first time. This is expected, not a virus.
   - Mac: do not double-click the first time. **Right-click the app, choose Open, then click Open** in the box. After that first time you can open it normally.
   - Windows: on the blue "Windows protected your PC" box, click **More info**, then **Run anyway**.

3. **Open the app and finish the checklist.** A window opens (this is the whole app). Go to the **Setup** page and complete the five steps in order:
   1. **LLM provider** — paste the Anthropic API key. This is what writes the messages.
   2. **Google account** — sign in and allow access. This is how it reads the events sheet and sends.
   3. **Contacts sheet** — point it at the right Google Sheet.
   4. **Import contacts** — pulls the people in.
   5. **WhatsApp Web** — a QR code appears. On your phone, open WhatsApp, go to Linked Devices, and scan it.

When all five have a tick, setup is done.

---

## Every time you use it (the short version)

1. **Open Event Drafter** (Applications on Mac, Start menu on Windows). Just open the app. Nothing else to start.

2. **Wait for the green dot.** At the top there is a status pill.
   - **Green "connected"** means it is running and ready. Good.
   - **Blue** means it is busy sending or drafting right now. Also fine.
   - **Red "offline"** means the engine is not running. There is a **Start** button next to the pill and in the red banner. Click it and wait a few seconds for green.

3. **Check WhatsApp is still linked.** WhatsApp sometimes logs the computer out (phone off for days, "log out of all devices", etc.). If the app says WhatsApp needs attention, go to **Setup > WhatsApp Web** and scan the QR again with your phone.

4. **Leave it open and awake while it should be working.** The app can only send while it is open and the laptop is on.
   - Keep the app open (you can minimise it).
   - Keep the laptop **plugged in and set to not sleep**. If the lid closes or the machine sleeps, nothing sends until you wake it.

That's the whole routine: open it, wait for green, make sure WhatsApp is linked, keep it awake.

---

## Good to know

- **Only run one copy.** Do not open Event Drafter on two computers pointed at the same account at the same time. One machine is the sender.

- **The "Safety stop" button is your emergency brake.** The red **Safety stop** button halts everything immediately, no more sending or drafting. Use it if something looks wrong. Click it again (Resume) to carry on.

- **You can watch what it's doing.** Little pop-up notes appear as it works ("Sending invite to ...", "Invite sent to ..."). The **Status** page shows what it is doing now, who is next, and anything stuck.

- **Updating the app.** Updates are not automatic. When there is a new version, install the new `.dmg` / `.exe` the same way as the first time (including the "unknown developer" step). Your data and login stay put.

- **Nothing lives in the cloud on your side.** Your data sits on that one laptop. Back up the laptop like you would anything important.

---

## If something looks wrong

| What you see | What to do |
|---|---|
| Red "offline" pill | Click **Start** next to the pill. Wait for green. |
| WhatsApp not sending | **Setup > WhatsApp Web**, scan the QR again with your phone. |
| Messages look stuck | Open the **Status** page. It lists anything mid-send with buttons to mark sent or resend. |
| It's sending when it shouldn't | Hit the red **Safety stop**. |
| Nothing happens overnight | The laptop slept or the app was closed. Keep it open, plugged in, sleep off. |
| Still stuck | Close the app fully and open it again. If that doesn't fix it, call the person who set this up. |
