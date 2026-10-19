export const LEVELS_OF_STUDY = [
  "Less than Secondary / High School",
  "Secondary / High School",
  "Undergraduate University (2 year - community college or similar)",
  "Undergraduate University (3+ year)",
  "Graduate University (Masters, Professional, Doctoral, etc)",
  "Code School / Bootcamp",
  "Other Vocational / Trade Program or Apprenticeship",
  "Post Doctorate",
  "Other",
  "I'm not currently a student",
  "Prefer not to answer",
] as const;

export const LEVEL_OF_STUDY_OTHER_OPTION = "Other" as const;

export const EXPERIENCE_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Expert",
] as const;

export const GENDERS = [
  "Man",
  "Woman",
  "Non-Binary",
  "Prefer to self-describe",
  "Prefer Not to Answer",
] as const;

export const GENDER_SELF_DESCRIBE_OPTION = "Prefer to self-describe" as const;

export const RACE_ETHNICITY_OPTIONS = [
  "Asian Indian",
  "Black or African",
  "Chinese",
  "Filipino",
  "Guamanian or Chamorro",
  "Hispanic / Latino / Spanish Origin",
  "Japanese",
  "Korean",
  "Middle Eastern",
  "Native American or Alaskan Native",
  "Native Hawaiian",
  "Samoan",
  "Vietnamese",
  "White",
  "Other Asian (Thai, Cambodian, etc)",
  "Other Pacific Islander",
  "Other (Please Specify)",
  "Prefer Not to Answer",
] as const;

export const DIETARY_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Celiac Disease",
  "Allergies",
  "Kosher",
  "Halal",
  "No Beef",
  "No Pork",
] as const;

export const STATES_OF_RESIDENCE = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "District of Columbia",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
  "American Samoa",
  "Guam",
  "Northern Mariana Islands",
  "Puerto Rico",
  "U.S. Virgin Islands",
  "Outside the United States",
] as const;

export const MAJORS = [
  "Computer science, computer engineering, or software engineering",
  "Another engineering discipline (such as civil, electrical, mechanical, etc.)",
  "Information systems, information technology, or system administration",
  "A natural science (such as biology, chemistry, physics, etc.)",
  "Mathematics or statistics",
  "Web development or web design",
  "Business discipline (such as accounting, finance, marketing, etc.)",
  "Humanities discipline (such as literature, history, philosophy, etc.)",
  "Social science (such as anthropology, psychology, political science, etc.)",
  "Fine arts or performing arts (such as graphic design, music, studio art, etc.)",
  "Health science (such as nursing, pharmacy, radiology, etc.)",
  "Other (please specify)",
  "Undecided / No Declared Major",
  "My school does not offer majors / primary areas of study",
  "Prefer not to answer",
] as const;

export const MAJOR_OTHER_OPTION = "Other (please specify)" as const;
export const SCHOOL_OTHER_OPTION = "Other (Please Specify)" as const;

export const TSHIRT_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"] as const;

export const HEAR_ABOUT_OPTIONS = [
  "Instagram",
  "Discord",
  "A friend",
  "School club or class",
  "MLH",
  "Previous HackUTA",
  "Other",
] as const;

export const HEAR_ABOUT_OTHER_OPTION = "Other" as const;

/** Mandatory multiline application questions (exact form labels). */
export const APPLICATION_QUESTIONS = {
  builtOrWantToBuild:
    "Tell us about something you have built or something you want to build",
  shortDeadlineLearning:
    "Describe a time you had to learn a tool or skill on a short deadline",
} as const;

export const FIELD_LIMITS = {
  name: 100,
  emergencyContactRelationship: 100,
  phone: 30,
  email: 254,
  school: 200,
  major: 200,
  hearAbout: 200,
  url: 2048,
  accessibilityNeeds: 2000,
  builtOrWantToBuild: 2000,
  shortDeadlineLearning: 2000,
  allergyDetails: 500,
  otherDietaryRestrictions: 500,
  otherMajor: 200,
  otherLevelOfStudy: 200,
  otherSchool: 200,
  otherHearAbout: 200,
  otherGender: 200,
  otherRaceEthnicity: 200,
} as const;

const CURRENT_YEAR = new Date().getFullYear();

export const MIN_HACKATHONS_ATTENDED = 0;
export const MAX_HACKATHONS_ATTENDED = 100;

export const MIN_AGE = 18;
/** Highest valid applicant age; values at or above 120 are rejected. */
export const MAX_AGE = 119;
export const AGE_UPPER_LIMIT_EXCLUSIVE = 120;
export const AGE_TOO_HIGH_MESSAGE = "Age must be less than 120.";
export const MIN_GRADUATION_YEAR = CURRENT_YEAR;
export const MAX_GRADUATION_YEAR = CURRENT_YEAR + 10;

export const MLH_PRIVACY_POLICY_URL = "https://github.com/MLH/mlh-policies/blob/main/privacy-policy.md";
export const MLH_CODE_OF_CONDUCT_URL = "https://static.mlh.io/docs/mlh-code-of-conduct.pdf";

export const SPONSOR_SHARING_CONSENT_TEXT =
  "I authorize HackUTA to share my resume and application information with HackUTA's sponsors for recruiting purposes. Sponsors may choose to contact me about internships and full-time position opportunities. (optional)";

export const FOOD_ALLERGY_WAIVER_TEXT =
  "I understand that HackUTA cannot guarantee that food served at this event is free of any particular allergen, and I accept responsibility for what I choose to eat.";
