const STORAGE_KEY =
  "ledgify_bank_rules";

const DEFAULT_RULES = [
  {
    id: "rule-001",
    name: "Stripe income",
    field: "description",
    operator: "contains",
    value: "Stripe",
    transactionType: "Money in",
    category: "Sales income",
    contact: "Stripe Payments UK",
    reference: "",
    vatRate: "20",
    isActive: true,
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  },
  {
    id: "rule-002",
    name: "Amazon purchases",
    field: "description",
    operator: "contains",
    value: "Amazon",
    transactionType: "Money out",
    category: "Office expenses",
    contact: "Amazon Business",
    reference: "",
    vatRate: "20",
    isActive: true,
    createdAt:
      new Date().toISOString(),
    updatedAt:
      new Date().toISOString(),
  },
];

// Saves bank rules.
const saveBankRules = (rules) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(rules)
  );

  return rules;
};

// Performs the initialise bank rules task.
const initialiseBankRules = () => {
  const storedRules =
    localStorage.getItem(
      STORAGE_KEY
    );

  if (storedRules) {
    try {
      return JSON.parse(
        storedRules
      );
    } catch {
      saveBankRules(
        DEFAULT_RULES
      );

      return DEFAULT_RULES;
    }
  }

  saveBankRules(
    DEFAULT_RULES
  );

  return DEFAULT_RULES;
};

// Normalizes text.
const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Gets bank rules.
export const getBankRules = ({
  search = "",
  status = "",
} = {}) => {
  let rules =
    initialiseBankRules();

  if (search.trim()) {
    const normalisedSearch =
      normaliseText(search);

    rules = rules.filter(
      (rule) =>
        [
          rule.name,
          rule.value,
          rule.category,
          rule.contact,
          rule.transactionType,
        ].some((value) =>
          normaliseText(value).includes(
            normalisedSearch
          )
        )
    );
  }

  if (status === "Active") {
    rules = rules.filter(
      (rule) => rule.isActive
    );
  }

  if (status === "Inactive") {
    rules = rules.filter(
      (rule) => !rule.isActive
    );
  }

  return [...rules].sort(
    (firstRule, secondRule) =>
      new Date(
        secondRule.createdAt
      ) -
      new Date(
        firstRule.createdAt
      )
  );
};

// Gets bank rule by id.
export const getBankRuleById = (
  ruleId
) => {
  return initialiseBankRules().find(
    (rule) =>
      String(rule.id) ===
      String(ruleId)
  );
};

// Creates bank rule.
export const createBankRule = (
  ruleData
) => {
  if (!ruleData.name?.trim()) {
    throw new Error(
      "Enter a rule name."
    );
  }

  if (!ruleData.field) {
    throw new Error(
      "Select a condition field."
    );
  }

  if (!ruleData.operator) {
    throw new Error(
      "Select a condition."
    );
  }

  if (!ruleData.value?.trim()) {
    throw new Error(
      "Enter a matching value."
    );
  }

  if (!ruleData.category) {
    throw new Error(
      "Select a category."
    );
  }

  const rules =
    initialiseBankRules();

  const timestamp =
    new Date().toISOString();

  const rule = {
    id: crypto.randomUUID(),
    name:
      ruleData.name.trim(),
    field:
      ruleData.field,
    operator:
      ruleData.operator,
    value:
      ruleData.value.trim(),
    transactionType:
      ruleData.transactionType ||
      "",
    category:
      ruleData.category,
    contact:
      ruleData.contact?.trim() ||
      "",
    reference:
      ruleData.reference?.trim() ||
      "",
    vatRate:
      ruleData.vatRate || "0",
    isActive:
      ruleData.isActive !== false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  saveBankRules([
    rule,
    ...rules,
  ]);

  return rule;
};

// Updates bank rule.
export const updateBankRule = (
  ruleId,
  changes
) => {
  const rules =
    initialiseBankRules();

  const existingRule =
    rules.find(
      (rule) =>
        String(rule.id) ===
        String(ruleId)
    );

  if (!existingRule) {
    throw new Error(
      "Bank rule not found."
    );
  }

  const updatedRules =
    rules.map((rule) => {
      if (
        String(rule.id) !==
        String(ruleId)
      ) {
        return rule;
      }

      return {
        ...rule,
        ...changes,
        name:
          changes.name !== undefined
            ? changes.name.trim()
            : rule.name,
        value:
          changes.value !==
          undefined
            ? changes.value.trim()
            : rule.value,
        contact:
          changes.contact !==
          undefined
            ? changes.contact.trim()
            : rule.contact,
        reference:
          changes.reference !==
          undefined
            ? changes.reference.trim()
            : rule.reference,
        updatedAt:
          new Date().toISOString(),
      };
    });

  saveBankRules(
    updatedRules
  );

  return updatedRules.find(
    (rule) =>
      String(rule.id) ===
      String(ruleId)
  );
};

// Deletes bank rule.
export const deleteBankRule = (
  ruleId
) => {
  const rules =
    initialiseBankRules();

  const rule =
    rules.find(
      (currentRule) =>
        String(
          currentRule.id
        ) ===
        String(ruleId)
    );

  if (!rule) {
    throw new Error(
      "Bank rule not found."
    );
  }

  saveBankRules(
    rules.filter(
      (currentRule) =>
        String(
          currentRule.id
        ) !==
        String(ruleId)
    )
  );

  return rule;
};

// Toggles bank rule.
export const toggleBankRule = (
  ruleId
) => {
  const rule =
    getBankRuleById(ruleId);

  if (!rule) {
    throw new Error(
      "Bank rule not found."
    );
  }

  return updateBankRule(
    ruleId,
    {
      isActive:
        !rule.isActive,
    }
  );
};

// Performs the matches operator task.
const matchesOperator = (
  actualValue,
  operator,
  expectedValue
) => {
  const actual =
    normaliseText(
      actualValue
    );

  const expected =
    normaliseText(
      expectedValue
    );

  if (!expected) {
    return false;
  }

  switch (operator) {
    case "equals":
      return actual === expected;

    case "startsWith":
      return actual.startsWith(
        expected
      );

    case "endsWith":
      return actual.endsWith(
        expected
      );

    case "contains":
    default:
      return actual.includes(
        expected
      );
  }
};

// Finds matching bank rule.
export const findMatchingBankRule = (
  transaction
) => {
  const activeRules =
    initialiseBankRules().filter(
      (rule) => rule.isActive
    );

  return activeRules.find(
    (rule) => {
      if (
        rule.transactionType &&
        rule.transactionType !==
          transaction.transactionType
      ) {
        return false;
      }

      const actualValue =
        transaction[
          rule.field
        ];

      return matchesOperator(
        actualValue,
        rule.operator,
        rule.value
      );
    }
  );
};

// Applies bank rule.
export const applyBankRule = (
  transaction,
  rule
) => {
  if (!rule) {
    return transaction;
  }

  return {
    ...transaction,
    category:
      rule.category ||
      transaction.category,
    contact:
      rule.contact ||
      transaction.contact,
    reference:
      rule.reference ||
      transaction.reference,
    vatRate:
      rule.vatRate || "0",
    appliedRuleId:
      rule.id,
    appliedRuleName:
      rule.name,
  };
};