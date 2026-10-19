import { describe, expect, it } from "vitest";
import { APPLICANT_DRAFT_PATCH_FIELD_KEYS } from "../../convex/applicationFields";
import {
  APPLICANT_ANSWER_FIELD_KEYS,
  TRIMMED_STRING_FIELDS,
} from "../../shared/registration/applicantFields";
import { FIELD_LIMITS } from "../../shared/registration/constants";
import {
  applicationToDraftForm,
  formToDraftPatch,
  mergeDraftPatchIntoApplication,
} from "../../shared/registration/draftMapping";
import {
  EMERGENCY_CONTACT_FIELDS,
  EMERGENCY_CONTACT_REQUIRED_MESSAGES,
  isEmergencyContactStarted,
  missingEmergencyContactFields,
  type EmergencyContactField,
} from "../../shared/registration/emergencyContact";
import { INITIAL_FORM, type ApplicationFormData } from "../../shared/registration/types";
import {
  validateApplicationForm,
  validateRegistrationPayload,
} from "../../shared/registration/validation";
import {
  validRegistrationForm,
  validRegistrationPayload,
} from "../fixtures/validRegistrationForm";

const FILLED: Record<EmergencyContactField, string> = {
  emergencyContactName: "Jane Test",
  emergencyContactRelationship: "Parent",
  emergencyContactPhone: "5559876543",
};

const EMPTY: Record<EmergencyContactField, string> = {
  emergencyContactName: "",
  emergencyContactRelationship: "",
  emergencyContactPhone: "",
};

function formWithContact(
  contact: Partial<Record<EmergencyContactField, string>>,
): ApplicationFormData {
  return { ...validRegistrationForm(), ...EMPTY, ...contact };
}

/** Every non-empty, non-full subset of the three fields. */
const PARTIAL_COMBINATIONS: EmergencyContactField[][] = [
  ["emergencyContactName"],
  ["emergencyContactRelationship"],
  ["emergencyContactPhone"],
  ["emergencyContactName", "emergencyContactRelationship"],
  ["emergencyContactName", "emergencyContactPhone"],
  ["emergencyContactRelationship", "emergencyContactPhone"],
];

describe("emergency contact field registration", () => {
  it("stores relationship alongside name and phone as trimmed draft fields", () => {
    for (const field of EMERGENCY_CONTACT_FIELDS) {
      expect(TRIMMED_STRING_FIELDS).toContain(field);
      expect(APPLICANT_ANSWER_FIELD_KEYS).toContain(field);
      expect(APPLICANT_DRAFT_PATCH_FIELD_KEYS).toContain(field);
      expect(INITIAL_FORM[field]).toBe("");
    }
    expect(FIELD_LIMITS.emergencyContactRelationship).toBe(100);
  });
});

describe("isEmergencyContactStarted / missingEmergencyContactFields", () => {
  it("treats a fully blank contact as not started", () => {
    expect(isEmergencyContactStarted(EMPTY)).toBe(false);
    expect(isEmergencyContactStarted({})).toBe(false);
    expect(missingEmergencyContactFields(EMPTY)).toEqual([]);
  });

  it("treats whitespace-only values as blank", () => {
    const blankish = {
      emergencyContactName: "   ",
      emergencyContactRelationship: "\t",
      emergencyContactPhone: "\n ",
    };
    expect(isEmergencyContactStarted(blankish)).toBe(false);
    expect(missingEmergencyContactFields(blankish)).toEqual([]);
  });

  it("reports nothing missing when every field is filled", () => {
    expect(missingEmergencyContactFields(FILLED)).toEqual([]);
  });

  it.each(PARTIAL_COMBINATIONS)(
    "reports the blank fields when only %s is filled",
    (...filled) => {
      const values = { ...EMPTY };
      for (const field of filled) values[field] = FILLED[field];
      const expectedMissing = EMERGENCY_CONTACT_FIELDS.filter(
        (field) => !filled.includes(field),
      );
      expect(missingEmergencyContactFields(values)).toEqual(expectedMissing);
    },
  );
});

describe("validateApplicationForm emergency contact", () => {
  it("accepts an application with no emergency contact and omits it from the payload", () => {
    const result = validateApplicationForm(formWithContact({}));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.emergencyContactName).toBeUndefined();
      expect(result.payload.emergencyContactRelationship).toBeUndefined();
      expect(result.payload.emergencyContactPhone).toBeUndefined();
    }
  });

  it("accepts whitespace-only fields as an empty contact", () => {
    const result = validateApplicationForm(
      formWithContact({
        emergencyContactName: "  ",
        emergencyContactRelationship: "   ",
        emergencyContactPhone: " ",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.emergencyContactName).toBeUndefined();
      expect(result.payload.emergencyContactRelationship).toBeUndefined();
      expect(result.payload.emergencyContactPhone).toBeUndefined();
    }
  });

  it("accepts a complete contact and trims each value", () => {
    const result = validateApplicationForm(
      formWithContact({
        emergencyContactName: "  Jane Test ",
        emergencyContactRelationship: " Mother  ",
        emergencyContactPhone: " (555) 987-6543 ",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.emergencyContactName).toBe("Jane Test");
      expect(result.payload.emergencyContactRelationship).toBe("Mother");
      expect(result.payload.emergencyContactPhone).toBe("(555)-987-6543");
    }
  });

  it.each(PARTIAL_COMBINATIONS)(
    "blocks submit and flags the missing fields when only %s is filled",
    (...filled) => {
      const contact: Partial<Record<EmergencyContactField, string>> = {};
      for (const field of filled) contact[field] = FILLED[field];

      const result = validateApplicationForm(formWithContact(contact));
      expect(result.success).toBe(false);
      if (!result.success) {
        for (const field of EMERGENCY_CONTACT_FIELDS) {
          if (filled.includes(field)) {
            expect(result.errors[field]).toBeUndefined();
          } else {
            expect(result.errors[field]).toBe(EMERGENCY_CONTACT_REQUIRED_MESSAGES[field]);
          }
        }
      }
    },
  );

  it("does not let whitespace satisfy a required sibling of a started contact", () => {
    const result = validateApplicationForm(
      formWithContact({
        emergencyContactName: "Jane Test",
        emergencyContactRelationship: "   ",
        emergencyContactPhone: "5559876543",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.emergencyContactRelationship).toBe(
        EMERGENCY_CONTACT_REQUIRED_MESSAGES.emergencyContactRelationship,
      );
    }
  });

  it("flags missing emergency fields alongside unrelated errors on the same submit", () => {
    const form = formWithContact({ emergencyContactPhone: "5559876543" });
    form.firstName = "";

    const result = validateApplicationForm(form);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.firstName).toBe("First name is required.");
      expect(result.errors.emergencyContactName).toBe(
        EMERGENCY_CONTACT_REQUIRED_MESSAGES.emergencyContactName,
      );
      expect(result.errors.emergencyContactRelationship).toBe(
        EMERGENCY_CONTACT_REQUIRED_MESSAGES.emergencyContactRelationship,
      );
    }
  });

  it("still validates phone format once the contact is complete", () => {
    const result = validateApplicationForm(
      formWithContact({ ...FILLED, emergencyContactPhone: "12345" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.emergencyContactPhone).toBe("Enter a valid phone number.");
    }
  });

  it("reports both an invalid phone and missing siblings when only a bad phone is given", () => {
    const result = validateApplicationForm(
      formWithContact({ emergencyContactPhone: "abc" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.emergencyContactPhone).toBe("Enter a valid phone number.");
      expect(result.errors.emergencyContactName).toBe(
        EMERGENCY_CONTACT_REQUIRED_MESSAGES.emergencyContactName,
      );
      expect(result.errors.emergencyContactRelationship).toBe(
        EMERGENCY_CONTACT_REQUIRED_MESSAGES.emergencyContactRelationship,
      );
    }
  });

  it.each([
    ["emergencyContactName", FIELD_LIMITS.name, "Emergency contact name is too long."],
    [
      "emergencyContactRelationship",
      FIELD_LIMITS.emergencyContactRelationship,
      "Emergency contact relationship is too long.",
    ],
  ] as const)("rejects %s over %i characters", (field, max, message) => {
    const result = validateApplicationForm(
      formWithContact({ ...FILLED, [field]: "a".repeat(max + 1) }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[field]).toBe(message);
    }
  });

  it("rejects markup in the relationship field", () => {
    const result = validateApplicationForm(
      formWithContact({
        ...FILLED,
        emergencyContactRelationship: "<script>alert(1)</script>",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.emergencyContactRelationship).toBe(
        "Please remove HTML or script content.",
      );
    }
  });
});

describe("validateRegistrationPayload emergency contact (server)", () => {
  it("accepts a payload with the emergency contact omitted entirely", () => {
    const payload: Record<string, unknown> = { ...validRegistrationPayload() };
    for (const field of EMERGENCY_CONTACT_FIELDS) delete payload[field];

    expect(validateRegistrationPayload(payload).success).toBe(true);
  });

  it("accepts a payload with a complete emergency contact", () => {
    const result = validateRegistrationPayload(validRegistrationPayload());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload.emergencyContactRelationship).toBe("Parent");
    }
  });

  it.each(PARTIAL_COMBINATIONS)(
    "rejects a crafted payload that bypasses the client with only %s",
    (...filled) => {
      const payload: Record<string, unknown> = { ...validRegistrationPayload() };
      for (const field of EMERGENCY_CONTACT_FIELDS) {
        if (!filled.includes(field)) delete payload[field];
      }

      expect(validateRegistrationPayload(payload).success).toBe(false);
    },
  );

  it("rejects a payload whose missing sibling is only whitespace", () => {
    const payload = {
      ...validRegistrationPayload(),
      emergencyContactRelationship: "   ",
    };

    expect(validateRegistrationPayload(payload).success).toBe(false);
  });
});

describe("emergency contact draft autosave", () => {
  it("round-trips a partially filled contact so applicants can finish later", () => {
    const form = formWithContact({ emergencyContactRelationship: "Roommate" });
    const patch = formToDraftPatch(form);
    expect(patch.emergencyContactRelationship).toBe("Roommate");
    expect(patch.emergencyContactName).toBe("");

    const merged = mergeDraftPatchIntoApplication(
      { authUserId: "user1" } as Record<string, unknown>,
      patch,
      { email: "sam@example.com", updatedAt: 1 },
    );
    const restored = applicationToDraftForm(
      merged as { emergencyContactRelationship?: string },
    );
    expect(restored.emergencyContactRelationship).toBe("Roommate");
    expect(restored.emergencyContactName).toBe("");
  });

  it("restores a missing relationship on legacy applications as an empty string", () => {
    const restored = applicationToDraftForm({
      emergencyContactName: "Jane Test",
      emergencyContactPhone: "5559876543",
    } as Record<string, unknown>);
    expect(restored.emergencyContactRelationship).toBe("");
  });
});
