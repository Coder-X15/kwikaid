# KwikAid: what should we polish before the demo?

The app now works end to end. This is a menu of frontend and UX improvements for the
presentation on **16 Oct**. Please **tick the items you want done** (or reply with their
numbers) and answer the model questions in section 2. Reply **by tonight** so there is time
to build and test.

Effort guide: **S** is under an hour, **M** is 1 to 3 hours. ⭐ marks my recommendation.

---

## 1. Where we are

Working now, tested against our Supabase project (`qbrktjyqdejvjwrwohvd`):

- **Accounts:** register, sign in and sign out with Supabase. The old `test`/`test` login is gone.
- **Button path:** one button per scenario (cut, burn, fracture, heavy bleeding, sprain, and a new **choking** protocol) starts the guided steps straight away.
- **Photo path:** the photo uploads to the private `injury-images` bucket and a row is added to `inference_queue`.
  - The Python worker classifies it with the ResNet18 ONNX model and writes the label back in about 5 seconds.
  - The page then opens the matching protocol.
  - If the label can't be used, the user picks the scenario from a list instead.
- **Security:** each user can only see their own queue rows, photos and incidents.
- **Incident history** is saved per account in a Supabase `incidents` table, so it follows
  the user to any device.

Not done yet:

- The model's class names are missing, so results come back as `class_0` to `class_7`
  (see section 2).
- Nothing is pushed yet, so kwikaid.lovable.app still runs the old demo version.

---

## 2. The blocker: the model (needs whoever trained it)

This is the only thing stopping the photo path from working in the demo. Everything
around the model (upload, queue, worker, results back to the app) is built and tested.

**Problem 1: we don't know what the model's outputs mean.** It returns 8 numbered classes,
but their names aren't saved in the repo or in the ONNX file. The app can only show
`class_7`, which matches no protocol, so every photo ends at the manual list.

**Problem 2: it gives the same answer for almost everything.** It predicts class 7 for a
clear burn photo, a hand with no injury, random noise and a plain white image. Changing how
we prepare the image didn't change the answer. One guess: class 7 is a `normal` (no wound)
class, and the classes are the Kaggle wound set (Abrasions, Bruises, Burns, Cut,
Ingrown_nails, Laceration, Stab_wound, normal). If class 7 *isn't* "normal", the ONNX export
may need checking.

**What we need, tonight:**

- [ ] **Class list in order:** the output of `print(train_dataset.classes)`.
- [ ] **Validation transforms:** resize, crop and normalisation.
- [ ] **Validation accuracy**, plus 3 to 4 test-set images the model gets right, for the demo.

Once the class list arrives, connecting it on our side is a small change.

---

## 3. Bug: fixed ✅

- [x] **Incident history was shared between accounts on the same browser.**
  Fixed: incidents now live in a Supabase `incidents` table, where each user can only read
  and change their own. Tested with two accounts.

---

## 4. Improvements before the demo

**Status (15 Oct):** all seven are built and on the `dev` branch, not pushed yet. Still open: the
confidence score in 4.1, which needs a `confidence` column and a worker change.

- [x] ⭐ **4.1 Show what the model detected, then confirm** (S, or M with confidence)
  Today a correct label jumps straight into the steps, so the audience never sees the CV
  result. Add a result card instead:
  - the photo, with "Detected: Burns";
  - **Confirm** and **Not right? Choose manually** buttons.

  This is the key moment of a CV project. Given how unreliable the model is, having a person
  confirm the result is also the safer design. Showing a confidence score needs a small
  `confidence` column and a one-line worker change.

- [x] ⭐ **4.2 Live progress while the model works** (S)
  At the moment the button just says "Waiting for the model…". Show
  *Uploading → Queued → Analysing → Done*, driven by the row's real `status`. It makes the
  whole pipeline visible on stage.

- [x] ⭐ **4.3 Emergency-first home screen** (S)
  - **Icons:** give each scenario button an icon (droplet, flame, bone, wind and so on).
  - **Colour:** colour the severe ones (bleeding, choking, fracture) red.
  - **Call button:** add a **Call 112** button that's always visible; today it only appears
    after a protocol starts.

  People in a panic need big, obvious buttons.

- [x] **4.4 "Do you need further help?" screen** (S)
  This is step 5 of our own requirements, but the flow currently ends with a few preset
  questions. Offer:
  - **Call emergency**
  - **Find nearest hospital** (opens a maps search)
  - **Ask a question**
  - **I'm done** (closes the incident)

- [x] **4.5 Hands-free guidance** (M)
  The person giving first aid has their hands full. All three use built-in browser features,
  with no backend work:
  - **Read each step aloud** with the browser's text-to-speech.
  - **Countdown timers** for timed steps ("Cool for 20 minutes", "Press for 5 minutes").
  - **Keep the screen awake** so the phone doesn't dim mid-CPR.

- [x] **4.6 Better photos for the model** (S)
  - **Hint:** add a short note under the camera button: "Fill the frame with the injury,
    use good light."
  - **Smaller uploads:** shrink photos to about 1024px before upload, which speeds things up
    on mobile data.

  This helps accuracy directly: the model failed on a wide stock photo with a white
  background.

- [x] **4.7 Small polish** (S)
  - **Toasts:** pop-up messages for upload errors and "Call placed" (the toast component is
    installed but not used).
  - **Loading screen:** a spinner instead of the blank screen during the login check.
  - **Screen readers:** status changes announced to screen-reader users.

---

## 5. Future work (for the "next steps" slide, not for tomorrow)

- Photo thumbnails in the incident history, loaded from the bucket.
- Realtime updates instead of checking every 2 seconds.
- A real phone call through a `tel:112` link. We keep it simulated for the demo so nobody
  dials 112 by accident.
- Support for regional languages.
- A medical disclaimer shown once, on first login.
- An AI agent for follow-up questions, replacing today's keyword matching.

---

## How to reply

Section 4 is built, so please try it and reply with anything you'd change.
Model owner: please also send the answers to section 2.
