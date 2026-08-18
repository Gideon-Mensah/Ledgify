import { getJournals } from "./journalService";

const roundMoney = (value) =>
  Math.round(
    ((Number(value) || 0) + Number.EPSILON) * 100
  ) / 100;

const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normaliseDate = (value) => {
  if (!value) {
    return null;
  }

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsedDate = new Date(text);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const year = parsedDate.getFullYear();
  const month = String(
    parsedDate.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    parsedDate.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const getJournalDate = (journal) =>
  normaliseDate(
    journal?.date ||
      journal?.journalDate ||
      journal?.postedAt ||
      journal?.createdAt
  );

const getJournalStatus = (journal) => {
  const status = normaliseText(
    journal?.status
  );

  if (status === "reversed") {
    return "Reversed";
  }

  if (status === "draft") {
    return "Draft";
  }

  return "Posted";
};

const getJournalSource = (journal) => {
  const sourceType = String(
    journal?.sourceType || ""
  ).trim();

  if (sourceType) {
    return sourceType;
  }

  return journal?.isSystem
    ? "System journal"
    : "Manual journal";
};

const getJournalAction = (journal) => {
  if (journal?.sourceAction) {
    return journal.sourceAction;
  }

  const status = getJournalStatus(journal);

  if (status === "Reversed") {
    return "Journal reversed";
  }

  return journal?.isSystem
    ? "System journal posted"
    : "Manual journal posted";
};

const getLineTotals = (journal) => {
  const lines = Array.isArray(
    journal?.lines
  )
    ? journal.lines
    : [];

  return lines.reduce(
    (totals, line) => ({
      debit: roundMoney(
        totals.debit +
          (Number(line?.debit) || 0)
      ),
      credit: roundMoney(
        totals.credit +
          (Number(line?.credit) || 0)
      ),
    }),
    {
      debit: 0,
      credit: 0,
    }
  );
};

const getLineCount = (journal) =>
  Array.isArray(journal?.lines)
    ? journal.lines.length
    : 0;

const getCreatedBy = (journal) =>
  journal?.createdBy ||
  journal?.userName ||
  journal?.user ||
  (journal?.isSystem
    ? "Ledgify System"
    : "Current user");

const rowMatchesSearch = (
  row,
  searchValue
) => {
  if (!searchValue) {
    return true;
  }

  return [
    row.reference,
    row.description,
    row.source,
    row.sourceNumber,
    row.action,
    row.status,
    row.createdBy,
  ].some((value) =>
    normaliseText(value).includes(
      searchValue
    )
  );
};

const sortRows = (rows) =>
  [...rows].sort((first, second) => {
    const dateComparison = String(
      second.date || ""
    ).localeCompare(
      String(first.date || "")
    );

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return String(
      second.createdAt || ""
    ).localeCompare(
      String(first.createdAt || "")
    );
  });

export const getAuditTrail = ({
  fromDate = "",
  toDate = "",
  search = "",
  source = "all",
  status = "all",
} = {}) => {
  const resolvedFromDate =
    normaliseDate(fromDate);

  const resolvedToDate =
    normaliseDate(toDate);

  if (
    resolvedFromDate &&
    resolvedToDate &&
    resolvedFromDate > resolvedToDate
  ) {
    throw new Error(
      "The start date cannot be after the end date."
    );
  }

  const allRows = sortRows(
    getJournals().map((journal) => {
      const totals =
        getLineTotals(journal);

      return {
        id: journal.id,

        journalId: journal.id,

        date: getJournalDate(journal),

        reference:
          journal.reference ||
          journal.sourceNumber ||
          "—",

        description:
          journal.description ||
          "Journal entry",

        source:
          getJournalSource(journal),

        sourceId:
          journal.sourceId || null,

        sourceNumber:
          journal.sourceNumber || "",

        action:
          getJournalAction(journal),

        status:
          getJournalStatus(journal),

        createdBy:
          getCreatedBy(journal),

        createdAt:
          journal.createdAt ||
          journal.postedAt ||
          "",

        reversedAt:
          journal.reversedAt || "",

        reversalReason:
          journal.reversalReason || "",

        lineCount:
          getLineCount(journal),

        totalDebit:
          totals.debit,

        totalCredit:
          totals.credit,

        balanced:
          Math.abs(
            totals.debit -
              totals.credit
          ) <= 0.005,

        isSystem:
          Boolean(
            journal.isSystem ||
              journal.sourceType
          ),
      };
    })
  );

  const sourceOptions = Array.from(
    new Set(
      allRows
        .map((row) => row.source)
        .filter(Boolean)
    )
  ).sort((first, second) =>
    first.localeCompare(second)
  );

  const searchValue =
    normaliseText(search);

  const rows = allRows.filter((row) => {
    if (
      resolvedFromDate &&
      row.date &&
      row.date < resolvedFromDate
    ) {
      return false;
    }

    if (
      resolvedToDate &&
      row.date &&
      row.date > resolvedToDate
    ) {
      return false;
    }

    if (
      source !== "all" &&
      row.source !== source
    ) {
      return false;
    }

    if (
      status !== "all" &&
      normaliseText(row.status) !==
        normaliseText(status)
    ) {
      return false;
    }

    return rowMatchesSearch(
      row,
      searchValue
    );
  });

  const postedCount = allRows.filter(
    (row) => row.status === "Posted"
  ).length;

  const reversedCount = allRows.filter(
    (row) => row.status === "Reversed"
  ).length;

  const systemCount = allRows.filter(
    (row) => row.isSystem
  ).length;

  const manualCount =
    allRows.length - systemCount;

  return {
    fromDate: resolvedFromDate,
    toDate: resolvedToDate,
    rows,
    sourceOptions,
    totalCount: allRows.length,
    visibleCount: rows.length,
    postedCount,
    reversedCount,
    systemCount,
    manualCount,
  };
};

export const exportAuditTrailCsv = (
  options = {}
) => {
  const report =
    getAuditTrail(options);

  const escapeCsv = (value) => {
    const text = String(value ?? "");

    if (/[",\n]/.test(text)) {
      return `"${text.replace(
        /"/g,
        '""'
      )}"`;
    }

    return text;
  };

  const rows = [
    [
      "Audit Trail",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "From",
      report.fromDate || "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "To",
      report.toDate || "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    ["", "", "", "", "", "", "", ""],
    [
      "Date",
      "Reference",
      "Source",
      "Action",
      "Status",
      "Created By",
      "Debit",
      "Credit",
    ],

    ...report.rows.map((row) => [
      row.date || "",
      row.reference,
      row.source,
      row.action,
      row.status,
      row.createdBy,
      row.totalDebit.toFixed(2),
      row.totalCredit.toFixed(2),
    ]),
  ];

  return rows
    .map((row) =>
      row.map(escapeCsv).join(",")
    )
    .join("\n");
};