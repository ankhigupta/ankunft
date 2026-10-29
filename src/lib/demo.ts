import type { Profile } from "./pack/schema";

export type Scenario = {
  id: string;
  label: string;
  blurb: string;
  today: string;
  profile: Profile;
};

/** Fixed example situations so a demo always looks the same, whatever the real date is. */
export const SCENARIOS: Scenario[] = [
  {
    id: "no-housing",
    label: "Just landed, no flat yet",
    blurb: "Arrived on 20 Oct, still looking for a place.",
    today: "2026-10-24",
    profile: {
      inputs: {
        entryType: "national_visa",
        arrivalDate: "2026-10-20",
        visaEndDate: "2027-01-15",
        hasAdmissionLetter: true,
      },
      completed: [],
    },
  },
  {
    id: "moved-in",
    label: "Moved in, landlord form missing",
    blurb: "Moved in on 21 Oct. The 14-day clock is running.",
    today: "2026-10-24",
    profile: {
      inputs: {
        entryType: "national_visa",
        arrivalDate: "2026-10-18",
        moveInDate: "2026-10-21",
        visaEndDate: "2027-01-15",
        hasAdmissionLetter: true,
      },
      completed: [],
    },
  },
  {
    id: "overdue",
    label: "Registration deadline missed",
    blurb: "Moved in on 7 Oct and has not registered.",
    today: "2026-10-24",
    profile: {
      inputs: {
        entryType: "national_visa",
        arrivalDate: "2026-10-05",
        moveInDate: "2026-10-07",
        visaEndDate: "2027-01-15",
        hasAdmissionLetter: true,
      },
      completed: ["landlord_confirmation"],
    },
  },
  {
    id: "visa-free",
    label: "Entered without a visa",
    blurb: "Not covered yet. Shows how Ankunft says so.",
    today: "2026-10-24",
    profile: {
      inputs: { entryType: "visa_free", arrivalDate: "2026-10-20" },
      completed: [],
    },
  },
];
