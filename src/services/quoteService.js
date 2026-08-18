import { quotes as defaultQuotes } from "../data/quotes";

const STORAGE_KEY = "ledgify_quotes";

// Performs the clone data task.
const cloneData = (data) =>
  JSON.parse(JSON.stringify(data));

// Performs the initialise quotes task.
const initialiseQuotes = () => {
  const storedQuotes = localStorage.getItem(STORAGE_KEY);

  if (storedQuotes) {
    try {
      return JSON.parse(storedQuotes);
    } catch (error) {
      console.error("Unable to read saved quotes:", error);
    }
  }

  const initialQuotes = cloneData(defaultQuotes);

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(initialQuotes)
  );

  return initialQuotes;
};

// Gets quotes.
export const getQuotes = () => {
  return initialiseQuotes();
};

// Gets quote by id.
export const getQuoteById = (quoteId) => {
  return getQuotes().find(
    (quote) => quote.id === Number(quoteId)
  );
};

// Saves quotes.
export const saveQuotes = (quotes) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(quotes)
  );

  return quotes;
};

// Updates quote.
export const updateQuote = (quoteId, updatedFields) => {
  const quotes = getQuotes();

  const updatedQuotes = quotes.map((quote) =>
    quote.id === Number(quoteId)
      ? {
          ...quote,
          ...updatedFields,
        }
      : quote
  );

  saveQuotes(updatedQuotes);

  return updatedQuotes.find(
    (quote) => quote.id === Number(quoteId)
  );
};

// Performs the edit quote task.
export const editQuote = (quoteId, quoteData) => {
  const quote = getQuoteById(quoteId);

  if (!quote) {
    throw new Error("Quote not found.");
  }

  const now = new Date();

  const activityEntry = {
    id: crypto.randomUUID(),
    title: "Quote updated",
    description: "Quote details and line items were edited.",
    date: now.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  return updateQuote(quoteId, {
    ...quoteData,
    updatedAt: now.toISOString(),
    activity: [
      activityEntry,
      ...(quote.activity || []),
    ],
  });
};

// Performs the change quote status task.
export const changeQuoteStatus = (
  quoteId,
  status,
  description
) => {
  const quote = getQuoteById(quoteId);

  if (!quote) {
    throw new Error("Quote not found.");
  }

  const now = new Date();

  const activityEntry = {
    id: crypto.randomUUID(),
    title: `Quote ${status.toLowerCase()}`,
    description:
      description ||
      `Quote was marked as ${status.toLowerCase()}.`,
    date: now.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  return updateQuote(quoteId, {
    status,
    updatedAt: now.toISOString(),
    activity: [
      activityEntry,
      ...(quote.activity || []),
    ],
  });
};

// Performs the email quote task.
export const emailQuote = (
  quoteId,
  emailData
) => {
  const quote = getQuoteById(quoteId);

  if (!quote) {
    throw new Error("Quote not found.");
  }

  const now = new Date();

  const emailRecord = {
    id: crypto.randomUUID(),
    to: emailData.to.trim(),
    cc: emailData.cc?.trim() || "",
    subject: emailData.subject.trim(),
    message: emailData.message.trim(),
    sentAt: now.toISOString(),
  };

  const activityEntry = {
    id: crypto.randomUUID(),
    title: "Quote emailed",
    description: `${quote.quoteNumber} was emailed to ${emailRecord.to}.`,
    date: now.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  return updateQuote(quoteId, {
    status:
      quote.status === "Draft"
        ? "Sent"
        : quote.status,
    emails: [
      emailRecord,
      ...(quote.emails || []),
    ],
    lastEmailedAt: now.toISOString(),
    activity: [
      activityEntry,
      ...(quote.activity || []),
    ],
  });
};



// Deletes quote.
export const deleteQuote = (quoteId) => {
  const updatedQuotes = getQuotes().filter(
    (quote) => quote.id !== Number(quoteId)
  );

  saveQuotes(updatedQuotes);

  return updatedQuotes;
};

// Gets next quote number.
export const getNextQuoteNumber = () => {
  return calculateNextQuoteNumber(getQuotes());
};

// Calculates next quote number.
const calculateNextQuoteNumber = (quotes) => {
  const highestNumber = quotes.reduce(
    (highest, quote) => {
      const numericPart = Number(
        String(quote.quoteNumber || "").replace(/\D/g, "")
      );

      return Number.isFinite(numericPart)
        ? Math.max(highest, numericPart)
        : highest;
    },
    1000
  );

  return `QUO-${highestNumber + 1}`;
};

// Creates quote.
export const createQuote = (
  quoteData,
  status = "Draft"
) => {
  const quotes = getQuotes();

  const nextId =
    quotes.length > 0
      ? Math.max(
          ...quotes.map(
            (quote) => Number(quote.id) || 0
          )
        ) + 1
      : 1;

  const now = new Date();

  const activityEntry =
    status === "Draft"
      ? {
          id: crypto.randomUUID(),
          title: "Quote created",
          description: "Quote was created as a draft.",
          date: now.toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        }
      : {
          id: crypto.randomUUID(),
          title: "Quote sent",
          description:
            "Quote was created and marked as sent.",
          date: now.toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        };

  const newQuote = {
    id: nextId,
    quoteNumber:
      quoteData.quoteNumber ||
      calculateNextQuoteNumber(quotes),
    customer: quoteData.customer,
    customerEmail: quoteData.customerEmail || "",
    customerAddress: quoteData.customerAddress || [],
    issueDate: quoteData.issueDate,
    expiryDate: quoteData.expiryDate,
    reference: quoteData.reference || "",
    status,
    currency: quoteData.currency || "GBP",
    pricingMode:
      quoteData.pricingMode || "exclusive",
    items: quoteData.items || [],
    notes: quoteData.notes || "",
    createdAt: now.toISOString(),
    activity: [activityEntry],
  };

  saveQuotes([...quotes, newQuote]);

  return newQuote;
};