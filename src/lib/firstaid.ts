// Hard-coded first-aid protocols. The incident log lives in lib/incidents.ts.

export type Severity = "minor" | "moderate" | "severe";

export type Protocol = {
  label: string;
  severity: Severity;
  symptoms: string[];
  steps: { title: string; detail: string }[];
  followUps: { question: string; answer: string }[];
};

export type Incident = {
  id: string;
  createdAt: string;
  injuryType: string;
  label: string;
  severity: Severity;
  symptoms: string[];
  photoName: string | null;
  stepsTotal: number;
  stepsDone: number;
  callPlaced: boolean;
  callNumber: string | null;
  notes: string[];
};

export const INJURY_TYPES = [
  { value: "cut", label: "Cut / laceration" },
  { value: "burn", label: "Burn / scald" },
  { value: "bruise", label: "Bruise / contusion" },
  { value: "ingrown_nail", label: "Ingrown toenail" },
  { value: "fracture", label: "Suspected fracture" },
  { value: "bleed", label: "Heavy bleeding" },
  { value: "sprain", label: "Sprain / twist" },
  { value: "choking", label: "Choking / can't breathe" },
] as const;

const PROTOCOLS: Record<string, Protocol> = {
  cut: {
    label: "Cut / laceration on forearm",
    severity: "minor",
    symptoms: ["Shallow skin break", "Slow oozing blood", "Localised pain"],
    steps: [
      { title: "Protect yourself", detail: "Wash your hands or wear gloves before touching the wound." },
      { title: "Control the bleeding", detail: "Press a clean gauze pad firmly on the cut for 5 full minutes without peeking." },
      { title: "Rinse the wound", detail: "Run clean lukewarm water over the cut for 30 seconds. Do not scrub." },
      { title: "Dress it", detail: "Apply a thin layer of antiseptic and cover with a sterile adhesive dressing." },
      { title: "Watch for infection", detail: "Recheck in 24 hours for spreading redness, warmth, pus or fever." },
    ],
    followUps: [
      { question: "Is my dressing tight enough?", answer: "Snug, not constricting. You should be able to slide one finger under the edge, and the fingertips beyond it should stay warm and pink." },
      { question: "When should I change the dressing?", answer: "Once daily, or sooner if it becomes wet or soaked through. Wash hands before and after each change." },
      { question: "Do I need a tetanus shot?", answer: "If the wound was caused by something dirty or rusty and your last tetanus booster was over 5 years ago, get reviewed within 24 hours." },
    ],
  },
  burn: {
    label: "Superficial thermal burn",
    severity: "moderate",
    symptoms: ["Red, shiny skin", "Blistering at the edges", "Sharp burning pain"],
    steps: [
      { title: "Stop the burning", detail: "Move away from the heat source and remove rings or watches near the area." },
      { title: "Cool for 20 minutes", detail: "Hold under cool (not ice-cold) running water for a full 20 minutes." },
      { title: "Do not pop blisters", detail: "Leave blisters intact. Do not apply butter, oil or toothpaste." },
      { title: "Cover loosely", detail: "Lay cling film lengthwise over the burn, or use a non-stick sterile dressing." },
      { title: "Keep warm and hydrated", detail: "Cover the rest of the body to prevent chill and sip water." },
    ],
    followUps: [
      { question: "How do I know if it needs a hospital?", answer: "Seek care if the burn is larger than the casualty's palm, on the face, hands or genitals, or looks white/leathery." },
      { question: "Can I use a burn cream?", answer: "Only after cooling and only a plain water-based gel. Avoid anything greasy for the first 48 hours." },
      { question: "Pain relief?", answer: "Standard paracetamol or ibuprofen dosing for the casualty's weight is appropriate if there are no contraindications." },
    ],
  },
  fracture: {
    label: "Suspected closed forearm fracture",
    severity: "severe",
    symptoms: ["Visible deformity", "Swelling and bruising", "Cannot bear weight or grip", "Pain on any movement"],
    steps: [
      { title: "Do not realign", detail: "Support the limb exactly as you found it. Never try to straighten it." },
      { title: "Immobilise", detail: "Pad either side of the limb with rolled cloth and support it against the body." },
      { title: "Apply a sling", detail: "Slide a triangular bandage under the forearm, bring the lower point over the shoulder and tie at the side of the neck." },
      { title: "Check circulation", detail: "Confirm the fingertips stay warm, pink and sensate. Loosen if they turn pale or numb." },
      { title: "Arrange transport", detail: "Emergency services should assess and transport. Keep the casualty nil by mouth." },
    ],
    followUps: [
      { question: "Have I tied the sling right?", answer: "The hand should sit slightly higher than the elbow, the knot rests beside the neck (not on the spine), and the elbow is fully cupped by the fabric." },
      { question: "Can I give painkillers?", answer: "Hold off — if surgery is likely, keep the casualty nil by mouth and let the ambulance crew manage pain relief." },
      { question: "Should I use ice?", answer: "A cold pack wrapped in cloth over the dressing for 15 minutes can reduce swelling. Never place ice directly on skin." },
    ],
  },
  bleed: {
    label: "Severe external haemorrhage",
    severity: "severe",
    symptoms: ["Blood soaking through dressings", "Pale, clammy skin", "Rapid weak pulse", "Anxiety or confusion"],
    steps: [
      { title: "Call for help first", detail: "This is a life threat. Emergency services must be on the way before anything else." },
      { title: "Apply direct pressure", detail: "Press hard with both hands over a pad directly on the wound. Do not release to look." },
      { title: "Pack or tourniquet", detail: "For a limb that keeps bleeding, apply a tourniquet 5–7 cm above the wound and note the time." },
      { title: "Lay the casualty flat", detail: "Raise the legs slightly and keep them warm with a blanket to fight shock." },
      { title: "Monitor breathing", detail: "Recheck responsiveness and breathing every minute until help arrives." },
    ],
    followUps: [
      { question: "When do I loosen the tourniquet?", answer: "Never loosen it yourself. Hand over the application time to the ambulance crew." },
      { question: "Dressing is soaked — replace it?", answer: "Do not remove it. Add another pad on top and keep pressing." },
      { question: "What do I tell the dispatcher?", answer: "Exact location, mechanism of injury, that bleeding is uncontrolled, and whether a tourniquet is on." },
    ],
  },
  bruise: {
    label: "Bruise / contusion",
    severity: "minor",
    symptoms: ["Tenderness", "Discoloured skin", "Mild local swelling"],
    steps: [
      {
        title: "Rest and protect the area",
        detail: "Stop activity and avoid pressure or further knocks to the bruised area.",
      },
      {
        title: "Use a wrapped cold pack",
        detail:
          "Apply a cold pack wrapped in cloth for up to 20 minutes at a time. Never put ice directly on skin.",
      },
      {
        title: "Raise it if practical",
        detail: "Elevate the area, if comfortable, to help limit swelling.",
      },
      {
        title: "Monitor changes",
        detail:
          "Seek urgent medical advice for severe pain or swelling, numbness, a rapidly enlarging or unexplained bruise, or a head or eye injury.",
      },
      {
        title: "Consider health risks",
        detail:
          "Get medical advice promptly if the person takes blood thinners or bruises easily without a clear cause.",
      },
    ],
    followUps: [
      {
        question: "Should I put ice directly on it?",
        answer: "No. Wrap a cold pack in cloth and apply it for up to 20 minutes at a time.",
      },
      {
        question: "When should I seek care?",
        answer:
          "Seek urgent advice for severe pain or swelling, numbness, a head or eye injury, a rapidly growing bruise, or if the person takes blood thinners.",
      },
      {
        question: "Can I massage the bruise?",
        answer:
          "Avoid massaging it while it is painful or swollen; protect the area and monitor it.",
      },
    ],
  },
  ingrown_nail: {
    label: "Ingrown toenail",
    severity: "minor",
    symptoms: ["Pain along the nail edge", "Redness or swelling", "Possible drainage if infected"],
    steps: [
      {
        title: "Soak gently",
        detail: "Soak the toe in warm water for 10–20 minutes, then dry it carefully.",
      },
      {
        title: "Reduce pressure",
        detail: "Wear roomy footwear or open-toed shoes while the area is sore.",
      },
      {
        title: "Do not dig or cut the edge",
        detail: "Do not try to dig out the nail, cut down its side, or puncture the skin.",
      },
      {
        title: "Keep it clean",
        detail:
          "Keep the toe clean and dry between soaks; cover loosely with a clean dressing if rubbing causes discomfort.",
      },
      {
        title: "Watch for infection or risk factors",
        detail:
          "Get medical advice for pus, spreading redness, fever, worsening pain, or if the person has diabetes or poor circulation.",
      },
    ],
    followUps: [
      {
        question: "Should I cut out the corner?",
        answer: "No. Digging or cutting down the side can worsen the injury or cause infection.",
      },
      {
        question: "When does it need medical attention?",
        answer:
          "Get advice for pus, spreading redness, fever, worsening pain, or promptly if the person has diabetes or poor circulation.",
      },
      {
        question: "What footwear should I use?",
        answer: "Choose roomy shoes or open-toed footwear until pressure and soreness improve.",
      },
    ],
  },
  sprain: {
    label: "Ankle sprain, grade I–II",
    severity: "minor",
    symptoms: ["Swelling around the joint", "Tender to touch", "Painful but possible to weight-bear"],
    steps: [
      { title: "Rest", detail: "Stop activity and take weight off the joint immediately." },
      { title: "Ice", detail: "Wrapped cold pack for 15–20 minutes, every 2–3 hours for the first day." },
      { title: "Compress", detail: "Apply an elastic bandage from the toes upward with even, moderate tension." },
      { title: "Elevate", detail: "Raise the limb above heart level whenever seated for the next 24 hours." },
      { title: "Reassess at 48 hours", detail: "If weight-bearing is still impossible, imaging is needed to rule out a fracture." },
    ],
    followUps: [
      { question: "Is my compression bandage correct?", answer: "It should feel supportive, never throbbing. Toes stay pink and you can slip a finger under the wrap." },
      { question: "Heat or ice?", answer: "Ice for the first 48 hours to limit swelling, then gentle heat and movement to restore mobility." },
      { question: "When can I walk normally?", answer: "Reintroduce weight gradually as pain settles, usually 3–7 days for a mild sprain." },
    ],
  },
  choking: {
    label: "Choking — airway obstruction",
    severity: "severe",
    symptoms: ["Unable to speak, cough or breathe", "Clutching the throat", "Lips or face turning blue", "High-pitched noise when breathing in"],
    steps: [
      { title: "Encourage coughing", detail: "Ask \"Are you choking?\" If they can cough or speak, tell them to keep coughing hard. Do not hit their back yet." },
      { title: "Give 5 back blows", detail: "Stand to the side, support their chest, lean them forward and give up to 5 sharp blows between the shoulder blades with the heel of your hand." },
      { title: "Give 5 abdominal thrusts", detail: "Stand behind them, place a fist just above the navel, grasp it with your other hand and pull sharply inwards and upwards up to 5 times." },
      { title: "Keep alternating", detail: "Repeat 5 back blows and 5 abdominal thrusts until the object comes out or help arrives." },
      { title: "If they collapse", detail: "Lower them to the floor and start CPR: 30 chest compressions, then 2 rescue breaths, until help arrives." },
    ],
    followUps: [
      { question: "The object came out — are they fine now?", answer: "Anyone given abdominal thrusts should see a doctor, as thrusts can cause internal injury. Watch for a persistent cough, trouble swallowing or chest pain." },
      { question: "What if it is a baby?", answer: "Lay the baby face-down along your forearm, head lower than the chest, give up to 5 back blows, then turn them over and give up to 5 chest thrusts with two fingers. Never use abdominal thrusts on a baby." },
      { question: "Should I sweep their mouth with my finger?", answer: "Only remove an object you can clearly see and easily grab. Blind finger sweeps can push it deeper." },
    ],
  },
};

export function assess(injuryType: string): Protocol {
  return PROTOCOLS[injuryType] ?? (PROTOCOLS["cut"] as Protocol);
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  minor: "Minor — self-care",
  moderate: "Moderate — monitor closely",
  severe: "Severe — emergency services advised",
};

export const EMERGENCY_NUMBER = "112";
