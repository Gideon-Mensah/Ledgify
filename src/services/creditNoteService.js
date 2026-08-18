import {
  creditNotes as defaultCreditNotes,
} from "../data/creditNotes";

const STORAGE_KEY = "ledgify_credit_notes";

// Performs the clone data task.
const cloneData = (data) =>
  JSON.parse(JSON.stringify(data));

// Performs the initialise credit notes task.
const initialiseCreditNotes = () => {
  const storedCreditNotes =
    localStorage.getItem(STORAGE_KEY);

  if (storedCreditNotes) {
    try {
      return JSON.parse(storedCreditNotes);
    } catch (error) {
      console.error(
        "Unable to read saved credit notes:",
        error
      );
    }
  }

  const initialCreditNotes =
    cloneData(defaultCreditNotes);

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(initialCreditNotes)
  );

  return initialCreditNotes;
};

// Gets credit notes.
export const getCreditNotes = () => {
  return initialiseCreditNotes();
};

// Gets credit note by id.
export const getCreditNoteById = (
  creditNoteId
) => {
  return getCreditNotes().find(
    (creditNote) =>
      creditNote.id ===
      Number(creditNoteId)
  );
};

// Saves credit notes.
export const saveCreditNotes = (
  creditNotes
) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(creditNotes)
  );

  return creditNotes;
};

// Updates credit note.
export const updateCreditNote = (
  creditNoteId,
  updatedFields
) => {
  const creditNotes =
    getCreditNotes();

  const updatedCreditNotes =
    creditNotes.map((creditNote) =>
      creditNote.id ===
      Number(creditNoteId)
        ? {
            ...creditNote,
            ...updatedFields,
          }
        : creditNote
    );

  saveCreditNotes(
    updatedCreditNotes
  );

  return updatedCreditNotes.find(
    (creditNote) =>
      creditNote.id ===
      Number(creditNoteId)
  );
};

// Deletes credit note.
export const deleteCreditNote = (
  creditNoteId
) => {
  const updatedCreditNotes =
    getCreditNotes().filter(
      (creditNote) =>
        creditNote.id !==
        Number(creditNoteId)
    );

  saveCreditNotes(
    updatedCreditNotes
  );

  return updatedCreditNotes;
};

// Calculates next credit note number.
const calculateNextCreditNoteNumber = (
  creditNotes
) => {
  const highestNumber =
    creditNotes.reduce(
      (highest, creditNote) => {
        const numericPart = Number(
          String(
            creditNote.creditNoteNumber ||
              ""
          ).replace(/\D/g, "")
        );

        return Number.isFinite(
          numericPart
        )
          ? Math.max(
              highest,
              numericPart
            )
          : highest;
      },
      1000
    );

  return `CN-${highestNumber + 1}`;
};

// Gets next credit note number.
export const getNextCreditNoteNumber =
  () => {
    return calculateNextCreditNoteNumber(
      getCreditNotes()
    );
  };

// Resets credit notes.
export const resetCreditNotes = () => {
  const initialCreditNotes =
    cloneData(defaultCreditNotes);

  saveCreditNotes(
    initialCreditNotes
  );

  return initialCreditNotes;
};

// Creates credit note.
export const createCreditNote = (
  creditNoteData,
  status = "Draft"
) => {
  const creditNotes = getCreditNotes();

  const nextId =
    creditNotes.length > 0
      ? Math.max(
          ...creditNotes.map(
            (creditNote) =>
              Number(creditNote.id) || 0
          )
        ) + 1
      : 1;

  const now = new Date();

  const activityEntry = {
    id: crypto.randomUUID(),
    title:
      status === "Draft"
        ? "Credit note created"
        : "Credit note approved",
    description:
      status === "Draft"
        ? "Credit note was created as a draft."
        : "Credit note was approved and made available for allocation.",
    date: now.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  const newCreditNote = {
    id: nextId,
    creditNoteNumber:
      creditNoteData.creditNoteNumber ||
      calculateNextCreditNoteNumber(
        creditNotes
      ),
    customer: creditNoteData.customer,
    customerEmail:
      creditNoteData.customerEmail || "",
    customerAddress:
      creditNoteData.customerAddress || [],
    sourceInvoiceId:
      creditNoteData.sourceInvoiceId ||
      null,
    sourceInvoiceNumber:
      creditNoteData.sourceInvoiceNumber ||
      "",
    issueDate: creditNoteData.issueDate,
    reference:
      creditNoteData.reference || "",
    reason: creditNoteData.reason || "",
    status,
    currency:
      creditNoteData.currency || "GBP",
    pricingMode:
      creditNoteData.pricingMode ||
      "exclusive",
    amountApplied: 0,
    applications: [],
    items: creditNoteData.items || [],
    notes: creditNoteData.notes || "",
    createdAt: now.toISOString(),
    activity: [activityEntry],
  };

  saveCreditNotes([
    ...creditNotes,
    newCreditNote,
  ]);

  return newCreditNote;
};

// Performs the change credit note status task.
export const changeCreditNoteStatus = (
  creditNoteId,
  status,
  description
) => {
  const creditNote =
    getCreditNoteById(creditNoteId);

  if (!creditNote) {
    throw new Error(
      "Credit note not found."
    );
  }

  const now = new Date();

  const activityEntry = {
    id: crypto.randomUUID(),
    title:
      status === "Voided"
        ? "Credit note voided"
        : `Credit note ${status.toLowerCase()}`,
    description:
      description ||
      `Credit note was marked as ${status.toLowerCase()}.`,
    date: now.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  return updateCreditNote(
    creditNoteId,
    {
      status,
      updatedAt: now.toISOString(),
      activity: [
        activityEntry,
        ...(creditNote.activity || []),
      ],
    }
  );
};

// Applies credit note.
export const applyCreditNote = (
  creditNoteId,
  applicationData
) => {
  const creditNote =
    getCreditNoteById(creditNoteId);

  if (!creditNote) {
    throw new Error(
      "Credit note not found."
    );
  }

  if (
    creditNote.status === "Draft"
  ) {
    throw new Error(
      "Approve the credit note before applying it."
    );
  }

  if (
    creditNote.status === "Voided"
  ) {
    throw new Error(
      "A voided credit note cannot be applied."
    );
  }

  const amount =
    Number(applicationData.amount) || 0;

  if (amount <= 0) {
    throw new Error(
      "The applied amount must be greater than zero."
    );
  }

  const creditTotal =
    Number(applicationData.creditTotal) ||
    0;

  const currentAmountApplied =
    Number(
      creditNote.amountApplied
    ) || 0;

  const availableCredit = Math.max(
    creditTotal -
      currentAmountApplied,
    0
  );

  if (
    amount >
    availableCredit + 0.005
  ) {
    throw new Error(
      "The applied amount exceeds the available credit."
    );
  }

  const invoiceBalance =
    Number(
      applicationData.invoiceBalance
    ) || 0;

  if (
    amount >
    invoiceBalance + 0.005
  ) {
    throw new Error(
      "The applied amount exceeds the invoice balance."
    );
  }

  const now = new Date();

  const application = {
    id: crypto.randomUUID(),
    invoiceId:
      applicationData.invoiceId,
    invoiceNumber:
      applicationData.invoiceNumber,
    amount,
    appliedDate:
      now.toISOString(),
    appliedDateDisplay:
      now.toLocaleDateString(
        "en-GB",
        {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }
      ),
  };

  const nextAmountApplied =
    currentAmountApplied + amount;

  let nextStatus =
    "Part applied";

  if (
    nextAmountApplied >=
    creditTotal - 0.005
  ) {
    nextStatus = "Applied";
  }

  const activityEntry = {
    id: crypto.randomUUID(),
    title:
      nextStatus === "Applied"
        ? "Credit applied"
        : "Credit partially applied",
    description: `${new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency:
          creditNote.currency ||
          "GBP",
      }
    ).format(amount)} was applied to invoice ${
      applicationData.invoiceNumber
    }.`,
    date: now.toLocaleString(
      "en-GB",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    ),
  };

  return updateCreditNote(
    creditNoteId,
    {
      status: nextStatus,
      amountApplied:
        nextAmountApplied,
      applications: [
        application,
        ...(creditNote.applications ||
          []),
      ],
      updatedAt: now.toISOString(),
      activity: [
        activityEntry,
        ...(creditNote.activity || []),
      ],
    }
  );
};

// Performs the email credit note task.
export const emailCreditNote = (
  creditNoteId,
  emailData
) => {
  const creditNote =
    getCreditNoteById(creditNoteId);

  if (!creditNote) {
    throw new Error(
      "Credit note not found."
    );
  }

  const now = new Date();

  const emailRecord = {
    id: crypto.randomUUID(),
    to: emailData.to.trim(),
    cc:
      emailData.cc?.trim() || "",
    subject:
      emailData.subject.trim(),
    message:
      emailData.message.trim(),
    sentAt: now.toISOString(),
  };

  const activityEntry = {
    id: crypto.randomUUID(),
    title: "Credit note emailed",
    description: `${
      creditNote.creditNoteNumber
    } was emailed to ${
      emailRecord.to
    }.`,
    date: now.toLocaleString(
      "en-GB",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    ),
  };

  return updateCreditNote(
    creditNoteId,
    {
      emails: [
        emailRecord,
        ...(creditNote.emails || []),
      ],
      lastEmailedAt:
        now.toISOString(),
      updatedAt: now.toISOString(),
      activity: [
        activityEntry,
        ...(creditNote.activity || []),
      ],
    }
  );
};

// Performs the edit credit note task.
export const editCreditNote = (
  creditNoteId,
  creditNoteData
) => {
  const creditNote =
    getCreditNoteById(creditNoteId);

  if (!creditNote) {
    throw new Error(
      "Credit note not found."
    );
  }

  if (creditNote.status !== "Draft") {
    throw new Error(
      "Only draft credit notes can be edited."
    );
  }

  const now = new Date();

  const activityEntry = {
    id: crypto.randomUUID(),
    title: "Credit note updated",
    description:
      "Draft credit note details and items were updated.",
    date: now.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  return updateCreditNote(
    creditNoteId,
    {
      ...creditNoteData,
      updatedAt: now.toISOString(),
      activity: [
        activityEntry,
        ...(creditNote.activity || []),
      ],
    }
  );
};