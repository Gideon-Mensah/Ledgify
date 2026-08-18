// Normalizes duplicate value.
const normaliseDuplicateValue = (
    value
) =>
    String(value || "")
        .trim()
        .toLowerCase();

// Creates transaction duplicate key.
const createTransactionDuplicateKey = (
    transaction
) =>
    [
        transaction.bankAccountId,
        transaction.date,
        transaction.transactionType,
        Number(
            transaction.amount
        ).toFixed(2),
        normaliseDuplicateValue(
            transaction.description
        ),
        normaliseDuplicateValue(
            transaction.reference
        ),
    ].join("|");

// Performs the split csv row task.
const splitCsvRow = (row) => {
    const values = [];
    let currentValue = "";
    let insideQuotes = false;

    for (
        let index = 0;
        index < row.length;
        index += 1
    ) {
        const character =
            row[index];

        if (character === '"') {
            const nextCharacter =
                row[index + 1];

            if (
                insideQuotes &&
                nextCharacter === '"'
            ) {
                currentValue += '"';
                index += 1;
            } else {
                insideQuotes =
                    !insideQuotes;
            }

            continue;
        }

        if (
            character === "," &&
            !insideQuotes
        ) {
            values.push(
                currentValue.trim()
            );

            currentValue = "";
            continue;
        }

        currentValue += character;
    }

    values.push(
        currentValue.trim()
    );

    return values;
};

// Normalizes header.
const normaliseHeader = (
    header
) =>
    String(header || "")
        .trim()
        .toLowerCase()
        .replace(
            /[^a-z0-9]/g,
            ""
        );

// Finds suggested column.
const findSuggestedColumn = (
    headers,
    possibleNames
) => {
    const normalisedNames =
        possibleNames.map(
            normaliseHeader
        );

    const matchingHeader =
        headers.find(
            (header) =>
                normalisedNames.includes(
                    normaliseHeader(header)
                )
        );

    return matchingHeader || "";
};

// Parses bank statement csv.
export const parseBankStatementCsv =
    async (file) => {
        if (!file) {
            throw new Error(
                "Select a CSV file."
            );
        }

        const fileText =
            await file.text();

        const rows = fileText
            .replace(
                /^\uFEFF/,
                ""
            )
            .split(/\r?\n/)
            .filter(
                (row) =>
                    row.trim() !== ""
            );

        if (rows.length < 2) {
            throw new Error(
                "The CSV file must contain a header row and at least one transaction."
            );
        }

        const headers =
            splitCsvRow(
                rows[0]
            );

        if (
            headers.length < 2
        ) {
            throw new Error(
                "The CSV file does not contain enough columns."
            );
        }

        const dataRows = rows
            .slice(1)
            .map(
                (row, rowIndex) => {
                    const values =
                        splitCsvRow(row);

                    return headers.reduce(
                        (
                            parsedRow,
                            header,
                            columnIndex
                        ) => {
                            parsedRow[header] =
                                values[
                                columnIndex
                                ] || "";

                            return parsedRow;
                        },
                        {
                            __rowNumber:
                                rowIndex + 2,
                        }
                    );
                }
            );

        return {
            headers,
            rows: dataRows,
            suggestedMapping: {
                date:
                    findSuggestedColumn(
                        headers,
                        [
                            "date",
                            "transaction date",
                            "posted date",
                            "booking date",
                        ]
                    ),

                description:
                    findSuggestedColumn(
                        headers,
                        [
                            "description",
                            "details",
                            "transaction description",
                            "narrative",
                            "merchant",
                        ]
                    ),

                reference:
                    findSuggestedColumn(
                        headers,
                        [
                            "reference",
                            "transaction reference",
                            "ref",
                        ]
                    ),

                contact:
                    findSuggestedColumn(
                        headers,
                        [
                            "contact",
                            "payee",
                            "payer",
                            "merchant name",
                        ]
                    ),

                amount:
                    findSuggestedColumn(
                        headers,
                        [
                            "amount",
                            "transaction amount",
                            "value",
                        ]
                    ),

                moneyIn:
                    findSuggestedColumn(
                        headers,
                        [
                            "money in",
                            "credit",
                            "paid in",
                            "deposit",
                        ]
                    ),

                moneyOut:
                    findSuggestedColumn(
                        headers,
                        [
                            "money out",
                            "debit",
                            "paid out",
                            "withdrawal",
                        ]
                    ),

                transactionType:
                    findSuggestedColumn(
                        headers,
                        [
                            "transaction type",
                            "type",
                            "credit debit",
                        ]
                    ),
            },
        };
    };

// Performs the clean amount task.
const cleanAmount = (value) => {
    const cleanedValue =
        String(value || "")
            .trim()
            .replace(/[£,$€\s]/g, "")
            .replace(/\((.*)\)/, "-$1");

    if (!cleanedValue) {
        return 0;
    }

    const parsedAmount =
        Number(cleanedValue);

    return Number.isFinite(
        parsedAmount
    )
        ? parsedAmount
        : 0;
};

// Parses statement date.
const parseStatementDate = (
    value
) => {
    const dateValue =
        String(value || "").trim();

    if (!dateValue) {
        return "";
    }

    const directDate =
        new Date(dateValue);

    if (
        !Number.isNaN(
            directDate.getTime()
        )
    ) {
        return directDate
            .toISOString()
            .slice(0, 10);
    }

    const ukDateMatch =
        dateValue.match(
            /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/
        );

    if (!ukDateMatch) {
        return "";
    }

    const [, day, month, year] =
        ukDateMatch;

    const fullYear =
        year.length === 2
            ? Number(year) + 2000
            : Number(year);

    const parsedDate =
        new Date(
            fullYear,
            Number(month) - 1,
            Number(day)
        );

    if (
        Number.isNaN(
            parsedDate.getTime()
        )
    ) {
        return "";
    }

    return [
        parsedDate.getFullYear(),
        String(
            parsedDate.getMonth() + 1
        ).padStart(2, "0"),
        String(
            parsedDate.getDate()
        ).padStart(2, "0"),
    ].join("-");
};

// Performs the determine transaction type task.
const determineTransactionType = ({
    row,
    mapping,
    amount,
    moneyIn,
    moneyOut,
}) => {
    if (mapping.moneyIn) {
        if (moneyIn > 0) {
            return "Money in";
        }

        if (moneyOut > 0) {
            return "Money out";
        }
    }

    if (
        mapping.transactionType
    ) {
        const typeValue =
            String(
                row[
                mapping.transactionType
                ] || ""
            )
                .trim()
                .toLowerCase();

        if (
            [
                "credit",
                "money in",
                "deposit",
                "income",
                "in",
            ].includes(typeValue)
        ) {
            return "Money in";
        }

        if (
            [
                "debit",
                "money out",
                "withdrawal",
                "expense",
                "out",
            ].includes(typeValue)
        ) {
            return "Money out";
        }
    }

    return amount < 0
        ? "Money out"
        : "Money in";
};

// Builds statement transactions.
export const buildStatementTransactions =
    ({
        rows = [],
        mapping = {},
        bankAccountId,
        existingTransactions = [],
    }) => {
        const existingDuplicateKeys =
            new Set(
                existingTransactions.map(
                    createTransactionDuplicateKey
                )
            );

        const statementDuplicateKeys =
            new Set();
        return rows.map((row) => {
            const rawAmount =
                mapping.amount
                    ? cleanAmount(
                        row[mapping.amount]
                    )
                    : 0;

            const moneyIn =
                mapping.moneyIn
                    ? Math.abs(
                        cleanAmount(
                            row[
                            mapping.moneyIn
                            ]
                        )
                    )
                    : 0;

            const moneyOut =
                mapping.moneyOut
                    ? Math.abs(
                        cleanAmount(
                            row[
                            mapping.moneyOut
                            ]
                        )
                    )
                    : 0;

            const transactionType =
                determineTransactionType({
                    row,
                    mapping,
                    amount: rawAmount,
                    moneyIn,
                    moneyOut,
                });

            const amount =
                mapping.amount
                    ? Math.abs(rawAmount)
                    : transactionType ===
                        "Money in"
                        ? moneyIn
                        : moneyOut;

            const date =
                parseStatementDate(
                    row[mapping.date]
                );

            const description =
                String(
                    row[
                    mapping.description
                    ] || ""
                ).trim();

            const reference =
                mapping.reference
                    ? String(
                        row[
                        mapping.reference
                        ] || ""
                    ).trim()
                    : "";

            const contact =
                mapping.contact
                    ? String(
                        row[
                        mapping.contact
                        ] || ""
                    ).trim()
                    : "";

            const duplicateKey =
                createTransactionDuplicateKey({
                    bankAccountId,
                    date,
                    description,
                    reference,
                    transactionType,
                    amount,
                });

            const isExistingDuplicate =
                existingDuplicateKeys.has(
                    duplicateKey
                );

            const isStatementDuplicate =
                statementDuplicateKeys.has(
                    duplicateKey
                );

            statementDuplicateKeys.add(
                duplicateKey
            );

            const errors = [];

            if (!date) {
                errors.push(
                    "Invalid transaction date"
                );
            }

            if (!description) {
                errors.push(
                    "Description is missing"
                );
            }

            if (amount <= 0) {
                errors.push(
                    "Amount must be greater than zero"
                );
            }

            if (
                isExistingDuplicate ||
                isStatementDuplicate
            ) {
                errors.push(
                    "Possible duplicate transaction"
                );
            }

            return {
                temporaryId:
                    `statement-row-${row.__rowNumber}`,

                rowNumber:
                    row.__rowNumber,

                bankAccountId,

                date,

                description,

                reference,

                contact,

                category:
                    "Uncategorised",

                transactionType,

                amount,

                status:
                    "Unreconciled",

                source:
                    "Statement import",

                errors,

                duplicateKey,

                isDuplicate:
                    isExistingDuplicate ||
                    isStatementDuplicate,

                isValid:
                    errors.length === 0,

                selected:
                    errors.length === 0,
            };
        });
    };